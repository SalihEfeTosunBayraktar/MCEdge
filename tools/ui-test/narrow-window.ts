/**
 * KUYRUK 224: narrow windows. At 720, 900 and 1280 px in en and tr every menu is one line and no title-bar item
 * overlaps another or the window-controls area (whose width is the --window-controls CSS variable, the same value the
 * fallback padding of the title bar uses; CDP cannot show the real overlay, so the test applies that padding itself); the find bar, the toolbars, the bottom panel tabs, the
 * Agents panel and Preferences show no clipped label and no overlapping sibling. Screenshots in design/224/.
 */
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, copyProject, launchApp, type App } from "./cdp.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const shots: Record<string, "dark" | "light"> = { "720-tr": "dark", "900-en": "dark", "720-en": "light" };
let failed = false;

/** Containers whose labels and children are checked; whichever are on screen at the time. */
const CONTAINERS = [".findbar", ".actions", ".panel-tabs", ".rtabs", ".edtabs", ".langtabs", ".agentsview", ".timeline", ".tlbody", ".agtree", ".tlnotes", ".problems", ".prefsdialog", ".edhead"];

/** Clipped text (scrollWidth > clientWidth without an intended ellipsis) and overlapping or escaping children. */
const fit = (app: App, view: string) => app.eval<string[]>(`(() => {
  const out = [];
  const name = (e) => (e.className && e.className.baseVal === undefined ? e.className : "") + "|" + (e.textContent || "").trim().slice(0, 24);
  const box = (e) => e.getBoundingClientRect();
  for (const sel of ${JSON.stringify(CONTAINERS)}) for (const c of document.querySelectorAll(sel)) {
    const cb = box(c);
    if (!cb.width || !cb.height) continue;
    const kids = [...c.children].filter((k) => k.getClientRects().length && getComputedStyle(k).position !== "absolute" && box(k).width > 0);
    for (let i = 0; i < kids.length; i++) {
      const a = box(kids[i]);
      if (a.right > cb.right + 1 && getComputedStyle(c).overflowX === "visible") out.push(${JSON.stringify(view)} + ": " + sel + " child " + name(kids[i]) + " runs past the right edge");
      for (let j = i + 1; j < kids.length; j++) {
        const b = box(kids[j]);
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(${JSON.stringify(view)} + ": " + sel + " " + name(kids[i]) + " overlaps " + name(kids[j]));
      }
    }
    for (const e of [c, ...c.querySelectorAll("*")]) {
      if (!e.getClientRects().length || e.clientWidth === 0 || e.closest("svg, canvas, textarea")) continue;
      const s = getComputedStyle(e);
      if (s.overflowX !== "visible" && s.overflowX !== "hidden" && s.overflowX !== "clip") continue;
      if (e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== "ellipsis" && (e.textContent || "").trim()) out.push(${JSON.stringify(view)} + ": " + sel + " clipped " + name(e) + " (" + e.scrollWidth + ">" + e.clientWidth + ")");
    }
  }
  return [...new Set(out)];
})()`);

const section = async (app: App, rail: string) => { await app.click(".rail button", rail); await app.sleep(500); };

for (const language of ["en", "tr"]) {
  const strings = (language === "tr" ? tr : en) as Record<string, string>;
  for (const width of [720, 900, 1280]) {
    const app = await launchApp({ project, language, width, height: 800, theme: shots[`${width}-${language}`] ?? "dark" });
    try {
      const key = `${width}-${language}`;
      const theme = shots[key] ?? "dark";
      await app.waitFor(`document.querySelector(".menubar .wsname")`, 30000);
      // CDP resizes the viewport only, so env(titlebar-area-*) still describes the full-size real window; reserve the
      // window buttons the way the stylesheet does when the overlay is not reported (the --window-controls width).
      await app.eval(`(() => { const s = document.createElement("style"); s.textContent = ".menubar { padding-right: calc(var(--window-controls) + 8px) !important; }"; document.head.append(s); })()`);
      const r = await app.eval<{ wrapped: string[]; boxes: { n: string; l: number; r: number }[]; controls: number; scroll: boolean }>(`(() => {
        const bar = document.querySelector(".menubar");
        const wrapped = [...bar.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().height > 34 || m.getClientRects().length !== 1 || m.scrollHeight > m.clientHeight + 1).map((m) => m.textContent);
        const sel = [".brand", ".menus", ".wsname", ".wsname .tbtns", ".enginebtn", ".themebtn"];
        const boxes = sel.map((s) => document.querySelector(s)).filter(Boolean).filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return { n: e.className, l: b.left, r: b.right }; });
        const reserved = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--window-controls"));
        return { wrapped, boxes, controls: window.innerWidth - reserved, scroll: bar.scrollWidth > bar.clientWidth + 1 };
      })()`);
      assert(r.wrapped.length === 0, `${key}: menu items wrap: ${r.wrapped}`);
      assert(!r.scroll, `${key}: menu bar content overflows`);
      assert(r.controls < width, `${key}: --window-controls is not set (${r.controls})`);
      const sorted = [...r.boxes].sort((a, b) => a.l - b.l);
      for (let i = 1; i < sorted.length; i++) assert(sorted[i].l >= sorted[i - 1].r - 0.5 || sorted[i].r <= sorted[i - 1].r, `${key}: ${sorted[i - 1].n} overlaps ${sorted[i].n}`);
      for (const b of r.boxes) assert(b.r <= r.controls + 0.5, `${key}: ${b.n} (right ${b.r}) runs under the window controls (${r.controls})`);
      if (shots[key]) await app.shot(`design/224/${key}-${shots[key]}.png`);

      // Views: elements, Resources, the procedure and GUI editors, the bottom panels, Preferences.
      const problems: string[] = [];
      const look = async (view: string) => { problems.push(...(await fit(app, `${key} ${view}`))); await app.shot(`design/224/fit-${key}-${view.replace(/\W+/g, "-")}-${theme}.png`).catch(() => {}); };
      await app.waitFor(`document.querySelector(".tile")`, 30000);
      await look("elements");
      await app.eval(`document.querySelector(".sitem.agent")?.click()`);
      await app.waitFor(`document.querySelector(".agentsview")`, 10000).catch(() => {});
      await look("agents");
      await app.eval(`document.querySelectorAll(".ptab")[0]?.click()`);
      await app.sleep(300);
      await look("problems");
      const rail = (n: number) => app.eval(`document.querySelectorAll(".rail .rtab")[${n}].click()`);
      await rail(1);
      await app.sleep(1200);
      await look("resources");
      await rail(0);
      await app.waitFor(`document.querySelector(".tile")`, 10000);
      await app.click(".menu", strings["menu.window"]);
      await app.click(".menulist button", strings["menu.preferences"]);
      await app.waitFor(`document.querySelector(".prefsdialog")`, 10000);
      await look("preferences");
      await app.key("Escape");
      await app.sleep(300);
      await app.click(".tile", "Guis", { double: true });
      await app.sleep(500);
      await app.click(".tile", "adminpanelgui", { double: true });
      await app.waitFor(`document.querySelector(".guistage")`, 30000);
      await app.sleep(500);
      await look("gui-editor");
      await rail(0);
      await app.sleep(500);
      await app.click(".linkbtn", "etreco");
      await app.click(".tile", "Procedures", { double: true });
      await app.sleep(500);
      for (let depth = 0; depth < 4 && !(await app.eval<boolean>(`!!document.querySelector(".tile:not(.foldertile)")`)); depth++) {
        await app.eval(`[...document.querySelectorAll(".tile.foldertile")].find((t) => t.textContent.trim() !== ${JSON.stringify(strings["folders.up"])})?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
        await app.sleep(500);
      }
      await app.eval(`document.querySelector(".tile:not(.foldertile)").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
      await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`, 60000);
      await app.sleep(800);
      await look("procedure-editor");
      if (problems.length) console.log(problems.join("\n"));
      assert(problems.length === 0, `${key}: ${problems.length} fit problems`);
      console.log(`ok ${key}`);
    } catch (e) {
      console.error("FAIL", e);
      await app.shot("tools/ui-test/last-failure.png").catch(() => {});
      failed = true;
    } finally {
      await app.close();
    }
  }
}
if (failed) process.exitCode = 1; else console.log("PASS");
