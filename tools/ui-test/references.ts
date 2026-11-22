/**
 * KUYRUK #31/#32: find usages and the unused filter (and, from #32, rename) in the element list. Since #151 it runs
 * on a fixed fixture instead of a copy of ETREconomy, whose counts change with its data: the example project plus
 * two procedures and a GUI nothing uses, and a procedure the ruby item calls. Screenshots go to design/references/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "procedure", "unused_tick");
addElement(project, "procedure", "unused_reward");
addElement(project, "gui", "unused_menu");
addElement(project, "procedure", "ruby_used");
const rubyFile = join(project, "elements", "items", "ruby.json");
writeFileSync(rubyFile, JSON.stringify({ ...JSON.parse(readFileSync(rubyFile, "utf8")), onRightClickedInAir: "ruby_used" }, null, 2) + "\n");
const UNUSED = ["unused_menu", "unused_reward", "unused_tick"];

const OUT = evidence("design/references");
const tileIds = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".tile:not(.foldertile) code")].map((c) => c.textContent)`);
const pick = (app: App, id: string) => app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector("code")?.textContent === ${JSON.stringify(id)})?.setAttribute("id", "target")`);

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 0`);

  // Unused filter: exactly the fixture's unused procedures and GUI; the procedure the ruby calls is not one of them.
  await app.click(".view .actions .abtn", "Unused");
  await app.waitFor(`document.querySelector("[data-testid=unused-note]")`, 15000);
  const note = await app.eval<string>(`document.querySelector("[data-testid=unused-note]").textContent`);
  assert(note.includes(String(UNUSED.length)), `unused note says ${UNUSED.length}: ${note}`);
  await app.waitFor(`document.querySelectorAll(".tile").length === ${UNUSED.length}`, 10000);
  const ids = (await tileIds(app)).sort();
  assert(ids.join() === UNUSED.join(), `the unused tiles are ${UNUSED.join(", ")}: ${ids.join(", ")}`);
  await app.shot(`${OUT}/unused.png`);

  // Usages of an unused procedure: nothing uses it.
  await pick(app, "unused_tick");
  await app.click("#target");
  await app.click("#target", undefined, { button: "right" }); // Usages lives in the right-click menu
  await app.click(".menulist.ctx button", "Usages");
  await app.waitFor(`document.querySelector("[data-testid=refs-none]")`, 10000);
  await app.shot(`${OUT}/unused-procedure.png`);
  await app.click(".refdialog .abtn", "Close");
  await app.click(".view .actions .abtn", "Unused");
  await app.waitFor(`!document.querySelector("[data-testid=unused-note]")`);

  // Usages of a block: the smelting recipe uses it through an item or block field.
  await app.setValue(".findbar .search input", "ruby_block");
  await app.waitFor(`document.querySelectorAll(".tile").length === 1`);
  await pick(app, "ruby_block");
  await app.click("#target");
  await app.click("#target", undefined, { button: "right" });
  await app.click(".menulist.ctx button", "Usages");
  await app.waitFor(`document.querySelectorAll(".refs li").length >= 1`, 10000);
  const rows = await app.eval<string[]>(`[...document.querySelectorAll(".refs li")].map((li) => li.textContent)`);
  assert(rows.some((r) => r.includes("Ruby from Smelting") && r.includes("item or block field")), `the recipe is listed as a user: ${rows.join(" | ")}`);
  await app.shot(`${OUT}/usages.png`);
  // A row opens its element.
  await app.click(".refdialog .linkbtn");
  await app.waitFor(`!document.querySelector(".refdialog")`);
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby from Smelting"`);
}, { project });
