import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { claimTask, completeTask, listTasks, updateTask, type AgentTask } from "../live/tasks.ts";
import { SESSION } from "./activity.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;

const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/**
 * Tasks the user gives the agent in the app (KUYRUK 146, .mcedge/tasks): the agent lists, claims, reports progress
 * and completes them; the user accepts or reopens the result. Calls made while a task is claimed are linked to it in
 * the agent timeline.
 */
export function registerTaskTools(server: McpServer, root: string, guard: Guard): void {
  const client = () => server.server.getClientVersion()?.name;

  server.registerTool("list_tasks", {
    description: "Tasks the user gave you in the MCEdge app, oldest first: id, title, detail, what it is about (element, field, problem or build "
      + "error), status (open, claimed, done, accepted), owner, progress, result and the user's review (a reopened task says why). "
      + "By default the ones to work on: open and claimed.",
    inputSchema: { status: z.enum(["todo", "open", "claimed", "done", "accepted", "all"]).optional().describe("todo (default): open and claimed") },
  }, ({ status }) =>
    guard(() => {
      const wanted = status ?? "todo";
      const tasks = listTasks(root).filter((t: AgentTask) => wanted === "all" || (wanted === "todo" ? t.status === "open" || t.status === "claimed" : t.status === wanted));
      return json(tasks);
    }),
  );

  server.registerTool("claim_task", {
    description: "Take a task before working on it. The app shows it as in progress, owned by you, and links your following calls to it. "
      + "A task another session holds needs takeOver (only when that session has ended).",
    inputSchema: { id: z.string(), takeOver: z.boolean().optional() },
  }, ({ id, takeOver }) => guard(() => json(claimTask(root, id, { client: client(), session: SESSION }, takeOver))));

  server.registerTool("update_task", {
    description: "Report progress on a task you claimed, in a sentence; the app shows it under the task.",
    inputSchema: { id: z.string(), progress: z.string().min(1) },
  }, ({ id, progress }) => guard(() => json(updateTask(root, id, SESSION, progress))));

  server.registerTool("complete_task", {
    description: "Finish a task you claimed with a short result (what you changed, what to check). The user then accepts it or reopens it with a reason.",
    inputSchema: { id: z.string(), result: z.string().min(1) },
  }, ({ id, result }) => guard(() => json(completeTask(root, id, SESSION, result))));
}
