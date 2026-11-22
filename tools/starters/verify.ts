/**
 * Verifies the starters of the template gallery (Q252) and records the result in config/starters/gallery.json: per
 * engine, whether the starter built (a real Gradle build) and passed a smoke test on a dedicated server (its scenario,
 * run by the test probe). A starter is listed in the gallery only when every target passed.
 *
 *   node tools/starters/verify.ts [--engine <id>]... [--starter <id>]... [--keep] [--dry]
 *
 * Headless only: Gradle and the server run through src/build/gradle.ts (windowsHide, no console window); no client is
 * started. Engines run one after the other. The starters are built in a copy under the temp folder, never in
 * examples/ or in a project of the user. Stops when C:/BrainOS/.ingame exists (game mode).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProject, engineSetup } from "../../src/build/gradle.ts";
import { runProbe, type ProbeHost } from "../../src/build/scenarioRun.ts";
import { serverTasks } from "../../src/build/runs.ts";
import type { Scenario } from "../../src/build/scenario.ts";
import { Run } from "../../src/mcp/runs.ts";
import { listEngines, toolchainNeeds } from "../../src/engines/registry.ts";
import { ensureToolchains } from "../../src/engines/toolchains.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { createProject } from "../../src/ir/createProject.ts";
import { applyStarter, listStarters, starterScenario, type StarterCheck } from "../../src/ir/starters.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { ROOT } from "../../src/paths.ts";

const GAME_MODE = "C:/BrainOS/.ingame";
const GALLERY = join(ROOT, "config", "starters", "gallery.json");
const args = process.argv.slice(2);
const values = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const engineIds = values("--engine").length ? values("--engine") : (JSON.parse(readFileSync(GALLERY, "utf8")).targets as string[]);
const starterIds = values("--starter").length ? values("--starter") : listStarters(true).map((s) => s.id);
const keep = args.includes("--keep");
const dry = args.includes("--dry");

const stopIfGameMode = () => {
  if (existsSync(GAME_MODE)) {
    console.error(`game mode is on (${GAME_MODE}); stopping before the next Gradle or server run`);
    process.exit(3);
  }
};
const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address() as { port: number }; probe.close(() => resolve(port)); });
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const today = () => new Date().toISOString().slice(0, 10);

/** A project of the starters (empty project + each starter with its example parameters). */
function makeProject(parent: string, ids: string[]): string {
  const dir = createProject({ parent, name: "Starters", modId: "starters", package: "dev.mcedge.starters", template: "empty" });
  for (const id of ids) {
    const result = applyStarter(dir, id, listStarters(true).find((s) => s.id === id)!.params);
    if (!result.applied) throw new Error(`starter ${id} did not apply: ${JSON.stringify(result.errors)} ${JSON.stringify(result.newProblems)}`);
  }
  return dir;
}

/** The error lines of a Gradle log, for the note of a failed check. */
function failure(logFile: string): string {
  const lines = existsSync(logFile) ? readFileSync(logFile, "utf8").split(/\r?\n/) : [];
  return lines.filter((l) => /error:|FAILED|What went wrong|Could not|Exception/.test(l)).slice(0, 4).join(" | ").slice(0, 400);
}

async function build(engineId: string, dir: string): Promise<{ ok: boolean; note?: string }> {
  const engine = listEngines().find((e) => e.id === engineId)!;
  await ensureToolchains(toolchainNeeds(engine));
  const out = join(dir, "out", engineId);
  generateTarget(loadProject(dir), dir, engine, out, {});
  stopIfGameMode();
  const result = await buildProject(engineSetup(engine, out));
  return result.ok && result.jar ? { ok: true } : { ok: false, note: failure(result.logFile) || `Gradle exit ${result.exitCode}` };
}

async function smoke(engineId: string, dir: string, ids: string[]): Promise<Record<string, { ok: boolean; note?: string }>> {
  const engine = listEngines().find((e) => e.id === engineId)!;
  const out = join(dir, "out", engineId);
  // The server project with the test probe; the server listens on a free port, not the user's 25565.
  generateTarget(loadProject(dir), dir, engine, out, { probe: {} });
  const setup = engineSetup(engine, out);
  const tasks = serverTasks(setup);
  const propertiesFile = join(out, "run", "server.properties");
  writeFileSync(propertiesFile, readFileSync(propertiesFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("server-port=")).concat(`server-port=${await freePort()}`).join("\n") + "\n");
  const steps = ids.flatMap((id) => starterScenario(id, listStarters(true).find((s) => s.id === id)!.params, "starters").steps.map((s) => ({ ...s, label: `[${id}] ${s.label ?? s.op}` })));
  const scenario: Scenario = { name: "starters smoke", steps };
  const server = new Run();
  const host: ProbeHost = {
    running: () => Boolean(server.run),
    exitCode: () => server.exitCode,
    tail: (lines) => server.tail(lines),
    logFile: () => server.logFile,
    start: async () => void server.start(setup, tasks, "mcedge-server.log", engineId),
    stop: async () => { server.run?.stop(); await Promise.race([server.run?.done, sleep(30_000)]); },
  };
  stopIfGameMode();
  const per: Record<string, { ok: boolean; note?: string }> = {};
  try {
    const result = await runProbe(host, out, scenario, 900);
    for (const id of ids) {
      const mine = result.steps.filter((s) => s.label?.startsWith(`[${id}] `));
      const bad = mine.filter((s) => s.error || s.pass === false);
      const fatal = result.fatal;
      per[id] = fatal ? { ok: false, note: `probe: ${fatal}`.slice(0, 300) } : bad.length ? { ok: false, note: bad.map((s) => `${s.label}: ${s.error ?? JSON.stringify(s.value)}`).join(" | ").slice(0, 400) } : { ok: true };
      if (!mine.length) per[id] = { ok: false, note: "no step ran" };
    }
    console.log(`  server ${engineId}: passed ${result.passed} failed ${result.failed} errors ${result.errors}${result.fatal ? ` fatal ${result.fatal}` : ""}`);
    for (const s of result.steps) console.log(`    ${s.label ?? s.op}: ${JSON.stringify(s.value ?? s.error)}${s.pass === undefined ? "" : s.pass ? " PASS" : " FAIL"}`);
  } catch (error) {
    for (const id of ids) per[id] = { ok: false, note: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
  return per;
}

function record(engineId: string, id: string, check: StarterCheck): void {
  if (dry) return;
  const gallery = JSON.parse(readFileSync(GALLERY, "utf8"));
  const entry = gallery.starters.find((s: { id: string }) => s.id === id);
  entry.verified[engineId] = check;
  writeFileSync(GALLERY, JSON.stringify(gallery, null, 2) + "\n");
}

const parent = mkdtempSync(join(tmpdir(), "mcedge-starters-"));
console.log(`working in ${parent}; engines ${engineIds.join(", ")}; starters ${starterIds.join(", ")}`);
let failed = 0;
try {
  for (const engineId of engineIds) {
    console.log(`== ${engineId}`);
    stopIfGameMode();
    const root = mkdtempSync(join(parent, "p-"));
    const combined = makeProject(root, starterIds);
    let built: Record<string, { ok: boolean; note?: string }> = {};
    const all = await build(engineId, combined);
    console.log(`  build all: ${all.ok ? "ok" : `FAILED ${all.note}`}`);
    if (all.ok) built = Object.fromEntries(starterIds.map((id) => [id, { ok: true }]));
    else {
      // Find which starter breaks the build: each one alone.
      for (const id of starterIds) {
        const alone = await build(engineId, makeProject(mkdtempSync(join(parent, "s-")), [id]));
        built[id] = alone;
        console.log(`  build ${id}: ${alone.ok ? "ok" : `FAILED ${alone.note}`}`);
      }
    }
    const good = starterIds.filter((id) => built[id].ok);
    const served = good.length ? await smoke(engineId, good.length === starterIds.length ? combined : makeProject(mkdtempSync(join(parent, "g-")), good), good) : {};
    for (const id of starterIds) {
      const check: StarterCheck = {
        build: built[id].ok ? "pass" : "fail",
        server: served[id]?.ok ? "pass" : "fail",
        date: today(),
        ...(!built[id].ok ? { note: built[id].note } : served[id] && !served[id].ok ? { note: served[id].note } : !served[id] ? { note: "not run: the build failed" } : {}),
      };
      record(engineId, id, check);
      if (check.build !== "pass" || check.server !== "pass") failed++;
      console.log(`  ${id}: build ${check.build}, server ${check.server}${check.note ? ` (${check.note})` : ""}`);
    }
    if (!keep) rmSync(root, { recursive: true, force: true });
  }
} finally {
  if (!keep) rmSync(parent, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exitCode = failed ? 1 : 0;
