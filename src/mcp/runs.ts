import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listEngines } from "../engines/registry.ts";
import { logPath, runGradle, type GradleRun, type GradleSetup } from "../build/gradle.ts";
import { enableRcon, type RconConfig } from "../build/rcon.ts";
import { clientLogName, DEFAULT_PLAYER, isPlayerName, nextPlayer } from "../build/players.ts";
import { clientTasks, DEBUG_PORT, muteClient, serverTasks, testServerPort } from "../build/runs.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const text = (value: string, isError = false): Text => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });
const LOG_LINES_KEPT = 4000;

/** A long-running Gradle task the agent starts and polls: the client, the server, the debug client, a console command. */
export class Run {
  log: string[] = [];
  run?: GradleRun;
  /** Engine of the current or last run (undefined for Gradle mods). */
  engine?: string;
  /** Full log file of the current or last run. */
  logFile?: string;
  /** RCON of a server started by run_server. */
  rcon?: RconConfig;
  /** Last exit code, once the run ended. */
  exitCode?: number;
  start(setup: GradleSetup, tasks: string[], logName: string, engine?: string) {
    if (this.run) throw new Error("already running; stop it first");
    this.log.length = 0;
    this.engine = engine;
    this.exitCode = undefined;
    this.logFile = logPath(setup, logName);
    this.push(`[mcedge] gradle ${tasks.join(" ")}`);
    const run = runGradle(setup, tasks, this.logFile, (line) => this.push(line));
    this.run = run;
    run.done.then((code) => {
      this.push(`[mcedge] exited with code ${code}`);
      if (this.run === run) {
        this.run = undefined;
        this.exitCode = code;
      }
    });
    return run;
  }
  push(line: string) {
    this.log.push(line);
    if (this.log.length > LOG_LINES_KEPT) this.log.shift();
  }
  tail(lines = 80, filter?: string) {
    const regex = filter ? new RegExp(filter, "i") : undefined;
    return `running: ${Boolean(this.run)}\n${(regex ? this.log.filter((l) => regex.test(l)) : this.log).slice(-lines).join("\n")}`;
  }
}

/** The runs an agent can start, for the tools that observe them (src/mcp/observe.ts). */
export interface Runs {
  /** The client run of a player (default Dev); several players' clients may run at once (KUYRUK 190). */
  client(player?: string): Run;
  /** Players with a client running now. */
  runningPlayers(): string[];
  server: Run;
  debug: Run;
  /** Starts the client or the server the way run_client / run_server do. */
  start(kind: "client" | "server", engine?: string, options?: { player?: string; join?: boolean }): Promise<Run>;
}

const engineArg = { engine: z.string().optional().describe("Engine id; required for MCEdge projects, ignored for Gradle mods") };
const logArgs = { lines: z.number().int().positive().max(LOG_LINES_KEPT).optional(), filter: z.string().optional() };
/** Player name argument of the client tools (KUYRUK 190). */
export const playerArg = z.string().regex(/^[A-Za-z0-9_]{3,16}$/).optional();

/**
 * Build & run > Run client, Run server and Debug client, and Tools > Gradle console / Reload Gradle project for agents.
 * `setupFor` generates the engine's project first (MCEdge projects) or returns the Gradle mod's own setup.
 */
export function registerRunTools(server: McpServer, setupFor: (engine?: string, options?: { generate?: boolean }) => Promise<GradleSetup>, guard: Guard): Runs {
  const clients = new Map<string, Run>();
  const client = (player = DEFAULT_PLAYER): Run => {
    if (!clients.has(player)) clients.set(player, new Run());
    return clients.get(player)!;
  };
  const runningPlayers = () => [...clients].filter(([, r]) => r.run).map(([player]) => player);
  const srv = new Run();
  const debug = new Run();
  const gradle = new Run();

  const start = async (kind: "client" | "server", engine?: string, options: { player?: string; join?: boolean } = {}): Promise<Run> => {
    if (kind === "client") {
      const player = options.player ?? DEFAULT_PLAYER;
      if (!isPlayerName(player)) throw new Error(`bad player name "${player}": 3 to 16 letters, digits or _`);
      const run = client(player);
      if (run.run) throw new Error(`a client of ${player} is already running; stop it first or use another player name (${nextPlayer(runningPlayers())} is free)`);
      // A client of another player already runs from the generated project: start from it as it is, so the running
      // game's build is not changed under it.
      const generate = ![...clients.values()].some((r) => r.run && r.engine === engine);
      const setup = await setupFor(engine, { generate });
      // Clients an agent starts are silent (MCEDGE_TEST_SOUND=1 keeps the sound).
      muteClient(setup.projectDir);
      // Gradle mods have no engine: their client gets the player name and joins with quick play.
      const minecraft = listEngines().find((e) => e.id === engine)?.minecraft ?? "";
      run.start(setup, clientTasks(setup, minecraft, { player, join: options.join }), clientLogName(player), engine);
      if (options.join) run.push(`[mcedge] ${player} joins the test server on port ${testServerPort(setup.projectDir)}`);
      return run;
    }
    const setup = await setupFor(engine);
    if (srv.run) throw new Error("already running; stop it first");
    const tasks = serverTasks(setup);
    // RCON on a fresh port and password, so server_command can reach this server.
    srv.rcon = await enableRcon(setup.projectDir);
    srv.start(setup, tasks, "mcedge-server.log", engine);
    return srv;
  };

  server.registerTool(
    "run_client",
    {
      description: "Start the Minecraft client with the mod loaded (non-blocking). Read output with client_log; game_screenshot shows its window. "
        + "Several clients may run at once with different player names (multiplayer tests); with join_server the client connects straight to the "
        + "test server started by run_server (online-mode=false) instead of showing the title screen.",
      inputSchema: {
        ...engineArg,
        username: playerArg.describe(`Player name (3-16 letters, digits, _); default ${DEFAULT_PLAYER}. A second client needs another name, e.g. Dev2`),
        join_server: z.boolean().optional().describe("Connect to the local test server (run_server) on start"),
      },
    },
    ({ engine, username, join_server }) => guard(async () => {
      const player = username ?? DEFAULT_PLAYER;
      await start("client", engine, { player, join: join_server });
      return text(`client of ${player} starting${join_server ? ", joining the test server" : ""}; poll client_log${player === DEFAULT_PLAYER ? "" : ` with username "${player}"`}`);
    }),
  );
  const clientLogArgs = { ...logArgs, username: playerArg.describe(`Player of the client; default ${DEFAULT_PLAYER}`) };
  server.registerTool("client_log", { description: "Last lines of the running (or last) client's output of a player (default Dev), optionally filtered by a regex.", inputSchema: clientLogArgs },
    ({ lines, filter, username }) => guard(() => text(client(username).tail(lines, filter))));
  server.registerTool(
    "stop_client",
    { description: "Stop the client of one player, or every running client without username.", inputSchema: { username: playerArg.describe("Player of the client to stop; all clients when omitted") } },
    ({ username }) => guard(() => {
      const players = username ? [username].filter((p) => client(p).run) : runningPlayers();
      players.forEach((p) => client(p).run!.stop());
      return text(players.length ? `stop requested: ${players.join(", ")}` : username ? `no client of ${username} running` : "no client running");
    }),
  );

  server.registerTool("run_server", { description: "Start a dedicated Minecraft server with the mod (non-blocking; the EULA of the local test server is accepted, it runs with online-mode=false so dev clients can join, RCON is turned on for server_command). Poll server_log for \"Done (\".", inputSchema: engineArg },
    ({ engine }) => guard(async () => (await start("server", engine), text("server starting; poll server_log"))));
  server.registerTool("server_log", { description: "Last lines of the running (or last) server's output, optionally filtered by a regex.", inputSchema: logArgs },
    ({ lines, filter }) => guard(() => text(srv.tail(lines, filter))));
  server.registerTool("stop_server", { description: "Stop the running server." },
    () => guard(() => (srv.run ? (srv.run.stop(), text("stop requested")) : text("no server running"))));

  server.registerTool("debug_client", { description: `Start the client with a JDWP agent on localhost:${DEBUG_PORT} (non-blocking) for a Java debugger. Read output with debug_log; stop with stop_debug_client.`, inputSchema: engineArg },
    ({ engine }) => guard(async () => {
      const setup = await setupFor(engine);
      muteClient(setup.projectDir);
      debug.start(setup, clientTasks(setup, listEngines().find((e) => e.id === engine)?.minecraft ?? "", { debug: true }), "mcedge-debug.log", engine);
      return text(`debug client starting; attach to localhost:${DEBUG_PORT} once debug_log shows "Listening for transport"`);
    }));
  server.registerTool("debug_log", { description: "Output of the debug client.", inputSchema: logArgs }, ({ lines, filter }) => guard(() => text(debug.tail(lines, filter))));
  server.registerTool("stop_debug_client", { description: "Stop the debug client." },
    () => guard(() => (debug.run ? (debug.run.stop(), text("stop requested")) : text("no debug client running"))));

  server.registerTool(
    "gradle_task",
    {
      description: "Run Gradle tasks in the project (Tools > Gradle console), e.g. [\"dependencies\", \"--configuration\", \"runtimeClasspath\"]; "
        + "[\"help\"] after regenerating is Tools > Reload Gradle project. Waits for the end and returns the exit code and log tail.",
      inputSchema: { ...engineArg, tasks: z.array(z.string()).min(1), lines: z.number().int().positive().max(LOG_LINES_KEPT).optional() },
    },
    ({ engine, tasks, lines }) => guard(async () => {
      const setup = await setupFor(engine);
      const code = await gradle.start(setup, tasks, "mcedge-console.log").done;
      return text(`exit code ${code}\n${gradle.tail(lines ?? 60)}`, code !== 0);
    }),
  );
  return { client, runningPlayers, server: srv, debug, start };
}
