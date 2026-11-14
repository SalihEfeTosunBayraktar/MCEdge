/**
 * KUYRUK 123: one label width per kind of form (form, panel) and labels that wrap instead of being cut. Creates one
 * element of every type in a copy of examples/hello, then opens every editor page, every section with a selected row,
 * the texture editor and the dialogs, and collects the label column widths and any label whose text does not fit.
 * Args: language (en|tr), theme, suffix ("before" records and fails at the end). Screenshots go to design/123/.
 */
import { typeRegistry } from "../../src/elements/registry.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const suffix = process.argv[4] ?? "after";
const project = exampleProject();
for (const type of typeRegistry().types) {
  try {
    addElement(project, type.id, `label_${type.id}`);
  } catch {
    // A type the fixture cannot create stays out; the editors of the others are still checked.
  }
}

/** Editor pages with long labels, shot every run (they were cut before KUYRUK 123). */
const SHOOT = new Set(["label_damage_type p1", "label_dimension p2", "label_living_entity p1"]);

/** Label widths on screen and the labels whose text is cut (wider or taller than the label box). */
const MEASURE = `(() => {
  const labels = [...document.querySelectorAll(".frow > label")].filter((l) => l.offsetParent);
  return {
    widths: [...new Set(labels.map((l) => Math.round(l.getBoundingClientRect().width)))],
    cut: labels.filter((l) => l.textContent.trim() && (l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1)).map((l) => l.textContent.trim()),
  };
})()`;

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 10`, 20000);
  const widths = new Map<number, string>();
  const cut = new Set<string>();
  const shots = new Set<string>();
  const measure = async (where: string) => {
    const m = await app.eval<{ widths: number[]; cut: string[] }>(MEASURE);
    m.widths.forEach((w) => widths.has(w) || widths.set(w, where));
    m.cut.forEach((label) => cut.add(`${where}: ${label}`));
    if (m.cut.length && shots.size < 2 && !shots.has(where)) (shots.add(where), await app.shot(`design/123/cut-${shots.size}-${lang}-${theme}-${suffix}.png`));
  };
  const home = async () => {
    await app.key("Escape");
    await app.eval(`document.querySelector(".rail .rtab").click()`);
    await app.waitFor(`document.querySelector(".tiles")`);
  };

  // Every editor page.
  const tiles = await app.eval<number>(`document.querySelectorAll(".tile:not(.foldertile)").length`);
  for (let i = 0; i < tiles; i++) {
    await home();
    const name = await app.eval<string>(`(() => { const t = document.querySelectorAll(".tile:not(.foldertile)")[${i}]; t.scrollIntoView({ block: "nearest" }); t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return t.querySelector(".tname").textContent; })()`);
    await app.waitFor(`document.querySelector(".edhead")`, 15000);
    await app.sleep(300);
    const pages = await app.eval<number>(`document.querySelectorAll(".pagetabs .ltab").length`);
    for (let p = 0; p < Math.max(1, pages); p++) {
      if (p > 0) {
        await app.eval(`document.querySelectorAll(".pagetabs .ltab")[${p}].click()`);
        await app.sleep(200);
      }
      await measure(`${name} p${p + 1}`);
      if (SHOOT.has(`${name} p${p + 1}`)) await app.shot(`design/123/${name.replace("label_", "")}-p${p + 1}-${lang}-${theme}-${suffix}.png`);
    }
  }

  // Every section, with a row selected so its side panel shows.
  await home();
  const sections = await app.eval<number>(`document.querySelectorAll(".rail .rtab").length`);
  for (let i = 0; i < sections; i++) {
    await app.eval(`document.querySelectorAll(".rail .rtab")[${i}].click()`);
    await app.sleep(400);
    await app.eval(`document.querySelector(".content .grid tbody tr, .content .texcell:not(.draft)")?.click()`);
    await app.sleep(200);
    const tabs = await app.eval<number>(`document.querySelectorAll(".content [role=tablist]:not(.edtabs) [role=tab]").length`);
    for (let k = 0; k < Math.max(1, tabs); k++) {
      if (k > 0) {
        await app.eval(`document.querySelectorAll(".content [role=tablist]:not(.edtabs) [role=tab]")[${k}].click()`);
        await app.sleep(200);
        await app.eval(`document.querySelector(".content .grid tbody tr")?.click()`);
        await app.sleep(150);
      }
      await measure(`section ${i + 1} tab ${k + 1}`);
    }
  }

  // Texture editor, the new element name step and the dialogs.
  await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
  await app.eval(`document.querySelector(".view [role=tab]").click()`);
  await app.waitFor(`document.querySelector(".texcell:not(.draft)")`);
  await app.click(".texcell:not(.draft)", undefined, { double: true });
  await app.waitFor(`document.querySelector(".ptools")`, 10000);
  await measure("texture editor");
  await home();
  await app.click(".view .actions .abtn.primary");
  await app.waitFor(`document.querySelector(".addpop .ptype:not(:disabled)")`);
  await app.eval(`document.querySelector(".addpop .ptype:not(:disabled)").click()`);
  await app.waitFor(`document.querySelector(".popform")`);
  await measure("new element name");
  await app.click(".popform .abtn:not(.primary)");
  await app.click(".view .actions .abtn.primary");
  await app.key("e", 2);
  await app.waitFor(`document.querySelector(".exportdlg")`);
  await measure("export dialog");
  await app.eval(`[...document.querySelectorAll(".exportdlg button")].find((b) => b.type === "button" && /Cancel|Close|İptal|Kapat|Vazgeç/.test(b.textContent))?.click()`);
  await app.sleep(200);
  await app.eval(`document.querySelectorAll(".menubar .menus .menu")[5].click()`);
  await app.eval(`[...document.querySelectorAll(".menulist [role=menuitem]")].find((b) => /Preferences|Tercihler/.test(b.textContent)).click()`);
  await app.waitFor(`document.querySelector(".prefsdialog")`);
  await measure("preferences");
  await app.shot(`design/123/preferences-${lang}-${theme}-${suffix}.png`);
  await app.key("Escape");

  const list = [...widths].map(([w, where]) => `${w}px (${where})`);
  console.log(`label widths: ${list.join(", ")}`);
  console.log(`cut labels: ${cut.size}${cut.size ? `\n  ${[...cut].slice(0, 30).join("\n  ")}` : ""}`);
  assert(widths.size <= 2, `at most two label widths: ${list.join(", ")}`);
  assert(cut.size === 0, `no label is cut (${cut.size})`);
}, { project, language: lang });
