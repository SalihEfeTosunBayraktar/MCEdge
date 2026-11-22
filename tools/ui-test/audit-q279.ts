/**
 * Q279 audit: hidden screenshots of the screens outside the GUI and texture editors (element grid, element editor pages,
 * resources, tags / variables / localization / git / project settings, preferences, main dialogs, bottom panels, welcome)
 * on a copy of ETREconomy-MCEdge, at 1280x720 and 1440x900, text size 100 % and 150 %, en and tr, dark and light.
 * The project is copied from ETREconomy-MCEdge (never written to). Measurement only: it never asserts; a screen that cannot be reached is logged and skipped. Output: design/279/shots/.
 *   node tools/ui-test/audit-q279.ts [--quick]
 * Full set (every screen) in en dark at 1280x720 (100 % and 150 %); the core set (grid, item page 1, resources, preferences, new
 * project, Problems panel, welcome) at all four views in all four language and theme passes.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = process.env.AUDIT_OUT ?? evidence("design/279/shots");
const ETR = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";
const quick = process.argv.includes("--quick");
const metrics: Record<string, unknown> = {};
const log: string[] = [];

type View = [number, number, number];
const V_SMALL: View = [1280, 720, 1], V_SMALL_150: View = [1280, 720, 1.5], V_BIG: View = [1440, 900, 1], V_BIG_150: View = [1440, 900, 1.5];

const MEASURE = `(() => {
  const vis = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent);
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const hs = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))].sort((a, b) => a - b);
  const view = document.querySelector(".content > .view, .content > section, .content");
  const bars = vis(".view .actions, .view .findbar, .edhead, .bottom-panel .panel-tabs, .welcome .actions").map((e) => ({ cls: e.className.toString().slice(0, 30), ...box(e),
    rows: new Set([...e.children].map((c) => Math.round(c.getBoundingClientRect().top))).size, buttons: e.querySelectorAll("button").length }));
  return { vw: innerWidth, vh: innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth,
    overflowRight: vis("*").filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length,
    viewBox: view ? box(view) : null, bars,
    buttonHeights: hs(vis("button")), inputHeights: hs(vis("input:not([type=checkbox]):not([type=range]), select")),
    labelCols: [...new Set(vis(".frow > label").map((l) => Math.round(l.getBoundingClientRect().width)))],
    fonts: [...new Set(vis("button, input, select, label, td, th, p, h1, h2, h3, summary").map((e) => getComputedStyle(e).fontSize))].sort(),
    panelHeaders: vis(".fgroup > h3, .fgroup > header, .fgroup > summary, .ptab, .ltab").map((e) => Math.round(e.getBoundingClientRect().height)).slice(0, 12),
    bottomPanel: (() => { const e = document.querySelector(".bottom-panel"); return e ? box(e) : null; })() };
})()`;

async function view(app: App, [w, h, s]: View) {
  await app.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(${s})`);
  await app.sleep(350);
}
const vtag = ([w, h, s]: View) => `${w}x${h}-${s === 1 ? "100" : "150"}`;

interface Pass { lang: "en" | "tr"; theme: "dark" | "light"; dir: string }
let current: Pass;

/** Shoots the open screen at the given views, then goes back to the roomy view the navigation code expects. */
async function shoot(app: App, name: string, views: View[]) {
  for (const v of views) {
    await view(app, v);
    const tag = `${name}-${vtag(v)}-${current.lang}-${current.theme}`;
    await app.shot(`${OUT}/${tag}.png`);
    metrics[tag] = await app.eval(MEASURE).catch(() => null);
  }
  await view(app, V_BIG);
}

async function step(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    const line = `SKIP ${name}: ${String(error).split("\n")[0].slice(0, 160)}`;
    log.push(line);
    console.log(line);
  }
}

const closeOverlays = async (app: App) => {
  await app.key("Escape");
  await app.sleep(150);
  await app.eval(`(() => {
    if (document.querySelector(".addpop")) document.querySelector(".view .actions .abtn.primary")?.click();
    const dialog = document.querySelector(".dialog");
    if (dialog) [...dialog.querySelectorAll("button")].find((b) => /^(Close|Cancel|Kapat|İptal|Vazgeç)$/.test(b.textContent.trim()))?.click();
  })()`);
  await app.sleep(150);
};
const home = async (app: App) => {
  await closeOverlays(app);
  await app.eval(`document.querySelector(".rail .rtab")?.click()`);
  await app.waitFor(`document.querySelector(".tiles, .empty-note")`);
  await app.sleep(250);
};
const closePanel = (app: App) => app.eval(`document.querySelector(".bottom-panel .vbtn")?.click()`).then(() => app.sleep(200));
const menuItem = async (app: App, menu: number, text: RegExp) => {
  await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${menu}].click()`);
  await app.sleep(200);
  const ok = await app.eval<boolean>(`(() => { const b = [...document.querySelectorAll(".menulist button")].find((x) => ${text}.test(x.textContent)); b?.click(); return !!b; })()`);
  if (!ok) throw new Error(`menu item ${text} not found`);
  await app.sleep(500);
};

/** Opens an element by name through Quick open (Ctrl+K), which finds it in any folder. */
async function openElement(app: App, query: string) {
  await home(app);
  await app.key("k", 2);
  await app.waitFor(`document.querySelector(".quickopen input")`);
  await app.type(query);
  await app.sleep(350);
  // The first hit that is an element (its detail reads "Type · id"); other hits are lang keys, textures and models.
  const clicked = await app.eval<boolean>(`(() => { const r = [...document.querySelectorAll(".quickrow")].find((x) => x.querySelector(".quickdetail")?.textContent.includes(" · ")); r?.click(); return !!r; })()`);
  if (!clicked) throw new Error(`no element hit for ${query}`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(600);
}

async function editorPages(app: App, stem: string, query: string, views: View[], allPages: boolean) {
  await step(`editor ${stem}`, async () => {
    await openElement(app, query);
    await shoot(app, `editor-${stem}-p1`, views);
    if (!allPages) return;
    const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
    for (let p = 1; p < pages; p++) {
      await app.eval(`document.querySelectorAll(".pagetabs .ltab")[${p}].click()`);
      await app.sleep(350);
      await shoot(app, `editor-${stem}-p${p + 1}`, views);
    }
  });
}

async function run(pass: Pass, full: boolean) {
  current = pass;
  const app = await launchApp({ project: pass.dir, theme: pass.theme, language: pass.lang, width: 1440, height: 900 });
  const core: View[] = quick ? [V_SMALL] : [V_SMALL, V_SMALL_150, V_BIG, V_BIG_150];
  const wide: View[] = quick ? [V_SMALL] : [V_SMALL, V_SMALL_150];
  try {
    await app.waitFor(`document.querySelector(".tiles .tile")`, 60000);
    await app.sleep(900);
    await step("elements", () => shoot(app, "elements-grid", core));
    await step("elements folder", async () => {
      await app.eval(`(() => { const f = [...document.querySelectorAll(".foldertile")].find((e) => /items/i.test(e.textContent)) ?? document.querySelector(".foldertile"); f?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
      await app.sleep(700);
      await shoot(app, "elements-folder", wide);
      await app.eval(`document.querySelector(".tile:not(.foldertile)")?.click()`);
      await app.sleep(250);
      await shoot(app, "elements-selected", wide);
    });
    await editorPages(app, "item", "adminkey", core, true);
    if (full) {
      await editorPages(app, "block", "aciksandik", wide, true);
      await editorPages(app, "recipe", "applekeyrecipe", wide, true);
      await editorPages(app, "procedure", "addingmode", wide, false);
      await editorPages(app, "living-entity", "worker", wide, true);
      await editorPages(app, "radial-menu", "admin_wheel", wide, true);
      await editorPages(app, "command", "money", wide, true);
      await editorPages(app, "particle", "builder", wide, false);
      await editorPages(app, "game-rule", "badluckmaximumcut", wide, false);
    }

    // Rail views and resources.
    const sections = ["elements", "resources", "tags", "variables", "localization", "git", "settings"];
    for (const id of sections.slice(1)) {
      if (!full && !["resources"].includes(id)) continue;
      await step(`section ${id}`, async () => {
        await closeOverlays(app);
        await app.eval(`document.querySelector('.rail .rtab[data-section="${id}"]')?.click()`);
        await app.sleep(900);
        await shoot(app, `section-${id}`, id === "resources" ? core : wide);
        if (id === "resources") {
          const tabs = await app.eval<number>(`document.querySelectorAll(".view [role=tablist] .ltab").length`);
          for (let k = 1; k < tabs; k++) {
            await app.eval(`document.querySelectorAll(".view [role=tablist] .ltab")[${k}].click()`);
            await app.sleep(600);
            await shoot(app, `section-resources-tab${k + 1}`, wide);
          }
          await app.eval(`document.querySelectorAll(".view [role=tablist] .ltab")[0]?.click()`);
        } else if (["tags", "variables", "settings", "localization"].includes(id)) {
          await app.eval(`document.querySelector(".grid tbody tr")?.click()`);
          await app.sleep(300);
          await shoot(app, `section-${id}-selected`, wide);
        }
      });
    }

    // Preferences (Ctrl+,) and dialogs.
    await step("preferences", async () => {
      await home(app);
      await app.key(",", 2);
      await app.waitFor(`document.querySelector(".dialog")`);
      await app.sleep(400);
      await shoot(app, "dialog-preferences", core);
      if (full) {
        const tabs = await app.eval<number>(`document.querySelectorAll(".dialog [role=tablist] [role=tab], .dialog .ltab").length`);
        for (let k = 1; k < tabs; k++) {
          await app.eval(`document.querySelectorAll(".dialog [role=tablist] [role=tab], .dialog .ltab")[${k}].click()`);
          await app.sleep(300);
          await shoot(app, `dialog-preferences-tab${k + 1}`, wide);
        }
      }
      await closeOverlays(app);
    });
    await step("new project", async () => {
      await home(app);
      await menuItem(app, 0, /New project|Yeni proje/i);
      await app.waitFor(`document.querySelector(".dialog")`);
      await shoot(app, "dialog-new-project", core);
      await closeOverlays(app);
    });
    if (full) {
      await step("new element", async () => {
        await home(app);
        await app.click(".view .actions .abtn.primary");
        await app.waitFor(`document.querySelector(".addpop")`);
        await shoot(app, "dialog-new-element", wide);
        await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => /^(Item|Eşya)$/.test(b.querySelector(".pname").textContent))?.click()`);
        await app.waitFor(`document.querySelector(".popform")`);
        await shoot(app, "dialog-new-element-name", wide);
        await closeOverlays(app);
      });
      await step("export", async () => {
        await home(app);
        await app.key("e", 2);
        await app.waitFor(`document.querySelector(".dialog")`);
        await app.sleep(800);
        await shoot(app, "dialog-export", wide);
        await closeOverlays(app);
      });
      await step("updates", async () => {
        await home(app);
        const menus = await app.eval<number>(`document.querySelectorAll(".menubar .menus .menu").length`);
        await menuItem(app, menus - 1, /update|güncelle/i);
        await app.waitFor(`document.querySelector(".dialog")`);
        await app.sleep(600);
        await shoot(app, "dialog-updates", wide);
        await closeOverlays(app);
      });
      await step("new texture", async () => {
        await closeOverlays(app);
        await app.eval(`document.querySelector('.rail .rtab[data-section="resources"]')?.click()`);
        await app.sleep(500);
        await app.click(".view .actions .abtn.primary");
        await app.waitFor(`document.querySelector(".dialog")`);
        await shoot(app, "dialog-new-texture", wide);
        await closeOverlays(app);
      });
      await step("rename + references", async () => {
        await home(app);
        await app.click(".tiles .tile:not(.foldertile)", undefined, { button: "right" });
        await app.sleep(200);
        await shoot(app, "elements-context-menu", wide);
        await app.eval(`[...document.querySelectorAll(".menulist.ctx button")].find((b) => /Rename|Yeniden/.test(b.textContent))?.click()`);
        await app.sleep(300);
        await shoot(app, "dialog-rename", wide);
        await closeOverlays(app);
      });
    }

    // Bottom panels: Problems, Build output, Gradle, Scenarios, Agents (ptab order in BottomPanel).
    await step("panels", async () => {
      await home(app);
      await app.eval(`document.querySelector(".status .sitem")?.click()`);
      await app.waitFor(`document.querySelector(".bottom-panel")`);
      await app.sleep(500);
      const tabs = await app.eval<number>(`document.querySelectorAll(".bottom-panel .ptab").length`);
      const names = ["problems", "build", "gradle", "scenarios", "agents"];
      for (let k = 0; k < tabs; k++) {
        if (!full && k > 0) break;
        await app.eval(`document.querySelectorAll(".bottom-panel .ptab")[${k}].click()`);
        await app.sleep(700);
        await shoot(app, `panel-${names[k] ?? k}`, k === 0 ? core : wide);
      }
      await closePanel(app);
    });
  } finally {
    await app.close();
  }
}

async function welcome(pass: Pass, views: View[]) {
  current = pass;
  const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
  writeFileSync(join(userData, "app-state.json"), JSON.stringify({
    exportFolders: {}, preferences: { language: pass.lang, theme: pass.theme, fontScale: 1, uiFont: "", codeFont: "", level: "java", mode: "advanced" },
    recent: [{ dir: pass.dir, name: "ETREconomy", openedAt: new Date().toISOString() }, { dir: "C:\\missing\\old-mod", name: "old-mod", openedAt: "2026-10-01T10:00:00Z" }],
  }));
  const app = await launchApp({ userData, theme: pass.theme, language: pass.lang, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".welcome")`);
    await app.sleep(500);
    await shoot(app, "welcome", views);
  } finally {
    await app.close();
  }
}

mkdirSync(`${REPO}/${OUT}`, { recursive: true });
const all: [Pass["lang"], Pass["theme"]][] = [["en", "dark"], ["en", "light"], ["tr", "dark"], ["tr", "light"]];
for (const [lang, theme] of quick ? [all[0]] : all) {
  const dir = copyProject(ETR, "etr");
  const pass: Pass = { lang, theme, dir };
  const first = lang === "en" && theme === "dark";
  await step(`welcome ${lang} ${theme}`, () => welcome(pass, quick ? [V_SMALL] : [V_SMALL, V_SMALL_150, V_BIG, V_BIG_150]));
  await step(`pass ${lang} ${theme}`, () => run(pass, first));
  writeFileSync(`${REPO}/${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
}
writeFileSync(`${REPO}/${OUT}/skipped.txt`, log.join("\n") + "\n");
console.log(`done, ${log.length} skipped`);
