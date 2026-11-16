/**
 * Q220/Q222 fixture on a copy of examples/hello: an item "gem" with what only it uses (procedures gem_use and gem_helper, a GUI,
 * a recipe that makes it, a texture, a model, three translation keys, folder entries) and what it shares with the ruby item (the procedure
 * shared_fx, the texture textures/ruby.png, the key shared.msg). Also two translation keys nothing uses and one the engine needs.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addElement } from "../ui-test/fixtures.ts";

const program = (...blocks: object[]) => ({ format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, ...blocks] }] });
const say = (key: string) => ({ block: "player_message_translated", inputs: { key } });

export function buildCascadeFixture(project: string): void {
  copyFileSync(join(project, "textures/ruby.png"), join(project, "textures/gem.png"));
  mkdirSync(join(project, "models"), { recursive: true });
  writeFileSync(join(project, "models/gem_model.json"), '{"elements": []}');
  addElement(project, "procedure", "gem_use", { program: program({ block: "call_procedure", fields: { procedure: "gem_helper" } }, say("gem.msg"), say("shared.msg")) });
  addElement(project, "procedure", "gem_helper", { program: program() });
  addElement(project, "procedure", "shared_fx", { program: program(say("shared.msg")) });
  addElement(project, "gui", "gem_menu", { title: "Gem menu" });
  addElement(project, "item", "gem", {
    name: "Gem", model: "gem_model", texture: "textures/gem.png", guiTexture: "textures/ruby.png", onRightClickedInAir: "gem_use", onRightClickedOnBlock: "shared_fx", guiBoundTo: "gem_menu",
  });
  addElement(project, "recipe", "gem_recipe", { recipeType: "Smelting", smeltingInputStack: "ruby", smeltingReturnStack: "gem" });
  // The ruby item shares the procedure and the texture.
  const rubyFile = join(project, "elements/items/ruby.json");
  writeFileSync(rubyFile, JSON.stringify({ ...JSON.parse(readFileSync(rubyFile, "utf8")), onRightClickedInAir: "shared_fx" }, null, 2) + "\n");
  writeFileSync(join(project, "sound_events.json"), JSON.stringify({ chime: { category: "block", subtitle: true, files: ["chime"] } }, null, 2) + "\n");
  const texts = {
    "item.hellomcedge.gem": "Gem", "gui.hellomcedge.gem_menu": "Gem menu", "gem.msg": "You found a gem", "shared.msg": "Shared text",
    // Nothing uses the first two; the engine needs the others by name (a sound subtitle, a key binding category, a vanilla text).
    "old.removed_block": "Leftover", "item.hellomcedge.long_gone": "Gone",
    "subtitles.hellomcedge.chime": "Chime", "key.categories.hellomcedge": "Hello keys", "item.minecraft.diamond": "Shiny diamond",
  };
  mkdirSync(join(project, "localization"), { recursive: true });
  writeFileSync(join(project, "localization/en_us.json"), JSON.stringify({ "item.hellomcedge.ruby": "Shiny Ruby", ...texts }, null, 2) + "\n");
  writeFileSync(join(project, "localization/tr_tr.json"), JSON.stringify({ "item.hellomcedge.gem": "Mücevher", "gem.msg": "Mücevher buldun", "old.removed_block": "Artık", "item.hellomcedge.ruby": "Yakut" }, null, 2) + "\n");
  writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Gems"], placement: { "item/gem": "Gems", "procedure/gem_use": "Gems", "gui/gem_menu": "Gems", "item/ruby": "Gems" } }, null, 2) + "\n");
  writeFileSync(join(project, "texture-folders.json"), JSON.stringify({ folders: ["Art"], placement: { "textures/gem.png": "Art", "textures/ruby.png": "Art" }, resources: { models: { folders: ["Art"], placement: { "models/gem_model.json": "Art" } } } }, null, 2) + "\n");
}
