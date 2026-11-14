import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { engineSetup, logPath, runGradle, type GradleRun } from "../../src/build/gradle.ts";
import { clientTasks, DEBUG_PORT, muteClient, serverTasks } from "../../src/build/runs.ts";
import { listEngines, toolchainNeeds } from "../../src/engines/registry.ts";
import { ensureToolchains } from "../../src/engines/toolchains.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { resolveModDependencies } from "../../src/build/modDependencies.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { ROOT } from "../../src/paths.ts";
import { clearGradleCaches, deleteResource, exportWorkspace, importResources, resourceExtensions } from "../../src/resources/files.ts";
import { deleteSoundEvent, saveSoundEvent, type SoundEventChange } from "../../src/resources/soundEvents.ts";
import { createPack, previewPack, type PackOptions } from "../../src/ir/packs.ts";
import { runKey, type AppInfo, type McpCommand, type BuildEvent, type GradleMode, type ResourceImport, type ResourceKind } from "../shared/api.ts";
import { buildRunning, cancelBuild, insideProject, snapshot } from "./ipc.ts";
import { checkForUpdatesNow } from "./updater.ts";

/** Running Gradle tasks by build-event key ("fabric-1.21.5 server"), so Stop can end them. */
const runs = new Map<string, GradleRun>();
/** Runs the user stopped: their end is "stopped", not a crash (KUYRUK 154). */
const stopping = new Set<string>();

const FILTER_NAMES: Record<ResourceKind, string> = { sound: "Ogg Vorbis", model: "Blockbench, JSON, Java or OBJ model", structure: "Structure template" };

export function registerTools(): void {
  ipcMain.handle("resource:import", async (event, dir: string, kind: ResourceKind): Promise<ResourceImport | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openFile", "multiSelections"], filters: [{ name: FILTER_NAMES[kind], extensions: resourceExtensions(kind) }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return importResult(dir, kind, result.filePaths);
  });
  ipcMain.handle("resource:delete", (_e, dir: string, path: string) => (deleteResource(dir, path), snapshot(dir)));
  ipcMain.handle("sound-event:save", (_e, dir: string, change: SoundEventChange, previous?: string) => (saveSoundEvent(dir, change, previous), snapshot(dir)));
  ipcMain.handle("pack:preview", (_e, dir: string, options: PackOptions) => previewPack(dir, options));
  ipcMain.handle("pack:create", (_e, dir: string, options: PackOptions) => (createPack(dir, options), snapshot(dir)));
  ipcMain.handle("sound-event:delete", (_e, dir: string, name: string) => (deleteSoundEvent(dir, name), snapshot(dir)));
  ipcMain.handle("resource:read", (_e, dir: string, path: string) =>
    `data:audio/ogg;base64,${readFileSync(insideProject(dir, path)).toString("base64")}`);

  ipcMain.handle("gradle:run", (event, dir: string, engineId: string, mode: GradleMode, args: string[] = []) => gradle(event.sender, dir, engineId, mode, args));
  ipcMain.handle("gradle:stop", (_e, key: string) => {
    const run = runs.get(key);
    if (run) (stopping.add(key), run.stop());
  });
  // Build & run > Cancel task (KUYRUK 135): the running build or export, and Gradle console / reload runs. The game client
  // and the server keep their own Stop.
  ipcMain.handle("gradle:cancel", () => {
    let cancelled = cancelBuild();
    for (const [key, run] of runs) if (key.endsWith(" gradle")) (stopping.add(key), run.stop(), (cancelled = true));
    return cancelled;
  });
  // Build & run > Clear Gradle caches: refused while Gradle runs in this app.
  ipcMain.handle("gradle:clearCaches", (_e, dir: string) => {
    if (runs.size || buildRunning()) throw new Error("Gradle is running; stop it first");
    return clearGradleCaches(dir);
  });

  ipcMain.handle("workspace:export", async (event, dir: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: join(app.getPath("documents"), `${loadProject(dir).mod.id}-workspace.zip`),
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return null;
    return { file: result.filePath, count: exportWorkspace(dir, result.filePath) };
  });

  ipcMain.handle("app:info", (): AppInfo => ({
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
  }));
  // The app's exe run as Node on the CLI bundled at out/cli (vite.cli.config.ts); app.asar when installed, the
  // repository (after a build) in development.
  ipcMain.handle("app:mcpCommand", (): McpCommand => ({
    command: app.getPath("exe"), args: [join(app.getAppPath(), "out", "cli", "index.js")], env: { ELECTRON_RUN_AS_NODE: "1" },
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
  }));
  ipcMain.handle("shell:external", (_e, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error("only https links");
    return shell.openExternal(url);
  });
  // Help > User guide (KUYRUK 128): docs/guide/<language>/*.md in file order; English where a language has no guide.
  const guideFolder = (language: string) => {
    const folder = join(ROOT, "docs", "guide", /^[a-z]{2}$/.test(language) ? language : "en");
    return existsSync(folder) ? folder : join(ROOT, "docs", "guide", "en");
  };
  ipcMain.handle("docs:list", (_e, language = "en") => {
    const folder = guideFolder(language);
    if (!existsSync(folder)) return [];
    return readdirSync(folder).filter((f) => f.endsWith(".md")).sort().map((file) => {
      const heading = /^#\s+(.+)$/m.exec(readFileSync(join(folder, file), "utf8"));
      return { file, title: heading?.[1] ?? file };
    });
  });
  ipcMain.handle("docs:read", (_e, language: string, file: string) => {
    if (!/^[A-Za-z0-9_.-]+\.md$/.test(file)) throw new Error("bad doc name");
    return readFileSync(join(guideFolder(language), file), "utf8");
  });
  ipcMain.handle("updates:check", () => checkForUpdatesNow());
  app.on("before-quit", () => runs.forEach((run) => run.stop()));
}

/** Imports, then snapshots the project so the new files are listed. */
function importResult(dir: string, kind: ResourceKind, files: string[]): ResourceImport {
  const result = importResources(dir, kind, files);
  return { snapshot: snapshot(dir), ...result };
}

/**
 * Gradle work on an engine's generated project, streamed as build events:
 *   console  - any tasks the user types (Tools > Gradle console)
 *   reload   - regenerate, then let Gradle configure the project again (Tools > Reload Gradle project)
 *   debug    - the client with a JDWP agent for an IDE debugger (Build & run > Debug client)
 *   server   - a dedicated server with the mod (Build & run > Run server)
 */
async function gradle(sender: WebContents, dir: string, engineId: string, mode: GradleMode, args: string[]): Promise<void> {
  const engine = listEngines().find((e) => e.id === engineId);
  const key = runKey(engineId, mode === "debug" ? "client" : mode === "server" ? "server" : "gradle");
  if (!engine || runs.has(key)) return;
  const send = (event: BuildEvent) => sender.send("build:event", event);
  const line = (text: string) => send({ type: "line", engineId: key, line: text });
  send({ type: "start", engineId: key });
  try {
    await ensureToolchains(toolchainNeeds(engine), (p) => line(`[mcedge] downloading ${p.kind} ${p.version}: ${Math.round(p.received / 1e6)} MB`));
    const outDir = join(dir, "out", engine.id);
    if (mode !== "console") await resolveModDependencies(loadProject(dir).mod.dependencies, engine, { onLine: line });
    if (mode !== "console" || !existsSync(join(outDir, "build.gradle"))) {
      const { warnings } = generateTarget(loadProject(dir), dir, engine, outDir);
      warnings.forEach((w) => line(`[mcedge] not generated: ${w}`));
    }
    const setup = engineSetup(engine, outDir);
    // UI tests start the app with MCEDGE_MUTE_CLIENTS=1; the user's own debug client keeps its sound.
    if (mode === "debug" && process.env.MCEDGE_MUTE_CLIENTS === "1") muteClient(outDir);
    const tasks = mode === "console" ? (args.length ? args : ["tasks"])
      : mode === "reload" ? ["help"]
      : mode === "debug" ? clientTasks(setup, engine.minecraft, { debug: true })
      : serverTasks(setup);
    if (mode === "debug") line(`[mcedge] debug client: attach a Java debugger to localhost:${DEBUG_PORT}`);
    line(`[mcedge] gradle ${tasks.join(" ")}`);
    const run = runGradle(setup, tasks, logPath(setup, `mcedge-${mode}.log`), line);
    runs.set(key, run);
    const code = await run.done;
    runs.delete(key);
    send({ type: "done", engineId: key, ok: code === 0, stopped: stopping.delete(key) });
  } catch (error) {
    runs.delete(key);
    line(`[mcedge] ${error instanceof Error ? error.message : String(error)}`);
    send({ type: "done", engineId: key, ok: false, stopped: stopping.delete(key) });
  }
}
