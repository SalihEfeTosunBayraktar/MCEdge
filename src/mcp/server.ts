import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildProject, engineSetup, type GradleSetup } from "../build/gradle.ts";
import { resolveModDependencies } from "../build/modDependencies.ts";
import { listEngines, toolchainNeeds } from "../engines/registry.ts";
import { ensureToolchain, ensureToolchains } from "../engines/toolchains.ts";
import { generateTarget } from "../generator/generate.ts";
import { isProjectDir, loadProject, refreshSchemas } from "../ir/storage.ts";
import { gradleModSetup, isGradleModProject, loadGradleModProject } from "../projects/gradleMod.ts";
import { registerAgentTools } from "./agentTools.ts";
import { buildDiagnostics, registerBuildErrorTools } from "./buildErrors.ts";
import { registerDependencyTools } from "./dependencies.ts";
import { registerLockedCodeTools } from "./lockedCode.ts";
import { registerCreateProjectTool } from "./createProject.ts";
import { registerGeneratorTools } from "./generator.ts";
import { registerProcedureTools } from "./procedures.ts";
import { registerGitTools } from "./git.ts";
import { registerGradleModTools } from "./gradleMod.ts";
import { trackActivity } from "./live.ts";
import { registerActivityTools } from "./activity.ts";
import { registerTaskTools } from "./tasks.ts";
import { registerGuiTools } from "./gui.ts";
import { registerLocalizationTools } from "./localization.ts";
import { registerProjectTools } from "./project.ts";
import { registerReferenceTools } from "./references.ts";
import { registerRenameTool } from "./rename.ts";
import { registerResourceTools } from "./resources.ts";
import { registerCreativeTabTools } from "./creativeTabs.ts";
import { registerTagTools } from "./tags.ts";
import { registerTextureTools } from "./textures.ts";
import { registerRunTools } from "./runs.ts";
import { registerObserveTools } from "./observe.ts";

/** Folders that are generated or huge; never listed or searched. */
const SKIPPED_DIRS = new Set([".git", ".gradle", "build", "run", "out", "node_modules", ".idea", ".toolchains"]);
const MAX_LIST = 2000;
const MAX_MATCHES = 200;
const MAX_READ_BYTES = 400_000;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (value: string, isError = false): Text => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

/**
 * MCP server for one mod project: lets an AI agent read and edit files, build and run the game
 * through the same pipeline the editor uses. Works for MCEdge projects and plain Gradle mods.
 */
export async function serveMcp(projectDir: string): Promise<void> {
  const root = resolve(projectDir);
  const kind = isProjectDir(root) ? "mcedge" : isGradleModProject(root) ? "gradle" : undefined;
  if (!kind) throw new Error(`not an MCEdge project or Gradle mod: ${root}`);

  // Schemas of a project last saved by an older MCEdge are brought up to date at start (KUYRUK 110).
  if (kind === "mcedge") refreshSchemas(root);
  const server = new McpServer({ name: "mcedge", version: "0.1.0" });
  trackActivity(server, root);
  registerActivityTools(server, root);

  const inside = (path: string): string => {
    const file = resolve(root, path);
    if (relative(root, file).startsWith("..")) throw new Error(`path outside the project: ${path}`);
    return file;
  };
  const guard = async (fn: () => Promise<Text> | Text): Promise<Text> => {
    try {
      return await fn();
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  };
  /**
   * Downloads missing toolchains first, so a fresh install can build without manual setup. With generate: false the
   * engine's project is used as it was generated last (a second client of a running engine, KUYRUK 190).
   */
  const setupFor = async (engineId?: string, options: { generate?: boolean } = {}): Promise<GradleSetup> => {
    if (kind === "gradle") {
      const project = loadGradleModProject(root);
      await ensureToolchain("jdk", project.jdk);
      return gradleModSetup(project);
    }
    const engine = listEngines().find((e) => e.id === engineId);
    if (!engine) throw new Error(`engine required; one of: ${listEngines().map((e) => e.id).join(", ")}`);
    await ensureToolchains(toolchainNeeds(engine));
    const outDir = join(root, "out", engine.id);
    if (options.generate === false) return engineSetup(engine, outDir);
    // Jars of the mods the project depends on, so runs load them (KUYRUK 152).
    await resolveModDependencies(loadProject(root).mod.dependencies, engine);
    generateTarget(loadProject(root), root, engine, outDir);
    return engineSetup(engine, outDir);
  };
  const engineArg = { engine: z.string().optional().describe("Engine id; required for MCEdge projects, ignored for Gradle mods") };

  server.registerTool("project_info", { description: "Describe the open mod project: kind, name, build JDK or engines." }, () =>
    guard(() => {
      if (kind === "gradle") {
        const project = loadGradleModProject(root);
        return text(JSON.stringify({ kind, dir: root, name: project.name, jdk: project.jdk }, null, 2));
      }
      const { mod } = loadProject(root);
      return text(JSON.stringify({ kind, dir: root, mod, engines: listEngines().map((e) => e.id) }, null, 2));
    }),
  );

  server.registerTool(
    "list_files",
    {
      description: "List project files (build output and caches are skipped).",
      inputSchema: { path: z.string().optional().describe("Folder relative to the project root"), extension: z.string().optional() },
    },
    ({ path, extension }) =>
      guard(() => {
        const files = walk(inside(path ?? ".")).map((file) => relative(root, file).replaceAll("\\", "/"));
        const filtered = extension ? files.filter((f) => f.endsWith(extension)) : files;
        const shown = filtered.slice(0, MAX_LIST);
        return text(shown.join("\n") + (filtered.length > shown.length ? `\n... ${filtered.length - shown.length} more` : ""));
      }),
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a project file, optionally a 1-based inclusive line range.",
      inputSchema: { path: z.string(), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional() },
    },
    ({ path, startLine, endLine }) =>
      guard(() => {
        const file = inside(path);
        if (statSync(file).size > MAX_READ_BYTES && !startLine) throw new Error("file too large; pass startLine/endLine");
        const lines = readFileSync(file, "utf8").split("\n");
        const from = (startLine ?? 1) - 1;
        const to = endLine ?? lines.length;
        return text(lines.slice(from, to).map((line, i) => `${from + i + 1}\t${line}`).join("\n"));
      }),
  );

  server.registerTool(
    "write_file",
    { description: "Create or overwrite a project file with the given content.", inputSchema: { path: z.string(), content: z.string() } },
    ({ path, content }) =>
      guard(() => {
        const file = inside(path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
        return text(`wrote ${path}`);
      }),
  );

  server.registerTool(
    "edit_file",
    {
      description: "Replace an exact text in a file. Fails if it is missing, or appears more than once unless replaceAll is set.",
      inputSchema: { path: z.string(), oldText: z.string(), newText: z.string(), replaceAll: z.boolean().optional() },
    },
    ({ path, oldText, newText, replaceAll }) =>
      guard(() => {
        const file = inside(path);
        const source = readFileSync(file, "utf8");
        const count = source.split(oldText).length - 1;
        if (count === 0) throw new Error("oldText not found");
        if (count > 1 && !replaceAll) throw new Error(`oldText found ${count} times; make it unique or set replaceAll`);
        writeFileSync(file, replaceAll ? source.split(oldText).join(newText) : source.replace(oldText, () => newText));
        return text(`edited ${path} (${replaceAll ? count : 1} replacement${count > 1 && replaceAll ? "s" : ""})`);
      }),
  );

  server.registerTool(
    "search",
    {
      description: "Regex search across project files; returns path:line: text.",
      inputSchema: { pattern: z.string(), path: z.string().optional(), extension: z.string().optional() },
    },
    ({ pattern, path, extension }) =>
      guard(() => {
        const regex = new RegExp(pattern);
        const matches: string[] = [];
        for (const file of walk(inside(path ?? "."))) {
          if (extension && !file.endsWith(extension)) continue;
          if (statSync(file).size > MAX_READ_BYTES) continue;
          readFileSync(file, "utf8").split("\n").forEach((line, i) => {
            if (matches.length < MAX_MATCHES && regex.test(line)) {
              matches.push(`${relative(root, file).replaceAll("\\", "/")}:${i + 1}: ${line.trim()}`);
            }
          });
        }
        return text(matches.length ? matches.join("\n") : "no matches");
      }),
  );

  server.registerTool(
    "build",
    { description: "Build the mod with Gradle; returns success, the jar path and the compiler errors or log tail. For MCEdge projects a failed build also gives `sources`: each compile error with the element, procedure block and fields it came from (see build_errors).", inputSchema: engineArg },
    ({ engine }) =>
      guard(async () => {
        const lines: string[] = [];
        const result = await buildProject(await setupFor(engine), (line) => lines.push(line));
        const errors = lines.filter((line) => /error:|FAILED|What went wrong|Exception/.test(line)).slice(0, 80);
        // Compile errors pointed at the element, procedure block and fields that made the Java (KUYRUK 145).
        const sources = kind === "mcedge" && !result.ok && engine ? buildDiagnostics(root, engine, lines).slice(0, 40) : [];
        const summary = { ok: result.ok, exitCode: result.exitCode, jar: result.jar, log: result.logFile, ...(sources.length ? { sources } : {}) };
        return text(`${JSON.stringify(summary, null, 2)}\n\n${(errors.length ? errors : lines.slice(-40)).join("\n")}`, !result.ok);
      }),
  );

  if (kind === "mcedge") registerProcedureTools(server, root, guard);
  if (kind === "mcedge") {
    registerResourceTools(server, root, guard);
    registerProjectTools(server, root, guard);
    registerLocalizationTools(server, root, guard);
    registerReferenceTools(server, root, guard);
    registerRenameTool(server, root, guard);
    registerTextureTools(server, root, guard);
    registerGuiTools(server, root, guard);
    registerTagTools(server, root, guard);
    registerCreativeTabTools(server, root, guard);
    registerAgentTools(server, root, guard);
    registerBuildErrorTools(server, root, guard);
    registerDependencyTools(server, root, guard);
    registerLockedCodeTools(server, root, guard);
    registerCreateProjectTool(server, guard);
    registerTaskTools(server, root, guard);
  }
  else registerGradleModTools(server, () => setupFor(), guard);
  const runs = registerRunTools(server, setupFor, guard);
  registerObserveTools(server, root, kind, runs);
  registerGitTools(server, root, guard);
  if (kind === "mcedge") registerGeneratorTools(server, root, guard);

  await server.connect(new StdioServerTransport());
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files.sort();
}
