import { createHash } from "node:crypto";
import { join } from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { JavaServer, type JavaStatus, type LspCompletionItem, type LspPosition } from "../../src/java/jdtls.ts";
import { collectResourceIds } from "../../src/java/resourceIds.ts";
import { scanModResources } from "../../src/java/scanResources.ts";
import { loadGradleModProject } from "../../src/projects/gradleMod.ts";

/** jdtls holds about a gigabyte; after this long without any Java editing it is stopped and starts again on demand. */
const IDLE_MS = 15 * 60_000;

interface Session {
  server: JavaServer;
  sender: WebContents;
  lastUse: number;
  /** Set when stopped for being idle: the next edit starts a new server with these documents. */
  idle?: [string, string][];
}

const sessions = new Map<string, Session>();

/**
 * Java language features of code project mode: one jdtls per open Gradle mod, started lazily by the first Java file
 * opened, stopped when the project closes, the app quits or it sat idle. Status and diagnostics go to the window as
 * "java:status" / "java:diagnostics"; editing never waits for it.
 */
export function registerJavaServer(): void {
  ipcMain.handle("java:open", (event, dir: string, path: string, text: string) => use(event.sender, dir).server.open(path, text));
  ipcMain.handle("java:change", (event, dir: string, path: string, text: string) => use(event.sender, dir).server.change(path, text));
  ipcMain.handle("java:close", (_e, dir: string, path: string) => {
    const session = sessions.get(dir);
    session?.server.close(path);
    if (session?.idle) session.idle = session.idle.filter(([p]) => p !== path);
  });
  ipcMain.handle("java:complete", (event, dir: string, path: string, position: LspPosition) => use(event.sender, dir).server.completion(path, position).catch(() => ({ items: [], incomplete: false })));
  ipcMain.handle("java:resolve", (event, dir: string, item: LspCompletionItem) => use(event.sender, dir).server.resolveCompletion(item).catch(() => item));
  ipcMain.handle("java:hover", (event, dir: string, path: string, position: LspPosition) => use(event.sender, dir).server.hover(path, position).catch(() => null));
  ipcMain.handle("java:status", (_e, dir: string): JavaStatus | null => sessions.get(dir)?.server.state ?? null);
  ipcMain.handle("java:resources", (_e, dir: string) => collectResourceIds(scanModResources(dir)));
  ipcMain.handle("java:stop", (_e, dir: string) => stop(dir));
  app.on("before-quit", () => sessions.forEach((s) => s.server.kill()));
  setInterval(() => {
    for (const [dir, session] of sessions) {
      if (session.idle || Date.now() - session.lastUse < IDLE_MS) continue;
      session.idle = session.server.openDocuments();
      void session.server.stop();
      send(session.sender, dir, { state: "stopped", detail: "idle" });
    }
  }, 60_000).unref();
}

/** The project's session, started (or restarted after an idle stop) on demand. */
function use(sender: WebContents, dir: string): Session {
  let session = sessions.get(dir);
  if (session && !session.idle) {
    session.lastUse = Date.now();
    session.sender = sender;
    return session;
  }
  const reopen = session?.idle ?? [];
  const project = loadGradleModProject(dir);
  const server = new JavaServer({
    projectDir: dir,
    projectJdk: project.jdk,
    dataDir: join(app.getPath("userData"), "jdtls", createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 16)),
    onStatus: (status) => send(sessions.get(dir)?.sender ?? sender, dir, status),
    onDiagnostics: (path, diagnostics) => {
      const target = sessions.get(dir)?.sender ?? sender;
      if (!target.isDestroyed()) target.send("java:diagnostics", { dir, path, diagnostics });
    },
  });
  for (const [path, text] of reopen) server.open(path, text);
  session = { server, sender, lastUse: Date.now() };
  sessions.set(dir, session);
  // Failures arrive as a "failed" status; editing goes on without Java features.
  server.start().catch(() => {});
  return session;
}

async function stop(dir: string): Promise<void> {
  const session = sessions.get(dir);
  if (!session) return;
  sessions.delete(dir);
  await session.server.stop();
}

function send(sender: WebContents, dir: string, status: JavaStatus): void {
  if (!sender.isDestroyed()) sender.send("java:status", { dir, ...status });
}
