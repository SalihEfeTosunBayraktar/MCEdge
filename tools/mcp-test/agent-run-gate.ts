/**
 * Q255: heavy MCP tools (config/agent-execution.json) never run behind the user's back, over the real `mcedge mcp`
 * server. No app: refused (also with a stale heartbeat or a dead process), unless the server was started with
 * --allow-headless-runs or MCEDGE_ALLOW_HEADLESS_RUNS=1; tools that are not heavy are untouched. App open: policy
 * allow runs; policy ask writes a request and honours the answer (once, session, deny, no answer). Nothing heavy
 * starts: server_command only answers "no server running" once it is allowed.
 *   node tools/mcp-test/agent-run-gate.ts
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import EXECUTION from "../../config/agent-execution.json" with { type: "json" };
import { LIVE_DIR, readActivity, writePresence } from "../../src/live/activity.ts";
import { answerApproval, pendingApprovals } from "../../src/live/approval.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect, type Mcp } from "./client.ts";

const project = exampleProject();
const presence = (patch: object = {}) => writePresence(project, { who: "app", at: new Date().toISOString(), open: "items", pid: process.pid, agentRuns: "ask", ...patch });
const clearPresence = () => rmSync(join(project, LIVE_DIR, "presence-app.json"), { force: true });
const gated = (text: unknown) => String(text).startsWith("[MCEdge]");
const call = (mcp: Mcp, tool = "server_command", args: Record<string, unknown> = { commands: ["list"] }) => mcp.call<string>(tool, args, true);
const waitRequest = async () => {
  for (const end = Date.now() + 8000; Date.now() < end;) {
    const [request] = pendingApprovals(project);
    if (request) return request;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("no approval request appeared");
};

assert(["build", "export_jar", "publish_mod", "run_client", "run_server", "debug_client", "gradle_task", "run_scenario", "observe_run", "clear_gradle_caches", "server_command"].every((t) => EXECUTION.tools.includes(t)), "the config lists the heavy tools");

// No app, no flag: refused with what to do, and logged as an error.
let mcp = await connect(project, { MCEDGE_APPROVAL_TIMEOUT_S: "2", MCEDGE_ALLOW_HEADLESS_RUNS: "0" });
try {
  assert(EXECUTION.tools.every((t) => mcp.tools.includes(t)), "every configured heavy tool exists as an MCP tool");
  for (const [tool, args] of [["server_command", { commands: ["list"] }], ["build", { engine: "neoforge-1.21.5" }], ["gradle_task", { engine: "neoforge-1.21.5", tasks: ["help"] }]] as const) {
    const text = await call(mcp, tool, args);
    assert(gated(text) && text.includes("not open") && text.includes("--allow-headless-runs") && text.includes("MCEDGE_ALLOW_HEADLESS_RUNS"), `${tool} without the app is refused and says what to do`);
  }
  assert(readActivity(project, 20).some((e) => e.tool === "server_command" && e.error), "the refusal is in the agent timeline as an error");
  assert(!gated(await mcp.call("project_info")) && !gated(await mcp.call("list_files", { path: "." })), "tools that are not heavy are untouched");

  // A heartbeat that is too old, and one of a process that is gone.
  presence({ at: new Date(Date.now() - (EXECUTION.presenceFreshSeconds + 5) * 1000).toISOString() });
  assert(gated(await call(mcp)), "a stale heartbeat counts as closed");
  const dead = spawnSync(process.execPath, ["-e", "0"]);
  presence({ pid: dead.pid });
  assert(gated(await call(mcp)), "a heartbeat of a dead process counts as closed");

  // App open, policy allow: runs.
  presence({ agentRuns: "allow" });
  const allowed = await call(mcp);
  assert(!gated(allowed) && pendingApprovals(project).length === 0, `policy allow runs without a request: ${String(allowed).slice(0, 60)}`);

  // App open, policy ask: a request, answered once.
  presence({ agentRuns: "ask" });
  let pending = call(mcp);
  let request = await waitRequest();
  assert(request.tool === "server_command" && request.summary.includes("list") && request.client === "mcedge-test" && !!request.session, `the request names tool, arguments and agent: ${JSON.stringify(request)}`);
  answerApproval(project, request.id, "once");
  assert(!gated(await pending), "Allow once runs the call");
  assert(readdirSync(join(project, LIVE_DIR)).every((f) => !f.startsWith("approval-")), "request and answer files are removed");
  pending = call(mcp);
  request = await waitRequest();
  answerApproval(project, request.id, "deny");
  let text = await pending;
  assert(gated(text) && text.includes("denied"), "Deny refuses the call");
  // No answer: refused after the timeout.
  text = await call(mcp);
  assert(gated(text) && text.includes("did not answer"), "no answer refuses after the timeout");
  // Session: asked once, then free.
  pending = call(mcp);
  request = await waitRequest();
  answerApproval(project, request.id, "session");
  assert(!gated(await pending), "Allow for this session runs the call");
  assert(!gated(await call(mcp)) && pendingApprovals(project).length === 0, "the next call of the session does not ask again");
  // The app closing ends it: no heartbeat, refused even in the allowed session.
  clearPresence();
  assert(gated(await call(mcp)), "the session allowance does not outlive the app");
} finally {
  await mcp.close();
}

// Unattended runs: the environment variable and the flag.
for (const [how, env, flags] of [["MCEDGE_ALLOW_HEADLESS_RUNS=1", { MCEDGE_ALLOW_HEADLESS_RUNS: "1" }, []], ["--allow-headless-runs", { MCEDGE_ALLOW_HEADLESS_RUNS: "0" }, ["--allow-headless-runs"]]] as const) {
  clearPresence();
  mcp = await connect(project, { ...env }, undefined, [...flags]);
  try {
    assert(!gated(await call(mcp)), `${how} lets a heavy tool run without the app`);
    presence({ agentRuns: "ask" });
    const pending = call(mcp);
    answerApproval(project, (await waitRequest()).id, "deny");
    assert(gated(await pending), `${how} does not skip the question while the app is open`);
  } finally {
    await mcp.close();
  }
}
console.log("PASS agent-run-gate");
