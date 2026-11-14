import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { appendActivity, LIVE_DIR, readActivity, type FileChange } from "./activity.ts";

/**
 * Undo for agent changes. Around every changing MCP call the server compares the project files before and after
 * (FileTracker) and keeps what changed in .mcedge/live/changes.jsonl: for a JSON object file the top-level keys
 * that changed, for any other file its whole content. undoCalls() takes calls back, newest first, and refuses
 * with a conflict list when a field (or file) no longer holds what the agent wrote, so a later edit of the user
 * is never overwritten.
 */

/** Folders never compared: build output, caches, version control, generated schemas, MCEdge's own state. */
const SKIPPED = new Set([".git", ".gradle", "build", "run", "out", "node_modules", ".idea", ".toolchains", "dist", "schemas", ".mcedge"]);
/** Files bigger than this are not kept: a change to them is shown but cannot be undone. */
const MAX_FILE_BYTES = 256 * 1024;
/** One call's record above this is not kept (a huge git switch, say). */
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
/** The undo store keeps its newer half once it grows past this. */
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const PREVIEW_CHARS = 120;
const CHANGES_FILE = "changes.jsonl";

/** One file of a call's undo record. JSON objects keep only the changed keys: `b`/`a` absent = key absent. */
export interface StoredFile {
  path: string;
  json?: Record<string, { b?: unknown; a?: unknown }>;
  /** Whole content before and after (null = no file), utf8 or base64. */
  before?: string | null;
  after?: string | null;
  enc?: "base64";
}

interface Seen {
  mtimeMs: number;
  size: number;
  data?: Buffer;
}

/** What the project files held, kept between calls so the state before a call is known without reading it all again. */
export class FileTracker {
  private seen = new Map<string, Seen>();
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Brings the cache up to the files on disk (the user may have changed some since the last call). */
  before(): void {
    const now = this.scan();
    for (const path of this.seen.keys()) if (!now.has(path)) this.seen.delete(path);
    for (const [path, stat] of now) {
      const old = this.seen.get(path);
      if (!old || old.mtimeMs !== stat.mtimeMs || old.size !== stat.size) this.seen.set(path, this.read(path, stat));
    }
  }

  /** What changed since before(): the record kept for undo (undefined when too big) and the previews for the timeline. */
  after(): { stored?: StoredFile[]; changes: FileChange[]; undoable: boolean } {
    const now = this.scan();
    const paths = new Set([...this.seen.keys(), ...now.keys()]);
    const stored: StoredFile[] = [];
    const changes: FileChange[] = [];
    let undoable = true;
    for (const path of [...paths].sort()) {
      const old = this.seen.get(path);
      const stat = now.get(path);
      if (old && stat && old.mtimeMs === stat.mtimeMs && old.size === stat.size) continue;
      const next = stat ? this.read(path, stat) : undefined;
      if (next) this.seen.set(path, next);
      else this.seen.delete(path);
      const before = old ? old.data : null;
      const after = next ? next.data : null;
      // A file too big to keep: shown, not undoable.
      if (before === undefined || after === undefined) {
        undoable = false;
        changes.push({ path, kind: !old ? "create" : !next ? "delete" : "edit" });
        continue;
      }
      if (before && after && before.equals(after)) continue;
      const file = diffFile(path, before, after);
      stored.push(file.stored);
      changes.push(file.change);
    }
    const size = JSON.stringify(stored).length;
    return { stored: undoable && size <= MAX_RECORD_BYTES ? stored : undefined, changes, undoable: undoable && size <= MAX_RECORD_BYTES };
  }

  private read(path: string, stat: { mtimeMs: number; size: number }): Seen {
    if (stat.size > MAX_FILE_BYTES) return { ...stat };
    try {
      return { ...stat, data: readFileSync(join(this.root, path)) };
    } catch {
      return { ...stat };
    }
  }

  private scan(): Map<string, { mtimeMs: number; size: number }> {
    const files = new Map<string, { mtimeMs: number; size: number }>();
    const walk = (dir: string) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (SKIPPED.has(name)) continue;
        const full = join(dir, name);
        try {
          const s = statSync(full);
          if (s.isDirectory()) walk(full);
          else files.set(relative(this.root, full).replaceAll("\\", "/"), { mtimeMs: s.mtimeMs, size: s.size });
        } catch {
          // Gone while scanning.
        }
      }
    };
    walk(this.root);
    return files;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const parseObject = (data: Buffer | null): Record<string, unknown> | undefined => {
  if (!data) return undefined;
  try {
    const value = JSON.parse(data.toString("utf8"));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
};
/** Deep equality of JSON values, key order ignored. */
export const sameJson = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const stable = (v: unknown): string =>
  v === undefined ? "undefined" : Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
export const preview = (v: unknown): string | undefined => {
  if (v === undefined) return undefined;
  const text = typeof v === "string" && v !== "" ? v : JSON.stringify(v);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 3)}...` : text;
};
const isText = (data: Buffer) => !data.includes(0) && Buffer.from(data.toString("utf8"), "utf8").equals(data);

function diffFile(path: string, before: Buffer | null, after: Buffer | null): { stored: StoredFile; change: FileChange } {
  const kind = !before ? "create" : !after ? "delete" : "edit";
  const [b, a] = [parseObject(before), parseObject(after)];
  if (b && a) {
    const json: StoredFile["json"] = {};
    const fields: NonNullable<FileChange["fields"]> = [];
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (sameJson(b[key], a[key])) continue;
      json[key] = { ...(key in b ? { b: b[key] } : {}), ...(key in a ? { a: a[key] } : {}) };
      fields.push({ key, before: preview(b[key]), after: preview(a[key]) });
    }
    return { stored: { path, json }, change: { path, kind, fields } };
  }
  const text = (before ? isText(before) : true) && (after ? isText(after) : true);
  const encode = (data: Buffer | null) => (data ? data.toString(text ? "utf8" : "base64") : null);
  return { stored: { path, before: encode(before), after: encode(after), ...(text ? {} : { enc: "base64" as const }) }, change: { path, kind } };
}

const storeFile = (dir: string) => join(dir, LIVE_DIR, CHANGES_FILE);

/** Keeps a call's before/after for undo. */
export function storeChanges(dir: string, call: string, files: StoredFile[]): void {
  const file = storeFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && statSync(file).size > MAX_STORE_BYTES) {
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
  }
  appendFileSync(file, JSON.stringify({ call, files }) + "\n");
}

function readStore(dir: string): Map<string, StoredFile[]> {
  const records = new Map<string, StoredFile[]>();
  const file = storeFile(dir);
  if (!existsSync(file)) return records;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { call: string; files: StoredFile[] };
      records.set(record.call, record.files);
    } catch {
      // A line cut by trimming.
    }
  }
  return records;
}

export interface UndoConflict {
  path: string;
  /** The JSON field; absent for a whole file. */
  field?: string;
  /** What the agent wrote, and what is there now (short previews; absent = nothing). */
  agent?: string;
  now?: string;
}

export interface UndoResult {
  ok: boolean;
  /** Fields or files changed since the agent wrote them: nothing was written. */
  conflicts: UndoConflict[];
  /** Calls whose before/after is no longer kept (or never was): nothing was written. */
  missing: string[];
  /** Project-relative files written. */
  written: string[];
  /** Calls taken back. */
  undone: string[];
}

/**
 * Takes the given calls back, newest first, all or nothing: with any conflict or missing record nothing is written.
 * Calls without changes and calls already undone are skipped. The undo is logged as an activity entry of `actor`.
 */
export function undoCalls(dir: string, calls: string[], actor: "user" | "agent" = "user"): UndoResult {
  const entries = readActivity(dir, Number.MAX_SAFE_INTEGER);
  const done = new Set(entries.flatMap((e) => e.undoes ?? []));
  const order = new Map(entries.map((e, i) => [e.call, i]));
  const wanted = [...new Set(calls)].filter((c) => !done.has(c) && entries.some((e) => e.call === c && e.changes?.length))
    .sort((x, y) => (order.get(y) ?? 0) - (order.get(x) ?? 0));
  const store = readStore(dir);
  const result: UndoResult = { ok: false, conflicts: [], missing: wanted.filter((c) => !store.has(c)), written: [], undone: [] };
  if (result.missing.length) return result;

  // The files as the undo goes along, newest call first: content, or null when there is no file.
  const state = new Map<string, Buffer | null>();
  const current = (path: string) => {
    if (!state.has(path)) {
      const full = join(dir, path);
      state.set(path, existsSync(full) ? readFileSync(full) : null);
    }
    return state.get(path)!;
  };
  for (const call of wanted) {
    for (const file of store.get(call)!) {
      const now = current(file.path);
      if (file.json) {
        const value = parseObject(now);
        if (!value) {
          result.conflicts.push({ path: file.path, agent: "{...}", now: preview(now?.toString("utf8")) });
          continue;
        }
        const next: Record<string, unknown> = { ...value };
        for (const [key, change] of Object.entries(file.json)) {
          if (!sameJson(value[key], change.a)) {
            result.conflicts.push({ path: file.path, field: key, agent: preview(change.a), now: preview(value[key]) });
            continue;
          }
          if ("b" in change) next[key] = change.b;
          else delete next[key];
        }
        state.set(file.path, Buffer.from(JSON.stringify(next, null, 2) + "\n", "utf8"));
      } else {
        const decode = (v: string | null | undefined) => (v == null ? null : Buffer.from(v, file.enc ?? "utf8"));
        const agent = decode(file.after);
        const same = agent === null ? now === null : !!now && now.equals(agent);
        if (!same) {
          result.conflicts.push({ path: file.path, agent: agent === null ? undefined : preview(file.enc ? `${agent.length} bytes` : agent.toString("utf8")), now: now === null ? undefined : preview(file.enc ? `${now.length} bytes` : now.toString("utf8")) });
          continue;
        }
        state.set(file.path, decode(file.before));
      }
    }
  }
  if (result.conflicts.length) return result;

  const changes: FileChange[] = [];
  for (const [path, data] of state) {
    const full = join(dir, path);
    const existed = existsSync(full);
    if (data === null) {
      if (existed) rmSync(full);
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    }
    if (existed || data !== null) {
      result.written.push(path);
      changes.push({ path, kind: !existed ? "create" : data === null ? "delete" : "edit" });
    }
  }
  result.ok = true;
  result.undone = wanted;
  if (wanted.length) appendActivity(dir, { at: new Date().toISOString(), actor, tool: "undo", undoes: wanted, changes });
  return result;
}
