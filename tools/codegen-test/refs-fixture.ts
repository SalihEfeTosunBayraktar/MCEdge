// A throwaway mod project with every reference form, and a fingerprint of a project folder. Shared by the references checks.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addElement } from "../ui-test/fixtures.ts";

const START = { block: "start" };
const program = (...blocks: object[]) => ({ format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [START, ...blocks] }] });
const widget = (extra: Record<string, unknown>) => ({ kind: "button", x: 0, y: 0, ...extra });

export function buildRefsProject(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "refmod", name: "Ref", version: "1.0.0", package: "refmod", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }));
  addElement(dir, "procedure", "p_main", {
    program: program(
      { block: "call_procedure", fields: { procedure: "p_helper" } },
      { block: "gui_open", fields: { gui: "shop" }, inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } } } },
      { block: "player_has_item", fields: { item: "refmod:gem_item" } },
      { block: "java_code", fields: { code: 'PHelperProcedure.execute(world); String s = "refmod:gem_item"; // GemBlockRenderer is unrelated', deps: "", imports: "", gen: "1.16.5" } },
      { block: "text_literal_probe", inputs: { value: "refmod:ruby_block" } },
    ),
    globalTrigger: "mod_load",
  });
  addElement(dir, "procedure", "p_helper", { program: program({ block: "call_procedure", fields: { procedure: "p_helper" } }) });
  addElement(dir, "procedure", "p_unused", { program: program() });
  addElement(dir, "procedure", "p_cond", { program: program() });
  addElement(dir, "procedure", "p_chain_a", { program: program({ block: "call_procedure", fields: { procedure: "p_chain_b" } }) });
  addElement(dir, "procedure", "p_chain_b", { program: program() });
  addElement(dir, "gui", "shop", { components: [widget({ procedure: "p_helper", name: "buy" }), widget({ kind: "label", textProcedure: "p_cond" }), widget({ kind: "slot", id: 0, limit: "gem_item" })] });
  addElement(dir, "block", "ruby_block", { guiBoundTo: "shop", onRightClicked: "p_helper", texture: "textures/blocks/ruby_block.png" });
  addElement(dir, "block", "other_block", { texture: "textures/blocks/ruby_block.png" });
  addElement(dir, "block", "gem_block", { texture: "textures/blocks/gem_block.png", luminanceProcedure: "p_cond" });
  addElement(dir, "item", "gem_item", { texture: "textures/items/gem_item.png" });
  addElement(dir, "recipe", "gem_item", { recipeSlots: ["", "gem_block", "", "", "refmod:gem_item", "", "", "", ""], recipeReturnStack: "gem_item" });
  mkdirSync(join(dir, "textures/blocks"), { recursive: true });
  mkdirSync(join(dir, "textures/items"), { recursive: true });
  for (const p of ["textures/blocks/ruby_block.png", "textures/blocks/gem_block.png", "textures/items/gem_item.png"]) writeFileSync(join(dir, p), "png");
  writeFileSync(join(dir, "textures/blocks/gem_block.png.mcmeta"), "{}");
  writeFileSync(join(dir, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "refmod:gems", entries: ["gem_item", "refmod:gem_block", "minecraft:diamond", "#c:gems"] }] }));
  mkdirSync(join(dir, "datapack/refmod/tags/items"), { recursive: true });
  writeFileSync(join(dir, "datapack/refmod/tags/items/money.json"), JSON.stringify({ values: ["refmod:gem_item", "refmod:ruby_block", "minecraft:gold_ingot"] }));
  mkdirSync(join(dir, "localization"), { recursive: true });
  for (const lang of ["en_us", "tr_tr"]) {
    writeFileSync(join(dir, "localization", `${lang}.json`), JSON.stringify({ "item.refmod.gem_item": "Gem", "gui.refmod.shop.buy": "Buy", "gui.refmod.shop.title": "Shop", "block.refmod.gem_block": "Gem block", "item.refmod.gem_item_other": "keep", "plain": "x" }));
  }
  writeFileSync(join(dir, "folders.json"), JSON.stringify({ folders: ["Econ"], placement: { "item/gem_item": "Econ", "gui/shop": "Econ" } }));
}

/** Path and content digest of every file, to tell a project that changed from one that did not. */
export function fingerprint(dir: string): string {
  const lines: string[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      if (name === ".mcedge") continue; // the MCP server logs its calls here
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else lines.push(`${path.slice(dir.length)} ${createHash("sha1").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(dir);
  return lines.join("\n");
}
