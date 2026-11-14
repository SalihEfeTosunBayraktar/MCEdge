import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendActivity, type ActivityEntry } from "../live/activity.ts";
import { ackNote, readNotes } from "../live/notes.ts";
import { currentTask, listTasks } from "../live/tasks.ts";
import { FileTracker, storeChanges } from "../live/timeline.ts";
import { READ_ONLY, targetOf } from "./live.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Calls that run for minutes or touch only build output: logged, but not compared before and after. */
const NOT_COMPARED = /^(build|export_jar|run_client|run_server|stop_client|stop_server|debug_client|stop_debug_client|gradle_task|server_command|observe_run|git_push|begin_step|ack_note)$/;
/** Timeline tools whose `id` names a note or a task, not a procedure: they have no target. */
const NO_TARGET = /^(begin_step|read_notes|ack_note|list_tasks|claim_task|update_task|complete_task)$/;
/** One MCP server run is one agent session; its calls and the tasks it claims carry this id. */
export const SESSION = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Without an explicit step, a pause this long starts a new one. */
const STEP_GAP_MS = 30_000;
/** An explicit step (begin_step) ends after this long without calls. */
const NAMED_STEP_GAP_MS = 5 * 60_000;

/**
 * The agent timeline (KUYRUK 144): every MCP call is logged to .mcedge/live/activity.jsonl with its session, step,
 * target and a field-level diff of the files it changed; the before/after goes to changes.jsonl so the user can undo
 * a step or the whole session in the app. Steps start with begin_step, or on their own when the agent moves from a
 * change to another target or pauses. Every result mentions notes the user left that the agent has not seen yet.
 * Must run before the tools are registered.
 */
export function registerActivityTools(server: McpServer, root: string): void {
  const session = SESSION;
  const client = () => server.server.getClientVersion()?.name;
  const clientVersion = () => server.server.getClientVersion()?.version;
  /** The model the agent named in begin_step (KUYRUK 195): MCP's clientInfo names the client, not the model. */
  let model: string | undefined;
  const tracker = new FileTracker(root);
  let calls = 0;
  const step = { n: 0, title: undefined as string | undefined, named: false, lastAt: 0, lastTarget: undefined as string | undefined, lastChanged: false };
  const told = new Set<string>();
  /** Compared calls run one at a time, so each one's before/after is its own. */
  let queue: Promise<unknown> = Promise.resolve();

  const stepFor = (target: string | undefined, now: number) => {
    const gap = now - step.lastAt;
    const fresh = step.n === 0 || (step.named ? gap > NAMED_STEP_GAP_MS : gap > STEP_GAP_MS || (step.lastChanged && target !== step.lastTarget));
    if (fresh) Object.assign(step, { n: step.n + 1, title: undefined, named: false });
    step.lastAt = now;
    step.lastTarget = target;
  };

  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, handler: unknown) => {
    const tool = String(name);
    const hasArgs = !!(config as { inputSchema?: unknown })?.inputSchema;
    const run = handler as (...a: unknown[]) => Promise<Text> | Text;
    const wrapped = async (...params: unknown[]) => {
      const args = (hasArgs ? params[0] : {}) as Record<string, unknown>;
      const read = READ_ONLY.test(tool);
      const compared = !read && !NOT_COMPARED.test(tool);
      const target = NO_TARGET.test(tool) ? undefined : targetOf(args ?? {});
      const call = async (): Promise<[Text, ActivityEntry]> => {
        if (compared) safe(() => tracker.before());
        const result = await run(...params);
        const id = `${session}.${++calls}`;
        const entry: ActivityEntry = { at: new Date().toISOString(), actor: "agent", client: client(), session, call: id, tool, target };
        const version = clientVersion();
        if (version) entry.clientVersion = version;
        if (model) entry.model = model;
        if (read) entry.read = true;
        if (result.isError) entry.error = true;
        const task = safe(() => currentTask(root, session));
        if (task) entry.task = task;
        if (compared) {
          safe(() => {
            const diff = tracker.after();
            if (!diff.changes.length) return;
            entry.changes = diff.changes;
            entry.undoable = !!diff.stored;
            if (diff.stored) storeChanges(root, id, diff.stored);
          });
        }
        const fields = isRecord(args?.values) ? Object.keys(args.values) : entry.changes?.flatMap((c) => c.fields?.map((f) => f.key) ?? []).filter((k) => k !== "$schema");
        if (fields?.length) entry.fields = [...new Set(fields)];
        return [result, entry];
      };
      const [result, entry] = await (compared ? (queue = queue.then(call, call)) as Promise<[Text, ActivityEntry]> : call());
      if (tool !== "begin_step") stepFor(target, Date.now());
      entry.step = step.n;
      if (step.title) entry.stepTitle = step.title;
      step.lastChanged = !!entry.changes?.length;
      safe(() => appendActivity(root, entry));
      return withNotes(result, tool);
    };
    return original(name, config, wrapped);
  };

  /** Tells the agent about notes and open tasks it has not been told of yet, after the tool's own result. */
  const withNotes = (result: Text, tool: string): Text => {
    const notes = safe(() => readNotes(root).filter((n) => !n.ack && !told.has(n.id))) ?? [];
    const tasks = safe(() => listTasks(root).filter((t) => t.status === "open" && !told.has(`${t.id}@${t.updated}`))) ?? [];
    notes.forEach((n) => told.add(n.id));
    tasks.forEach((t) => told.add(`${t.id}@${t.updated}`));
    // list_tasks already shows the tasks.
    if (tool === "list_tasks") tasks.length = 0;
    if (!notes.length && !tasks.length) return result;
    const lines = [
      ...(notes.length ? [`[MCEdge] The user left ${notes.length} note(s) for you in the app:`, ...notes.map((n) => `- ${n.id}${n.target ? ` (${n.target})` : ""}: ${n.text}`), "Acknowledge each with ack_note when handled."] : []),
      ...(tasks.length ? [`[MCEdge] ${tasks.length} open task(s) from the user:`, ...tasks.map((t) => `- ${t.id}${t.source.target ? ` (${t.source.target}${t.source.field ? `#${t.source.field}` : ""})` : ""}: ${t.title}`), "See list_tasks; claim_task before working on one."] : []),
    ];
    return { ...result, content: [...result.content, { type: "text", text: lines.join("\n") }] };
  };

  server.registerTool("begin_step", {
    description: "Start a named step of your work (\"Add ruby armor set\"). The user sees your calls grouped under it in the app's agent timeline "
      + "and can undo the whole step in one click. Without it, steps start on their own when you move to another target or pause.",
    inputSchema: {
      title: z.string().min(1).describe("What this step does, in a few words"),
      model: z.string().optional().describe("The model you run on (\"claude-opus-4-5\", \"gpt-5-codex\", \"gemini-2.5-pro\", \"deepseek-chat\"); "
        + "the app files your session under it. Given once, it holds for the rest of the session."),
    },
  }, ({ title, model: named }) => {
    if (named?.trim()) model = named.trim();
    Object.assign(step, { n: step.n + 1, title, named: true, lastAt: Date.now(), lastChanged: false });
    return { content: [{ type: "text" as const, text: `step ${step.n}: ${title}` }] };
  });

  server.registerTool("read_notes", {
    description: "Notes the user left for you in the MCEdge app (Agents panel), each with its id, time, text and what it is about "
      + "(\"item/ruby\" or \"item/ruby#stackSize\"). Unacknowledged ones by default. Acknowledge each with ack_note once handled.",
    inputSchema: { all: z.boolean().optional().describe("Also the ones already acknowledged") },
  }, ({ all }) => {
    const notes = readNotes(root).filter((n) => all || !n.ack);
    notes.forEach((n) => told.add(n.id));
    return { content: [{ type: "text" as const, text: JSON.stringify(notes, null, 2) }] };
  });

  server.registerTool("ack_note", {
    description: "Acknowledge a note of the user (read_notes), optionally with a short reply the app shows under it.",
    inputSchema: { id: z.string(), reply: z.string().optional() },
  }, ({ id, reply }) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(ackNote(root, id, reply, client()), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The timeline is a courtesy: a read-only folder or a file in use must not fail the tool. */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
