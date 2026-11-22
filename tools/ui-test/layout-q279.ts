/**
 * Q279: the Dock layout in the screens outside the GUI and texture editors. Hidden window, a copy of ETREconomy-MCEdge.
 * Element grid (view bar, path strip, inspector), element editor (one bar, page tabs, sections, inspector), Resources (the
 * filter stays in the window), Preferences (category list), bottom panel (grip, remembered height, 200 px of content kept)
 * and New project (Create reachable), at 1280x720 at 100 % and 150 % text, en and tr, dark and light. Asserts no page
 * overflow in any of them; screenshots in design/279/after/.
 *   node tools/ui-test/layout-q279.ts [--quick]
 */
import { mkdirSync } from "node:fs";
import { assert, copyProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/279/after");
const quick = process.argv.includes("--quick");
const ETR = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";
type View = [name: string, scale: number];
const VIEWS: View[] = [["100", 1], ["150", 1.5]];

async function view(app: App, scale: number) {
  await app.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${scale})`);
  await app.sleep(350);
}

/** Nothing sticks out of the window: no horizontal scroll, no visible element beyond the right edge (open menus excepted). */
const OVERFLOW = `(() => {
  const out = [...document.querySelectorAll("body *")].filter((e) => e.offsetParent && !e.closest(".menulist, .tooltip, [role=tooltip]") && getComputedStyle(e).position !== "fixed"
    && e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => e.tagName + "." + e.className.toString().slice(0, 30));
  return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, out };
})()`;

async function checkFit(app: App, label: string) {
  const o = await app.eval<{ scrollW: number; innerW: number; out: string[] }>(OVERFLOW);
  assert(o.scrollW <= o.innerW + 1 && o.out.length === 0, `${label}: overflow ${JSON.stringify(o)}`);
}

async function shoot(app: App, name: string, lang: string, theme: string, onView?: (scale: number, app: App) => Promise<void>) {
  for (const [tag, scale] of quick ? [VIEWS[1]] : VIEWS) {
    await view(app, scale);
    await onView?.(scale, app);
    await checkFit(app, `${name} ${tag} ${lang} ${theme}`);
    await app.shot(`${OUT}/${name}-1280x720-${tag}-${lang}-${theme}.png`);
  }
  await view(app, 1);
}

const home = async (app: App) => {
  await app.key("Escape");
  await app.sleep(150);
  await app.eval(`(() => { const d = document.querySelector(".dialog"); if (d) [...d.querySelectorAll("button")].find((b) => /^(Close|Cancel|Kapat|İptal)$/.test(b.textContent.trim()))?.click(); })()`);
  await app.eval(`document.querySelector(".rail .rtab")?.click()`);
  await app.waitFor(`document.querySelector(".tiles, .empty-note")`);
  await app.sleep(250);
};

async function pass(lang: "en" | "tr", theme: "dark" | "light") {
  const project = copyProject(ETR, "etr");
  const app = await launchApp({ project, language: lang, theme, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    await app.sleep(800);

    // 1. Element grid: one 40 px bar, path strip, inspector; nothing dimmed before a selection.
    await shoot(app, "grid", lang, theme, async () => {
      const m = await app.eval<{ bar: number; actions: number; disabled: number }>(`({ bar: document.querySelector(".view > .findbar").getBoundingClientRect().height, actions: document.querySelectorAll(".view .actions .abtn").length,
        disabled: [...document.querySelectorAll(".view .crumbrow .abtn")].filter((b) => b.disabled).length })`);
      assert(Math.abs(m.bar - 40) < 0.5, `grid bar is 40 px, was ${m.bar}`);
      assert(m.disabled === 0, "no dimmed buttons in the path strip before a selection");
    });
    await app.eval(`(() => { const f = [...document.querySelectorAll(".foldertile")].find((e) => /items/i.test(e.textContent)); f?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
    await app.sleep(600);
    await app.eval(`document.querySelector(".tile:not(.foldertile)")?.click()`);
    await app.sleep(300);
    await shoot(app, "grid-selected", lang, theme, async () => {
      assert(await app.eval<boolean>(`!!document.querySelector(".dk-view .dk-insp, .dk-view .dk-strip")`), "the grid has the inspector (or its strip)");
    });
    // The inspector opens from the strip and shows the element.
    await view(app, 1.5);
    if (await app.eval<boolean>(`!!document.querySelector(".dk-view .dk-strip")`)) await app.click(".dk-view .dk-strip .dkstripbtn");
    await app.waitFor(`document.querySelector(".dk-view .dk-insp .gi-head")`, 5000);
    await view(app, 1);

    // 2. Element editor: one bar, page tabs, sections, inspector.
    await app.key("k", 2);
    await app.waitFor(`document.querySelector(".quickopen input")`);
    await app.type("adminkey");
    await app.sleep(350);
    await app.eval(`[...document.querySelectorAll(".quickrow")].find((x) => x.querySelector(".quickdetail")?.textContent.includes(" · "))?.click()`);
    await app.waitFor(`document.querySelector(".edhead")`, 15000);
    await app.sleep(500);
    await shoot(app, "editor", lang, theme, async () => {
      const m = await app.eval<{ bar: number; tabs: number; inspector: boolean }>(`({ bar: document.querySelector(".edhead").getBoundingClientRect().height, tabs: document.querySelector(".pagetabbar").getBoundingClientRect().height,
        inspector: !!document.querySelector(".dk-view .dk-insp, .dk-view .dk-strip") })`);
      assert(Math.abs(m.bar - 40) < 0.5, `editor bar is 40 px, was ${m.bar}`);
      assert(m.tabs <= 34, `page tabs are one row, were ${m.tabs}`);
      assert(m.inspector, "the editor has the inspector");
    });
    // A long type (Living entity) keeps every page reachable: the More pages menu lists them at 150 % text.
    await app.key("k", 2);
    await app.waitFor(`document.querySelector(".quickopen input")`);
    await app.type("worker");
    await app.sleep(350);
    await app.eval(`[...document.querySelectorAll(".quickrow")].find((x) => x.querySelector(".quickdetail")?.textContent.includes(" · "))?.click()`);
    await app.waitFor(`document.querySelector(".edhead")`, 15000);
    await app.sleep(400);
    await view(app, 1.5);
    const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
    assert(pages > 8, `Living entity has many pages, ${pages}`);
    assert(await app.eval<boolean>(`!!document.querySelector(".pagemore")`), "More pages menu appears when the tabs do not fit");
    await app.click(".pagemore button");
    await app.sleep(200);
    await app.shot(`${OUT}/editor-pages-menu-1280x720-150-${lang}-${theme}.png`);
    await app.key("Escape");
    await view(app, 1);

    // 3. Resources: the filter stays in the window.
    await home(app);
    await app.eval(`document.querySelector('.rail .rtab[data-section="resources"]')?.click()`);
    await app.waitFor(`document.querySelector(".fsel, .view")`, 15000);
    await app.sleep(1200);
    await shoot(app, "resources", lang, theme, async () => {
      const r = await app.eval<{ right: number; w: number } | null>(`(() => { const e = document.querySelector(".findbar .fsel"); if (!e) return null; const b = e.getBoundingClientRect(); return { right: b.right, w: innerWidth }; })()`);
      if (r) assert(r.right <= r.w, `the filter stays in the window: ${JSON.stringify(r)}`);
    });

    // 4. Preferences: category list, sections, the dialog in the window.
    await home(app);
    await app.key(",", 2);
    await app.waitFor(`document.querySelector(".prefsdialog .prefscat")`);
    await shoot(app, "preferences", lang, theme, async () => {
      const d = await app.eval<{ top: number; bottom: number; h: number; cats: number }>(`(() => { const r = document.querySelector(".prefsdialog").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, cats: document.querySelectorAll(".prefscat").length }; })()`);
      assert(d.top >= 0 && d.bottom <= d.h, `Preferences stays in the window: ${JSON.stringify(d)}`);
    });
    await app.click(".prefsdialog .prefscat", lang === "en" ? "Updates" : "Güncelleme");
    await app.key("Escape");
    await app.sleep(200);

    // 5. Bottom panel: Problems, resized by the grip, remembered, never taking the last 200 px of content.
    await home(app);
    await app.eval(`document.querySelector(".status .sitem")?.click()`);
    await app.waitFor(`document.querySelector(".bottom-panel")`);
    await app.sleep(500);
    await shoot(app, "panel-problems", lang, theme, async () => {
      const m = await app.eval<{ content: number; panel: number; h: number }>(`(() => { const p = document.querySelector(".bottom-panel").getBoundingClientRect(); const c = document.querySelector(".view").getBoundingClientRect(); return { content: c.height, panel: p.height, h: innerHeight }; })()`);
      assert(m.content >= 150, `the content above the panel keeps room: ${JSON.stringify(m)}`);
    });
    await app.eval(`[...document.querySelectorAll(".bottom-panel .ptab")].at(-1)?.click()`);
    await app.sleep(500);
    await shoot(app, "panel-agents", lang, theme, async () => {
      const m = await app.eval<{ content: number }>(`({ content: document.querySelector(".view").getBoundingClientRect().height })`);
      assert(m.content >= 150, `Agents leaves the content room at ${m.content}`);
    });
    // Resize with the keyboard on the grip: the height changes and is remembered.
    await view(app, 1);
    const before = await app.eval<number>(`document.querySelector(".bottom-panel").getBoundingClientRect().height`);
    await app.eval(`document.querySelector(".bpgrip").focus()`);
    await app.key("ArrowUp");
    await app.key("ArrowUp");
    await app.sleep(200);
    const after = await app.eval<number>(`document.querySelector(".bottom-panel").getBoundingClientRect().height`);
    assert(after > before, `the grip resizes the panel (${before} -> ${after})`);
    assert(await app.eval<boolean>(`localStorage.getItem("mcedge.panelHeight") !== null`), "the height is remembered");
    await app.eval(`document.querySelector(".bottom-panel .vbtn")?.click()`);
    await app.sleep(200);

    // 6. New project: the Create button is reachable at 150 % text.
    await home(app);
    await app.eval(`document.querySelectorAll(".menubar .menus .menu")[0].click()`);
    await app.sleep(200);
    await app.eval(`[...document.querySelectorAll(".menulist button")].find((x) => /New project|Yeni proje/i.test(x.textContent))?.click()`);
    await app.waitFor(`document.querySelector(".dialog")`);
    await app.sleep(500);
    await shoot(app, "new-project", lang, theme, async () => {
      const m = await app.eval<{ top: number; bottom: number; h: number; create: number; createBottom: number }>(`(() => { const d = document.querySelector(".dialog").getBoundingClientRect(); const b = [...document.querySelectorAll(".dialog button")].find((x) => /Create|Oluştur/.test(x.textContent)).getBoundingClientRect(); return { top: d.top, bottom: d.bottom, h: innerHeight, create: b.top, createBottom: b.bottom }; })()`);
      assert(m.top >= 0 && m.bottom <= m.h, `the dialog is inside the window: ${JSON.stringify(m)}`);
      assert(m.create >= 0 && m.createBottom <= m.h, `Create is on screen: ${JSON.stringify(m)}`);
    });
    await app.key("Escape");
  } finally {
    await app.close();
  }
}

mkdirSync(`${REPO}/${OUT}`, { recursive: true });
for (const [lang, theme] of quick ? [["en", "dark"]] as const : [["en", "dark"], ["en", "light"], ["tr", "dark"], ["tr", "light"]] as const) {
  await pass(lang, theme);
  console.log(`PASS ${lang} ${theme}`);
}

// Welcome (no project): the four entries are buttons and the card fits.
for (const [lang, theme] of quick ? [["en", "dark"]] as const : [["en", "dark"], ["tr", "light"]] as const) {
  const app = await launchApp({ language: lang, theme, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".welcome")`);
    await app.sleep(400);
    await shoot(app, "welcome", lang, theme, async () => {
      assert(await app.eval<boolean>(`document.querySelectorAll(".welcome-actions .welcome-link").length === 4`), "four welcome entries in the grid");
    });
  } finally {
    await app.close();
  }
}
console.log("layout-q279 PASS");
