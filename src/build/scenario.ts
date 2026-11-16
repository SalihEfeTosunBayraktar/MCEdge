import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Scenarios for run_scenario (Q218) and the profile run of tick_profile (Q219): JSON the test probe generated into a
 * dev build (src/generator/probe.ts) reads from run/mcedge-probe/scenario.json and runs on a dedicated server. The
 * probe answers with run/mcedge-probe/result.json. docs/MCP.md lists the steps.
 */
export interface ScenarioStep {
  op: string;
  label?: string;
  /** What the step's value must be: a plain value, or {contains}, {matches}, {min, max}, {not}. */
  expect?: unknown;
  [key: string]: unknown;
}

export interface Scenario {
  name?: string;
  steps: ScenarioStep[];
}

/** Steps and the keys each needs, besides `op`, `label` and `expect`. */
const STEPS: Record<string, string[]> = {
  player: ["name"],
  removePlayer: ["name"],
  setblock: ["pos", "block"],
  command: ["command"],
  give: ["item"],
  setSlot: ["slot"],
  closeMenu: [],
  useBlock: ["pos"],
  useItem: [],
  useEntity: ["target"],
  setBlockData: ["pos", "key", "value"],
  call: ["procedure"],
  set: ["name", "value"],
  read: ["what"],
  profile: ["action"],
  wait: ["ticks"],
};
const READS = ["var", "block", "blockdata", "count", "inventory", "position", "menu", "slot", "bubble"];
const READ_NEEDS: Record<string, string[]> = { var: ["name"], block: ["pos"], blockdata: ["pos", "key"] };

/** What is wrong with a scenario, so a run does not start a build and a server for a typo. */
export function scenarioProblems(scenario: unknown): string[] {
  const steps = (scenario as Scenario | undefined)?.steps;
  if (!Array.isArray(steps) || !steps.length) return ["the scenario needs a non-empty steps array"];
  const problems: string[] = [];
  steps.forEach((step, index) => {
    const at = `steps[${index}]`;
    const needs = typeof step?.op === "string" ? STEPS[step.op] : undefined;
    if (!needs) return void problems.push(`${at}: unknown op ${JSON.stringify(step?.op)}; one of ${Object.keys(STEPS).join(", ")}`);
    for (const key of needs) if (!(key in step)) problems.push(`${at} (${step.op}): ${key} is missing`);
    if (step.op !== "read") return;
    if (!READS.includes(String(step.what))) return void problems.push(`${at} (read): unknown what ${JSON.stringify(step.what)}; one of ${READS.join(", ")}`);
    for (const key of READ_NEEDS[String(step.what)] ?? []) if (!(key in step)) problems.push(`${at} (read ${step.what}): ${key} is missing`);
  });
  return problems;
}

/** The scenario of a profile run: fake players that tick, a warm-up, then a measured stretch and the report. */
export function profileScenario(options: { players: number; warmupSeconds: number; seconds: number; all: boolean }): Scenario {
  return {
    name: "tick profile",
    steps: [
      ...Array.from({ length: options.players }, (_, i): ScenarioStep => ({ op: "player", name: `Profile${i + 1}`, ticking: true, pos: [0.5, 100, 0.5] })),
      { op: "wait", ticks: options.warmupSeconds * 20 },
      { op: "profile", action: "reset" },
      { op: "wait", ticks: options.seconds * 20 },
      { op: "profile", action: "report", all: options.all },
    ],
  };
}

/** Folder the probe reads and writes, in the engine's run folder. */
export const probeDir = (engineDir: string) => join(engineDir, "run", "mcedge-probe");

/** Puts the scenario where the probe finds it and clears an older result. */
export function writeScenario(engineDir: string, scenario: Scenario): void {
  const dir = probeDir(engineDir);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, "result.json"), { force: true });
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario, null, 2));
}

/** Removes the scenario, so a later normal server run of the engine folder does not start it again. */
export function clearScenario(engineDir: string): void {
  rmSync(join(probeDir(engineDir), "scenario.json"), { force: true });
}

/** What the probe wrote: the steps' values, pass or fail where expected, errors and messages. */
export interface ProbeResult {
  name?: string;
  passed: number;
  failed: number;
  errors: number;
  fatal?: string;
  steps: { op: string; label?: string; value?: unknown; expected?: unknown; pass?: boolean; error?: string; messages?: Record<string, string[]>; tick: number; ms: number }[];
}

/** The result once the probe has written it, else undefined. */
export function readResult(engineDir: string): ProbeResult | undefined {
  const file = join(probeDir(engineDir), "result.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}
