/**
 * Q277: responsiveness measurement of the real app on a COPY of ETREconomy-MCEdge (hidden window, own user data).
 * Run from a worktree, so the build under test is that worktree's out/:
 *   node tools/ui-test/perf-q277.ts [label]
 * Prints one JSON object: per step the wall time plus the renderer long tasks (>50 ms) and the longest main-process
 * event-loop stall during it, and the time of the project:reload (snapshot with validation) round trip.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { copyProject, launchApp } from "./cdp.ts";

const SOURCE = process.env.Q277_PROJECT ?? "C:\\MyProjects\\AI-Assisted\\ETREconomy-MCEdge";
const dir = copyProject(SOURCE, "etr");
const label = process.argv[2] ?? "run";
const t0 = Date.now();
const app = await launchApp({ project: dir });
const result: Record<string, unknown> = { label, startMs: Date.now() - t0 };

await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
await app.eval(`(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ["longtask"] }); })()`);
await app.mainEval(`(() => { const g = globalThis; g.__lag = 0; g.__last = Date.now(); clearInterval(g.__iv); g.__iv = setInterval(() => { const n = Date.now(); g.__lag = Math.max(g.__lag, n - g.__last - 5); g.__last = n; }, 5); return 1; })()`);

/** Runs a step and records wall ms, renderer long tasks and the longest main stall. */
async function step<T>(name: string, body: () => Promise<T>): Promise<T | undefined> {
  await app.eval(`window.__lt = []`);
  await app.mainEval(`globalThis.__lag = 0`);
  const start = Date.now();
  let value: T | undefined;
  try {
    value = await body();
  } catch (error) {
    result[`${name}-error`] = String(error).split("\n")[0];
  }
  const ms = Date.now() - start;
  await app.sleep(300);
  const lt = await app.eval<number[]>(`window.__lt`);
  const lag = await app.mainEval<number>(`globalThis.__lag`);
  result[name] = { ms, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)), longestTaskMs: Math.round(Math.max(0, ...lt)), mainStallMs: lag };
  console.error(name, JSON.stringify(result[name]));
  return value;
}
const home = async () => {
  await app.click(".rail .rtab");
  await app.waitFor(`document.querySelector(".tiles .tile")`);
};
/** Searches the element id, then opens the first tile (the grid shows folders until a search is set). */
const open = async (id: string) => {
  await app.setValue(".findbar input", id);
  await app.waitFor(`document.querySelector(".tile:not(.foldertile)")`, 15000);
  await app.eval(`document.querySelector(".tile:not(.foldertile)").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(200);
};
const waitSaved = async () => {
  await app.sleep(400);
  await app.waitFor(`!document.querySelector(".smsg.saving")`, 20000);
};

// 1. Typing in a text field: an item's first text input, 30 keystrokes, round trip to the second animation frame.
const names = readdirSync(join(dir, "elements", "items")).map((f) => f.replace(/\.json$/, "")).slice(0, 12);
await home();
await open("adminkey");
const keystrokes: number[] = [];
await step("type-30-chars", async () => {
  await app.eval(`(() => { const i = document.querySelector(".frow input:not([type=checkbox]):not([type=number])"); i.focus(); i.select(); })()`);
  for (const ch of "abcdefghijklmnopqrstuvwxyz1234") {
    const s = Date.now();
    await app.type(ch);
    await app.eval(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    keystrokes.push(Date.now() - s - 50);
  }
});
result.keystrokeMs = { median: keystrokes.sort((a, b) => a - b)[15], max: keystrokes[keystrokes.length - 1] };

// 2. Autosave after the edit: time until the saving indicator is gone.
await step("autosave-after-typing", waitSaved);

// 3. Switch between 12 elements.
await home();
await step("switch-12-elements", async () => {
  for (const n of names) {
    await home();
    await open(n);
  }
});

// 4. Open a GUI element (the one with the most widgets) and its layout page.
await home();
await step("open-gui-layout", async () => {
  await open("vendingmachinesgui");
  const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
  for (let p = 0; p < pages; p++) {
    const isLayout = await app.eval<boolean>(`!!document.querySelector(".guistage")`);
    if (isLayout) break;
    await app.eval(`document.querySelectorAll(".pagetabs .ltab")[${p}].click()`);
    await app.sleep(200);
  }
  await app.waitFor(`document.querySelector(".guistage")`, 20000);
  await app.sleep(500);
});

// 5. Edit a widget (move by arrow key) and save.
await step("gui-edit-and-save", async () => {
  await app.click(".gwidget");
  for (let i = 0; i < 5; i++) await app.key("ArrowRight");
  await waitSaved();
});

// 6. Validation: the project snapshot (all problems) the Problems panel shows, called straight from the renderer.
await step("reload-snapshot-x5", async () => {
  for (let i = 0; i < 5; i++) await app.eval(`window.mcedge.reloadProject(${JSON.stringify(dir)}).then(() => 1)`);
});
const reload = await app.eval<number[]>(`(async () => { const out = []; for (let i = 0; i < 5; i++) { const s = performance.now(); await window.mcedge.reloadProject(${JSON.stringify(dir)}); out.push(Math.round(performance.now() - s)); } return out; })()`);
result.reloadSnapshotMs = reload;
await app.click(".ptab", "Problems").catch(() => {});
await step("problems-panel", async () => {
  await app.eval(`document.querySelector(".ptab")?.click()`);
  await app.sleep(500);
});

// Validation alone, in Node, on the same copy: with and without the GUI image check.
await app.close();
const probe = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "tools/ui-test/perf-q277-validate.ts", dir], { cwd: process.cwd(), encoding: "utf8" });
result.validate = probe.stdout.trim() || probe.stderr.trim().slice(0, 300);
console.log(JSON.stringify(result));
