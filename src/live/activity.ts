import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Live co-editing side channel. The project files stay the single source of truth (the app and an AI agent over MCP
 * both write them, and the app merges what it sees change); next to them, .mcedge/live/ says who is working:
 *   activity.jsonl         one line per MCP call of an agent (time, session, step, tool, target, field diff), newest last
 *   changes.jsonl          before/after of every file a call changed, for undo (src/live/timeline.ts), size-bounded
 *   notes.json             notes the user leaves for the agent (src/live/notes.ts)
 *   presence-<who>.json    a heartbeat: the app writes what the user has open, the MCP server who its client is
 */
export const LIVE_DIR = join(".mcedge", "live");
export const ACTIVITY_FILE = `${LIVE_DIR.replaceAll("\\", "/")}/activity.jsonl`;
const MAX_ACTIVITY_BYTES = 1024 * 1024;

export interface ActivityEntry {
  /** ISO time. */
  at: string;
  actor: "agent" | "user";
  /** The agent's MCP client name ("claude-code"), when known. */
  client?: string;
  /** The version its MCP client sent at initialize (KUYRUK 195). */
  clientVersion?: string;
  /** The model the agent said it runs on (begin_step's `model`), for the rest of its session. */
  model?: string;
  tool: string;
  /** What it touched: "item/ruby", "textures/item/gem.png", ... */
  target?: string;
  /** MCP server run the call came through: one agent session. */
  session?: string;
  /** Call id, unique per project ("<session>.<n>"); the key of its undo record. */
  call?: string;
  /** Step of the session the call belongs to (1, 2, ...), and the title the agent gave it (begin_step). */
  step?: number;
  stepTitle?: string;
  /** The call only read. */
  read?: boolean;
  /** The call failed. */
  error?: boolean;
  /** Fields the call worked on (highlighted in the open editor). */
  fields?: string[];
  /** Files it changed, with a field-level diff for JSON. */
  changes?: FileChange[];
  /** Its before/after is kept, so it can be undone. */
  undoable?: boolean;
  /** An undo: the calls it took back. */
  undoes?: string[];
  /** The task (.mcedge/tasks) the agent had claimed when it made the call. */
  task?: string;
}

export interface FileChange {
  path: string;
  kind: "edit" | "create" | "delete";
  /** Top-level JSON keys that changed, with short previews of the values (absent = the key did not exist). */
  fields?: { key: string; before?: string; after?: string }[];
}

export interface Presence {
  who: "app" | "agent";
  /** ISO time of the last heartbeat. */
  at: string;
  client?: string;
  /** App: the element or screen the user has open ("item/ruby", "resources"). */
  open?: string;
  /** App: the last show request (show.json) it acted on, with why it could not show it. */
  shown?: { id: string; error?: string };
  /** App: its main process id, so editor_screenshot captures the window of this project's app, not another MCEdge (KUYRUK 158). */
  pid?: number;
}

const liveDir = (dir: string) => {
  const path = join(dir, LIVE_DIR);
  mkdirSync(path, { recursive: true });
  // Session state, never versioned: the folder ignores itself.
  const ignore = join(path, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return path;
};

export function appendActivity(dir: string, entry: ActivityEntry): void {
  const file = join(liveDir(dir), "activity.jsonl");
  // Keep the log small: past the limit, only the newer half survives.
  if (existsSync(file) && statSync(file).size > MAX_ACTIVITY_BYTES) {
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
  }
  appendFileSync(file, JSON.stringify(entry) + "\n");
}

export function readActivity(dir: string, limit = 100): ActivityEntry[] {
  const file = join(dir, LIVE_DIR, "activity.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line) as ActivityEntry];
    } catch {
      return [];
    }
  });
}

export function writePresence(dir: string, presence: Presence): void {
  writeFileSync(join(liveDir(dir), `presence-${presence.who}.json`), JSON.stringify(presence) + "\n");
}

export function readPresence(dir: string, who: Presence["who"]): Presence | undefined {
  const file = join(dir, LIVE_DIR, `presence-${who}.json`);
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Presence) : undefined;
  } catch {
    return undefined;
  }
}
