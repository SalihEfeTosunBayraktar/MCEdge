import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildTarget } from "./build/gradle.ts";
import { resolveModDependencies } from "./build/modDependencies.ts";
import { generateTarget } from "./generator/generate.ts";
import { listEngines, toolchainNeeds } from "./engines/registry.ts";
import { ensureToolchains } from "./engines/toolchains.ts";
import { ROOT } from "./paths.ts";
import { isProjectDir, loadProblemSettings, loadProject } from "./ir/storage.ts";
import { blocksBuild, classify } from "./ir/problems.ts";
import { serveMcp } from "./mcp/server.ts";
import { validateProject } from "./ir/validate.ts";

const messages: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "config/messages.json"), "utf8"));

function say(key: string, values: Record<string, string | number> = {}): void {
  console.log(messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name])));
}

async function main(args: string[]): Promise<number> {
  const [command, projectArg] = args;
  if (command === "mcp" && projectArg) {
    // stdout belongs to the MCP protocol from here on; nothing else may print to it.
    await serveMcp(projectArg);
    return 0;
  }
  if (command === "engines") {
    listEngines().forEach((engine) => say("engineLine", { id: engine.id, name: engine.name, dir: engine.dir }));
    return 0;
  }
  if (command !== "build" || !projectArg) {
    say("usage");
    return 2;
  }
  const targetArg = args[args.indexOf("--target") + 1] ?? "all";
  const runGradle = !args.includes("--no-gradle");

  const projectDir = resolve(projectArg);
  if (!isProjectDir(projectDir)) {
    say("notAProject", { dir: projectDir });
    return 2;
  }
  const project = loadProject(projectDir);
  // Errors stop the build; warnings and info print and the build goes on; ignored problems stay quiet (KUYRUK 196).
  const { shown: issues } = classify(validateProject(project, projectDir), loadProblemSettings(projectDir));
  if (issues.length) {
    say(blocksBuild(issues) ? "invalidProject" : "projectWarnings");
    issues.forEach((issue) => console.log(`  ${issue.severity}: ${issue.path}: ${issue.message}`));
    if (blocksBuild(issues)) return 1;
  }

  const all = listEngines();
  const targets = args.includes("--target") && targetArg !== "all" ? all.filter((t) => t.id === targetArg) : all;
  if (!targets.length) {
    say("unknownTarget", { target: targetArg, available: all.map((t) => t.id).join(", ") });
    return 2;
  }

  let ok = 0;
  for (const target of targets) {
    const outDir = join(projectDir, "out", target.id);
    // Jars of the mods the project depends on, for the build's dev runs (KUYRUK 152).
    if (runGradle) await resolveModDependencies(project.mod.dependencies, target, { onLine: (line) => process.stderr.write(`${line}\n`) });
    const { skipped, warnings } = generateTarget(project, projectDir, target, outDir);
    say("generated", { target: target.id, dir: outDir });
    skipped.forEach((s) => say("skipped", { target: target.id, element: `${s.typeId}/${s.id}`, reason: s.reason }));
    warnings.forEach((message) => say("warning", { target: target.id, message }));
    if (!runGradle) continue;
    await ensureToolchains(toolchainNeeds(target), ({ kind, version, received, total }) =>
      process.stderr.write(`
${kind} ${version}: ${Math.round(received / 1e6)}${total ? `/${Math.round(total / 1e6)}` : ""} MB`),
    );
    say("building", { target: target.id, gradle: target.gradle.version, jdk: target.gradle.jdk });
    const result = await buildTarget(target, outDir);
    if (result.ok && result.jar) {
      ok++;
      say("built", { target: target.id, jar: result.jar });
    } else {
      say("buildFailed", { target: target.id, code: result.exitCode, log: result.logFile });
    }
  }
  if (runGradle) say("summary", { ok, total: targets.length });
  return runGradle && ok !== targets.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
