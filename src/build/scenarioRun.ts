import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { connect } from "node:net";
import { clearScenario, readResult, scenarioProblems, writeScenario, type ProbeResult, type Scenario } from "./scenario.ts";
import { RconClient, type RconConfig } from "./rcon.ts";
import { testServerPort } from "./runs.ts";

/** Folder of a project's scenario files (Q241), next to elements/ and localization/. */
export const SCENARIOS_DIR = "scenarios";

/** Longest wait for a run: a first build of an engine downloads and compiles for minutes. */
export const DEFAULT_TIMEOUT_SECONDS = 900;
/** How long a stopped server may take to end before a run returns anyway. */
export const STOP_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The dedicated server a scenario run drives; the MCP server's Run and the app's own server both implement it. */
export interface ProbeHost {
  running(): boolean;
  exitCode(): number | undefined;
  tail(lines: number): string;
  logFile(): string | undefined;
  /** Starts the server of the engine (built with the test probe). */
  start(): Promise<void>;
  /** Asks the server to stop and waits for it to end (bounded). */
  stop(): Promise<void>;
}

/**
 * Runs a scenario on a dedicated server: the scenario is written where the probe reads it, the host starts the server,
 * the answer is the probe's result file. The server is stopped at the end. Shared by MCP run_scenario / tick_profile
 * and the app's Scenarios panel.
 */
export async function runProbe(host: ProbeHost, engineDir: string, scenario: Scenario, timeoutSeconds: number): Promise<ProbeResult & { log?: string }> {
  if (host.running()) throw new Error("a server is running; stop it first");
  writeScenario(engineDir, scenario);
  try {
    await host.start();
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const result = readResult(engineDir);
      if (result) return { ...result, log: host.logFile() };
      if (!host.running()) throw new Error(`the server ended (exit code ${host.exitCode()}) before the scenario finished\n${host.tail(40)}`);
      if (Date.now() > deadline) throw new Error(`no result after ${timeoutSeconds} s\n${host.tail(30)}`);
      await sleep(500);
    }
  } finally {
    clearScenario(engineDir);
    await host.stop();
  }
}

/** A scenario file of the project. */
export interface ScenarioFile {
  /** Project-relative path, e.g. scenarios/ruby.json. */
  file: string;
  name: string;
  steps: number;
  problems: string[];
}

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_. -]{0,60}$/;

/** What is wrong with scenario JSON text (parse errors and scenarioProblems). */
export function textProblems(text: string): string[] {
  try {
    return scenarioProblems(JSON.parse(text));
  } catch (error) {
    return [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Scenario files of the project, by name; a file that is not valid JSON lists its problem instead of failing. */
export function listScenarioFiles(root: string): ScenarioFile[] {
  const dir = join(root, SCENARIOS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const text = readFileSync(join(dir, f), "utf8");
    let steps = 0;
    try {
      steps = (JSON.parse(text) as Scenario).steps?.length ?? 0;
    } catch { /* reported in problems */ }
    return { file: `${SCENARIOS_DIR}/${f}`, name: basename(f, ".json"), steps, problems: textProblems(text) };
  });
}

/** Path of the scenario called `name`; throws for a name that could leave the folder. */
export function scenarioFilePath(root: string, name: string): string {
  const base = name.replace(/\.json$/, "");
  if (!NAME.test(base)) throw new Error(`bad scenario name "${name}": letters, digits, space, _ - . (no folders)`);
  return join(root, SCENARIOS_DIR, `${base}.json`);
}

export function readScenarioFile(root: string, name: string): string {
  const path = scenarioFilePath(root, name);
  if (!existsSync(path)) throw new Error(`no scenario ${name}`);
  return readFileSync(path, "utf8");
}

/** Saves scenario text as the file `name`; text with problems is saved too (a draft), the problems are returned. */
export function writeScenarioFile(root: string, name: string, text: string): string[] {
  const path = scenarioFilePath(root, name);
  mkdirSync(join(root, SCENARIOS_DIR), { recursive: true });
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
  return textProblems(text);
}

/** A starting scenario: place a block, use it, read the block back and the inventory. */
export function scenarioTemplate(block = "minecraft:stone", item = "minecraft:apple"): Scenario {
  return {
    name: "new scenario",
    steps: [
      { op: "player", name: "Tester", pos: [0.5, 101, 0.5] },
      { label: "place the block", op: "setblock", pos: [2, 100, 2], block, expect: block },
      { op: "give", item, count: 3, hold: true },
      { label: "use the block", op: "useBlock", pos: [2, 100, 2] },
      { label: "block is there", op: "read", what: "block", pos: [2, 100, 2], expect: block },
      { label: "inventory", op: "read", what: "count", item, expect: 3 },
    ],
  };
}

/** True when something accepts connections on the engine's test server port (a server of the user's, or an agent's). */
export function serverPortInUse(engineDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(testServerPort(engineDir), "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.setTimeout(1500, () => (socket.destroy(), resolve(false)));
  });
}

/**
 * Reload data (Q241): after the project was generated again into the engine's folder, copies the data and assets of
 * the generated resources into the folder the running dev server reads (build/resources/main, which only a Gradle run
 * refreshes) and runs /reload on the server over RCON. Java code (procedures) needs a restart.
 */
export async function reloadServerData(engineDir: string, rcon: RconConfig): Promise<string> {
  const from = join(engineDir, "src", "main", "resources");
  const to = join(engineDir, "build", "resources", "main");
  if (!existsSync(to)) throw new Error("the server has not built its resources yet; wait until it is up");
  for (const folder of ["data", "assets"]) if (existsSync(join(from, folder))) cpSync(join(from, folder), join(to, folder), { recursive: true, force: true });
  const client = await RconClient.open(rcon);
  try {
    return (await client.command("reload", 60_000)).trim();
  } finally {
    client.close();
  }
}
