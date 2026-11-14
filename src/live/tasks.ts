import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tasks the user gives the AI agent (KUYRUK 146), one JSON file per task in .mcedge/tasks/<id>.json, so the app and
 * the agent never rewrite each other's tasks. The user creates them in the app (from an element, a field, a problem,
 * a build error, or free text) and accepts or reopens the result; the agent lists, claims, updates and completes them
 * over MCP. Versioned with the project (unlike .mcedge/live).
 */
export const TASKS_DIR = join(".mcedge", "tasks");

export type TaskStatus = "open" | "claimed" | "done" | "accepted";

export interface TaskSource {
  kind: "element" | "field" | "problem" | "build" | "free";
  /** Element ("item/ruby"), when the task is about one. */
  target?: string;
  field?: string;
  /** The problem message or the build output line it was made from. */
  text?: string;
}

export interface AgentTask {
  id: string;
  title: string;
  detail?: string;
  source: TaskSource;
  status: TaskStatus;
  /** ISO times. */
  created: string;
  updated: string;
  /** The agent session working on it (claim_task). */
  owner?: { client?: string; session: string; at: string };
  progress?: { at: string; text: string }[];
  result?: { at: string; text: string };
  /** The user's last verdict: a reopen says why. */
  review?: { at: string; verdict: "accepted" | "reopened"; comment?: string };
}

const dirOf = (dir: string) => join(dir, TASKS_DIR);
const fileOf = (dir: string, id: string) => {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error(`no task ${id}; list_tasks lists them`);
  return join(dirOf(dir), `${id}.json`);
};

export function listTasks(dir: string): AgentTask[] {
  if (!existsSync(dirOf(dir))) return [];
  return readdirSync(dirOf(dir)).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try {
      return [JSON.parse(readFileSync(join(dirOf(dir), f), "utf8")) as AgentTask];
    } catch {
      return [];
    }
  }).sort((a, b) => a.created.localeCompare(b.created));
}

export function readTask(dir: string, id: string): AgentTask {
  const file = fileOf(dir, id);
  if (!existsSync(file)) throw new Error(`no task ${id}; list_tasks lists them`);
  return JSON.parse(readFileSync(file, "utf8")) as AgentTask;
}

function saveTask(dir: string, task: AgentTask): AgentTask {
  mkdirSync(dirOf(dir), { recursive: true });
  task.updated = new Date().toISOString();
  writeFileSync(fileOf(dir, task.id), JSON.stringify(task, null, 2) + "\n");
  return task;
}

/** The user creates a task in the app. */
export function createTask(dir: string, input: { title: string; detail?: string; source: TaskSource }): AgentTask {
  const at = new Date().toISOString();
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const detail = input.detail?.trim();
  return saveTask(dir, { id, title: input.title.trim(), ...(detail ? { detail } : {}), source: input.source, status: "open", created: at, updated: at });
}

export function deleteTask(dir: string, id: string): void {
  rmSync(fileOf(dir, id), { force: true });
}

/** The user accepts a done task, or reopens it (done or accepted) with a reason; a reopened task can be claimed again. */
export function reviewTask(dir: string, id: string, verdict: "accepted" | "reopened", comment?: string): AgentTask {
  const task = readTask(dir, id);
  if (verdict === "accepted" && task.status !== "done") throw new Error(`task ${id} is ${task.status}, not done`);
  task.review = { at: new Date().toISOString(), verdict, ...(comment?.trim() ? { comment: comment.trim() } : {}) };
  task.status = verdict === "accepted" ? "accepted" : "open";
  if (verdict === "reopened") delete task.owner;
  return saveTask(dir, task);
}

/** The agent takes a task: open ones, or one another session holds when `takeOver` (that session ended, say). */
export function claimTask(dir: string, id: string, owner: { client?: string; session: string }, takeOver = false): AgentTask {
  const task = readTask(dir, id);
  if (task.status === "done" || task.status === "accepted") throw new Error(`task ${id} is ${task.status}; the user reopens it when more is needed`);
  if (task.status === "claimed" && task.owner?.session !== owner.session && !takeOver) {
    throw new Error(`task ${id} is claimed by another agent session (${task.owner?.client ?? "unknown"} since ${task.owner?.at}); pass takeOver if that session has ended`);
  }
  task.status = "claimed";
  task.owner = { ...owner, at: new Date().toISOString() };
  return saveTask(dir, task);
}

const mine = (task: AgentTask, session: string) => {
  if (task.status !== "claimed" || task.owner?.session !== session) throw new Error(`task ${task.id} is not claimed by you; claim_task first`);
};

export function updateTask(dir: string, id: string, session: string, text: string): AgentTask {
  const task = readTask(dir, id);
  mine(task, session);
  task.progress = [...(task.progress ?? []), { at: new Date().toISOString(), text }];
  return saveTask(dir, task);
}

export function completeTask(dir: string, id: string, session: string, text: string): AgentTask {
  const task = readTask(dir, id);
  mine(task, session);
  task.status = "done";
  task.result = { at: new Date().toISOString(), text };
  return saveTask(dir, task);
}

/** The task a session works on now: the one it claimed last and has not completed. */
export function currentTask(dir: string, session: string): string | undefined {
  return listTasks(dir).filter((t) => t.status === "claimed" && t.owner?.session === session)
    .sort((a, b) => (a.owner!.at < b.owner!.at ? -1 : 1)).at(-1)?.id;
}
