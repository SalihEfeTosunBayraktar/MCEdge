/**
 * KUYRUK #111: product audit. Walks every screen and dialog of the real app and saves a screenshot of each, plus a
 * metrics file (toolbar / search bar positions, label column widths, button counts) used to find inconsistencies.
 * Measurement only: it never asserts, a screen that cannot be reached is logged and skipped.
 *
 *   node tools/ui-test/audit-screens.ts            # examples/hello (dark en, light en, dark tr) + ETREconomy-MCEdge
 *   node tools/ui-test/audit-screens.ts --hello    # only the example
 *
 * Output: design/audit-2026-11-10/{hello,etr}/<screen>-<theme>-<lang>.png and metrics-<project>-<theme>-<lang>.json.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyProject, exampleProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = process.env.AUDIT_OUT ?? evidence("design/audit-2026-11-10");
const ETR = "C:\\MyProjects\\AI-Assisted\\ETREconomy-MCEdge";
const onlyHello = process.argv.includes("--hello");

type Theme = "dark" | "light";
interface Pass { project: "hello" | "etr"; dir: string; theme: Theme; lang: "en" | "tr"; create?: boolean; full: boolean }

/** Element types the example lacks: created once (en pass) through the New popup, so their editors can be shown. */
const CREATE = [
  ["Armor", "Audit Armor"], ["Living entity", "Audit Mob"], ["GUI", "Audit Screen"], ["Procedure", "Audit Proc"],
  ["Loot table", "Audit Loot"], ["Biome", "Audit Biome"], ["Dimension", "Audit Dim"], ["Creative tab", "Audit Tab"],
] as const;
/** Editors to open: tile text to match and the file stem. */
const EDITORS: [string, string][] = [
  ["Ruby Apple", "item"], ["Block of Ruby", "block"], ["Ruby Pickaxe", "tool"], ["ruby_from_smelting", "recipe"],
  ["Rubies", "creative-tab"], ["Audit Armor", "armor"], ["Audit Mob", "living-entity"], ["Audit Screen", "gui"],
  ["Audit Proc", "procedure"], ["Audit Loot", "loot-table"], ["Audit Biome", "biome"], ["Audit Dim", "dimension"],
];

const metrics: Record<string, unknown> = {};
const log: string[] = [];

async function step(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    const line = `SKIP ${name}: ${String(error).split("\n")[0]}`;
    log.push(line);
    console.log(line);
  }
}

/** Layout facts of the current screen: where the search bar, toolbars and form label columns sit. */
const MEASURE = `(() => {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const all = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent);
  return {
    findbar: all(".findbar").map(box),
    toolbars: all("[role=toolbar]").map((e) => ({ cls: e.className, ...box(e), buttons: e.querySelectorAll("button").length,
      labels: [...e.querySelectorAll("button")].map((b) => b.textContent.trim() || b.title).slice(0, 20) })),
    sidepanel: all(".sidepanel, .spanel, aside").map(box),
    labelCols: [...new Set(all(".frow > label").map((l) => Math.round(l.getBoundingClientRect().width)))],
    controlX: [...new Set(all(".frow").map((r) => { const c = r.children[1]; return c ? Math.round(c.getBoundingClientRect().x) : -1; }))].slice(0, 12),
    buttonHeights: [...new Set(all("button").map((b) => Math.round(b.getBoundingClientRect().height)))].sort((a, b) => a - b),
    fontSizes: [...new Set(all("button, input, select, label, td, th").map((e) => getComputedStyle(e).fontSize))],
    inputsWidth: [...new Set(all(".frow input:not([type=checkbox]), .frow select").map((e) => Math.round(e.getBoundingClientRect().width)))].slice(0, 12),
    selects: all("select").length, tables: all("table").length, scrollW: document.documentElement.scrollWidth,
  };
})()`;

async function shoot(app: App, pass: Pass, name: string) {
  const file = `${OUT}/${pass.project}/${name}-${pass.theme}-${pass.lang}.png`;
  await app.shot(file);
  metrics[name] = await app.eval(MEASURE).catch(() => null);
}

const closeOverlays = async (app: App) => {
  await app.key("Escape");
  await app.sleep(150);
  // Escape does not close the New popup or the export dialog (finding U-?): close them the way a user would.
  await app.eval(`(() => {
    if (document.querySelector(".addpop")) document.querySelector(".view .actions .abtn.primary")?.click();
    const dialog = document.querySelector(".dialog");
    if (dialog) [...dialog.querySelectorAll("button")].find((b) => /^(Close|Cancel|Kapat|İptal|Vazgeç)$/.test(b.textContent.trim()))?.click();
  })()`);
  await app.sleep(150);
};
const home = async (app: App) => {
  await closeOverlays(app);
  await app.click(".rail .rtab");
  await app.waitFor(`document.querySelector(".tiles, .empty-note")`);
};
/** Opens the element tile whose text contains `text` (case-insensitive). */
const openTile = async (app: App, text: string) => {
  const ok = await app.eval<boolean>(`(() => {
    const t = [...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.textContent.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!t) return false; t.scrollIntoView({ block: "nearest" }); t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true;
  })()`);
  if (!ok) throw new Error(`no tile ${text}`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(500);
};
const clickText = (app: App, selector: string, text: string) => app.click(selector, text);

async function runPass(pass: Pass) {
  const app = await launchApp({ project: pass.dir, theme: pass.theme, language: pass.lang, width: 1440, height: 900 });
  for (const key of Object.keys(metrics)) delete metrics[key];
  try {
    await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
    await app.sleep(800);
    await shoot(app, pass, "elements");

    if (pass.create) {
      for (const [type, name] of CREATE) {
        await step(`create ${type}`, async () => {
          await home(app);
          await app.click(".view .actions .abtn.primary");
          await app.waitFor(`document.querySelector(".addpop")`);
          await app.setValue(".addpop .popsearch input", type);
          await app.sleep(150);
          await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent === ${JSON.stringify(type)})?.click()`);
          await app.waitFor(`document.querySelector(".popform input")`);
          await app.setValue(".popform input", name);
          await app.key("Enter");
          await app.waitFor(`document.querySelector(".edhead")`, 15000);
        });
      }
    }

    if (pass.full) {
      // Menus.
      const menus = await app.eval<number>(`document.querySelectorAll(".menubar .menus .menu").length`);
      for (let i = 0; i < menus; i++) {
        await step(`menu ${i}`, async () => {
          await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${i}].click()`);
          await app.sleep(200);
          await shoot(app, pass, `menu-${i + 1}-${["file", "workspace", "resources", "build-run", "tools", "window", "help"][i] ?? "x"}`);
          await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${i}].click()`);
        });
      }
      await step("engine menu", async () => {
        await app.click(".enginebtn");
        await shoot(app, pass, "menu-engine");
        await app.click(".enginebtn");
      });

      // Element list: New popup, name step, context menu, wide rail.
      await step("new popup", async () => {
        await home(app);
        await app.click(".view .actions .abtn.primary");
        await app.waitFor(`document.querySelector(".addpop")`);
        await shoot(app, pass, "new-element-popup");
        await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent.match(/^(Item|Eşya)$/))?.click()`);
        await app.waitFor(`document.querySelector(".popform")`);
        await shoot(app, pass, "new-element-name");
        await closeOverlays(app);
      });
      await step("context menu", async () => {
        await home(app);
        await app.click(".tiles .tile:not(.foldertile)", undefined, { button: "right" });
        await app.sleep(200);
        await shoot(app, pass, "elements-context-menu");
        await closeOverlays(app);
      });
      await step("wide rail + actions", async () => {
        await home(app);
        await app.click(".rail .rtoggle");
        await app.sleep(200);
        await shoot(app, pass, "elements-wide");
        await app.click(".rail .rtoggle");
      });
      await step("element filter", async () => {
        await home(app);
        await app.eval(`document.querySelector(".findbar select")?.focus()`);
        await shoot(app, pass, "elements-findbar");
      });

      // Editors, every page.
      for (const [tile, stem] of EDITORS) {
        await step(`editor ${stem}`, async () => {
          await home(app);
          await openTile(app, tile);
          await shoot(app, pass, `editor-${stem}`);
          const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
          for (let p = 1; p < pages; p++) {
            await app.eval(`document.querySelectorAll(".pagetabs .ltab")[${p}].click()`);
            await app.sleep(300);
            await shoot(app, pass, `editor-${stem}-p${p + 1}`);
          }
          if (stem === "gui" || stem === "procedure") {
            await step(`${stem} element menu`, async () => {
              await app.click(".elementmenu button");
              await shoot(app, pass, `editor-${stem}-menu`);
              await closeOverlays(app);
            });
          }
        });
      }
    }

    // Rail sections (both projects): each one, plus its sub-tabs.
    const sections = await app.eval<number>(`document.querySelectorAll(".rail .rtab").length`);
    for (let i = 0; i < sections; i++) {
      await step(`section ${i}`, async () => {
        await closeOverlays(app);
        await app.eval(`document.querySelectorAll(".rail .rtab")[${i}].click()`);
        await app.sleep(700);
        const id = ["elements", "resources", "tags", "variables", "localization", "git", "settings"][i] ?? `s${i}`;
        await shoot(app, pass, `section-${id}`);
        if (id === "resources") {
          const tabs = await app.eval<number>(`document.querySelectorAll(".view .langtabs .ltab, .view [role=tablist] .ltab").length`);
          for (let k = 1; k < tabs; k++) {
            await app.eval(`document.querySelectorAll(".view .langtabs .ltab, .view [role=tablist] .ltab")[${k}].click()`);
            await app.sleep(300);
            await shoot(app, pass, `section-resources-tab${k + 1}`);
          }
          await app.eval(`document.querySelectorAll(".view .langtabs .ltab, .view [role=tablist] .ltab")[0].click()`);
          await app.sleep(300);
        }
        if (id === "localization") {
          await step("loc select row", async () => {
            await app.click(".grid tbody tr");
            await shoot(app, pass, "section-localization-selected");
            await app.setValue(".findbar select", "missing");
            await shoot(app, pass, "section-localization-missing");
            await app.setValue(".findbar select", "all");
          });
          if (pass.full) {
            await step("loc dialogs", async () => {
              await app.click(".actions .abtn.primary");
              await shoot(app, pass, "dialog-localization-add-key");
              await closeOverlays(app);
              await app.eval(`document.querySelectorAll(".actions .abtn")[1].click()`);
              await app.sleep(200);
              await shoot(app, pass, "dialog-localization-add-language");
              await closeOverlays(app);
            });
          }
        }
        if (["tags", "variables"].includes(id)) {
          await step(`${id} select row`, async () => {
            // A project without tags or variables (examples/hello) has an empty list: New adds one and selects it.
            if (await app.eval<boolean>(`!!document.querySelector(".grid tbody tr")`)) await app.click(".grid tbody tr");
            else await app.click(".view .abtn.primary");
            await shoot(app, pass, `section-${id}-selected`);
          });
        }
        if (id === "settings") {
          // The mod form has no table; the dependency and integration tabs do (a row is selected when there is one).
          await step("settings tabs", async () => {
            for (const k of [1, 2]) {
              await app.eval(`document.querySelectorAll(".view .langtabs .ltab, .view [role=tablist] .ltab")[${k}].click()`);
              await app.sleep(300);
              if (await app.eval<boolean>(`!!document.querySelector(".grid tbody tr")`)) await app.click(".grid tbody tr");
              await shoot(app, pass, `section-settings-tab${k + 1}`);
            }
          });
        }
      });
    }

    if (pass.full) {
      await step("texture editor", async () => {
        await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
        await app.waitFor(`document.querySelector(".texcell:not(.draft)")`);
        await app.click(".texcell:not(.draft)", undefined, { double: true });
        await app.waitFor(`document.querySelector(".ptools")`, 10000);
        await app.sleep(500);
        await shoot(app, pass, "texture-editor");
        await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
        await app.sleep(300);
        await app.click(".actions .abtn.primary");
        await app.sleep(300);
        await shoot(app, pass, "dialog-new-texture");
        await closeOverlays(app);
      });
      await step("resources import menu", async () => {
        await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
        await app.sleep(300);
        await app.eval(`document.querySelectorAll(".actions .abtn")[1].click()`);
        await app.sleep(200);
        await shoot(app, pass, "resources-import-menu");
        await closeOverlays(app);
      });
      await step("export jar", async () => {
        await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
        await app.key("e", 2);
        await app.sleep(800);
        await shoot(app, pass, "dialog-export-jar");
        await closeOverlays(app);
      });
      for (const [i, name] of [[0, "docs"], [1, "about"]] as const) {
        await step(`help ${name}`, async () => {
          const helpIndex = await app.eval<number>(`document.querySelectorAll(".menubar .menus .menu").length - 1`);
          await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${helpIndex}].click()`);
          await app.sleep(150);
          await app.eval(`document.querySelectorAll(".menulist button")[${i}]?.click()`);
          await app.sleep(400);
          await shoot(app, pass, `dialog-${name}`);
          await closeOverlays(app);
        });
      }
      for (const panel of ["problems", "build", "gradle"]) {
        await step(`panel ${panel}`, async () => {
          const winIndex = await app.eval<number>(`document.querySelectorAll(".menubar .menus .menu").length - 2`);
          const toolsIndex = winIndex - 1;
          await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${panel === "gradle" ? toolsIndex : winIndex}].click()`);
          await app.sleep(150);
          const idx = panel === "gradle" ? 0 : panel === "build" ? 2 : 3;
          await app.eval(`[...document.querySelectorAll(".menulist button[role=menuitem]")][${idx}]?.click()`);
          await app.sleep(400);
          await shoot(app, pass, `panel-${panel}`);
        });
      }
      await step("rename dialog", async () => {
        await home(app);
        await app.click(".tiles .tile:not(.foldertile)", undefined, { button: "right" });
        await app.sleep(150);
        await app.eval(`[...document.querySelectorAll(".menulist.ctx button")].find((b) => /Rename|Yeniden/.test(b.textContent))?.click()`);
        await app.sleep(300);
        await shoot(app, pass, "dialog-rename");
        await closeOverlays(app);
      });
      await step("references dialog", async () => {
        await home(app);
        await app.click(".tiles .tile:not(.foldertile)", undefined, { button: "right" });
        await app.sleep(150);
        await app.eval(`[...document.querySelectorAll(".menulist.ctx button")].find((b) => /usages|Kullan/i.test(b.textContent))?.click()`);
        await app.sleep(300);
        await shoot(app, pass, "dialog-references");
        await closeOverlays(app);
      });
    }
  } finally {
    writeFileSync(resolve(REPO, `${OUT}/metrics-${pass.project}-${pass.theme}-${pass.lang}.json`), JSON.stringify(metrics, null, 1));
    await app.close();
  }
}

async function welcome(theme: Theme, lang: "en" | "tr", recentDir: string) {
  const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
  writeFileSync(join(userData, "app-state.json"), JSON.stringify({
    exportFolders: {}, preferences: { language: lang, theme, fontScale: 1, uiFont: "", codeFont: "", level: "java", mode: "advanced" },
    recent: [{ dir: recentDir, name: "hello", openedAt: new Date().toISOString() }, { dir: "C:\\missing\\old-mod", name: "old-mod", openedAt: "2026-10-01T10:00:00Z" }],
  }));
  const app = await launchApp({ userData, theme, language: lang });
  try {
    await app.waitFor(`document.querySelector(".welcome")`);
    await app.sleep(500);
    await app.shot(`${OUT}/hello/welcome-${theme}-${lang}.png`);
  } finally {
    await app.close();
  }
}

mkdirSync(resolve(REPO, OUT), { recursive: true });
const hello = exampleProject();
for (const [theme, lang] of [["dark", "en"], ["light", "en"], ["dark", "tr"], ["light", "tr"]] as const) await step(`welcome ${theme} ${lang}`, () => welcome(theme, lang, hello));
await runPass({ project: "hello", dir: hello, theme: "dark", lang: "en", create: true, full: true });
await runPass({ project: "hello", dir: hello, theme: "light", lang: "en", full: true });
await runPass({ project: "hello", dir: hello, theme: "dark", lang: "tr", full: true });
if (!onlyHello) {
  const etr = copyProject(ETR, "ETREconomy-MCEdge");
  await runPass({ project: "etr", dir: etr, theme: "dark", lang: "en", full: false });
  await runPass({ project: "etr", dir: etr, theme: "light", lang: "tr", full: false });
}
writeFileSync(resolve(REPO, `${OUT}/skipped.txt`), log.join("\n") + "\n");
console.log(`done, ${log.length} skipped`);
// A skipped step means a screen the audit could not reach: that fails the run.
if (log.length) process.exitCode = 1;
else console.log("PASS");
