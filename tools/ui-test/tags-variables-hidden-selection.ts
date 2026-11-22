/**
 * KUYRUK #147: in Element tags and Variables, a selected row that the filter or the search hides is no longer
 * selected (the side panel empties, Delete selected is off) and stays unselected when they are cleared (same rule as
 * #112/#142); renaming the selected row in the panel keeps it; New while a filter or search is set still shows the new
 * row (it takes the filtered type or scope, a search it does not match is cleared). Screenshots go to design/147/.
 *   node tools/ui-test/tags-variables-hidden-selection.ts [before|after]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/147");
const suffix = process.argv[2] ?? "after";
// The "before" run records failed checks and fails at the end, so its screenshots are taken too.
const failed: string[] = [];
const check = (ok: unknown, message: string) => (suffix === "before" ? ok || failed.push(message) : assert(ok, message));

const setup = await connect(project);
await setup.call("set_tag", { type: "item", id: "gems", entries: ["ruby"] });
await setup.call("set_tag", { type: "block", id: "ores", entries: ["ruby_block"] });
await setup.call("set_variables", { variables: [
  { name: "mana", type: "number", scope: "player_persistent", initial: "20" },
  { name: "coins", type: "number", scope: "global_world", initial: "0" },
] });
await setup.close();

const deleteOn = (app: App) => app.eval<boolean>(`!![...document.querySelectorAll(".actions .abtn")].find((b) => b.textContent.includes("Delete selected") && !b.disabled)`);
// Q284: the selection is edited in the inspector; with none selected it shows only its hints.
const panelEmpty = (app: App) => app.eval<boolean>(`!!document.querySelector(".tagsinsp .dk-sec .hint") && !document.querySelector(".tagsinsp .form")`);
const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".grid tbody tr")].map((r) => r.textContent)`);
const pickRow = (app: App, text: string) => app.eval(`[...document.querySelectorAll(".grid tbody tr")].find((r) => r.textContent.includes(${JSON.stringify(text)}))?.click()`);
const settle = async (app: App) => {
  await app.sleep(600);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};

await run(async (app) => {
  // ---- Element tags ----
  await app.click(".rtab", "Element tags");
  await app.waitFor(`document.querySelectorAll(".grid tbody tr").length === 2`);
  await pickRow(app, "gems");
  check(await deleteOn(app) && !(await panelEmpty(app)), "tags: a selected tag can be deleted and is in the panel");
  // The search hides it.
  await app.setValue(".findbar .search input", "ores");
  await app.sleep(300);
  check(!(await deleteOn(app)) && await panelEmpty(app), "tags: the search hides the selection, Delete selected is off");
  await app.shot(`${OUT}/147-tags-hidden-dark-${suffix}.png`);
  await app.setValue(".findbar .search input", "");
  await app.sleep(300);
  check(!(await deleteOn(app)), "tags: it stays unselected when the search is cleared");
  // The type filter hides it.
  await pickRow(app, "gems");
  await app.setValue(".findbar .fsel select", "block");
  await app.sleep(300);
  check(!(await deleteOn(app)) && await panelEmpty(app), "tags: the type filter hides the selection");
  // Delete selected cannot remove the hidden one: nothing selected, both tags kept.
  check(JSON.parse(readFileSync(join(project, "tags.json"), "utf8")).tags.length === 2, "tags: both tags are kept");
  // New while filtered by Blocks and searching "ores": the new tag is a block tag and the search is cleared.
  await app.setValue(".findbar .search input", "ores");
  await app.click(".abtn", "New tag");
  await app.sleep(300);
  const tagRows = await rows(app);
  check(tagRows.some((r) => r.includes("tag_1")) && !(await panelEmpty(app)), `tags: the new tag is listed and selected: ${tagRows.join(" | ")}`);
  check((await app.eval<string>(`document.querySelector(".findbar .search input").value`)) === "", "tags: the search it did not match is cleared");
  // Renaming the selected tag in the panel keeps it selected even if the filter would hide it later.
  await app.setValue(".findbar .search input", "tag");
  await app.setField("Tag", "hellomcedge:metal", ".tagform");
  await app.sleep(300);
  check(!(await panelEmpty(app)), "tags: editing the id of the selected tag keeps it in the panel");
  await settle(app);

  // ---- Variables ----
  await app.click(".rtab", "Variables");
  await app.waitFor(`document.querySelectorAll(".grid tbody tr").length === 2`);
  await pickRow(app, "mana");
  check(await deleteOn(app), "variables: a selected variable can be deleted");
  await app.setValue(".findbar .search input", "coins");
  await app.sleep(300);
  check(!(await deleteOn(app)) && await panelEmpty(app), "variables: the search hides the selection");
  await app.shot(`${OUT}/147-variables-hidden-dark-${suffix}.png`);
  await app.setValue(".findbar .search input", "");
  await app.sleep(300);
  check(!(await deleteOn(app)), "variables: it stays unselected when the search is cleared");
  await pickRow(app, "mana");
  await app.setValue(".findbar .fsel select", "global_world");
  await app.sleep(300);
  check(!(await deleteOn(app)), "variables: the scope filter hides the selection");
  // New while filtered to Global (world) and searching "coins": a world variable, the search cleared.
  await app.setValue(".findbar .search input", "coins");
  await app.click(".abtn", "New variable");
  await app.sleep(300);
  const varRows = await rows(app);
  check(varRows.length === 2 && !(await panelEmpty(app)), `variables: the new variable is listed and selected: ${varRows.join(" | ")}`);
  await settle(app);
  const saved = JSON.parse(readFileSync(join(project, "variables.json"), "utf8")).variables as { name: string; scope: string }[];
  check(saved.length === 3 && saved.some((v) => v.name === "mana") && saved.at(-1)!.scope === "global_world", `variables: mana kept, the new one is a world variable: ${JSON.stringify(saved)}`);
  await app.setTheme("light");
  await app.shot(`${OUT}/147-variables-new-light-${suffix}.png`);
  if (failed.length) throw new Error(`failed checks:\n${failed.join("\n")}`);
}, { project });
