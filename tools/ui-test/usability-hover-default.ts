/**
 * KUYRUK #76: a textured button's hover texture follows the normal texture while it is still the default (the same
 * file): picking the normal texture sets both, or <name>_hover.png when the project has it. A hover texture chosen on
 * purpose is not overwritten. Screenshots go to design/usability/.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
copyFileSync(join(project, "textures/ruby_block.png"), join(project, "textures/ruby_apple_hover.png"));
addElement(project, "gui", "shop", { type: 0, width: 176, height: 166 });
const saved = () => JSON.parse(readFileSync(join(project, "elements/guis/shop.json"), "utf8")).components as Record<string, string>[];
const settle = async (app: App) => (await app.sleep(600), await app.waitFor(`!document.querySelector(".smsg.saving")`));
const pick = async (app: App, label: string, texture: string) => {
  await app.eval(`document.getElementById("pk")?.removeAttribute("id"); [...document.querySelectorAll(".efrow")].find((r) => r.querySelector("label").textContent === ${JSON.stringify(label)}).querySelector(".texpicked").id = "pk"`);
  await app.click("#pk");
  await app.eval(`[...document.querySelectorAll(".texpop .texcell")].find((c) => c.textContent.trim() === ${JSON.stringify(texture)}).id = "pc"`);
  await app.click("#pc");
  await settle(app);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "shop", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", "Textured button");
  await settle(app);
  const first = saved()[0];
  assert(first.image === first.hoverImage, `a new button starts with one texture for both: ${first.image}, ${first.hoverImage}`);

  // Normal texture picked while hover is still the default: hover follows (to ruby_pickaxe: no _hover file).
  await pick(app, "Normal texture", "ruby_pickaxe");
  let w = saved()[0];
  assert(w.image === "textures/ruby_pickaxe.png" && w.hoverImage === "textures/ruby_pickaxe.png", `hover follows: ${w.image}, ${w.hoverImage}`);

  // A <name>_hover.png in the project is picked up.
  await pick(app, "Normal texture", "ruby_apple");
  w = saved()[0];
  assert(w.image === "textures/ruby_apple.png" && w.hoverImage === "textures/ruby_apple_hover.png", `<name>_hover used: ${w.image}, ${w.hoverImage}`);
  await app.shot(`${OUT}/after-hover-default.png`);

  // A hover texture picked on purpose stays when the normal one changes.
  await pick(app, "Hover texture", "ruby_block");
  await pick(app, "Normal texture", "ruby_pickaxe");
  w = saved()[0];
  assert(w.image === "textures/ruby_pickaxe.png" && w.hoverImage === "textures/ruby_block.png", `chosen hover kept: ${w.image}, ${w.hoverImage}`);
}, { project });
