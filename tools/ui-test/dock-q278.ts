/**
 * Q278: the shared dock layout of the GUI editor and the texture editor, in the hidden window: top bar, tool rail,
 * canvas, collapsible inspector (38 px strip), status strip; the GUI stage fits instead of scrolling. For en/tr,
 * dark/light at 1280x720 and at text size 150 % (an 853x480 CSS viewport) it checks that nothing overflows, that
 * the stage and the texture fit their area, that the inspector collapses by itself on the narrow viewport and opens
 * from its strip, and writes screenshots to design/278/after/ and the measured canvas sizes to metrics.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addElement } from "./fixtures.ts";
import { assert, exampleProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/278/after");
const project = exampleProject();
const components = [
  { kind: "label", x: 8, y: 6, width: 100, height: 10, text: "Ruby machine" },
  { kind: "button", x: 100, y: 20, width: 60, height: 20, text: "Craft" },
  { kind: "slot", x: 20, y: 30, id: 0 }, { kind: "slot", x: 44, y: 30, id: 1 },
  { kind: "checkbox", x: 8, y: 60, width: 80, height: 12, text: "Auto" },
];
addElement(project, "gui", "machine", { type: 1, width: 176, height: 166, components });
const metrics: Record<string, unknown> = {};

async function view(app: App, scale: number) {
  await app.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${scale})`);
  await app.sleep(700);
}

/** What overflows: the page, the top bar's children, the inspector body, the status strip; the canvas area must not scroll. */
const CHECK = `(() => {
  const bad = [];
  const root = document.documentElement;
  if (root.scrollWidth > innerWidth + 1) bad.push("page scrolls horizontally " + root.scrollWidth + ">" + innerWidth);
  const inside = (name, sel) => { const box = document.querySelector(sel); if (!box) return bad.push("missing " + name);
    const b = box.getBoundingClientRect();
    for (const c of box.querySelectorAll("button, input, select, .dk-zoom, .dk-id")) { if (!c.offsetParent) continue; const r = c.getBoundingClientRect();
      if (r.width && (r.right > b.right + 1 || r.left < b.left - 1)) { bad.push(name + " child outside: " + (c.title || c.className || c.tagName) + " " + Math.round(r.right) + ">" + Math.round(b.right)); break; } } };
  inside("top bar", ".dk-bar");
  inside("status", ".dk-status");
  const body = document.querySelector(".dk-insp-body");
  if (body && body.scrollWidth > body.clientWidth + 1) bad.push("inspector scrolls horizontally " + body.scrollWidth + ">" + body.clientWidth);
  const area = document.querySelector(".guiarea, .paintarea");
  if (area && (area.scrollWidth > area.clientWidth + 1 || area.scrollHeight > area.clientHeight + 1)) bad.push("canvas area scrolls " + area.scrollWidth + "x" + area.scrollHeight + " in " + area.clientWidth + "x" + area.clientHeight);
  const a = area ? area.getBoundingClientRect() : null;
  const stage = document.querySelector(".guistage, .paintframe");
  const s = stage ? stage.getBoundingClientRect() : null;
  return { bad, vw: innerWidth, vh: innerHeight, area: a && { w: Math.round(a.width), h: Math.round(a.height) }, stage: s && { w: Math.round(s.width), h: Math.round(s.height) },
    inspector: !!document.querySelector(".dk-insp"), strip: !!document.querySelector(".dk-strip"),
    barH: Math.round(document.querySelector(".dk-bar").getBoundingClientRect().height), statusH: Math.round(document.querySelector(".dk-status").getBoundingClientRect().height) };
})()`;
type Result = { bad: string[]; vw: number; vh: number; area: { w: number; h: number }; stage: { w: number; h: number }; inspector: boolean; strip: boolean; barH: number; statusH: number };

const BACK = `(() => { const b = [...document.querySelectorAll(".dk-bar .abtn")].find((x) => /Back|Geri|dön/.test(x.textContent)); b?.click(); })()`;

async function pass(lang: "en" | "tr", theme: "dark" | "light") {
  const app = await launchApp({ project, language: lang, theme, width: 1280, height: 720 });
  try {
    for (const scale of [1, 1.5]) {
      const tag = `${lang}-${theme}-${scale === 1 ? "100" : "150"}`;
      await view(app, scale);
      // GUI editor.
      await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
      await app.eval(`(() => { const f = [...document.querySelectorAll(".foldertile")].find((e) => /gui/i.test(e.textContent)); f?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
      await app.sleep(400);
      await app.eval(`(() => { const t = [...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => /machine/i.test(e.textContent)); t?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
      await app.waitFor(`document.querySelector(".guistage")`, 20000);
      await app.sleep(700);
      let r = await app.eval<Result>(CHECK);
      await app.shot(`${OUT}/gui-${tag}.png`);
      assert(r.bad.length === 0, `GUI ${tag}: ${r.bad.join("; ")}`);
      assert(r.barH <= 42 && r.statusH <= 26, `GUI ${tag}: one-row bar and status strip (${r.barH}, ${r.statusH})`);
      assert(r.stage.w <= r.area.w && r.stage.h <= r.area.h, `GUI ${tag}: the stage fits its area ${JSON.stringify(r)}`);
      assert(scale === 1 ? r.inspector : r.strip && !r.inspector, `GUI ${tag}: the inspector is ${scale === 1 ? "open" : "collapsed"} by itself`);
      metrics[`gui-${tag}`] = r;
      if (scale === 1.5) {
        // A strip button opens the inspector with that section; the toggle closes it again, the canvas follows.
        const before = r.area;
        await app.click(".dkstripbtn[title=Layers], .dkstripbtn[title=Katmanlar]");
        await app.waitFor(`document.querySelector(".dk-insp")`);
        await app.sleep(500);
        const open = await app.eval<Result>(CHECK);
        assert(open.area.w < before.w, `GUI ${tag}: opening the inspector gives the canvas area less room (${before.w} -> ${open.area.w})`);
        assert(await app.eval<boolean>(`document.querySelector('.dk-sec[data-section="gui.layers"]')?.classList.contains("open")`), "the Layers section is open");
        await app.shot(`${OUT}/gui-${tag}-inspector-open.png`);
        assert(open.bad.length === 0, `GUI ${tag} opened: ${open.bad.join("; ")}`);
        await app.click(`.dk-bar .abtn[title^="Hide"], .dk-bar .abtn[title^="Denet"]`);
        await app.waitFor(`document.querySelector(".dk-strip")`);
      }
      // Texture editor.
      await app.eval(BACK);
      await app.click(".rtab", lang === "en" ? "Resources" : "Kaynak");
      await app.waitFor(`document.querySelector(".texcell")`, 30000);
      await app.sleep(1200);
      await app.eval(`(() => { const c = document.querySelector(".texcell[data-path]"); c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
      await app.waitFor(`document.querySelector(".paintcanvas")`, 20000);
      await app.sleep(700);
      r = await app.eval<Result>(CHECK);
      await app.shot(`${OUT}/texture-${tag}.png`);
      assert(r.bad.length === 0, `texture ${tag}: ${r.bad.join("; ")}`);
      assert(r.barH <= 42, `texture ${tag}: one-row bar (${r.barH})`);
      assert(r.stage.w <= r.area.w && r.stage.h <= r.area.h, `texture ${tag}: the texture fits its area ${JSON.stringify(r)}`);
      metrics[`texture-${tag}`] = r;
      // Back to the element grid for the next size.
      await app.eval(BACK);
      await app.sleep(300);
      await app.click(".rtab", lang === "en" ? "Mod elements" : "Mod öğeleri");
      await app.waitFor(`document.querySelector(".tile")`);
    }
  } finally {
    await app.close();
  }
}

mkdirSync(join(REPO, OUT), { recursive: true });
try {
  for (const [lang, theme] of [["en", "dark"], ["en", "light"], ["tr", "dark"], ["tr", "light"]] as const) await pass(lang, theme);
  writeFileSync(join(REPO, OUT, "metrics.json"), JSON.stringify(metrics, null, 1));
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error);
  writeFileSync(join(REPO, OUT, "metrics.json"), JSON.stringify(metrics, null, 1));
  process.exitCode = 1;
}
