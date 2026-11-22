/**
 * KUYRUK 185: performance of the Blockly procedure editor on real ETREconomy procedures (a copy). For each procedure
 * it times opening, scrolling, zooming, dragging a block and the whole start stack, typing in a text field, changing a
 * dropdown, opening toolbox categories, the block search and undo. Each action reports its wall time, the longest gap
 * between animation frames, the long tasks (> 50 ms) of the main thread, and the functions that dominate a CPU profile
 * taken during it.
 *
 *   npm run build:app
 *   node tools/ui-test/procedure-perf.ts [procedureId ...] [--json out.json] [--profiles dir] [--plain]
 *
 * --plain skips the CPU profile and the trace (they slow the page down) and only measures frames, long tasks and the
 * main-thread totals. PERF_VERBOSE=1 prints the hottest functions, PERF_ONLY="drag block,undo" measures only these
 * actions, PERF_TRACE_TOP / PERF_TRACE_CATEGORIES / PERF_TRACE_DUMP=file tune or save the trace.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyProject, launchApp, type App } from "./cdp.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const jsonOut = flag("--json");
const profileDir = flag("--profiles");
const plain = args.includes("--plain") && !!args.splice(args.indexOf("--plain"), 1);
// Without ids: the five largest procedures of the project (it changes, so none is named).
const ids = args.length ? args : null;

const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const B = `document.querySelector(".blocklyhost").blockly`;

interface Row {
  procedure: string;
  blocks: number;
  action: string;
  wallMs: number;
  maxFrameMs: number;
  slowFrames: number;
  longTasks: number;
  longTaskMs: number;
  /** Main-thread time from Performance.getMetrics: script, style recalculation, layout, and the rest (paint, GC, ...). */
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
  otherMs: number;
  /** Renderer main-thread trace events (devtools.timeline) by total duration: Paint, HitTest, UpdateLayoutTree, ... */
  trace: string[];
  top: string[];
}
const rows: Row[] = [];

/** Frame and long-task recorders in the page; read back per time window. */
async function installRecorders(app: App) {
  await app.eval(`(() => {
    if (window.__perf) return;
    const perf = window.__perf = { frames: [], long: [] };
    const tick = (t) => { perf.frames.push(t); if (perf.frames.length > 20000) perf.frames.splice(0, 10000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => { for (const e of list.getEntries()) perf.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  })()`);
}

/** Self and inclusive time per function of a CPU profile. */
function summarize(profile: any): string[] {
  const byId = new Map<number, any>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const label = (n: any) => {
    const f = n.callFrame;
    const file = String(f.url).split("/").pop() ?? "";
    return `${f.functionName || "(anon)"} ${file}:${f.lineNumber + 1}`;
  };
  const self = new Map<string, number>();
  const incl = new Map<string, number>();
  profile.samples.forEach((id: number, i: number) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    const n = byId.get(id);
    const name = n.callFrame.functionName;
    if (name === "(idle)" || name === "(program)") return;
    self.set(label(n), (self.get(label(n)) ?? 0) + dt);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const node = byId.get(cur);
      if (!node.callFrame.functionName) continue;
      const l = label(node);
      if (seen.has(l)) continue;
      seen.add(l);
      incl.set(l, (incl.get(l) ?? 0) + dt);
    }
  });
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${Math.round(v)}ms ${k}`);
  return [...top(self, 6).map((s) => `self ${s}`), ...top(incl, 14).map((s) => `incl ${s}`)];
}

const metrics = async (app: App) => {
  const { metrics } = await app.cdp("Performance.getMetrics");
  const get = (name: string) => (metrics.find((m: { name: string }) => m.name === name)?.value ?? 0) * 1000;
  return { task: get("TaskDuration"), script: get("ScriptDuration"), style: get("RecalcStyleDuration"), layout: get("LayoutDuration") };
};

/** Starts a devtools.timeline trace of the page; the returned stop() gives the main-thread time per event name. */
async function startTrace(app: App) {
  const events: any[] = [];
  const offData = app.onCdp("Tracing.dataCollected", (p) => events.push(...p.value));
  await app.cdp("Tracing.start", { categories: process.env.PERF_TRACE_CATEGORIES ?? "devtools.timeline", transferMode: "ReportEvents" });
  return async (): Promise<string[]> => {
    const done = new Promise<void>((resolve) => {
      const off = app.onCdp("Tracing.tracingComplete", () => (off(), resolve()));
    });
    await app.cdp("Tracing.end");
    await done;
    offData();
    if (process.env.PERF_TRACE_DUMP) writeFileSync(process.env.PERF_TRACE_DUMP, JSON.stringify({ traceEvents: events }));
    const main = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
    const total = new Map<string, number>();
    for (const e of events) {
      if (e.ph !== "X" || !main.has(`${e.pid}:${e.tid}`) || /^(RunTask|ThreadControllerImpl::RunTask|RunMicrotasks)$/.test(e.name)) continue;
      total.set(e.name, (total.get(e.name) ?? 0) + (e.dur ?? 0) / 1000);
    }
    return [...total].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.PERF_TRACE_TOP ?? 8)).map(([k, v]) => `${k} ${Math.round(v)}ms`);
  };
}

async function measure(app: App, procedure: string, blocks: number, action: string, body: () => Promise<void>, settleMs = 1500) {
  await app.cdp("Performance.enable", { timeDomain: "timeTicks" });
  // The CPU profile and the trace slow the page down; --plain measures frames and long tasks without them.
  if (!plain) {
    await app.cdp("Profiler.enable");
    await app.cdp("Profiler.setSamplingInterval", { interval: 250 });
    await app.cdp("Profiler.start");
  }
  const t0 = await app.eval<number>("performance.now()");
  const before = await metrics(app);
  const stopTrace = plain ? async () => [] : await startTrace(app);
  const started = Date.now();
  try {
    await body();
  } catch (error) {
    console.log(`      (${action} failed: ${String(error).split("\n")[0].slice(0, 160)})`);
    await app.key("Escape").catch(() => {});
  }
  const wallMs = Date.now() - started;
  await app.sleep(settleMs);
  const t1 = await app.eval<number>("performance.now()");
  const after = await metrics(app);
  const trace = await stopTrace();
  const spent = { scriptMs: Math.round(after.script - before.script), styleMs: Math.round(after.style - before.style), layoutMs: Math.round(after.layout - before.layout) };
  const otherMs = Math.max(0, Math.round(after.task - before.task) - spent.scriptMs - spent.styleMs - spent.layoutMs);
  const { profile } = plain ? { profile: undefined } : await app.cdp("Profiler.stop");
  if (profileDir && profile) {
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, `${procedure}-${action.replace(/\W+/g, "_")}.cpuprofile`), JSON.stringify(profile));
  }
  const m = await app.eval<{ maxFrameMs: number; slowFrames: number; longTasks: number; longTaskMs: number }>(`(() => {
    const p = window.__perf;
    const f = p.frames.filter((t) => t >= ${t0} && t <= ${t1});
    let max = 0, slow = 0;
    for (let i = 1; i < f.length; i++) { const d = f[i] - f[i - 1]; max = Math.max(max, d); if (d > 50) slow++; }
    // A frame still pending at the end (the main thread is busy) counts from the last frame.
    if (f.length) max = Math.max(max, ${t1} - f[f.length - 1]);
    const l = p.long.filter(([s]) => s >= ${t0} && s <= ${t1});
    return { maxFrameMs: Math.round(max), slowFrames: slow, longTasks: l.length, longTaskMs: Math.round(l.reduce((a, [, d]) => a + d, 0)) };
  })()`);
  // Culled blocks (procedures/cull.ts) must never be on screen once the view settled.
  const culledInView = await app.eval<number>(`(() => {
    const host = document.querySelector(".blocklyhost .blocklySvg");
    if (!host) return 0;
    const v = host.getBoundingClientRect();
    return [...document.querySelectorAll(".blocklyhost g.blocklyCulled")].filter((g) => {
      const r = g.querySelector(":scope > .blocklyPath")?.getBoundingClientRect();
      return r && r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom && !(r.width === 0 && r.height === 0);
    }).length;
  })()`);
  if (culledInView) console.log(`      CULLED IN VIEW: ${culledInView} blocks`);
  const row: Row = { procedure, blocks, action, wallMs, ...m, ...spent, otherMs, trace, top: profile ? summarize(profile) : [] };
  rows.push(row);
  console.log(`${procedure.padEnd(28)} ${String(blocks).padStart(5)}  ${action.padEnd(16)} wall ${String(wallMs).padStart(6)}ms  maxFrame ${String(m.maxFrameMs).padStart(6)}ms  slowFrames ${String(m.slowFrames).padStart(3)}  longTasks ${String(m.longTasks).padStart(3)} / ${String(m.longTaskMs).padStart(5)}ms  script ${String(spent.scriptMs).padStart(5)} style ${String(spent.styleMs).padStart(4)} layout ${String(spent.layoutMs).padStart(4)} other ${String(otherMs).padStart(5)}`);
  if (trace.length) console.log(`      trace: ${trace.join(", ")}`);
  if (process.env.PERF_VERBOSE) for (const line of row.top) console.log(`      ${line}`);
}

/** Paced mouse drag: one move per ~16 ms, like a real pointer. */
async function paceDrag(app: App, from: [number, number], to: [number, number], steps = 20) {
  await app.mouse("mouseMoved", from[0], from[1], 0);
  await app.mouse("mousePressed", from[0], from[1]);
  for (let i = 1; i <= steps; i++) {
    await app.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, 1);
    await app.sleep(16);
  }
  await app.mouse("mouseReleased", to[0], to[1], 0);
}

/** Centre of a block's field or of its top-left corner, after scrolling it into view (not measured). */
async function pointOf(app: App, find: string, field?: string): Promise<[number, number] | null> {
  const id = await app.eval<string | null>(`(() => { const b = (${find})(${WS}); return b ? b.id : null; })()`);
  if (!id) return null;
  await app.eval(`${WS}.centerOnBlock(${JSON.stringify(id)})`);
  await app.sleep(400);
  return app.eval<[number, number]>(`(() => {
    const b = ${WS}.getBlockById(${JSON.stringify(id)});
    const el = ${field ? `b.getField(${JSON.stringify(field)}).getSvgRoot()` : "b.getSvgRoot()"};
    const r = el.getBoundingClientRect();
    return ${field ? "[r.x + r.width / 2, r.y + r.height / 2]" : "[r.x + 6, r.y + 8]"};
  })()`);
}

/** An empty spot of the canvas, to drag the view. */
const emptySpot = (app: App) => app.eval<[number, number] | null>(`(() => {
  const r = document.querySelector(".blocklyhost .blocklySvg").getBoundingClientRect();
  for (let y = r.y + 40; y < r.bottom - 40; y += 20) for (let x = r.x + r.width * 0.5; x < r.right - 40; x += 20) {
    const e = document.elementFromPoint(x, y);
    if (e && e.classList.contains("blocklyMainBackground")) return [x, y];
  }
  return null;
})()`);

async function openProcedure(app: App, id: string): Promise<number> {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelector(".tile")`, 30000);
  await app.eval(`(() => { const i = document.querySelector(".view input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(id)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.trim() === ${JSON.stringify(id)}) || document.querySelectorAll(".tile").length === 1`, 8000);
  await app.eval(`document.getElementById("perf-target")?.removeAttribute("id"); ([...document.querySelectorAll(".tile")].find((t) => t.textContent.trim() === ${JSON.stringify(id)}) ?? document.querySelector(".tile")).setAttribute("id", "perf-target")`);
  let blocks = 0;
  await measure(app, id, 0, "open", async () => {
    await app.click("#perf-target", undefined, { double: true });
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`, 120000);
    // The first frame after the load paints the canvas.
    await app.eval("new Promise((r) => requestAnimationFrame(() => setTimeout(r)))");
  }, 2000);
  blocks = Number(await app.eval<string>(`document.querySelector(".blocklyhost").dataset.blocks`));
  rows.at(-1)!.blocks = blocks;
  const loadMs = await app.eval<string>(`document.querySelector(".blocklyhost").dataset.loadMs`);
  console.log(`      (Blockly load ${loadMs}ms, ${blocks} blocks)`);
  return blocks;
}

async function exercise(app: App, id: string) {
  const blocks = await openProcedure(app, id);
  // PERF_ONLY="drag block,undo" runs the setup of every step but measures only these actions.
  const only = process.env.PERF_ONLY?.split(",");
  const m = (action: string, body: () => Promise<void>, settle?: number) => (only && !only.includes(action) ? body() : measure(app, id, blocks, action, body, settle));
  // Start from the top of the program.
  await app.eval(`(() => { const s = ${WS}.getTopBlocks(false).find((b) => b.type === "start"); if (s) ${WS}.centerOnBlock(s.id); })()`);
  await app.sleep(500);

  const spot = await emptySpot(app);
  if (spot) {
    await m("scroll (drag)", async () => {
      await paceDrag(app, spot, [spot[0] - 200, spot[1] - 300], 30);
      await paceDrag(app, [spot[0] - 200, spot[1] - 300], spot, 30);
    }, 800);
  }
  const [cx, cy] = await app.center(".blocklyhost .blocklySvg");
  await m("zoom (wheel x8)", async () => {
    for (let i = 0; i < 4; i++) await app.wheel(cx, cy, 120);
    for (let i = 0; i < 4; i++) await app.wheel(cx, cy, -120);
  }, 800);

  // A leaf statement block somewhere in the middle of the program: drag it out (detaches), then undo puts it back.
  const leaf = `(ws) => { const all = ws.getAllBlocks(true).filter((b) => !b.isShadow() && b.previousConnection && b.getParent() && !b.getNextBlock() && b.getDescendants(false).length <= 4);
    return all[Math.floor(all.length / 2)]; }`;
  const p = await pointOf(app, leaf);
  if (!p) console.log("      (no leaf block to drag)");
  if (p) {
    await m("drag block", () => paceDrag(app, p, [p[0] + 160, p[1] + 90], 24));
    await m("undo", async () => {
      await app.click("button.abtn", "Undo");
    });
  }

  const startPoint = await pointOf(app, `(ws) => ws.getTopBlocks(false).find((b) => b.type === "start")`);
  if (startPoint) {
    await m("drag start stack", () => paceDrag(app, startPoint, [startPoint[0] + 120, startPoint[1] + 60], 24));
    await app.click("button.abtn", "Undo");
    await app.sleep(1500);
  }

  const textBlock = `(ws) => { const all = ws.getAllBlocks(true).filter((b) => b.type === "text" && b.getField("value")); return all[Math.floor(all.length / 2)]; }`;
  const tp = await pointOf(app, textBlock, "value");
  if (tp) {
    await m("type 10 chars", async () => {
      await app.mouse("mouseMoved", tp[0], tp[1], 0);
      await app.mouse("mousePressed", tp[0], tp[1]);
      await app.mouse("mouseReleased", tp[0], tp[1], 0);
      await app.waitFor(`document.querySelector(".blocklyHtmlInput")`, 4000);
      for (const ch of "perf_check") {
        await app.type(ch);
        await app.sleep(40);
      }
      await app.key("Enter");
    });
    await app.key("Escape");
    await app.sleep(300);
  }

  // An operator dropdown (compare, arithmetic) when there is one: every program has them and they always open.
  const isDrop = `(f) => f instanceof ${B}.FieldDropdown && f.constructor.name !== "FieldChoice" && f.getOptions().length > 1`;
  const dropBlock = `(ws) => { const all = ws.getAllBlocks(true).filter((b) => !b.isShadow() && b.inputList.some((i) => i.fieldRow.some(${isDrop})));
    const ops = all.filter((b) => b.getField("op") && (${isDrop})(b.getField("op")));
    const list = ops.length ? ops : all;
    return list[Math.floor(list.length / 2)]; }`;
  const dropField = await app.eval<string | null>(`(() => { const b = (${dropBlock})(${WS}); if (!b) return null; if (b.getField("op") && (${isDrop})(b.getField("op"))) return "op"; for (const i of b.inputList) for (const f of i.fieldRow) if ((${isDrop})(f)) return f.name; return null; })()`);
  const dp = dropField ? await pointOf(app, dropBlock, dropField) : null;
  if (dp) {
    await m("dropdown change", async () => {
      await app.mouse("mouseMoved", dp[0], dp[1], 0);
      await app.mouse("mousePressed", dp[0], dp[1]);
      await app.mouse("mouseReleased", dp[0], dp[1], 0);
      await app.waitFor(`document.querySelector(".blocklyDropDownDiv .blocklyMenuItem")`, 4000);
      await app.eval(`(() => { const items = [...document.querySelectorAll(".blocklyDropDownDiv .blocklyMenuItem")]; const pick = items.find((i) => !i.classList.contains("blocklyMenuItemSelected")) ?? items[0]; pick.scrollIntoView({ block: "nearest" }); })()`);
      const [x, y] = await app.center(".blocklyDropDownDiv .blocklyMenuItem:not(.blocklyMenuItemSelected)");
      await app.mouse("mouseMoved", x, y, 0);
      await app.mouse("mousePressed", x, y);
      await app.mouse("mouseReleased", x, y, 0);
    });
  }

  await m("toolbox x4", async () => {
    const names = await app.eval<string[]>(`[...document.querySelectorAll(".blocklyToolboxCategoryLabel")].map((e) => e.textContent).filter(Boolean).slice(2, 6)`);
    for (const n of names) {
      await app.click(".blocklyToolboxCategoryLabel", n);
      await app.sleep(250);
    }
    await app.key("Escape");
  }, 800);

  await m("search 'player'", async () => {
    await app.eval(`document.querySelector(".procsearch input").focus()`);
    let text = "";
    for (const ch of "player") {
      text += ch;
      await app.setValue(".procsearch input", text);
      await app.sleep(60);
    }
    await app.setValue(".procsearch input", "");
  }, 800);

  await app.click("button.abtn", "Back").catch(() => app.key("Escape"));
  await app.sleep(800);
}

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const app = await launchApp({ project });
try {
  await installRecorders(app);
  // A small procedure first, so the first measured open does not pay for loading the Blockly code.
  await openProcedure(app, "goldsellerleftclick");
  rows.pop();
  await app.click("button.abtn", "Back").catch(() => app.key("Escape"));
  await app.sleep(800);
  const procDir = join(project, "elements", "procedures");
  const largest = readdirSync(procDir).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.slice(0, -5), size: statSync(join(procDir, f)).size })).sort((a, b) => b.size - a.size);
  for (const id of ids ?? largest.slice(0, 5).map((f) => f.id)) await exercise(app, id);
} catch (error) {
  console.error("FAIL", error);
  await app.shot("tools/ui-test/last-failure.png").catch(() => {});
  process.exitCode = 1;
} finally {
  await app.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
