import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { buildProject, runProjectClient, type GradleRun } from "../../src/build/gradle.ts";
import { ensureToolchain } from "../../src/engines/toolchains.ts";
import { gradleModSetup, loadGradleModProject } from "../../src/projects/gradleMod.ts";
import { codeRunKey, type BuildEvent, type CodeFile, type CodeProjectInfo } from "../shared/api.ts";
import { insideProject } from "./ipc.ts";
import { ownWrite, projectRelative } from "./watch.ts";

/** Never listed in the file tree: generated, cached or huge. */
const SKIPPED = new Set([".git", ".gradle", "build", "run", "out", "node_modules", ".idea", ".toolchains", "bin", ".vscode"]);
const MAX_FILES = 8000;
const MAX_TEXT_BYTES = 2_000_000;

let clientRun: GradleRun | undefined;
/** The user stopped the client: it ends "stopped", not crashed (KUYRUK 154). */
let clientStopping = false;

export function codeProjectInfo(dir: string): CodeProjectInfo {
  const project = loadGradleModProject(dir);
  return { dir, name: project.name, jdk: project.jdk, wrapper: existsSync(join(dir, process.platform === "win32" ? "gradlew.bat" : "gradlew")) };
}

/** Code project mode: plain Gradle mods (ETREconomy-Legacy) edited as files and built with their own wrapper. */
export function registerCodeProject(): void {
  ipcMain.handle("code:tree", (_e, dir: string): CodeFile[] => tree(dir));
  ipcMain.handle("code:read", (_e, dir: string, path: string) => {
    const file = insideProject(dir, path);
    const size = statSync(file).size;
    if (size > MAX_TEXT_BYTES) return { text: "", binary: true, size };
    const bytes = readFileSync(file);
    // A NUL byte in the first block means a binary file (class, png, jar).
    const binary = bytes.subarray(0, 8000).includes(0);
    return { text: binary ? "" : bytes.toString("utf8"), binary, size };
  });
  ipcMain.handle("code:write", (_e, dir: string, path: string, text: string) => {
    const file = insideProject(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    ownWrite(file, () => writeFileSync(file, text));
  });
  ipcMain.handle("code:create", (_e, dir: string, path: string, folder: boolean) => {
    const file = insideProject(dir, path);
    if (existsSync(file)) throw new Error(`exists: ${path}`);
    ownWrite(file, () => (folder ? mkdirSync(file, { recursive: true }) : (mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, ""))));
    return tree(dir);
  });
  ipcMain.handle("code:delete", (_e, dir: string, path: string) => {
    const file = insideProject(dir, path);
    if (file === dir) throw new Error("refusing to delete the project");
    ownWrite(file, () => rmSync(file, { recursive: true }));
    return tree(dir);
  });
  ipcMain.handle("code:build", (event, dir: string) => build(event.sender, dir));
  ipcMain.handle("code:run", (event, dir: string) => runClient(event.sender, dir));
  ipcMain.handle("code:stop", () => clientRun && ((clientStopping = true), clientRun.stop()));
  ipcMain.handle("code:export", async (event, dir: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const jar = await build(event.sender, dir);
    if (!jar) return null;
    const result = await dialog.showSaveDialog(window!, { defaultPath: basename(jar), filters: [{ name: "Jar", extensions: ["jar"] }] });
    if (result.canceled || !result.filePath) return null;
    copyFileSync(jar, result.filePath);
    return result.filePath;
  });
}

/** Files and folders of the project, folders first, depth-first in name order. */
function tree(dir: string): CodeFile[] {
  const out: CodeFile[] = [];
  const walk = (folder: string, depth: number) => {
    const entries = readdirSync(folder, { withFileTypes: true })
      .filter((e) => !(e.isDirectory() && SKIPPED.has(e.name)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const path = join(folder, e.name);
      out.push({ path: projectRelative(dir, path), folder: e.isDirectory(), depth });
      if (e.isDirectory()) walk(path, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

async function setup(dir: string, send: (e: BuildEvent) => void, key: string) {
  const project = loadGradleModProject(dir);
  await ensureToolchain("jdk", project.jdk, (p) => send({ type: "line", engineId: key, line: `[mcedge] downloading ${p.kind} ${p.version}: ${Math.round(p.received / 1e6)} MB` }));
  return gradleModSetup(project);
}

async function build(sender: WebContents, dir: string): Promise<string | undefined> {
  const key = codeRunKey("build");
  const send = (event: BuildEvent) => sender.send("build:event", event);
  send({ type: "start", engineId: key });
  try {
    const result = await buildProject(await setup(dir, send, key), (line) => send({ type: "line", engineId: key, line }));
    send({ type: "done", engineId: key, ok: result.ok && !!result.jar, jar: result.jar });
    return result.ok ? result.jar : undefined;
  } catch (error) {
    send({ type: "line", engineId: key, line: `[mcedge] ${error instanceof Error ? error.message : String(error)}` });
    send({ type: "done", engineId: key, ok: false });
    return undefined;
  }
}

async function runClient(sender: WebContents, dir: string): Promise<void> {
  if (clientRun) return;
  const key = codeRunKey("client");
  const send = (event: BuildEvent) => sender.send("build:event", event);
  send({ type: "start", engineId: key });
  try {
    clientStopping = false;
    clientRun = runProjectClient(await setup(dir, send, key), (line) => send({ type: "line", engineId: key, line }));
    const code = await clientRun.done;
    send({ type: "done", engineId: key, ok: code === 0, stopped: clientStopping });
  } catch (error) {
    send({ type: "line", engineId: key, line: `[mcedge] ${error instanceof Error ? error.message : String(error)}` });
    send({ type: "done", engineId: key, ok: false });
  } finally {
    clientRun = undefined;
  }
}
