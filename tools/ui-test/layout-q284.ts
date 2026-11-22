/**
 * Q284: the remaining Dock screens. Hidden window (cdp.ts), a copy of ETREconomy-MCEdge (never written to) and of examples/hello.
 * Tags and Variables (the inspector instead of the side panel), Resources (all five tabs: one 40 px bar, the actions of a
 * selection in the tabs row, the inspector), Localization (page nav, one bar), Workspace settings and Version control (one
 * bar, the shared empty state), Problems (filter chips and search) and the dialogs (three widths). Every screen at 1280x720
 * with 150 % and 175 % text (100 % in en dark), en and tr, dark and light, and Simple mode; asserts no page overflow, the
 * 40 px bars, no second action row and that buttons come in 24 / 28 / 36 px only. Screenshots in design/284/after/.
 *   node tools/ui-test/layout-q284.ts [--quick]
 */
import { mkdirSync } from "node:fs";
import { assert, copyProject, exampleProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/284/after");
const quick = process.argv.includes("--quick");
const ETR = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";
const SCALES = (lang: string, theme: string, mode: string): [string, number][] =>
  lang === "en" && theme === "dark" && mode === "advanced" && !quick ? [["100", 1], ["150", 1.5], ["175", 1.75]] : quick ? [["175", 1.75]] : [["150", 1.5], ["175", 1.75]];

async function view(app: App, scale: number) {
  await app.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${scale})`);
  await app.sleep(350);
}

/** Nothing sticks out of the window: no horizontal scroll, no visible element beyond the right edge (open menus excepted). */
const OVERFLOW = `(() => {
  // An element a clipping ancestor (a table cell, a scroll area) cuts off inside the window does not stick out.
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== "visible" && p.getBoundingClientRect().right <= innerWidth + 1) return true; } return false; };
  const out = [...document.querySelectorAll("body *")].filter((e) => e.offsetParent && !e.closest(".menulist, .tooltip, [role=tooltip], .menubar") && getComputedStyle(e).position !== "fixed"
    && e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0 && !clipped(e)).slice(0, 4).map((e) => e.tagName + "." + e.className.toString().slice(0, 30) + " in " + (e.parentElement?.className.toString().slice(0, 30) ?? "") + " [" + e.textContent.slice(0, 16) + "] right " + Math.round(e.getBoundingClientRect().right));
  return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, out };
})()`;
/** Heights of the visible command buttons (.abtn, .mbtn): the scale is 24 / 28 / 36. */
const HEIGHTS = `[...new Set([...document.querySelectorAll(".abtn, .mbtn")].filter((b) => b.offsetParent && b.getBoundingClientRect().width > 0).map((b) => Math.round(b.getBoundingClientRect().height)))]`;

async function checkFit(app: App, label: string) {
  const o = await app.eval<{ scrollW: number; innerW: number; out: string[] }>(OVERFLOW);
  assert(o.scrollW <= o.innerW + 1 && o.out.length === 0, `${label}: overflow ${JSON.stringify(o)}`);
  const heights = await app.eval<number[]>(HEIGHTS);
  assert(heights.every((h) => [24, 28, 36].includes(h)), `${label}: button heights ${heights}`);
}

type Ctx = { app: App; lang: string; theme: string; mode: string };
async function shoot(c: Ctx, name: string, check?: (scale: number) => Promise<void>) {
  for (const [tag, scale] of SCALES(c.lang, c.theme, c.mode)) {
    await view(c.app, scale);
    await check?.(scale);
    await checkFit(c.app, `${name} ${tag} ${c.lang} ${c.theme} ${c.mode}`);
    await c.app.shot(`${OUT}/${name}-1280x720-${tag}-${c.lang}-${c.theme}${c.mode === "simple" ? "-simple" : ""}.png`);
  }
  await view(c.app, 1);
}

const go = async (app: App, section: string) => {
  await app.key("Escape");
  await app.sleep(150);
  await app.eval(`(() => { const d = document.querySelector(".dialog"); if (d) [...d.querySelectorAll("button")].find((b) => /^(Close|Cancel|Kapat|İptal)$/.test(b.textContent.trim()))?.click(); })()`);
  await app.eval(`document.querySelector('.rail .rtab[data-section="${section}"]')?.click()`);
  await app.waitFor(`document.querySelector(".view")`, 15000);
  await app.sleep(700);
};
/** The inspector of the view is there (open) or its 38 px strip is (narrow windows); opening it from the strip works. */
const inspector = (app: App) => app.eval<boolean>(`!!document.querySelector(".dk-view .dk-insp, .dk-view .dk-strip")`);
const openInspector = async (app: App) => {
  if (await app.eval<boolean>(`!!document.querySelector(".dk-view .dk-strip")`)) await app.click(".dk-view .dk-strip .dkstripbtn");
  await app.waitFor(`document.querySelector(".dk-view .dk-insp")`, 5000);
};
const closeInspector = async (app: App) => {
  await app.eval(`[...document.querySelectorAll(".view > .findbar .abtn")].find((b) => /^(Hide the inspector|Denetçiyi gizle)/.test(b.title))?.click()`);
  await app.sleep(250);
};
const bar = (app: App, label: string) => app.eval<number>(`document.querySelector(".view > .findbar")?.getBoundingClientRect().height ?? 0`).then((h) => assert(Math.abs(h - 40) < 0.5, `${label}: the bar is 40 px, was ${h}`));
/** After the 40 px bar there is no second 38 px action row: the view has no `.actions` toolbar that is a direct child of it. */
const noSecondRow = (app: App, label: string) => app.eval<number>(`document.querySelectorAll(".view > .actions").length`).then((n) => assert(n === 0, `${label}: no second action row (${n})`));

async function pass(lang: "en" | "tr", theme: "dark" | "light", mode: "advanced" | "simple") {
  const project = copyProject(ETR, "etr");
  const app = await launchApp({ project, language: lang, theme, mode, level: mode === "simple" ? "new" : "java", width: 1440, height: 900 });
  const c: Ctx = { app, lang, theme, mode };
  try {
    await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    await app.sleep(800);

    // 1. Tags: the bar carries Common tags and New tag; the selected tag is edited in the inspector.
    await go(app, "tags");
    await app.click(".view > .findbar .abtn.primary");
    await app.waitFor(`document.querySelector(".tagsinsp, .dk-strip")`, 5000);
    await app.sleep(400);
    await shoot(c, "tags", async () => {
      await bar(app, "tags");
      await noSecondRow(app, "tags");
      assert(await inspector(app), "tags: the inspector replaces the side panel");
      assert(await app.eval<boolean>(`!document.querySelector(".view > .split > .panel, .view .panel")`), "tags: no 372 px side panel");
    });
    await view(app, 1.5);
    await openInspector(app);
    await app.shot(`${OUT}/tags-inspector-1280x720-150-${lang}-${theme}${mode === "simple" ? "-simple" : ""}.png`);
    await closeInspector(app);
    await view(app, 1);
    // Common tags dialog: the middle width.
    await app.click(".view > .findbar .abtn", lang === "en" ? "Common tags" : "Ortak etiketler");
    await app.waitFor(`document.querySelector(".commontags")`);
    await app.sleep(300);
    await shoot(c, "dialog-common-tags", async (scale) => {
      const w = await app.eval<{ w: number; vw: number }>(`({ w: Math.round(document.querySelector(".dialog").getBoundingClientRect().width), vw: innerWidth })`);
      assert(w.w === 560 || w.w === w.vw - 32, `common tags dialog is the middle width: ${JSON.stringify(w)} at ${scale}`);
    });
    await app.key("Escape");

    // 2. Variables (hidden in Simple mode).
    if (mode === "advanced") {
      await go(app, "variables");
      await app.click(".view > .findbar .abtn.primary");
      await app.sleep(500);
      await shoot(c, "variables", async () => {
        await bar(app, "variables");
        await noSecondRow(app, "variables");
        assert(await inspector(app), "variables: the inspector replaces the side panel");
      });
    }

    // 3. Resources: five tabs; the selection's actions sit in the tabs row.
    await go(app, "resources");
    await app.waitFor(`document.querySelector(".texcell")`, 15000);
    await app.click(".texcell:not(.draft)");
    await app.sleep(300);
    await shoot(c, "resources-textures", async () => {
      await bar(app, "resources");
      await noSecondRow(app, "resources");
      const m = await app.eval<{ right: number; w: number; row: number }>(`(() => { const e = document.querySelector(".findbar .fsel").getBoundingClientRect(); return { right: e.right, w: innerWidth, row: document.querySelectorAll(".tabsrow .actions .abtn").length }; })()`);
      assert(m.right <= m.w, `the filter stays in the window: ${JSON.stringify(m)}`);
      assert(m.row >= 2, `the selection's actions are in the tabs row: ${m.row}`);
    });
    await view(app, 1.5);
    await openInspector(app);
    await app.shot(`${OUT}/resources-inspector-1280x720-150-${lang}-${theme}${mode === "simple" ? "-simple" : ""}.png`);
    await closeInspector(app);
    await view(app, 1);
    for (const [i, tab] of ["sounds", "models", "animations", "structures"].entries()) {
      await app.eval(`document.querySelectorAll(".tabsrow [role=tab]")[${i + 1}]?.click()`);
      await app.sleep(500);
      await shoot(c, `resources-${tab}`, async () => {
        await bar(app, `resources ${tab}`);
        await noSecondRow(app, `resources ${tab}`);
      });
    }

    // 4. Localization: page nav and one bar.
    await go(app, "localization");
    await app.waitFor(`document.querySelector(".locgrid .lockey, .locgrid tr")`, 15000);
    await app.eval(`document.querySelector(".locgrid .lockey")?.click()`);
    await app.sleep(400);
    await shoot(c, "localization", async () => {
      await bar(app, "localization");
      await noSecondRow(app, "localization");
      assert(await app.eval<boolean>(`!!document.querySelector(".locbody > nav.pagenav .pnitem")`), "localization: the groups are the shared page nav");
      const r = await app.eval<{ right: number; w: number }>(`(() => { const e = document.querySelector(".findbar > .actions"); return { right: e.getBoundingClientRect().right, w: innerWidth }; })()`);
      assert(r.right <= r.w + 1, `localization actions stay in the window: ${JSON.stringify(r)}`);
    });

    // 5. Workspace settings: one bar, tabs row, empty state for a search without a match.
    await go(app, "settings");
    await shoot(c, "settings-mod", async () => {
      await bar(app, "settings");
      await noSecondRow(app, "settings");
    });
    await app.eval(`document.querySelectorAll(".tabsrow [role=tab]")[1]?.click()`);
    await app.sleep(400);
    await shoot(c, "settings-dependencies", async () => {
      await bar(app, "settings dependencies");
      await noSecondRow(app, "settings dependencies");
    });
    await app.eval(`document.querySelectorAll(".tabsrow [role=tab]")[2]?.click()`);
    await app.sleep(400);
    await app.eval(`document.querySelector(".grid tbody tr")?.click()`);
    await app.sleep(200);
    await shoot(c, "settings-integrations", async () => {
      await bar(app, "settings integrations");
      await noSecondRow(app, "settings integrations");
    });
    await app.eval(`document.querySelectorAll(".tabsrow [role=tab]")[0]?.click()`);
    await app.sleep(300);
    await app.setValue(".view > .findbar .search input", "zzzz-no-such-field");
    await app.sleep(250);
    await shoot(c, "settings-empty", async () => assert(await app.eval<boolean>(`!!document.querySelector(".emptystate")`), "settings: the shared empty state"));

    // 6. Version control (hidden in Simple mode): a repository, with its bar and tabs row.
    if (mode === "advanced") {
      await go(app, "git");
      await app.waitFor(`document.querySelector(".gitview, .emptystate")`, 15000);
      await shoot(c, "git", async () => {
        await bar(app, "git");
        await noSecondRow(app, "git");
      });
    }

    // 7. Problems panel: severity chips and search.
    await go(app, "elements");
    await app.eval(`[...document.querySelectorAll(".status .sitem")].find((e) => /problem|sorun/i.test(e.textContent))?.click()`);
    await app.waitFor(`document.querySelector(".bottom-panel .pchip")`);
    await app.sleep(500);
    await shoot(c, "panel-problems", async () => {
      const chips = await app.eval<number>(`document.querySelectorAll(".bottom-panel .pchip").length`);
      assert(chips === 3, `three severity chips: ${chips}`);
    });
    // A chip filters the list; the other chips and the search still work.
    const all = await app.eval<number>(`document.querySelectorAll(".bottom-panel .problems li[data-severity]").length`);
    await app.click(".bottom-panel .pchip.sev-error");
    await app.sleep(200);
    const noErrors = await app.eval<number>(`document.querySelectorAll(".bottom-panel .problems li[data-severity=error]").length`);
    assert(noErrors === 0, `the Errors chip hides errors (${noErrors})`);
    await app.click(".bottom-panel .pchip.sev-error");
    await app.sleep(200);
    assert((await app.eval<number>(`document.querySelectorAll(".bottom-panel .problems li[data-severity]").length`)) === all, "turning the chip on again restores the list");
    await app.setValue(".bottom-panel .pfsearch input", "zzzz-nothing");
    await app.sleep(200);
    assert((await app.eval<number>(`document.querySelectorAll(".bottom-panel .problems li[data-severity]").length`)) === 0, "the search narrows the list");
    await app.setValue(".bottom-panel .pfsearch input", "");
    await app.eval(`document.querySelector(".bottom-panel .vbtn")?.click()`);
    await app.sleep(200);

    // 8. Dialogs: three widths (440 / 560 / 880), clamped to the window.
    const widthOf = () => app.eval<{ w: number; vw: number; top: number; bottom: number; h: number }>(`(() => { const r = document.querySelector(".dialog").getBoundingClientRect(); return { w: Math.round(r.width), vw: innerWidth, top: r.top, bottom: r.bottom, h: innerHeight }; })()`);
    const dialog = async (name: string, open: () => Promise<void>, want: number) => {
      await go(app, "elements");
      await open();
      await app.waitFor(`document.querySelector(".dialog")`);
      await app.sleep(500);
      await shoot(c, name, async (scale) => {
        const m = await widthOf();
        assert(m.w === want || m.w === Math.round(m.vw - 32), `${name} is ${want} wide (or the window less 32): ${JSON.stringify(m)} at ${scale}`);
        assert(m.top >= 0 && m.bottom <= m.h, `${name} is inside the window: ${JSON.stringify(m)}`);
      });
      await app.key("Escape");
      await app.sleep(200);
    };
    await dialog("dialog-new-project", async () => {
      await app.eval(`document.querySelectorAll(".menubar .menus .menu")[0].click()`);
      await app.sleep(200);
      await app.eval(`[...document.querySelectorAll(".menulist button")].find((x) => /New project|Yeni proje/i.test(x.textContent))?.click()`);
    }, 440);
    await dialog("dialog-preferences", async () => app.key(",", 2), 880);
    await dialog("dialog-quick-open", async () => app.key("k", 2), 560);
    await dialog("dialog-export", async () => app.key("e", 2), 560);
  } finally {
    await app.close();
  }
}

/** The shared empty state of Version control needs a project that is not a repository. */
async function gitEmpty(lang: "en" | "tr", theme: "dark" | "light") {
  const project = copyProject(exampleProject(), "hello");
  const app = await launchApp({ project, language: lang, theme, width: 1440, height: 900 });
  const c: Ctx = { app, lang, theme, mode: "advanced" };
  try {
    await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
    await go(app, "git");
    await app.waitFor(`document.querySelector(".emptystate")`, 15000);
    await shoot(c, "git-empty", async () => {
      await bar(app, "git empty");
      await noSecondRow(app, "git empty");
      assert(await app.eval<boolean>(`!!document.querySelector(".emptystate .abtn.primary")`), "git: the empty state carries Initialize");
    });
  } finally {
    await app.close();
  }
}

mkdirSync(`${REPO}/${OUT}`, { recursive: true });
const combos = quick ? [["en", "dark", "advanced"]] as const
  : [["en", "dark", "advanced"], ["en", "light", "advanced"], ["tr", "dark", "advanced"], ["tr", "light", "advanced"], ["en", "dark", "simple"], ["en", "light", "simple"], ["tr", "dark", "simple"]] as const;
// --from=<n> skips the first n passes (to resume a run); the screenshots of the earlier ones stay.
const from = Number(process.argv.find((a) => a.startsWith("--from="))?.slice(7) ?? 0);
for (const [lang, theme, mode] of combos.slice(from)) {
  await pass(lang, theme, mode);
  console.log(`PASS ${lang} ${theme} ${mode}`);
}
for (const [lang, theme] of quick ? [["en", "dark"]] as const : [["en", "dark"], ["en", "light"], ["tr", "dark"], ["tr", "light"]] as const) {
  await gitEmpty(lang, theme);
  console.log(`PASS git-empty ${lang} ${theme}`);
}
console.log("layout-q284 PASS");
