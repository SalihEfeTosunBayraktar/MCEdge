/**
 * KUYRUK 137 (audit U15): command buttons come in at most three heights (the size tokens in styles.css: toolbar,
 * inline and small). Walks the main screens of a copy of examples/hello (element list, item, recipe, GUI and procedure
 * editors, texture editor, Resources, Localization, Workspace settings, dialogs) and measures every visible command
 * button: anything that is a <button> but not a row, tile, tab, menu item, rail entry or pop-up cell. Prints the heights
 * with an example of each; fails with more than three. Args: "report" only prints.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "gui", "shop", { type: 1, width: 176, height: 166, components: [{ kind: "button", x: 10, y: 10, width: 60, height: 20, text: "Buy" }] });
addElement(project, "procedure", "main");
const reportOnly = process.argv[2] === "report";

/** Rows, tiles, tabs and menu entries are not command buttons; their height follows their content. */
const NOT_COMMANDS = "[role=option], [role=menuitem], [role=tab], .tile, .rtab, .rtoggle, .menubar .menu, .texcell, .lrow, .quickrow, .torow, .procrow, .ptype, .linkbtn, .slot, .rslot, .colgrip, .gwidget, .blocklyWidgetDiv button, .blocklyToolboxDiv button, .etclose, .tofold, .swatch, .pswatch, .crumb button";
const MEASURE = `(() => {
  const out = {};
  for (const b of document.querySelectorAll("button")) {
    if (!b.offsetParent || b.closest(${JSON.stringify(NOT_COMMANDS)}) || b.matches(${JSON.stringify(NOT_COMMANDS)})) continue;
    const r = b.getBoundingClientRect();
    if (r.height < 4) continue;
    const h = Math.round(r.height);
    (out[h] ??= []).push((b.className || b.parentElement.className || "?").toString().trim().split(/\\s+/).slice(0, 2).join(".") + ":" + (b.textContent.trim().slice(0, 14) || b.title || b.getAttribute("aria-label") || ""));
  }
  return out;
})()`;

const seen: Record<number, Set<string>> = {};
async function measure(app: App, screen: string) {
  await app.sleep(300);
  const found = await app.eval<Record<string, string[]>>(MEASURE);
  for (const [h, list] of Object.entries(found)) for (const b of list) (seen[Number(h)] ??= new Set()).add(`${screen} ${b}`);
}
const home = async (app: App) => {
  await app.key("Escape");
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
};
const openTile = async (app: App, id: string) => {
  await home(app);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.querySelector("code")?.textContent === ${JSON.stringify(id)}).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(800);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
  await measure(app, "elements");
  for (const id of ["ruby", "ruby_pickaxe", "ruby_block", "shop", "main", "ruby_tab"]) {
    await openTile(app, id);
    await measure(app, `editor:${id}`);
  }
  for (const [i, name] of [[1, "resources"], [4, "localization"], [6, "settings"], [2, "tags"], [3, "variables"], [5, "git"]] as const) {
    await app.key("Escape");
    await app.eval(`document.querySelectorAll(".rail .rtab")[${i}].click()`);
    await app.sleep(600);
    await measure(app, name);
  }
  await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
  await app.waitFor(`document.querySelector(".texcell:not(.draft)")`);
  await app.click(".texcell:not(.draft)", undefined, { double: true });
  await app.waitFor(`document.querySelector(".ptools")`, 10000);
  await measure(app, "texture-editor");
  await home(app);
  await app.click(".view .actions .abtn.primary");
  await app.waitFor(`document.querySelector(".addpop")`);
  await measure(app, "new-popup");
  await app.click(".view .actions .abtn.primary");
  await app.key("e", 2);
  await app.waitFor(`document.querySelector(".dialog")`);
  await measure(app, "export-dialog");
  await app.key("Escape");

  const heights = Object.keys(seen).map(Number).sort((a, b) => a - b);
  for (const h of heights) console.log(`${h}px (${seen[h].size}): ${[...seen[h]].slice(0, 6).join(" | ")}`);
  if (!reportOnly) assert(heights.length <= 3, `command buttons in ${heights.length} heights: ${heights.join(", ")}`);
}, { project });
