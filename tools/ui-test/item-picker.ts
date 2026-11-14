/**
 * KUYRUK 127: item, block and entity fields and the recipe grid open a searchable icon picker (this mod, Minecraft,
 * tags) and show the icon and the name. Runs on a copy of examples/hello: a crafting recipe (vanilla pick, tag, None,
 * a typed id of another mod, Escape) and a creative tab's icon (this mod's block). Vanilla names and icons come from a
 * client jar Gradle downloaded; the test checks them when this machine has one for the engine (Fabric 1.21.5).
 * Args: theme (dark/light), language (en/tr). Screenshots go to design/127/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vanillaCatalog } from "../../src/resources/vanillaAssets.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const project = exampleProject();
const read = (path: string) => JSON.parse(readFileSync(join(project, "elements", path), "utf8"));
const catalog = vanillaCatalog("item", "1.21.5", lang === "tr" ? "tr_tr" : "en_us");
const withJar = !!catalog.jar;
const shot = (app: App, name: string) => app.shot(`design/127/${name}-${theme}-${lang}-after.png`);

const openTile = async (app: App, id: string) => {
  await app.key("Escape");
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.querySelector("code")?.textContent === ${JSON.stringify(id)})?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(500);
};
const slot = (n: number) => `document.querySelectorAll("[data-field=recipeSlots] .rslot")[${n}]`;
const popOpen = `document.querySelector(".regpop")`;
const search = async (app: App, text: string) => {
  await app.setValue(".regpop .regsearch input", text);
  await app.sleep(150);
};
const tab = (app: App, index: number) => app.eval(`document.querySelectorAll(".regpop [role=tab]")[${index}].click()`);
const cell = (value: string) => `[...document.querySelectorAll(".regpop .texcell")].find((c) => c.dataset.value === ${JSON.stringify(value)})`;
const saved = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 40 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
  assert(check(), what);
};

await run(async (app) => {
  await app.setTheme(theme);

  // 1. The recipe grid is nine inventory slots with icons; the stick shows its game name and picture.
  await openTile(app, "ruby_pickaxe");
  assert(await app.eval<number>(`document.querySelectorAll("[data-field=recipeSlots] .rslot").length`) === 9, "nine slots");
  assert(!(await app.eval<boolean>(`!!document.querySelector("[data-field=recipeSlots] input")`)), "no free-text slot left");
  assert(await app.eval<boolean>(`!!${slot(0)}.querySelector("img")`), "slot 1 (ruby) shows the mod texture");
  if (withJar) {
    await app.waitFor(`${slot(4)}.querySelector(".regicon")?.style.backgroundImage.startsWith("url(")`);
    const title = await app.eval<string>(`${slot(4)}.title`);
    assert(title.startsWith(catalog.names["minecraft:stick"]), `stick slot named after the game: ${title}`);
  }

  // 2. An empty slot opens the picker: sources with counts, search, a vanilla pick is saved.
  await app.eval(`${slot(3)}.click()`);
  await app.waitFor(popOpen);
  assert(await app.eval<boolean>(`document.activeElement === document.querySelector(".regpop .regsearch input")`), "the search has the focus");
  const tabs = await app.eval<string[]>(`[...document.querySelectorAll(".regpop [role=tab]")].map((b) => b.textContent)`);
  assert(tabs.length === 4, `All, This mod, Minecraft, Tags: ${tabs.join("|")}`);
  await search(app, "diamond");
  await app.waitFor(cell("minecraft:diamond"));
  if (withJar) await app.waitFor(`${cell("minecraft:diamond")}.querySelector(".regicon")?.style.backgroundImage.startsWith("url(")`);
  await shot(app, "recipe-picker");
  await app.eval(`${cell("minecraft:diamond")}.click()`);
  await app.waitFor(`!${popOpen}`);
  await saved(() => read("recipes/ruby_pickaxe.json").recipeSlots[3] === "minecraft:diamond", "slot 4 saved as minecraft:diamond");

  // 3. Tags: the Tags source lists item tags; a tag is saved with its #.
  await app.eval(`${slot(6)}.click()`);
  await app.waitFor(popOpen);
  await tab(app, 3);
  await app.sleep(100);
  const sources = await app.eval<string[]>(`[...document.querySelectorAll(".regpop .regcells .texcell[data-value]")].map((c) => c.dataset.value)`);
  assert(sources.length > 0 && sources.every((v) => v.startsWith("#")), `Tags shows only tags: ${sources.slice(0, 5).join(", ")}`);
  await app.eval(`${cell("#minecraft:planks")}.click()`);
  await saved(() => read("recipes/ruby_pickaxe.json").recipeSlots[6] === "#minecraft:planks", "slot 7 saved as #minecraft:planks");

  // 4. None empties a slot; a typed id of another mod is kept and marked; Escape closes only the picker.
  await app.eval(`${slot(3)}.click()`);
  await app.waitFor(popOpen);
  await app.eval(`[...document.querySelectorAll(".regpop .texcell")][0].click()`);
  await saved(() => read("recipes/ruby_pickaxe.json").recipeSlots[3] === "", "None empties slot 4");
  await app.eval(`${slot(8)}.click()`);
  await app.waitFor(popOpen);
  await search(app, "othermod:gem");
  assert(await app.eval<boolean>(`!!document.querySelector(".regpop .texcell.typed")`), "a full id that is in no list can be used");
  await app.key("Enter");
  await saved(() => read("recipes/ruby_pickaxe.json").recipeSlots[8] === "othermod:gem", "typed id saved");
  assert(await app.eval<boolean>(`${slot(8)}.classList.contains("unknown")`), "an id outside the lists is marked");
  await app.eval(`${slot(0)}.click()`);
  await app.waitFor(popOpen);
  await app.key("Escape");
  await app.waitFor(`!${popOpen}`);
  assert(await app.eval<boolean>(`!!document.querySelector(".edhead")`), "Escape closed the picker, not the editor");
  await app.eval(`document.querySelector("[data-field=recipeSlots]").scrollIntoView({ block: "center" })`);
  await shot(app, "recipe");

  // 5. Creative tab icon: the field shows the item's texture and name; This mod lists the mod's items and blocks.
  await openTile(app, "ruby_tab");
  const field = `document.querySelector("[data-field=icon] .regpicked")`;
  const ruby = await app.eval<string>(`${field}.textContent`);
  assert(ruby.includes("ruby") && (await app.eval<boolean>(`!!${field}.querySelector("img")`)), `icon field shows the ruby texture and name: ${ruby}`);
  await app.eval(`${field}.click()`);
  await app.waitFor(popOpen);
  await tab(app, 1);
  await app.sleep(100);
  const mod = await app.eval<string[]>(`[...document.querySelectorAll(".regpop .texcell[data-value]")].map((c) => c.dataset.value)`);
  assert(mod.includes("ruby_block") && mod.includes("ruby") && mod.every((v) => !v.includes(":")), `This mod: ${mod.join(", ")}`);
  assert((await app.eval<number>(`document.querySelectorAll(".regpop [role=tab]").length`)) === 3, "no Tags source where the field takes no tags");
  await shot(app, "creative-tab-picker");
  await app.eval(`${cell("ruby_block")}.click()`);
  await saved(() => read("creative_tabs/ruby_tab.json").icon === "ruby_block", "tab icon saved as ruby_block");
  await app.waitFor(`${field}.dataset.value === "ruby_block"`);
  await shot(app, "creative-tab");
  console.log(`item picker OK (${theme}, ${lang}, ${withJar ? `names and icons from ${catalog.jar}` : "no client jar: bundled ids"})`);
}, { project, theme, language: lang });
