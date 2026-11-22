/**
 * Runs the whole UI suite: every tools/ui-test/*.ts test, hidden (cdp.ts keeps the window hidden), one at a time, each in
 * its own process with a time limit, then prints a pass/fail summary with timings.
 *
 *   npm run test:ui                      all tests
 *   npm run test:ui -- gui- tags         only tests whose file name contains one of the words
 *   UPDATE_EVIDENCE=1 npm run test:ui    also rewrites the tracked design/ screenshots and docs/A11Y-AUDIT.md
 *
 * Screenshots go to the untracked .ui-out/ folder. Needs `npm run build:app` first. Refuses to start while
 * C:/BrainOS/.ingame exists (the user is in a game). Exit code 1 when any test fails.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO, UI_OUT } from "./cdp.ts";

/** Helpers and one-off tools that are not tests (no PASS line, or they write mockup assets). */
const NOT_TESTS = new Set(["cdp", "fixtures", "a11y-page", "tabOrderFixture", "add-strings", "capture-q278-shell", "git-graph-check", "perf-q277-validate",
  "perf-measure", "perf-q277", "perf-suite", "packaged", "multi-client-run", "audit-q278", "audit-q279", "run-all"]);
/** Limit for one test (ms); a test over it is killed (its process tree) and counted as a failure. */
const LIMIT_MS = Number(process.env.UI_TEST_LIMIT_MS ?? 600_000);
/** Tests that start a Minecraft client (a window and sound on the user's machine): listed as skipped unless UI_TEST_GAME=1. */
const STARTS_GAME = new Set(["gradle-commands"]);
/** Tests that run a dedicated server or a Gradle build get longer. */
const SLOW = new Set(["scenarios-view", "tools-menu", "tour", "export-focus", "export-publish", "create-pack", "build-explain"]);

if (existsSync("C:/BrainOS/.ingame")) {
  console.error("C:/BrainOS/.ingame exists (the user is in a game): not running the UI suite.");
  process.exit(2);
}
// JDKs, Gradle and the Java language server are downloaded once per machine: a worktree uses the main checkout's folder
// instead of downloading its own copies (MCEDGE_TOOLCHAINS overrides).
if (!process.env.MCEDGE_TOOLCHAINS) {
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  const shared = common ? join(common, "..", ".toolchains") : "";
  if (shared && existsSync(shared)) process.env.MCEDGE_TOOLCHAINS = shared;
}
const words = process.argv.slice(2);
const dir = join(REPO, "tools", "ui-test");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))
  .filter((n) => !NOT_TESTS.has(n) && (words.length === 0 || words.some((w) => n.includes(w))))
  .sort();

interface Result { name: string; ok: boolean; skipped?: boolean; ms: number; note: string }
const results: Result[] = [];

function runOne(name: string): Promise<Result> {
  if (STARTS_GAME.has(name) && process.env.UI_TEST_GAME !== "1") {
    return Promise.resolve({ name, ok: true, skipped: true, ms: 0, note: "starts a Minecraft client (set UI_TEST_GAME=1 to run it)" });
  }
  const limit = SLOW.has(name) ? LIMIT_MS * 3 : LIMIT_MS;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(dir, `${name}.ts`)], { cwd: REPO, windowsHide: true, env: { ...process.env, UI_TEST_VISIBLE: "" } });
    let tail = "";
    let timedOut = false;
    const keep = (chunk: Buffer) => (tail = (tail + chunk.toString()).slice(-4000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      // Only the process this runner started, with its children (the Electron app of that test).
      if (child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    }, limit);
    child.on("close", (code) => {
      clearTimeout(timer);
      // The exit code is the contract (run() and the plain scripts exit non-zero on a failure); a FAIL line counts too.
      const ok = code === 0 && !/^FAIL\b/m.test(tail) && !timedOut && !/^SKIP /m.test(tail);
      // A test that cannot run here says `SKIP <reason>` and exits 0: it is listed as skipped, never as passed.
      const skip = !ok && code === 0 && !timedOut ? tail.match(/^SKIP (.*)$/m)?.[1] : undefined;
      const lastLine = tail.trim().split("\n").filter((l) => /FAIL|Error|assertion/.test(l)).slice(0, 1)[0] ?? "";
      resolve({ name, ok: ok || skip !== undefined, skipped: skip !== undefined, ms: Date.now() - started,
        note: skip ?? (timedOut ? `timed out after ${limit / 1000} s` : ok ? "" : (lastLine || `exit ${code}`).slice(0, 160)) });
    });
  });
}

for (const name of names) {
  if (existsSync("C:/BrainOS/.ingame")) {
    console.error("C:/BrainOS/.ingame appeared: stopping.");
    break;
  }
  const result = await runOne(name);
  results.push(result);
  console.log(`${result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL"}  ${name}  ${(result.ms / 1000).toFixed(1)} s${result.note ? `  ${result.note}` : ""}`);
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
const total = results.reduce((sum, r) => sum + r.ms, 0);
const lines = [
  "",
  `UI tests: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped, ${names.length - results.length} not run, ${(total / 60000).toFixed(1)} min`,
  ...failed.map((r) => `  FAIL ${r.name} (${(r.ms / 1000).toFixed(1)} s) ${r.note}`),
  ...skipped.map((r) => `  SKIP ${r.name} ${r.note}`),
];
console.log(lines.join("\n"));
mkdirSync(join(REPO, UI_OUT), { recursive: true });
writeFileSync(join(REPO, UI_OUT, "summary.txt"), [...results.map((r) => `${r.ok ? "PASS" : "FAIL"}\t${r.name}\t${(r.ms / 1000).toFixed(1)}s\t${r.note}`), ...lines].join("\n") + "\n");
process.exitCode = failed.length || results.length < names.length ? 1 : 0;
