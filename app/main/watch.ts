import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { relative, resolve } from "node:path";
import type { WebContents } from "electron";

/** Folders whose changes never matter to the editor: build output, caches, version control internals. */
const IGNORED = /^(out|build|run|\.gradle|\.git|node_modules|\.idea|\.toolchains|dist|schemas)(\/|$)|^\.mcedge\/live\/(presence-app\.json|\.gitignore)$/;
const DEBOUNCE_MS = 120;

interface Watch {
  dir: string;
  watcher: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  changed: Set<string>;
}

const watches = new Map<number, Watch>();
/** What this app last wrote per file (absolute, lower case): its fingerprint, or "gone" after a delete. */
const ownWrites = new Map<string, string>();

/**
 * What a file holds: a content hash (project files are small), so an outside write is told apart from the app's own
 * even when it lands within the file system's timestamp resolution and keeps the size.
 */
const fingerprint = (file: string) => {
  if (!existsSync(file)) return "gone";
  const s = statSync(file);
  if (s.isDirectory()) return "dir";
  if (s.size > 8_000_000) return `${s.size}:${s.mtimeMs}`;
  return createHash("sha1").update(readFileSync(file)).digest("hex");
};

/**
 * Runs a write of the app itself and remembers the file's resulting state, so the watcher does not report it back
 * as an outside change. A later outside write changes the content and is reported, however soon it comes.
 */
export function ownWrite<T>(file: string, write: () => T): T {
  const result = write();
  ownWrites.set(resolve(file).toLowerCase(), fingerprint(file));
  return result;
}

/** Remembers files the app has just written (without wrapping the write), so their change events are not echoed. */
export function markOwn(files: string[]): void {
  for (const file of files) ownWrites.set(resolve(file).toLowerCase(), fingerprint(file));
}

/**
 * Watches one project folder for the window: changes from outside the app (an AI agent over MCP, a text
 * editor, git) arrive as "fs:changed" with project-relative paths, batched. One watch per window.
 */
export function watchProject(sender: WebContents, dir: string): void {
  unwatch(sender.id);
  const entry: Watch = {
    dir,
    changed: new Set(),
    watcher: watch(dir, { recursive: true }, (_event, name) => {
      if (!name) return;
      const path = name.toString().replaceAll("\\", "/");
      if (IGNORED.test(path)) return;
      entry.changed.add(path);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const paths = [...entry.changed].filter((p) => {
          const file = resolve(dir, p);
          const now = fingerprint(file);
          // Windows also reports folders whose files were read or written; only file changes matter.
          if (now === "dir") return false;
          const own = ownWrites.get(file.toLowerCase());
          return own === undefined || own !== now;
        });
        entry.changed.clear();
        if (paths.length && !sender.isDestroyed()) sender.send("fs:changed", { dir, paths });
      }, DEBOUNCE_MS);
    }),
  };
  entry.watcher.on("error", () => unwatch(sender.id));
  watches.set(sender.id, entry);
  sender.once("destroyed", () => unwatch(sender.id));
}

/** The project folder this window opened last (what its file watch covers), if any. */
export const watchedDir = (id: number) => watches.get(id)?.dir;

export function unwatch(id: number): void {
  const entry = watches.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.watcher.close();
  watches.delete(id);
}

export const projectRelative = (dir: string, file: string) => relative(dir, file).replaceAll("\\", "/");
