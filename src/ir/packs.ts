import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newElement, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { writePng } from "../generator/png.ts";
import { loadProject, saveElement } from "./storage.ts";
import { armorLayer, MASKS, paintMask, type PackImage } from "./packTextures.ts";

/**
 * Pack wizards (KUYRUK 134, MCreator's ore/tool/armor/wood/material pack makers): one name and colour make a set of
 * elements with textures and recipes. A material item (ingot or gem) is the base of ore, tool, armor and material
 * packs; wood packs make a tree's blocks. Elements and textures that already exist are kept, never overwritten.
 */
export const PACK_KINDS = ["ore", "tool", "armor", "wood", "material"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export interface PackOptions {
  kind: PackKind;
  /** Display name, e.g. "Ruby". */
  name: string;
  /** Id base, e.g. "ruby"; derived from the name when left out. */
  id?: string;
  /** "#rrggbb" the textures are tinted with. */
  color: string;
  /** Material item look: an ingot or a gem. */
  look?: "ingot" | "gem";
}

export interface PackPlan {
  elements: { type: string; id: string; values: Record<string, unknown> }[];
  textures: { path: string; image: PackImage }[];
}

const ID = /^[a-z][a-z0-9_]*$/;
export const packId = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "p$1");

/** What a pack makes, without touching disk. */
export function planPack(options: PackOptions, modId: string): PackPlan {
  const id = options.id?.trim() || packId(options.name);
  if (!ID.test(id)) throw new Error(`"${id}" is not a valid id: lowercase letters, digits and _, starting with a letter`);
  const name = options.name.trim() || id;
  const color = options.color;
  const plan: PackPlan = { elements: [], textures: [] };
  const tex = (folder: string, file: string, mask: string) => {
    const path = `textures/${folder}/${file}.png`;
    plan.textures.push({ path, image: paintMask(MASKS[mask], color) });
    return path;
  };
  const add = (type: string, elementId: string, values: Record<string, unknown>) => plan.elements.push({ type, id: elementId, values });
  const crafting = (rid: string, result: string, slots: string[], count = 1, shapeless = false) =>
    add("recipe", rid, { recipeType: "Crafting", recipeSlots: slots, recipeReturnStack: result, recipeRetstackSize: count, recipeShapeless: shapeless });
  const kinds = options.kind === "material" ? (["ore", "tool", "armor"] as const) : [options.kind];
  const material = () => {
    if (plan.elements.some((e) => e.id === id)) return;
    add("item", id, { name, texture: tex("item", id, options.look ?? "ingot"), creativeTabs: ["MATERIALS"] });
  };

  for (const kind of kinds) {
    if (kind === "ore") {
      material();
      add("block", `${id}_ore`, {
        name: `${name} Ore`, texture: tex("block", `${id}_ore`, "ore"), hardness: 3, resistance: 3, destroyTool: "pickaxe", vanillaToolTier: "IRON", requiresCorrectTool: true,
        customDrop: id, dropAmount: 1, soundOnStep: "STONE", creativeTabs: ["BUILDING_BLOCKS"],
        generateFeature: true, blocksToReplace: [{ block: "minecraft:stone" }, { block: "minecraft:deepslate" }], generationShape: "TRIANGLE",
        frequencyPerChunks: 8, frequencyOnChunk: 7, minGenerateHeight: -48, maxGenerateHeight: 48,
      });
      add("block", `${id}_block`, {
        name: `Block of ${name}`, texture: tex("block", `${id}_block`, "block"), hardness: 5, resistance: 6, destroyTool: "pickaxe", vanillaToolTier: "IRON",
        requiresCorrectTool: true, soundOnStep: "METAL", creativeTabs: ["BUILDING_BLOCKS"],
      });
      add("recipe", `${id}_from_smelting`, { recipeType: "Smelting", smeltingInputStack: `${id}_ore`, smeltingReturnStack: id, xpReward: 0.7, cookingTime: 200 });
      crafting(`${id}_block_from_${id}`, `${id}_block`, Array(9).fill(id));
      crafting(`${id}_from_${id}_block`, id, [`${id}_block`, "", "", "", "", "", "", "", ""], 9, true);
    }
    if (kind === "tool") {
      material();
      const S = "minecraft:stick";
      const tools: [string, string, string, string[], Record<string, unknown>][] = [
        ["pickaxe", "Pickaxe", "pickaxe", [id, id, id, "", S, "", "", S, ""], { damageVsEntity: 3, attackSpeed: 1.2 }],
        ["axe", "Axe", "axe", [id, id, "", id, S, "", "", S, ""], { damageVsEntity: 8, attackSpeed: 0.9 }],
        ["sword", "Sword", "sword", ["", id, "", "", id, "", "", S, ""], { damageVsEntity: 6, attackSpeed: 1.6 }],
        ["shovel", "Shovel", "Spade", ["", id, "", "", S, "", "", S, ""], { damageVsEntity: 3.5, attackSpeed: 1 }],
        ["hoe", "Hoe", "Hoe", [id, id, "", "", S, "", "", S, ""], { damageVsEntity: 1, attackSpeed: 3 }],
      ];
      for (const [suffix, label, type, slots, extra] of tools) {
        const tid = `${id}_${suffix}`;
        add("tool", tid, {
          name: `${name} ${label}`, texture: tex("item", tid, suffix), toolType: type === "pickaxe" ? "Pickaxe" : type === "axe" ? "Axe" : type === "sword" ? "Sword" : type,
          blockDropsTier: "IRON", efficiency: 6, usageCount: 250, enchantability: 14, repairItems: [{ item: id }], creativeTabs: [type === "sword" ? "COMBAT" : "TOOLS"], ...extra,
        });
        crafting(tid, tid, slots);
      }
    }
    if (kind === "armor") {
      material();
      const layer = `textures/armor/${id}_layer_1.png`;
      plan.textures.push({ path: layer, image: armorLayer(color, 1) }, { path: `textures/armor/${id}_layer_2.png`, image: armorLayer(color, 2) });
      add("armor", `${id}_armor`, {
        armorTextureFile: layer, creativeTabs: ["COMBAT"], maxDamage: 15, enchantability: 12, repairItems: [{ item: id }],
        textureHelmet: tex("item", `${id}_helmet`, "helmet"), helmetName: `${name} Helmet`,
        textureBody: tex("item", `${id}_chestplate`, "chestplate"), bodyName: `${name} Chestplate`,
        textureLeggings: tex("item", `${id}_leggings`, "leggings"), leggingsName: `${name} Leggings`,
        textureBoots: tex("item", `${id}_boots`, "boots"), bootsName: `${name} Boots`,
      });
      // Armor pieces are items the armor element derives (<armor>_helmet, ...), named with the mod id since no element has that id.
      const piece = (p: string) => `${id}_armor_${p}`;
      crafting(piece("helmet"), `${modId}:${piece("helmet")}`, [id, id, id, id, "", id, "", "", ""]);
      crafting(piece("chestplate"), `${modId}:${piece("chestplate")}`, [id, "", id, id, id, id, id, id, id]);
      crafting(piece("leggings"), `${modId}:${piece("leggings")}`, [id, id, id, id, "", id, id, "", id]);
      crafting(piece("boots"), `${modId}:${piece("boots")}`, ["", "", "", id, "", id, id, "", id]);
    }
    if (kind === "wood") {
      const log = `${id}_log`, planks = `${id}_planks`;
      const wood = { hardness: 2, resistance: 3, destroyTool: "axe", soundOnStep: "WOOD", flammability: 5, fireSpreadSpeed: 5, material: "WOOD", creativeTabs: ["BUILDING_BLOCKS"] };
      const logTop = tex("block", `${log}_top`, "log_top");
      add("block", log, { name: `${name} Log`, texture: logTop, textureTop: logTop, textureFront: tex("block", log, "log"), textureLeft: `textures/block/${log}.png`,
        textureRight: `textures/block/${log}.png`, textureBack: `textures/block/${log}.png`, rotationMode: 5, ...wood });
      const p = tex("block", planks, "planks");
      add("block", planks, { name: `${name} Planks`, texture: p, ...wood });
      const based = (suffix: string, label: string, base: string, extra: Record<string, unknown> = {}) =>
        add("block", `${id}_${suffix}`, { name: `${name} ${label}`, texture: p, blockBase: base, ...wood, ...extra });
      based("stairs", "Stairs", "Stairs");
      based("slab", "Slab", "Slab");
      based("fence", "Fence", "Fence");
      based("fence_gate", "Fence Gate", "FenceGate");
      based("button", "Button", "Button", { blockSetType: "OAK", creativeTabs: ["REDSTONE"] });
      based("pressure_plate", "Pressure Plate", "PressurePlate", { blockSetType: "OAK", creativeTabs: ["REDSTONE"] });
      const S = "minecraft:stick", P = planks;
      crafting(`${planks}_from_log`, planks, [log, "", "", "", "", "", "", "", ""], 4, true);
      crafting(`${id}_stairs`, `${id}_stairs`, [P, "", "", P, P, "", P, P, P], 4);
      crafting(`${id}_slab`, `${id}_slab`, ["", "", "", "", "", "", P, P, P], 6);
      crafting(`${id}_fence`, `${id}_fence`, ["", "", "", P, S, P, P, S, P], 3);
      crafting(`${id}_fence_gate`, `${id}_fence_gate`, ["", "", "", S, P, S, S, P, S]);
      crafting(`${id}_button`, `${id}_button`, [P, "", "", "", "", "", "", "", ""], 1, true);
      crafting(`${id}_pressure_plate`, `${id}_pressure_plate`, ["", "", "", "", "", "", P, P, ""]);
    }
  }
  return plan;
}

/** What the dialog shows before making a pack: each element (and whether it exists) and each texture as a PNG. */
export interface PackPreview {
  elements: { type: string; id: string; exists: boolean }[];
  textures: { path: string; width: number; height: number; dataUrl: string; exists: boolean }[];
}

export function previewPack(dir: string, options: PackOptions): PackPreview {
  const project = loadProject(dir);
  const plan = planPack(options, project.mod.id);
  const has = (type: string, id: string) => Object.entries(project.elements).some(([t, list]) => (t === "recipe") === (type === "recipe") && list.some((e) => e.id === id));
  return {
    elements: plan.elements.map((e) => ({ type: e.type, id: e.id, exists: has(e.type, e.id) })),
    textures: plan.textures.map((x) => ({ path: x.path, width: x.image.width, height: x.image.height, dataUrl: `data:image/png;base64,${writePng(x.image).toString("base64")}`, exists: existsSync(join(dir, x.path)) })),
  };
}

export interface PackResult {
  /** "type/id" made, and textures written. */
  created: string[];
  textures: string[];
  /** "type/id" or texture paths that already existed and were kept. */
  kept: string[];
}

/** Writes a pack into the project: textures first, then elements (the type's defaults plus the pack's values). */
export function createPack(dir: string, options: PackOptions): PackResult {
  const project = loadProject(dir);
  const plan = planPack(options, project.mod.id);
  const registry = typeRegistry();
  const result: PackResult = { created: [], textures: [], kept: [] };
  for (const { path, image } of plan.textures) {
    const file = join(dir, path);
    if (existsSync(file)) { result.kept.push(path); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, writePng(image));
    result.textures.push(path);
  }
  for (const { type, id, values } of plan.elements) {
    const taken = Object.entries(project.elements).some(([t, list]) => (t === "recipe") === (type === "recipe") && list.some((e) => e.id === id));
    if (taken) { result.kept.push(`${type}/${id}`); continue; }
    const element: Element = { ...newElement(registry.byId.get(type)!, id), ...values, id };
    saveElement(dir, type, element);
    result.created.push(`${type}/${id}`);
  }
  return result;
}
