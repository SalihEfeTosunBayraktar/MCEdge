/**
 * Q278 audit: hidden screenshots of the GUI editor and the texture editor on a copy of ETREconomy-MCEdge at
 * 1280x720 and 1440x900, en/tr, dark/light, text size 100 % and 150 %. Measurement only; output in design/278/shots.
 *   node tools/ui-test/audit-q278.ts [--quick]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { copyProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = process.env.AUDIT_OUT ?? evidence("design/278/shots");
const ETR = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";
const quick = process.argv.includes("--quick");
const project = process.env.ETRC ?? copyProject(ETR, "etr");
const metrics: Record<string, unknown> = {};

const MEASURE = `(() => {
  const box = (s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vw = innerWidth, vh = innerHeight;
  const canvas = box(".guiarea") ?? box(".paintarea");
  const tools = [...document.querySelectorAll(".actions, .findbar, .ptools, .panel, .statusbar, .rail, .tabs")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className.toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  const bars = [...document.querySelectorAll(".actions")].map((e) => ({ rows: new Set([...e.children].map((c) => Math.round(c.getBoundingClientRect().top))).size, h: Math.round(e.getBoundingClientRect().height), buttons: e.querySelectorAll("button").length }));
  const panelEl = document.querySelector(".procpanel, .sidepanel, .paintsplit > .panel, .paintsplit > aside");
  return { vw, vh, canvas, canvasShare: canvas ? Math.round(canvas.w * canvas.h / (vw * vh) * 100) : null, tools, bars,
    panel: panelEl ? { w: Math.round(panelEl.getBoundingClientRect().width), scrollH: panelEl.scrollHeight, clientH: panelEl.clientHeight } : null,
    hscroll: document.documentElement.scrollWidth > innerWidth, bodyOverflow: [...document.querySelectorAll("*")].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).length,
    btnHeights: [...new Set([...document.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => Math.round(b.getBoundingClientRect().height)))].sort((a, b) => a - b),
    guiScroll: (() => { const e = document.querySelector(".guiarea, .paintarea"); return e ? { sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight } : null; })() };
})()`;

async function view(app: App, w: number, h: number, scale: number) {
  await app.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await app.mainEval(`require("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${scale})`).catch(async () => {
    await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${scale})`);
  });
  await app.sleep(500);
}

async function pass(lang: "en" | "tr", theme: "dark" | "light") {
  const app = await launchApp({ project, language: lang, theme, width: 1440, height: 900 });
  try {
    const combos: [number, number, number][] = quick ? [[1280, 720, 1]] : [[1280, 720, 1], [1280, 720, 1.5], [1440, 900, 1], [1440, 900, 1.5]];
    // GUI editor: the biggest GUI of the project.
    await view(app, 1440, 900, 1);
    await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    await app.eval(`(() => { const f = [...document.querySelectorAll(".foldertile")].find((e) => /guis/i.test(e.textContent)); f?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return !!f; })()`);
    await app.sleep(600);
    await app.eval(`(() => { const t = [...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => /vendingmachinesgui|vending/i.test(e.textContent)) ?? document.querySelector(".tile:not(.foldertile)"); t?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return !!t; })()`);
    await app.waitFor(`document.querySelector(".guistage")`, 20000);
    await app.sleep(800);
    for (const [w, h, s] of combos) {
      await view(app, w, h, s);
      const tag = `gui-${w}x${h}-${s === 1 ? "100" : "150"}-${lang}-${theme}`;
      await app.shot(`${OUT}/${tag}.png`);
      metrics[tag] = await app.eval(MEASURE);
    }
    await view(app, 1440, 900, 1);
    // Select a widget so the properties show.
    await app.click(".lrow").catch(() => {});
    await app.sleep(300);
    for (const [w, h, s] of combos) {
      await view(app, w, h, s);
      const tag = `gui-sel-${w}x${h}-${s === 1 ? "100" : "150"}-${lang}-${theme}`;
      await app.shot(`${OUT}/${tag}.png`);
      metrics[tag] = await app.eval(MEASURE);
    }
    await view(app, 1440, 900, 1);
    // Texture editor: leave the element, open Resources, edit a GUI texture.
    await app.key("Escape").catch(() => {});
    await app.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /Back|Geri/.test(x.textContent)); b?.click(); })()`);
    await app.click(".rtab", "Resources").catch(() => app.click(".rtab", "Kaynak"));
    await app.waitFor(`document.querySelector(".texcell")`, 30000);
    await app.sleep(1500);
    const path = await app.eval<string>(`(() => { const cells = [...document.querySelectorAll(".texcell[data-path]")]; const c = cells.find((x) => x.dataset.path.includes("gui")) ?? cells[0]; c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return c.dataset.path; })()`);
    await app.waitFor(`document.querySelector(".paintcanvas")`, 20000);
    await app.sleep(600);
    metrics[`texture-path-${lang}-${theme}`] = path;
    for (const [w, h, s] of combos) {
      await view(app, w, h, s);
      const tag = `texture-${w}x${h}-${s === 1 ? "100" : "150"}-${lang}-${theme}`;
      await app.shot(`${OUT}/${tag}.png`);
      metrics[tag] = await app.eval(MEASURE);
    }
  } finally {
    await app.close();
  }
}

mkdirSync(`${REPO}/${OUT}`, { recursive: true });
for (const [lang, theme] of quick ? [["en", "dark"]] as const : [["en", "dark"], ["en", "light"], ["tr", "dark"], ["tr", "light"]] as const) {
  try { await pass(lang, theme); } catch (e) { console.error("pass failed", lang, theme, String(e).split("\n").slice(0, 3).join(" | ")); }
  writeFileSync(`${REPO}/${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
}
