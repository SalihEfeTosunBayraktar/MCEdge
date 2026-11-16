import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listEngines } from "../engines/registry.ts";
import { profileScenario, scenarioProblems, type ProbeResult, type Scenario } from "../build/scenario.ts";
import { DEFAULT_TIMEOUT_SECONDS, STOP_WAIT_MS, listScenarioFiles, reloadServerData, runProbe, type ProbeHost } from "../build/scenarioRun.ts";
import type { GradleRun } from "../build/gradle.ts";
import type { ProbeOptions } from "../generator/typeModule.ts";
import type { Runs } from "./runs.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Adapts the MCP server's run to the shared scenario runner (src/build/scenarioRun.ts). */
function probeHost(runs: Runs, engine: string, probe: ProbeOptions): ProbeHost {
  const server = runs.server;
  return {
    running: () => Boolean(server.run),
    exitCode: () => server.exitCode,
    tail: (lines) => server.tail(lines),
    logFile: () => server.logFile,
    start: async () => void (await runs.start("server", engine, { probe })),
    stop: async () => {
      // Read again: the run may have started or ended while we waited.
      const run = server.run as GradleRun | undefined;
      if (run) {
        run.stop();
        await Promise.race([run.done, sleep(STOP_WAIT_MS)]);
      }
    },
  };
}

const runProbeOf = (runs: Runs, root: string, engine: string, scenario: Scenario, probe: ProbeOptions, timeoutSeconds: number) =>
  runProbe(probeHost(runs, engine, probe), join(root, "out", engine), scenario, timeoutSeconds);

const engineArg = z.string().describe(`Engine id (${listEngines().map((e) => e.id).join(", ")})`);
const timeoutArg = z.number().int().positive().max(3600).optional().describe(`Seconds to wait for the build, the server start and the scenario; default ${DEFAULT_TIMEOUT_SECONDS}`);

/** run_scenario (Q218), tick_profile (Q219), list_scenarios and reload_data (Q241); docs/MCP.md. MCEdge projects only. */
export function registerScenarioTools(server: McpServer, root: string, runs: Runs, guard: Guard, setupFor: (engine: string) => Promise<unknown>): void {
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
      const result = await runProbeOf(runs, root, engine, body, {}, timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
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
      const result = await runProbeOf(runs, root, engine, scenario, { profile: true }, timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
      const failed = result.steps.find((s) => s.error);
      const report = result.steps.find((s) => s.op === "profile" && s.value && typeof s.value === "object" && "procedures" in s.value)?.value as
        { ticks: number; seconds: number; players: number; procedures: unknown[] } | undefined;
      if (!report) throw new Error(`the profile run gave no report${failed ? `: ${failed.op}: ${failed.error}` : ""}${result.fatal ? `: ${result.fatal}` : ""}`);
      const listed = report.procedures.slice(0, top ?? 10);
      return json({ engine, ticks: report.ticks, seconds: report.seconds, players: report.players, listed: listed.length, of: report.procedures.length, procedures: listed, log: result.log });
    }),
  );

  server.registerTool(
    "list_scenarios",
    {
      description: "List the scenario files of the project (scenarios/*.json, the folder the app's Scenarios panel uses): file, name, number of steps and any problems with the steps. Run one with run_scenario `file`.",
    },
    () => guard(() => json(listScenarioFiles(root))),
  );

  server.registerTool(
    "reload_data",
    {
      description: "Reload without a restart: generate the project again into the engine's folder, copy its data and assets into the running dev server's resources and run /reload on it over RCON "
        + "(the server started by run_server). Java code (procedures) still needs a restart. A running client's integrated server has no command channel: its data follows with a restart; "
        + "assets of a client reload with F3+T in the game.",
      inputSchema: { engine: engineArg },
    },
    ({ engine }) => guard(async () => {
      if (!listEngines().some((e) => e.id === engine)) throw new Error(`unknown engine ${engine}`);
      const srv = runs.server;
      if (!srv.run || !srv.rcon) throw new Error("no server started by run_server is running");
      if (srv.engine !== engine) throw new Error(`the running server is ${srv.engine}, not ${engine}`);
      await setupFor(engine);
      const reply = await reloadServerData(join(root, "out", engine), srv.rcon);
      return json({ engine, reloaded: true, reply, hint: "Client assets: press F3+T in the game. Java code needs a restart." });
    }),
  );
}
