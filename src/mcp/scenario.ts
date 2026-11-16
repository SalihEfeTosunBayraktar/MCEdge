import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listEngines } from "../engines/registry.ts";
import { clearScenario, profileScenario, readResult, scenarioProblems, writeScenario, type ProbeResult, type Scenario } from "../build/scenario.ts";
import type { GradleRun } from "../build/gradle.ts";
import type { ProbeOptions } from "../generator/typeModule.ts";
import type { Runs } from "./runs.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Longest wait for a run: a first build of an engine downloads and compiles for minutes. */
const DEFAULT_TIMEOUT_SECONDS = 900;
/** How long a stopped server may take to end before the tool returns anyway. */
const STOP_WAIT_MS = 30_000;

/**
 * Runs a scenario on a dedicated server of the project: the engine's project is generated with the test probe (never
 * the exported jar's), the scenario is written where the probe reads it, and the answer is the probe's result file.
 * The server is stopped at the end.
 */
async function runProbe(runs: Runs, root: string, engine: string, scenario: Scenario, probe: ProbeOptions, timeoutSeconds: number): Promise<ProbeResult & { log?: string }> {
  const server = runs.server;
  if (server.run) throw new Error("a server is running; stop it first (stop_server)");
  const engineDir = join(root, "out", engine);
  writeScenario(engineDir, scenario);
  try {
    await runs.start("server", engine, { probe });
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const result = readResult(engineDir);
      if (result) return { ...result, log: server.logFile };
      if (!server.run) throw new Error(`the server ended (exit code ${server.exitCode}) before the scenario finished\n${server.tail(40)}`);
      if (Date.now() > deadline) throw new Error(`no result after ${timeoutSeconds} s\n${server.tail(30)}`);
      await sleep(500);
    }
  } finally {
    clearScenario(engineDir);
    // Read again: the run may have started or ended while we waited.
    const run = server.run as GradleRun | undefined;
    if (run) {
      run.stop();
      await Promise.race([run.done, sleep(STOP_WAIT_MS)]);
    }
  }
}

const engineArg = z.string().describe(`Engine id (${listEngines().map((e) => e.id).join(", ")})`);
const timeoutArg = z.number().int().positive().max(3600).optional().describe(`Seconds to wait for the build, the server start and the scenario; default ${DEFAULT_TIMEOUT_SECONDS}`);

/** run_scenario (Q218) and tick_profile (Q219); docs/MCP.md. MCEdge projects only. */
export function registerScenarioTools(server: McpServer, root: string, runs: Runs, guard: Guard): void {
  server.registerTool(
    "run_scenario",
    {
      description: "Run a JSON scenario on a dedicated server of the project and return each step's value (pass/fail where a step has `expect`). "
        + "The engine's project is generated with a test probe (dev builds only, never in export_jar), built, started, and stopped at the end. "
        + "Steps: player (fake player, `ticking` for its tick events), removePlayer, setblock, command, give (`hold`), setSlot, closeMenu, useBlock / useItem / useEntity "
        + "(right-click as a fake player), call (a procedure by id, `args` by dependency name), set and read of project variables, read of block, blockdata, count, inventory, "
        + "position, menu, slot and bubble, wait (ticks). Give the scenario inline or as a JSON `file` (absolute or project-relative). Fully described in docs/MCP.md.",
      inputSchema: {
        engine: engineArg,
        scenario: z.object({ name: z.string().optional(), steps: z.array(z.record(z.string(), z.unknown())) }).optional().describe("The scenario: {name?, steps: [{op, ...}]}"),
        file: z.string().optional().describe("A scenario JSON file instead of `scenario`"),
        timeoutSeconds: timeoutArg,
      },
    },
    ({ engine, scenario, file, timeoutSeconds }) => guard(async () => {
      if (!listEngines().some((e) => e.id === engine)) throw new Error(`unknown engine ${engine}`);
      const body = scenario ?? (file ? JSON.parse(readFileSync(isAbsolute(file) ? file : resolve(root, file), "utf8")) : undefined);
      if (!body) throw new Error("give a scenario or a file");
      const problems = scenarioProblems(body);
      if (problems.length) throw new Error(`the scenario is not valid:\n${problems.join("\n")}`);
      const result = await runProbe(runs, root, engine, body, {}, timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
      return json({ engine, ok: result.failed === 0 && result.errors === 0, ...result });
    }),
  );

  server.registerTool(
    "tick_profile",
    {
      description: "Run a dedicated server with the project for N seconds and report, per tick-triggered procedure (player, world and server ticks, block, item and effect ticks), "
        + "the time per call and per tick in microseconds, slowest per tick first, so a slow procedure stands out without writing code. Fake players (`players`) tick like real ones. "
        + "Times include the procedures a procedure calls. Only this run's build is instrumented (no cost in normal builds or export_jar).",
      inputSchema: {
        engine: engineArg,
        seconds: z.number().int().min(1).max(600).optional().describe("Measured seconds (20 ticks each); default 30"),
        warmupSeconds: z.number().int().min(0).max(120).optional().describe("Seconds before measuring, so loading and JIT warm-up do not count; default 5"),
        players: z.number().int().min(0).max(20).optional().describe("Fake players that tick during the run; default 1"),
        top: z.number().int().positive().max(200).optional().describe("How many procedures to list; default 10"),
        all: z.boolean().optional().describe("Also list procedures that no tick trigger runs but something called (their time is inside the caller's)"),
        timeoutSeconds: timeoutArg,
      },
    },
    ({ engine, seconds, warmupSeconds, players, top, all, timeoutSeconds }) => guard(async () => {
      if (!listEngines().some((e) => e.id === engine)) throw new Error(`unknown engine ${engine}`);
      const scenario = profileScenario({ players: players ?? 1, warmupSeconds: warmupSeconds ?? 5, seconds: seconds ?? 30, all: all ?? false });
      const result = await runProbe(runs, root, engine, scenario, { profile: true }, timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
      const failed = result.steps.find((s) => s.error);
      const report = result.steps.find((s) => s.op === "profile" && s.value && typeof s.value === "object" && "procedures" in s.value)?.value as
        { ticks: number; seconds: number; players: number; procedures: unknown[] } | undefined;
      if (!report) throw new Error(`the profile run gave no report${failed ? `: ${failed.op}: ${failed.error}` : ""}${result.fatal ? `: ${result.fatal}` : ""}`);
      const listed = report.procedures.slice(0, top ?? 10);
      return json({ engine, ticks: report.ticks, seconds: report.seconds, players: report.players, listed: listed.length, of: report.procedures.length, procedures: listed, log: result.log });
    }),
  );
}
