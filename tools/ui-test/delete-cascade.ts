/**
 * Q220: deleting an element in the app lists what only that element used, with checkboxes that start off. On a copy of
 * examples/hello with the item "gem" (tools/mcp-test/cascade-fixture.ts): Cancel deletes nothing; the dialog lists the
 * exclusive procedures, GUI, recipe, texture, model and translation keys and not what ruby shares; the ticked ones are deleted
 * with the element and their folder entries, the unticked stay. Screenshots (dark, light) go to design/220/.
 *   node tools/ui-test/delete-cascade.ts [en|tr]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { buildCascadeFixture } from "../mcp-test/cascade-fixture.ts";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const language = process.argv[2] === "tr" ? "tr" : "en";
const s: Record<string, string> = language === "tr" ? tr : en;
const project = exampleProject();
buildCascadeFixture(project);
const OUT = "design/220";
mkdirSync(join(REPO, OUT), { recursive: true });
const json = (file: string) => JSON.parse(readFileSync(join(project, file), "utf8"));
const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll("[data-testid=delete-dependents] label[data-key]")].map((l) => l.dataset.key)`);
const ticks = (app: App) => app.eval<boolean[]>(`[...document.querySelectorAll("[data-testid=delete-dependents] input[type=checkbox]")].map((i) => i.checked)`);
const tick = (app: App, key: string) => app.eval(`document.querySelector('[data-testid=delete-dependents] label[data-key="${key}"] input').click()`);
/** The theme button sits behind the dialog's backdrop, so it is clicked in the page. */
const theme = async (app: App, to: string) => {
  await app.eval(`document.documentElement.dataset.theme !== "${to}" && document.querySelector(".themebtn").click()`);
  await app.waitFor(`document.documentElement.dataset.theme === "${to}"`);
};
const openDialog = async (app: App) => {
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector("code")?.textContent === "gem")?.setAttribute("id", "target")`);
  await app.click("#target");
  await app.click(".view .actions .abtn", s["action.deleteSelected"]);
  await app.waitFor(`document.querySelector("[data-testid=delete-dependents]")`, 20000);
};

await run(async (app) => {
  await app.click(".rtab", s["section.elements"]);
  await app.waitFor(`document.querySelectorAll(".tile").length > 0`);
  await app.click(".foldertile", "Gems", { double: true }); // the fixture's element folder
  await app.waitFor(`[...document.querySelectorAll(".tile code")].some((c) => c.textContent === "gem")`);

  // Cancel: the dialog lists the dependents, all unticked; nothing is deleted.
  await openDialog(app);
  const listed = await rows(app);
  for (const key of ["procedure/gem_use", "procedure/gem_helper", "gui/gem_menu", "recipe/gem_recipe", "textures/gem.png", "models/gem_model.json", "gem.msg", "gui.hellomcedge.gem_menu", "item.hellomcedge.gem"]) assert(listed.includes(key), `listed: ${key} in ${listed.join(", ")}`);
  for (const key of ["procedure/shared_fx", "textures/ruby.png", "shared.msg"]) assert(!listed.includes(key), `not listed: ${key} (ruby shares it)`);
  assert((await ticks(app)).every((on) => !on), "every checkbox starts off");
  await app.click(".dialog .abtn", s["dialog.cancel"]);
  await app.waitFor(`!document.querySelector(".dialog")`);
  assert(existsSync(join(project, "elements/items/gem.json")) && existsSync(join(project, "elements/procedures/gem_use.json")), "Cancel deletes nothing");

  // Tick two of them and delete: only those go, with the folder entries.
  await openDialog(app);
  await tick(app, "procedure/gem_use");
  await tick(app, "gem.msg");
  await tick(app, "textures/gem.png");
  assert((await ticks(app)).filter(Boolean).length === 3, "three boxes ticked");
  await app.shot(`${OUT}/dialog-${language}-dark.png`);
  await theme(app, "light");
  await app.shot(`${OUT}/dialog-${language}-light.png`);
  await theme(app, "dark");
  await app.click(".dialog .abtn.danger", s["action.delete"]);
  await app.waitFor(`!document.querySelector(".dialog")`, 15000);
  await app.sleep(500);
  for (const gone of ["elements/items/gem.json", "elements/procedures/gem_use.json", "textures/gem.png"]) assert(!existsSync(join(project, gone)), `${gone} deleted`);
  for (const kept of ["elements/procedures/gem_helper.json", "elements/guis/gem_menu.json", "elements/recipes/gem_recipe.json", "elements/procedures/shared_fx.json", "textures/ruby.png", "models/gem_model.json"]) assert(existsSync(join(project, kept)), `${kept} stays`);
  assert(!("gem.msg" in json("localization/en_us.json")) && "item.hellomcedge.gem" in json("localization/en_us.json"), "the ticked key went, the unticked stays");
  const placement = json("folders.json").placement;
  assert(!("item/gem" in placement) && !("procedure/gem_use" in placement) && placement["gui/gem_menu"] === "Gems", `element folder entries: ${JSON.stringify(placement)}`);
  assert(!("textures/gem.png" in json("texture-folders.json").placement) && json("texture-folders.json").resources.models.placement["models/gem_model.json"] === "Art", "texture folder entry went, the model's stays");
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".tile code")].some((c) => c.textContent === "gem")`)), "the tile is gone");
}, { project, language, theme: "dark" });
