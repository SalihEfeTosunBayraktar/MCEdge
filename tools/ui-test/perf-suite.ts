/**
 * Q280: reusable speed suite of the real app. Measures the steps a user waits for on a COPY of a big project
 * (default: ETREconomy-MCEdge, never written to) in a hidden window with its own user data, and prints a before/after
 * table so a change (Q278/Q279 layouts, new features) can show it adds no cost.
 *
 *   npm run build:app
 *   node tools/ui-test/perf-suite.ts run <label> [--cold=3] [--diag] [--soak=600]
 *   node tools/ui-test/perf-suite.ts compare <labelA> <labelB> [...]      (table of design/280/perf-<label>.json files)
 *
 * run      timing pass (clean, nothing instrumented) -> design/280/perf-<label>.json. Cold start is the median of
 *          --cold launches (default 3). Steps: welcome list, project open, element switch, big procedure, typing,
 *          autosave, GUI open and edit, texture editor, project snapshot (validation), regenerate (build start),
 *          bundle sizes, plus Node-side load and validation.
 * --diag   adds the diagnosis pass (build with MCEDGE_PERF_BUILD=1 for readable names): CPU profiles of main and
 *          renderer, React commits and re-rendered components per step, IPC calls, bytes and time per channel.
 *          Slower, so its times are not the numbers of the table. -> design/280/diag-<label>.json
 * --soak   sustained run of N seconds (edit, save, switch, GUI) sampling memory every 30 s -> in the perf file.
 *
 * Nothing shows on screen: the window is cdp.ts's hidden one. Never set UI_TEST_VISIBLE.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, copyProject, launchApp, type App } from "./cdp.ts";

const OUT = join(REPO, "design", "280");
const SOURCE = process.env.PERF_PROJECT ?? "C:\\MyProjects\\AI-Assisted\\ETREconomy-MCEdge";

type Metrics = Record<string, number>;
interface Result {
  label: string;
  at: string;
  project: string;
  metrics: Metrics;
  diag?: Record<string, unknown>;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : 0);
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

// ---------------------------------------------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------------------------------------------
/** Metric name suffix gives the unit: _ms, _mb, _kb, _n. Lower is better for all of them. */
function compare(labels: string[]): void {
  const results = labels.map((l) => JSON.parse(readFileSync(join(OUT, `perf-${l}.json`), "utf8")) as Result);
  const names = [...new Set(results.flatMap((r) => Object.keys(r.metrics)))];
  const rows = [`| metric | ${labels.join(" | ")} | change |`, `| --- | ${labels.map(() => "---:").join(" | ")} | ---: |`];
  for (const name of names) {
    const values = results.map((r) => r.metrics[name]);
    const first = values[0];
    const last = values[values.length - 1];
    const change = first !== undefined && last !== undefined && first > 0 ? `${last <= first ? "" : "+"}${round(((last - first) / first) * 100)}%` : "";
    rows.push(`| ${name} | ${values.map((v) => (v === undefined ? "-" : String(v))).join(" | ")} | ${change} |`);
  }
  console.log(rows.join("\n"));
}

// ---------------------------------------------------------------------------------------------------------------
// bundle sizes
// ---------------------------------------------------------------------------------------------------------------
function bundleMetrics(): Metrics {
  const kb = (bytes: number) => round(bytes / 1024);
  const dirSize = (dir: string): number => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0) : 0);
  const html = readFileSync(join(REPO, "out", "renderer", "index.html"), "utf8");
  // What the page loads before it can show anything: the files its HTML references (scripts, modulepreloads, styles).
  const eager = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]).filter((f) => /\.(js|css)$/.test(f));
  const eagerBytes = eager.reduce((sum, f) => sum + statSync(join(REPO, "out", "renderer", f)).size, 0);
  const assets = join(REPO, "out", "renderer", "assets");
  const js = readdirSync(assets).filter((f) => /\.js$/.test(f) && !/worker/.test(f));
  return {
    bundle_renderer_eager_kb: kb(eagerBytes),
    bundle_renderer_js_total_kb: kb(js.reduce((s, f) => s + statSync(join(assets, f)).size, 0)),
    bundle_renderer_js_chunks_n: js.length,
    bundle_renderer_all_kb: kb(dirSize(join(REPO, "out", "renderer"))),
    bundle_main_kb: kb(dirSize(join(REPO, "out", "main"))),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// instrumentation helpers
// ---------------------------------------------------------------------------------------------------------------
/** Starts a CPU profile of the Electron main process (an in-process inspector session). */
const mainProfileStart = (app: App) =>
  app.mainEval(`(async () => {
    const inspector = (process.mainModule ? process.mainModule.require : require)("inspector");
    const s = globalThis.__prof = new inspector.Session(); s.connect();
    const post = (m, p) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
    await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 500 }); await post("Profiler.start");
    return 1;
  })()`);
const mainProfileStop = (app: App) =>
  app.mainEval<unknown>(`(async () => {
    const s = globalThis.__prof;
    const post = (m, p) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
    const { profile } = await post("Profiler.stop"); s.disconnect();
    return profile;
  })()`);

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
}
/** Self time per function (ms), the top `count`, plus the total of samples that are not idle. */
function topSelf(profile: CpuProfile, count = 15): { busyMs: number; top: { fn: string; ms: number }[]; byFile: { file: string; ms: number }[] } {
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFn = new Map<string, number>();
  const byFile = new Map<string, number>();
  let busy = 0;
  for (const node of profile.nodes) {
    const us = self.get(node.id) ?? 0;
    const name = node.callFrame.functionName || "(anonymous)";
    if (name === "(idle)" || name === "(program)") continue;
    busy += us;
    const file = node.callFrame.url.replace(/^.*[\\/](?:node_modules[\\/])?/, "") || name;
    const key = `${name} ${file}:${node.callFrame.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + us);
    byFile.set(file, (byFile.get(file) ?? 0) + us);
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, count);
  return { busyMs: round(busy / 1000), top: sorted(byFn).map(([fn, us]) => ({ fn, ms: round(us / 1000) })), byFile: sorted(byFile).map(([file, us]) => ({ file, ms: round(us / 1000) })) };
}

/** Hook injected before the page loads (diag): counts React commits and the function components that rendered. */
const REACT_HOOK = `(() => {
  const state = (window.__react = { commits: 0, rendered: 0, byName: {} });
  const isFn = (f) => f.tag === 0 || f.tag === 11 || f.tag === 14 || f.tag === 15;
  const name = (f) => { const t = f.type; const e = f.elementType; const x = (t && (t.displayName || t.name)) || (e && (e.displayName || e.name || (e.type && e.type.name))) || ""; return x || "(anon)"; };
  const walk = (next, prev) => {
    if (isFn(next) && (prev === null || (next.flags & 1) === 1)) { state.rendered++; const n = name(next); state.byName[n] = (state.byName[n] || 0) + 1; }
    if (prev === null || next.child !== prev.child) {
      for (let c = next.child; c; c = c.sibling) walk(c, c.alternate);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { this.renderers.set(1, r); return 1; },
    onCommitFiberRoot(_id, root) { state.commits++; try { walk(root.current, root.current.alternate); } catch {} },
    onPostCommitFiberRoot() {}, onCommitFiberUnmount() {}, checkDCE() {}, onScheduleFiberRoot() {}, setStrictMode() {},
  };
})()`;

/**
 * A project copy may name textures that are not on disk (ETREconomy-MCEdge does); generation stops at the first one.
 * The copy gets a placeholder at each missing path, so the build-start step measures a whole generation.
 */
function fillMissingTextures(dir: string): number {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const e of readdirSync(folder, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/^(out|schemas|textures|\.)/.test(e.name)) walk(join(folder, e.name)); }
      else if (e.name.endsWith(".json")) files.push(join(folder, e.name));
    }
  };
  walk(join(dir, "elements"));
  const placeholder = readdirSync(join(dir, "textures"), { recursive: true }).map(String).find((f) => f.endsWith(".png"));
  if (!placeholder) return 0;
  let made = 0;
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(/"(textures\/[A-Za-z0-9_./-]+\.png)"/g)) {
      const target = join(dir, m[1]);
      if (existsSync(target)) continue;
      mkdirSync(join(target, ".."), { recursive: true });
      copyFileSync(join(dir, "textures", placeholder), target);
      made++;
    }
  }
  return made;
}

// ---------------------------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------------------------
async function coldStarts(dir: string, runs: number): Promise<{ welcome: number[]; open: number[]; tiles: number[]; paint: number[] }> {
  const out = { welcome: [] as number[], open: [] as number[], tiles: [] as number[], paint: [] as number[] };
  for (let i = 0; i < runs; i++) {
    const app = await launchApp({ project: dir });
    const t = Date.now();
    await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    out.tiles.push(app.timings.openMs + (Date.now() - t));
    out.welcome.push(app.timings.welcomeMs);
    out.open.push(app.timings.openMs);
    out.paint.push(await app.eval<number>(`Math.round(performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint")?.startTime ?? 0)`));
    await app.close();
  }
  return out;
}

async function run(label: string, flags: Set<string>, soakSeconds: number, coldRuns: number): Promise<void> {
  const diag = flags.has("diag");
  const metrics: Metrics = { ...bundleMetrics() };
  const detail: Record<string, unknown> = {};
  const source = copyProject(SOURCE, "etr");
  mkdirSync(OUT, { recursive: true });

  if (!diag && coldRuns > 0) {
    const cold = await coldStarts(source, coldRuns);
    metrics.cold_welcome_list_ms = median(cold.welcome);
    metrics.cold_first_paint_ms = median(cold.paint);
    // The first launch opens a copy written a moment ago (cold file cache and virus scan of every file); the next
    // ones open it as the user's second start of the day does.
    metrics.project_first_open_ms = cold.tiles[0];
    if (cold.tiles.length > 1) metrics.project_open_to_grid_ms = median(cold.tiles.slice(1));
    console.error("cold", JSON.stringify(cold));
  }

  const dir = copyProject(SOURCE, "etr");
  console.error("placeholder textures added to the copy:", fillMissingTextures(dir));
  // Diag starts on the welcome list with the project in the recent list, so the first open (the one that refreshes a
  // project's schemas) is a measured step; the timing pass opens it through launchApp as every UI test does.
  const userData = diag ? mkdtempSync(join(tmpdir(), "mcedge-perf-data-")) : undefined;
  if (userData) {
    const preferences = { language: "en", theme: "dark", fontScale: 1, uiFont: "", codeFont: "", level: "java", mode: "advanced" };
    writeFileSync(join(userData, "app-state.json"), JSON.stringify({ exportFolders: {}, recent: [{ dir, name: "perf", openedAt: new Date().toISOString() }], preferences }));
  }
  const app = await launchApp(diag ? { userData } : { project: dir });
  if (!diag) await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
  else {
    // The React hook must be there before the page's scripts run: reload with it and stay on the welcome list.
    await app.waitFor(`document.querySelector(".grid tbody tr")`, 60000);
    await app.cdp("Page.enable");
    await app.cdp("Page.addScriptToEvaluateOnNewDocument", { source: REACT_HOOK });
    await app.eval(`window.__old = 1`);
    await app.cdp("Page.reload");
    await app.waitFor(`!window.__old && window.__react && document.querySelector(".grid tbody tr")`, 60000);
  }
  await app.eval(`(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ["longtask"] }); })()`);
  await app.mainEval(`(() => { const g = globalThis; g.__lag = 0; g.__last = Date.now(); clearInterval(g.__iv); g.__iv = setInterval(() => { const n = Date.now(); g.__lag = Math.max(g.__lag, n - g.__last - 5); g.__last = n; }, 5); return 1; })()`);

  /** Runs a step: wall ms, renderer long tasks, longest main-process stall; in diag also React and IPC deltas. */
  async function step<T>(name: string, body: () => Promise<T>): Promise<T | undefined> {
    await app.eval(`window.__lt = []`);
    await app.mainEval(`globalThis.__lag = 0`);
    const before = diag ? await app.eval<{ commits: number; rendered: number; byName: Record<string, number> }>(`JSON.parse(JSON.stringify(window.__react))`) : undefined;
    const ipcBefore = diag ? await app.mainEval<Record<string, { n: number; ms: number; bytes: number }>>(`JSON.parse(JSON.stringify(globalThis.__ipc))`) : undefined;
    if (diag) {
      await app.cdp("Profiler.start");
      await mainProfileStart(app);
    }
    const start = Date.now();
    let value: T | undefined;
    try {
      value = await body();
    } catch (error) {
      console.error(`step ${name} failed: ${String(error).split("\n")[0]}`);
      metrics[`${name}_failed_n`] = 1;
    }
    const ms = Date.now() - start;
    await app.sleep(300);
    let cpu: { renderer: ReturnType<typeof topSelf>; main: ReturnType<typeof topSelf> } | undefined;
    if (diag) cpu = { renderer: topSelf((await app.cdp("Profiler.stop")).profile as CpuProfile, 10), main: topSelf((await mainProfileStop(app)) as CpuProfile, 10) };
    const lt = await app.eval<number[]>(`window.__lt`);
    const lag = await app.mainEval<number>(`globalThis.__lag`);
    metrics[`${name}_ms`] = ms;
    metrics[`${name}_longtask_ms`] = Math.round(lt.reduce((a, b) => a + b, 0));
    metrics[`${name}_longest_task_ms`] = Math.round(Math.max(0, ...lt));
    metrics[`${name}_main_stall_ms`] = lag;
    if (diag && before && ipcBefore) {
      const after = await app.eval<{ commits: number; rendered: number; byName: Record<string, number> }>(`JSON.parse(JSON.stringify(window.__react))`);
      const ipcAfter = await app.mainEval<Record<string, { n: number; ms: number; bytes: number }>>(`JSON.parse(JSON.stringify(globalThis.__ipc))`);
      const byName = Object.entries(after.byName).map(([n, c]) => [n, c - (before.byName[n] ?? 0)] as const).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const channels = Object.entries(ipcAfter).map(([ch, e]) => [ch, { n: e.n - (ipcBefore[ch]?.n ?? 0), ms: round(e.ms - (ipcBefore[ch]?.ms ?? 0)), kb: round((e.bytes - (ipcBefore[ch]?.bytes ?? 0)) / 1024) }] as const).filter(([, e]) => e.n > 0).sort((a, b) => b[1].ms - a[1].ms);
      detail[name] = { commits: after.commits - before.commits, componentRenders: after.rendered - before.rendered, topComponents: byName, ipcCalls: channels.reduce((s, [, e]) => s + e.n, 0), ipcKb: round(channels.reduce((s, [, e]) => s + e.kb, 0)), ipcTop: channels.slice(0, 8), cpu };
      metrics[`${name}_commits_n`] = after.commits - before.commits;
      metrics[`${name}_renders_n`] = after.rendered - before.rendered;
      metrics[`${name}_ipc_n`] = channels.reduce((s, [, e]) => s + e.n, 0);
    }
    console.error(name, ms, "ms; long", lt.length, "stall", lag);
    return value;
  }

  if (diag) {
    await app.mainEval(`(() => {
      const { ipcMain } = (process.mainModule ? process.mainModule.require : require)("electron");
      globalThis.__ipc = {};
      for (const [ch, fn] of [...ipcMain._invokeHandlers]) {
        ipcMain._invokeHandlers.set(ch, async (...a) => { const t = performance.now(); const r = await fn(...a); const e = (globalThis.__ipc[ch] ||= { n: 0, ms: 0, bytes: 0 }); e.n++; e.ms += performance.now() - t; try { e.bytes += JSON.stringify(r)?.length ?? 0; } catch {} return r; });
      }
      return 1;
    })()`);
    await app.cdp("Profiler.enable");
    await app.cdp("Profiler.setSamplingInterval", { interval: 500 });
    await step("project_open", async () => {
      await app.click(".grid tbody tr", undefined, { double: true });
      await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    });
  }

  const home = async () => {
    await app.click(".rail .rtab");
    await app.waitFor(`document.querySelector(".tiles .tile")`);
  };
  /** Searches the id, opens the first element tile; returns ms from the double click to the editor shown and painted. */
  const open = async (id: string, ready = `document.querySelector(".edhead")`): Promise<number> => {
    await app.setValue(".findbar input", id);
    await app.waitFor(`document.querySelector(".tile:not(.foldertile)")`, 15000);
    const ms = await app.eval<number>(`(async () => {
      const t0 = performance.now();
      document.querySelector(".tile:not(.foldertile)").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      while (!(${ready})) { if (performance.now() - t0 > 20000) throw new Error("editor did not show"); await new Promise((r) => requestAnimationFrame(r)); }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    })()`);
    await app.sleep(150);
    return ms;
  };
  const waitSaved = async () => {
    await app.sleep(400);
    await app.waitFor(`!document.querySelector(".smsg.saving")`, 20000);
  };
  const names = (folder: string, count: number, skip: string[] = []) =>
    readdirSync(join(dir, "elements", folder)).map((f) => f.replace(/\.json$/, "")).filter((n) => !skip.includes(n)).sort().slice(0, count);

  // 1. Element switch: the double click to a painted editor, over a mix of types (not the typed item, not the big ones).
  const mix = [...names("items", 4, ["adminkey"]), ...names("blocks", 3), ...names("recipes", 2), ...names("guis", 2, ["vendingmachinesgui"]), ...names("procedures", 1)];
  await home();
  const switchMs: number[] = [];
  await step("switch_12_elements", async () => {
    // folders hold the elements: the search finds them by id wherever they are
    for (const id of mix) {
      await home();
      switchMs.push(await open(id));
    }
  });
  metrics.switch_element_median_ms = round(median(switchMs));
  metrics.switch_element_p95_ms = round(p95(switchMs));

  // 2. The biggest procedure (a Blockly program).
  const bigProc = readdirSync(join(dir, "elements", "procedures")).map((f) => [f, statSync(join(dir, "elements", "procedures", f)).size] as const).sort((a, b) => b[1] - a[1])[0][0].replace(/\.json$/, "");
  await home();
  await step("open_big_procedure", async () => {
    metrics.open_big_procedure_dblclick_ms = round(await open(bigProc, `document.querySelector(".blocklySvg, .blocklyWorkspace")`).catch(() => open(bigProc)));
  });

  // 3. Typing in a text field, 30 keystrokes.
  await home();
  await open("adminkey");
  const keystrokes: number[] = [];
  await step("type_30_chars", async () => {
    await app.eval(`(() => { const i = document.querySelector(".frow input:not([type=checkbox]):not([type=number])"); i.focus(); i.select(); })()`);
    for (const ch of "abcdefghijklmnopqrstuvwxyz1234") {
      const s = Date.now();
      await app.type(ch);
      await app.eval(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      keystrokes.push(Date.now() - s - 50);
    }
  });
  metrics.type_keystroke_median_ms = median(keystrokes);
  metrics.type_keystroke_p95_ms = p95(keystrokes);

  // 4. Save: time until the saving indicator is gone after the typing.
  await step("autosave_after_typing", waitSaved);

  // 5. A GUI (the one with the most widgets) and its layout page.
  await home();
  await step("open_gui_layout", async () => {
    await open("vendingmachinesgui");
    const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
    for (let p = 0; p < pages; p++) {
      if (await app.eval<boolean>(`!!document.querySelector(".guistage")`)) break;
      await app.eval(`document.querySelectorAll(".pagetabs .ltab")[${p}].click()`);
      await app.sleep(200);
    }
    await app.waitFor(`document.querySelector(".guistage")`, 20000);
    await app.sleep(500);
  });
  await step("gui_edit_and_save", async () => {
    await app.click(".gwidget");
    for (let i = 0; i < 5; i++) await app.key("ArrowRight");
    await waitSaved();
  });

  // 6. Texture editor: Resources, a texture, the painting canvas.
  await app.eval(`document.querySelector(".rail .rtab")?.click()`);
  await step("open_resources_tab", async () => {
    await app.click(".rtab", "Resources");
    await app.waitFor(`document.querySelector(".texcell")`, 20000);
  });
  await step("open_texture_editor", async () => {
    const t0 = Date.now();
    await app.eval(`document.querySelector(".texcell[data-path]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
    await app.waitFor(`document.querySelector(".paintcanvas")`, 20000);
    metrics.texture_editor_dblclick_ms = Date.now() - t0;
  });
  await app.key("Escape");
  await app.eval(`document.querySelector(".rail .rtab")?.click()`);

  // 7. Validation: the project snapshot (load + validate + resources) the app builds on open and every outside change.
  const reload = await app.eval<number[]>(`(async () => { const out = []; for (let i = 0; i < 5; i++) { const s = performance.now(); await window.mcedge.reloadProject(${JSON.stringify(dir)}); out.push(Math.round(performance.now() - s)); } return out; })()`);
  metrics.snapshot_roundtrip_median_ms = median(reload);
  await step("snapshot_x5", async () => {
    for (let i = 0; i < 5; i++) await app.eval(`window.mcedge.reloadProject(${JSON.stringify(dir)}).then(() => 1)`);
  });

  // 8. Build start: Regenerate code (the generation every build starts with, without Gradle), first engine.
  const engineId = await app.eval<string>(`window.mcedge.listEngines().then((e) => e[0].id)`);
  const regenerate = () => app.eval(`window.mcedge.regenerate(${JSON.stringify(dir)}, [${JSON.stringify(engineId)}]).then(() => 1)`);
  await step("regenerate_code", regenerate);
  await step("regenerate_code_2nd", regenerate);

  // 9. Heap and process memory after the steps.
  const memory = async (): Promise<Metrics> => {
    await app.cdp("HeapProfiler.collectGarbage").catch(() => {});
    const heap = await app.cdp("Runtime.getHeapUsage");
    const dom = await app.cdp("Memory.getDOMCounters").catch(() => ({ nodes: 0, jsEventListeners: 0 }));
    const proc = await app.mainEval<{ type: string; ws: number }[]>(`(process.mainModule ? process.mainModule.require : require)("electron").app.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize }))`);
    const mb = (n: number) => round(n / 1048576);
    return {
      renderer_heap_mb: mb(heap.usedSize),
      dom_nodes_n: dom.nodes,
      event_listeners_n: dom.jsEventListeners,
      main_rss_mb: round(proc.filter((p) => p.type === "Browser").reduce((s, p) => s + p.ws, 0) / 1024),
      renderer_rss_mb: round(proc.filter((p) => p.type === "Tab").reduce((s, p) => s + p.ws, 0) / 1024),
      all_processes_mb: round(proc.reduce((s, p) => s + p.ws, 0) / 1024),
    };
  };
  Object.assign(metrics, Object.fromEntries(Object.entries(await memory()).map(([k, v]) => [`after_steps_${k}`, v])));

  // 10. Sustained run: edit, save, switch, GUI, for N seconds; memory every 30 s.
  if (soakSeconds > 0) {
    const first = await memory();
    const samples: Metrics[] = [];
    const end = Date.now() + soakSeconds * 1000;
    let nextSample = Date.now() + 30000;
    let n = 0;
    while (Date.now() < end) {
      try {
        await home();
        await open(mix[n % mix.length]);
        if (n % 4 === 0) {
          await home();
          await open("adminkey");
          await app.eval(`(() => { const i = document.querySelector(".frow input:not([type=checkbox]):not([type=number])"); i.focus(); i.select(); })()`);
          await app.type(`soak${n}`);
          await waitSaved();
        }
        if (n % 8 === 0) {
          await home();
          await open("vendingmachinesgui");
          await app.eval(`[...document.querySelectorAll(".pagetabs .ltab")].find((t) => /layout/i.test(t.textContent))?.click()`);
          await app.sleep(600);
        }
      } catch (error) {
        console.error("soak step failed:", String(error).split("\n")[0]);
        await app.eval(`document.querySelector(".rail .rtab")?.click()`).catch(() => {});
      }
      n++;
      if (Date.now() >= nextSample) {
        samples.push(await memory());
        nextSample = Date.now() + 30000;
      }
    }
    const last = await memory();
    metrics.soak_cycles_n = n;
    for (const [k, v] of Object.entries(first)) metrics[`soak_start_${k}`] = v;
    for (const [k, v] of Object.entries(last)) metrics[`soak_end_${k}`] = v;
    metrics.soak_heap_growth_mb = round(last.renderer_heap_mb - first.renderer_heap_mb, 1);
    metrics.soak_all_processes_growth_mb = round(last.all_processes_mb - first.all_processes_mb, 1);
    detail.soakSamples = samples;
  }

  if (diag) {
    const ipcAll = await app.mainEval<Record<string, { n: number; ms: number; bytes: number }>>(`JSON.parse(JSON.stringify(globalThis.__ipc))`);
    detail.ipcTotal = Object.entries(ipcAll).map(([ch, e]) => ({ ch, n: e.n, ms: round(e.ms), kb: round(e.bytes / 1024) })).sort((a, b) => b.ms - a.ms).slice(0, 20);
    detail.react = await app.eval(`JSON.parse(JSON.stringify(window.__react))`);
  }
  await app.close();

  // 11. Validation alone, in Node, on the same copy (no Electron): load, then 5 validations.
  const probe = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(REPO, "tools", "ui-test", "perf-q277-validate.ts"), dir], { cwd: REPO, encoding: "utf8" });
  try {
    const v = JSON.parse(probe.stdout) as { loadMs: number; validateMs: number[] };
    metrics.node_load_project_ms = v.loadMs;
    metrics.node_validate_median_ms = median(v.validateMs);
  } catch {
    console.error("validate probe failed:", probe.stderr.slice(0, 300));
  }

  const result: Result = { label, at: new Date().toISOString(), project: SOURCE, metrics };
  writeFileSync(join(OUT, `${diag ? "diag" : "perf"}-${label}.json`), JSON.stringify(diag ? { ...result, diag: detail } : { ...result, ...(Object.keys(detail).length ? { diag: detail } : {}) }, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "compare") compare(rest);
else if (command === "run") {
  const label = rest.find((a) => !a.startsWith("--")) ?? "run";
  const flags = new Set(rest.filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")[0]));
  const value = (name: string, fallback: number) => Number(rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
  await run(label, flags, flags.has("soak") ? value("soak", 600) : 0, value("cold", 3));
} else console.error("usage: perf-suite.ts run <label> [--cold=3] [--diag] [--soak=600] | compare <a> <b> ...");
