import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import EXECUTION from "../../config/agent-execution.json" with { type: "json" };
import { LIVE_DIR, readPresence } from "./activity.ts";

/**
 * Agent runs need the user's say (Q255). An MCP tool that starts Gradle, the game or a server (config/agent-execution.json)
 * asks the running app first: the MCP server writes .mcedge/live/approval-<id>.json, the app shows a dialog and writes
 * approval-<id>.answer.json, the MCP server reads it and runs or refuses. The app also publishes its policy in
 * presence-app.json (`agentRuns`).
 */
export const EXECUTION_CONFIG = EXECUTION;
export type ApprovalChoice = "once" | "session" | "deny";

export interface ApprovalRequest {
  id: string;
  /** ISO time. */
  at: string;
  tool: string;
  /** The call's arguments, shortened. */
  summary: string;
  /** The agent's MCP client name and its MCP session (one server run). */
  client?: string;
  session: string;
}

const file = (dir: string, id: string, suffix: "" | ".answer") => join(dir, LIVE_DIR, `approval-${id}${suffix}.json`);

export const isHeavyTool = (tool: string) => EXECUTION.tools.includes(tool);

/** Seconds a call waits for the user (the testing override MCEDGE_APPROVAL_TIMEOUT_S wins). */
export function approvalTimeoutMs(): number {
  const seconds = Number(process.env[EXECUTION.timeoutEnv]);
  return (seconds > 0 ? seconds : EXECUTION.approvalTimeoutSeconds) * 1000;
}

/** Is the MCEdge app running with this project open: a fresh heartbeat of a live process. Returns its policy. */
export function appRunning(dir: string): { agentRuns: "ask" | "allow" } | undefined {
  const app = readPresence(dir, "app");
  if (!app || !(Date.now() - Date.parse(app.at) < EXECUTION.presenceFreshSeconds * 1000)) return undefined;
  if (app.pid) {
    try {
      process.kill(app.pid, 0);
    } catch (error) {
      // EPERM: the process exists but belongs to someone else.
      if ((error as NodeJS.ErrnoException).code !== "EPERM") return undefined;
    }
  }
  return { agentRuns: app.agentRuns === "allow" ? "allow" : "ask" };
}

const read = <T>(path: string): T | undefined => {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
};

/** Requests the user has not answered yet, oldest first; the ones nobody waits for any more are left out. */
export function pendingApprovals(dir: string): ApprovalRequest[] {
  const live = join(dir, LIVE_DIR);
  if (!existsSync(live)) return [];
  const fresh = Date.now() - (EXECUTION.approvalTimeoutSeconds + 5) * 1000;
  return readdirSync(live).filter((f) => /^approval-[\w.]+\.json$/.test(f) && !f.endsWith(".answer.json"))
    .flatMap((f) => {
      const request = read<ApprovalRequest>(join(live, f));
      return request && Date.parse(request.at) > fresh && !existsSync(file(dir, request.id, ".answer")) ? [request] : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function answerApproval(dir: string, id: string, answer: ApprovalChoice): void {
  writeFileSync(file(dir, id, ".answer"), JSON.stringify({ id, answer, at: new Date().toISOString() }) + "\n");
}

/** Writes the request and waits for the answer; no answer in time counts as deny. Both files are removed afterwards. */
export async function askApproval(dir: string, request: Omit<ApprovalRequest, "id" | "at">, timeoutMs = approvalTimeoutMs()): Promise<ApprovalChoice | "timeout"> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(join(dir, LIVE_DIR), { recursive: true });
  writeFileSync(file(dir, id, ""), JSON.stringify({ id, at: new Date().toISOString(), ...request }) + "\n");
  try {
    for (const end = Date.now() + timeoutMs; Date.now() < end;) {
      const answer = read<{ answer: ApprovalChoice }>(file(dir, id, ".answer"))?.answer;
      if (answer) return answer;
      await new Promise((r) => setTimeout(r, 150));
    }
    return "timeout";
  } finally {
    rmSync(file(dir, id, ""), { force: true });
    rmSync(file(dir, id, ".answer"), { force: true });
  }
}
