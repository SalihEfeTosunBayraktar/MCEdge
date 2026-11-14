import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseJavacDiagnostics } from "../build/javacErrors.ts";
import { groupLogProblems, type LogProblem } from "../build/logProblems.ts";
import { RconClient } from "../build/rcon.ts";
import { captureWindow } from "../build/windowShot.ts";
import { loadProject } from "../ir/storage.ts";
import { readPresence } from "../live/activity.ts";
import { showInApp } from "../live/show.ts";
import { mapDiagnostics, type MappedDiagnostic } from "./buildErrors.ts";
import { playerArg, type Run, type Runs } from "./runs.ts";

/**
 * Run and observe for agents (KUYRUK 145): grouped problems of a run's log with mod stack frames pointed at their
 * element and procedure block, server commands over RCON, screenshots of the game and of the MCEdge editor, and
 * observe_run, which does a whole test run in one call.
 */

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Text = { content: Content[]; isError?: boolean };
const json = (value: unknown, isError = false): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const READY = { server: /Done \(\d/, client: /Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas/ };
const DEAD = /Crash report saved|Failed to start the minecraft server|Exception in server tick loop|BUILD FAILED/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A mod stack frame: "at dev.x.procedures.FooProcedure.execute(FooProcedure.java:42)"; NeoForge puts the module
 * first ("at TRANSFORMER/mymod@1.0/dev.x...").
 */
const FRAME = /^at (?:[^\s/(]+\/)*([\w.$]+)\.[\w$<>]+\(([\w$]+\.java):(\d+)\)/;

/** Like the server's guard, for answers that may carry an image: a thrown error becomes an error result. */
async function guard(fn: () => Promise<Text> | Text): Promise<Text> {
  try {
    return await fn();
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

export function registerObserveTools(server: McpServer, root: string, kind: "mcedge" | "gradle", runs: Runs): void {
  /** A client is the one of `player` (default Dev, KUYRUK 190). */
  const runOf = (source: "client" | "server" | "debug", player?: string): Run => (source === "client" ? runs.client(player) : runs[source]);
  const usernameArg = { username: playerArg.describe("Player of the client (source client); default Dev") };
  const shotFile = (name: string) => {
    const dir = join(tmpdir(), "mcedge-shots");
    mkdirSync(dir, { recursive: true });
    return join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  };
  const image = (file: string): Content => ({ type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" });

  /** The first stack frame of the mod's own code, pointed at its element and block through the source map. */
  const sourceOf = (problem: LogProblem, run: Run, pkg: string | undefined): MappedDiagnostic | undefined => {
    if (kind !== "mcedge" || !run.engine || !pkg) return undefined;
    for (const line of problem.stack ?? []) {
      const m = FRAME.exec(line);
      if (!m || !m[1].startsWith(`${pkg}.`)) continue;
      const cls = m[1].replace(/\$.*$/, "");
      const outDir = join(root, "out", run.engine);
      const file = join(outDir, "src", "main", "java", ...cls.split(".")) + ".java";
      return mapDiagnostics(root, outDir, [{ file, line: Number(m[3]), severity: "error", message: problem.message, detail: [] }])[0];
    }
    return undefined;
  };
  const problemsOf = (run: Run, options: { warnings: boolean; modOnly: boolean; limit: number }) => {
    // The full log file has every line; the kept tail is the fallback.
    const lines = run.logFile && existsSync(run.logFile) ? readFileSync(run.logFile, "utf8").split("\n") : run.log;
    const project = kind === "mcedge" ? loadProject(root) : undefined;
    const pkg = project?.mod.package;
    const match = options.modOnly && project ? new RegExp(`${project.mod.id}|${pkg?.replaceAll(".", "\\.")}`, "i") : undefined;
    const grouped = groupLogProblems(lines, { warnings: options.warnings, match });
    // A run that failed to compile: the javac errors, pointed at their source like build_errors.
    const javac = parseJavacDiagnostics(lines).filter((d) => d.severity === "error");
    const compileErrors = javac.length && kind === "mcedge" && run.engine ? mapDiagnostics(root, join(root, "out", run.engine), javac).slice(0, 20) : [];
    return {
      running: Boolean(run.run),
      ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
      errors: grouped.errors,
      warnings: grouped.warnings,
      groups: grouped.problems.length,
      ...(compileErrors.length ? { compileErrors } : {}),
      problems: grouped.problems.slice(0, options.limit).map(({ key: _key, ...p }) => {
        const source = sourceOf(p as LogProblem, run, pkg);
        return { ...p, ...(source?.element ? { origin: { element: source.element, ...(source.block ? { block: source.block } : {}), file: source.file, line: source.line } } : {}) };
      }),
    };
  };
  const problemArgs = {
    warnings: z.boolean().default(true).describe("Include warnings"),
    modOnly: z.boolean().default(false).describe("Only problems that mention the mod id or package (message, logger or stack)"),
    limit: z.number().int().min(1).max(200).default(40),
  };

  server.registerTool(
    "log_problems",
    {
      description: "Errors and warnings of the running (or last) client, server or debug client, grouped: log4j ERROR/WARN/FATAL lines, uncaught exceptions with their "
        + "first stack lines and Gradle failures (a run that failed to compile also gives compileErrors, as build_errors); repeats (same text once numbers are masked) count once. A stack frame in the mod's own code is pointed at its "
        + "element and procedure block (origin). Errors come first, most frequent first.",
      inputSchema: { source: z.enum(["client", "server", "debug"]), ...usernameArg, ...problemArgs },
    },
    ({ source, username, warnings, modOnly, limit }) => guard(() => json(problemsOf(runOf(source, username), { warnings, modOnly, limit }))),
  );

  const command = async (cmd: string): Promise<string> => {
    const srv = runs.server;
    if (!srv.run || !srv.rcon) throw new Error("no server started by run_server is running");
    if (!srv.log.some((l) => READY.server.test(l))) throw new Error("the server is not ready yet; wait for \"Done (\" in server_log");
    const client = await RconClient.open(srv.rcon);
    try {
      return await client.command(cmd);
    } finally {
      client.close();
    }
  };
  server.registerTool(
    "server_command",
    {
      description: "Run commands on the server started by run_server (over RCON, as the server console) and return each reply, e.g. [\"give Dev hellomcedge:ruby 3\", \"time set day\"]. A leading / is optional.",
      inputSchema: { commands: z.array(z.string().min(1)).min(1).max(50) },
    },
    ({ commands }) => guard(async () => {
      const replies: { command: string; reply: string }[] = [];
      for (const c of commands) replies.push({ command: c, reply: await command(c) });
      return json(replies);
    }),
  );

  const gameShot = (player?: string): { file?: string; error?: string } => {
    const candidates = player ? [runs.client(player)] : [runs.client(), ...runs.runningPlayers().map((p) => runs.client(p)), runs.debug];
    const run = candidates.find((r) => r.run?.pid);
    if (!run) return { error: player ? `no client of ${player} started by run_client is running` : "no client started by run_client or debug_client is running" };
    const file = shotFile("game");
    const error = captureWindow({ rootPid: run.run!.pid, title: "Minecraft*" }, file);
    return error ? { error } : { file };
  };
  server.registerTool(
    "game_screenshot",
    {
      description: "Screenshot of the game window of the client started by run_client (or debug_client): its own image even behind other windows, returned as an image plus the saved PNG path. "
        + "With several clients running, username picks one (default: Dev's, else the first running).",
      inputSchema: { username: playerArg.describe("Player of the client to capture") },
    },
    ({ username }) => guard(() => {
      const { file, error } = gameShot(username);
      if (error) throw new Error(error);
      return { content: [{ type: "text", text: JSON.stringify({ file }) }, image(file!)] };
    }),
  );

  server.registerTool(
    "editor_screenshot",
    {
      description: "Screenshot of the running MCEdge editor window as it is now (its own image, even behind other windows), plus what the user has open there "
        + "(the same as collaborators). With `screen` the app first switches there: a section (elements, resources, tags, variables, localization, git, "
        + "settings), a resources tab (resources/models), an element editor (item/ruby), a dialog (dialog/preferences, dialog/about, dialog/docs, dialog/shortcuts) or a "
        + "bottom panel (panel/agents, panel/problems, panel/build, panel/gradle; panel/activity and panel/tasks open the Agents panel at the latest session or the tasks).",
      inputSchema: { screen: z.string().optional().describe("Screen to show first; without it the current one") },
    },
    ({ screen }) => guard(async () => {
      if (screen) await showInApp(root, screen);
      const file = shotFile("editor");
      // The window of the app that has this project open (its presence names its process), not the first MCEdge window
      // found: a second MCEdge with another project may be open too (KUYRUK 158).
      const presence = readPresence(root, "app");
      const fresh = presence && Date.now() - Date.parse(presence.at) < 60_000;
      if (!fresh) throw new Error("the MCEdge app does not have this project open (no MCEdge window found for it)");
      const error = captureWindow(presence.pid ? { rootPid: presence.pid, title: "MCEdge*" } : { processNames: ["MCEdge", "electron"], title: "MCEdge*" }, file);
      if (error) throw new Error(error.startsWith("no window") ? "the MCEdge app is not running (no MCEdge window found)" : error);
      const app = presence;
      return { content: [{ type: "text", text: JSON.stringify({ file, open: app?.open ?? null, openAt: app?.at ?? null }) }, image(file)] };
    }),
  );

  server.registerTool(
    "observe_run",
    {
      description: "A whole test run in one call: start the client or server (unless it is already running), wait until it is ready (server: \"Done (\"; client: title screen) "
        + "or crashes, run `commands` on a server over RCON, wait `waitSeconds`, then return the grouped log problems (as log_problems), the command replies, "
        + "a client screenshot if asked, and stop the run unless `keepRunning`. Heavy: it builds and starts Minecraft.",
      inputSchema: {
        side: z.enum(["client", "server"]),
        engine: z.string().optional().describe("Engine id; required for MCEdge projects"),
        commands: z.array(z.string().min(1)).max(50).optional().describe("Server only"),
        waitSeconds: z.number().min(0).max(600).default(5),
        timeoutSeconds: z.number().min(30).max(1800).default(600).describe("Longest wait for the ready line"),
        screenshot: z.boolean().default(false).describe("Client only"),
        username: playerArg.describe("Client only: player name (default Dev); other names run beside a running client"),
        joinServer: z.boolean().default(false).describe("Client only: connect to the test server started by run_server"),
        keepRunning: z.boolean().default(false),
        ...problemArgs,
      },
    },
    ({ side, engine, commands, waitSeconds, timeoutSeconds, screenshot, username, joinServer, keepRunning, warnings, modOnly, limit }) => guard(async () => {
      if (commands?.length && side !== "server") throw new Error("commands need side \"server\"");
      const started = Date.now();
      const run = runOf(side, username).run ? runOf(side, username) : await runs.start(side, engine, { player: username, join: joinServer });
      let ready = false;
      while (Date.now() - started < timeoutSeconds * 1000) {
        if (run.log.some((l) => READY[side].test(l))) {
          ready = true;
          break;
        }
        if (!run.run || run.log.some((l) => DEAD.test(l))) break;
        await sleep(1000);
      }
      const readyAfterSeconds = ready ? Math.round((Date.now() - started) / 1000) : undefined;
      const replies: { command: string; reply: string }[] = [];
      if (ready) {
        for (const c of commands ?? []) {
          try {
            replies.push({ command: c, reply: await command(c) });
          } catch (error) {
            replies.push({ command: c, reply: `failed: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        await sleep(waitSeconds * 1000);
      }
      const shot = ready && screenshot && side === "client" ? gameShot(username) : undefined;
      const gradle = run.run;
      if (!keepRunning && gradle) {
        gradle.stop();
        await Promise.race([gradle.done, sleep(30_000)]);
      }
      const result = {
        side, ready, ...(readyAfterSeconds !== undefined ? { readyAfterSeconds } : {}), stopped: !keepRunning,
        ...(replies.length ? { commands: replies } : {}),
        ...(shot ? { screenshot: shot.file ?? shot.error } : {}),
        ...problemsOf(run, { warnings, modOnly, limit }),
      };
      const content: Content[] = [{ type: "text", text: JSON.stringify(result, null, 2) }];
      if (shot?.file) content.push(image(shot.file));
      return { content, ...(ready ? {} : { isError: true }) };
    }),
  );
}
