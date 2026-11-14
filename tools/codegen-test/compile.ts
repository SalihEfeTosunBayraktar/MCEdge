// Fast check while writing generator code: generates the test project (no Gradle build) and runs compileJava on the
// given engines in parallel (default all 5), with a Gradle daemon. One line per engine plus the first errors.
// Logs: logs/compile-<engine>.log. Stop the daemons afterwards with: node tools/codegen-test/compile.ts --stop
// usage: node tools/codegen-test/compile.ts [engine...]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineSetup } from "../../src/build/gradle.ts";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
const args = process.argv.slice(2);
const engines = listEngines().filter((e) => (args.filter((a) => !a.startsWith("--")).length ? args.includes(e.id) : true));
mkdirSync(join(T, "logs"), { recursive: true });

if (args.includes("--stop")) {
  for (const engine of engines) {
    const s = engineSetup(engine, join(T, "project/out", engine.id));
    spawnSync("cmd.exe", ["/d", "/c", s.launcher, "--stop"], { cwd: s.projectDir, env: { ...process.env, JAVA_HOME: s.javaHome } });
  }
  console.log("daemons stopped");
  process.exit(0);
}

await Promise.all(engines.map(async (engine) => {
  const log = join(T, "logs", `compile-${engine.id}.log`);
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine.id, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(log, gen.stdout + gen.stderr);
  if (gen.status !== 0) return console.log(`${engine.id}: generate failed (${log})`);
  const s = engineSetup(engine, join(T, "project/out", engine.id));
  const code = await new Promise<number>((done) => {
    const child = spawn("cmd.exe", ["/d", "/c", s.launcher, "compileJava", "--console=plain", "-q", `-Dorg.gradle.java.installations.paths=${s.installations.join(",")}`], { cwd: s.projectDir, env: { ...process.env, JAVA_HOME: s.javaHome } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (c) => { writeFileSync(log, gen.stdout + gen.stderr + out); done(c ?? 1); });
  });
  const text = readFileSync(log, "utf8");
  const errors = text.split(/\r?\n/).filter((l) => /error:|\.java:\d+:/.test(l));
  console.log(`${engine.id}: compileJava exit ${code}, ${errors.length} error lines`);
  for (const e of errors.slice(0, 12)) console.log(`  ${e.replace(/^.*[\\/]main[\\/]java[\\/]/, "")}`);
}));
