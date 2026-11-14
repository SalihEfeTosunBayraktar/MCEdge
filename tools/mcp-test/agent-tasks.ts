/**
 * KUYRUK #146: tasks for the agent over the real `mcedge mcp` server. The user creates tasks (as the app does); a
 * scripted agent is told about them, lists, claims, reports progress, makes the change and completes; its calls are
 * linked to the task in the timeline; the user accepts one and reopens another with a reason, which the agent sees;
 * a second agent session cannot take a claimed task without takeOver.
 *   node tools/mcp-test/agent-tasks.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readActivity } from "../../src/live/activity.ts";
import { createTask, readTask, reviewTask } from "../../src/live/tasks.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const ruby = () => JSON.parse(readFileSync(join(project, "elements", "items", "ruby.json"), "utf8"));
const agent = await connect(project);
const other = await connect(project);
try {
  assert(["list_tasks", "claim_task", "update_task", "complete_task"].every((t) => agent.tools.includes(t)), "task tools are listed");
  const stack = createTask(project, { title: "Ruby should stack to 16", detail: "Like the other gems", source: { kind: "field", target: "item/ruby", field: "stackSize" } });
  const free = createTask(project, { title: "Add a sapphire item", source: { kind: "free" } });

  // The next tool result tells the agent; list_tasks shows both, open.
  const told = await agent.call("read_element", { type: "item", id: "ruby" });
  assert(typeof told === "string" && told.includes(stack.id) && told.includes("item/ruby#stackSize") && told.includes(free.id), "a tool result tells the agent about new tasks");
  const tasks = await agent.call("list_tasks");
  assert(tasks.length === 2 && tasks.every((t: { status: string }) => t.status === "open"), "list_tasks: two open tasks");

  // Claim, progress, change, complete.
  const claimed = await agent.call("claim_task", { id: stack.id });
  assert(claimed.status === "claimed" && claimed.owner.client === "mcedge-test", "claim_task takes it");
  const refused = await other.call("claim_task", { id: stack.id }, true);
  assert(String(refused).includes("claimed by another agent session"), "another session cannot take it");
  await agent.call("update_task", { id: stack.id, progress: "Changing the stack size" });
  await agent.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
  const done = await agent.call("complete_task", { id: stack.id, result: "Ruby stacks to 16 now" });
  assert(done.status === "done" && done.result.text === "Ruby stacks to 16 now" && done.progress[0].text === "Changing the stack size", "complete_task saves progress and result");
  assert(ruby().stackSize === 16, "the change is made");
  const linked = readActivity(project, 100).filter((e) => e.task === stack.id);
  assert(linked.some((e) => e.tool === "update_element" && e.changes?.length) && !readActivity(project, 100).some((e) => e.tool === "read_element" && e.task), "calls made while the task is claimed are linked to it, earlier ones are not");
  assert((await agent.call("update_task", { id: stack.id, progress: "more" }, true)).includes("not claimed by you"), "a done task takes no more progress");

  // The user accepts it; the agent's todo list no longer has it.
  assert(reviewTask(project, stack.id, "accepted").status === "accepted", "the user accepts");
  assert((await agent.call("list_tasks")).map((t: { id: string }) => t.id).join() === free.id, "accepted tasks leave the todo list");

  // The free task: claimed by the agent, then done, then reopened with a reason the agent reads.
  await agent.call("claim_task", { id: free.id });
  await agent.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
  await agent.call("complete_task", { id: free.id, result: "Added item/sapphire" });
  reviewTask(project, free.id, "reopened", "It needs a texture too");
  const reopened = (await other.call("list_tasks")).find((t: { id: string }) => t.id === free.id);
  assert(reopened.status === "open" && reopened.review.comment === "It needs a texture too" && !reopened.owner, "a reopened task is open again with the reason");
  assert((await other.call("claim_task", { id: free.id })).owner.session !== claimed.owner.session, "any session can claim a reopened task");
  assert(readTask(project, free.id).result?.text === "Added item/sapphire", "the earlier result stays");
  console.log("PASS");
} finally {
  await agent.close();
  await other.close();
}
