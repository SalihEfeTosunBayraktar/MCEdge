import type { Element } from "../elements/model.ts";
import {
  attributeMethod1165, attributeModifiersExpr, idExpr, ingredientExpr, itemExpr, itemPkg, jstr, list, qualify, str, tooltipMethod,
  type Modifier,
} from "./java.ts";
import { customModel } from "./models.ts";
import type { GenEnv, TagEntry } from "./typeModule.ts";

/**
 * Behaviour item-like elements (items, tools, armor pieces) share: Item.Properties calls, overridden methods and
 * the tags they need. `props` are appended to the Properties chain; `members` go into the item class.
 */
export interface ItemTraits {
  props: string[];
  members: string[];
  tags: TagEntry[];
}

export interface TraitInput {
  /** Registry name of the item (an armor piece: "<armor>_helmet"). */
  id: string;
  rarity?: unknown;
  immuneToFire?: unknown;
  glow?: unknown;
  tooltip?: unknown;
  enchantability?: number;
  /** Repair ingredients; with `durability` > 0 they become a repair tag (1.21+) or isValidRepairItem (1.16.5). */
  repairItems?: string[];
  durability?: number;
  stayInGrid?: unknown;
  damageOnCrafting?: unknown;
  recipeRemainder?: string;
  modifiers?: Modifier[];
  /** Tools and armor already declare durability and repair through their material. */
  materialHandled?: boolean;
}

export function itemTraits(env: GenEnv, input: TraitInput): ItemTraits {
  const props: string[] = [];
  const members: string[] = [];
  const tags: TagEntry[] = [];
  const pkg = itemPkg(env);
  const stack = `${pkg}.ItemStack`;

  if (input.rarity && input.rarity !== "COMMON") props.push(`.rarity(${pkg}.Rarity.${str(input.rarity)})`);
  if (input.immuneToFire === true) props.push(".fireResistant()");
  if (input.glow === true) members.push(override(`public boolean isFoil(${stack} stack)`, "return true;"));
  const tooltip = tooltipMethod(env, str(input.tooltip), "item");
  if (tooltip) members.push(tooltip);

  if (!input.materialHandled) {
    const durability = input.durability ?? 0;
    if (durability > 0) props.push(`.durability(${durability})`);
    const repairs = (input.repairItems ?? []).filter(Boolean);
    if (durability > 0 && repairs.length) {
      if (env.mc === "1.16.5") {
        members.push(override(`public boolean isValidRepairItem(${stack} stack, ${stack} repair)`,
          `return ${repairs.map((ref) => `${ingredientExpr(env, ref)}.test(repair)`).join(" || ")};`));
      } else {
        const tag = `${env.modId}:${input.id}_repair_items`;
        props.push(`.repairable(net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, tag)}))`);
        tags.push(...repairs.map((ref) => ({ registry: "item", tag, value: qualify(env, ref) })));
      }
    }
    if (input.enchantability) {
      if (env.mc === "1.16.5") members.push(override("public int getEnchantmentValue()", `return ${input.enchantability};`));
      else props.push(`.enchantable(${input.enchantability})`);
    }
  }

  if (input.stayInGrid === true) members.push(...craftingRemainder(env, input));
  // MCreator makes a damaged crafting remainder unrepairable. Only 1.16.5 has the hook: 1.21+ repairs through the repairable component,
  // which these items do not have, and the anvil's combine rule is vanilla's.
  if (input.stayInGrid === true && input.damageOnCrafting === true && (input.durability ?? 0) > 0 && env.mc === "1.16.5") members.push(override(`public boolean isRepairable(${stack} stack)`, "return false;"));

  const modifiers = input.modifiers ?? [];
  if (modifiers.length) {
    if (env.mc === "1.16.5") members.push(attributeMethod1165(env, input.id, modifiers));
    else props.push(`.attributes(${attributeModifiersExpr(env, input.id, modifiers)})`);
  }
  return { props, members, tags };
}

/**
 * Item left in the crafting grid: the given remainder item, else the item itself, damaged by one when
 * `damageOnCrafting` is set (nothing once it breaks). Each loader has its own hook.
 */
function craftingRemainder(env: GenEnv, input: TraitInput): string[] {
  const damaged = input.damageOnCrafting === true && (input.durability ?? 0) > 0;
  const remainder = str(input.recipeRemainder);
  const pkg = itemPkg(env);
  const stack = `${pkg}.ItemStack`;
  const result = (from: string) => remainder ? `new ${stack}(${itemExpr(env, remainder)})`
    : damaged ? undefined : `new ${stack}(this)`;
  const damage = (current: string) => `${stack} retval = new ${stack}(this);
        retval.setDamageValue(${current} + 1);
        if (retval.getDamageValue() >= retval.getMaxDamage()) return ${env.mc === "26.3" ? "null" : `${stack}.EMPTY`};`;

  if (env.mc === "1.16.5") {
    return [
      override(`public boolean hasContainerItem(${stack} stack)`, "return true;"),
      override(`public ${stack} getContainerItem(${stack} stack)`, result("") ? `return ${result("")};` : `${damage("stack.getDamageValue()")}\n        return retval;`),
    ];
  }
  if (env.mc === "1.21.5") {
    const name = env.loader === "fabric" ? "getRecipeRemainder" : "getCraftingRemainder";
    return [override(`public ${stack} ${name}(${stack} stack)`, result("") ? `return ${result("")};` : `${damage("stack.getDamageValue()")}\n        return retval;`)];
  }
  // 26.x hands out immutable templates; NeoForge passes an ItemInstance, Fabric an ItemStack.
  const template = `${pkg}.ItemStackTemplate`;
  const param = env.loader === "fabric" ? `${stack} stack` : `${pkg}.ItemInstance stack`;
  const current = "stack.getOrDefault(net.minecraft.core.component.DataComponents.DAMAGE, 0)";
  const body = remainder ? `return new ${template}(${itemExpr(env, remainder)});`
    : damaged ? `${damage(current)}\n        return ${template}.fromNonEmptyStack(retval);`
      : `return new ${template}(this);`;
  return [override(`public ${template} getCraftingRemainder(${param})`, body)];
}

export function override(signature: string, body: string): string {
  return `
    @Override
    ${signature} {
        ${body}
    }
`;
}

/** Built-in item models by the name a model field stores. */
const BUILTIN_ITEM_MODELS: Record<string, string> = {
  Normal: "minecraft:item/generated", Tool: "minecraft:item/handheld", "Ranged item": "minecraft:item/bow", "": "minecraft:item/generated",
};

/**
 * Item model parent: a built-in shape, or a project model (models/<name>.json or .obj) that `owner` ("item/ruby")
 * uses; a missing project model is warned about and the flat item shape is used.
 */
export function modelParent(env: GenEnv, owner: string, model: unknown): string {
  const name = str(model);
  return BUILTIN_ITEM_MODELS[name] ?? customModel(env, owner, name) ?? BUILTIN_ITEM_MODELS.Normal;
}

/** "#ns:tag" or an item id for each row of a list of { item } rows. */
export function itemRows(value: unknown): string[] {
  return list<Record<string, unknown>>(value).map((row) => str(row.item)).filter(Boolean);
}

/** Java string of an element's registry id, "mymod:ruby". */
export const registryId = (env: GenEnv, element: Element) => jstr(`${env.modId}:${element.id}`);

/** Item model names that are built-in shapes (no separate inventory icon applies). */
export const isBuiltinItemModel = (model: unknown) => str(model) in BUILTIN_ITEM_MODELS || str(model) === "Normal blocking";

export interface GuiIcon {
  /** 1.21.5+ item definition "model" value. */
  definition: Record<string, unknown>;
  /** models/item/<id>.json. */
  modelJson: Record<string, unknown>;
  files: { path: string; json: string }[];
  /** Texture copy of the icon (to item/<id>_gui). */
  texture?: { from: string; to: string };
}

/**
 * The inventory icon of an item with a custom model: `guiTexture` drawn flat in GUIs, the model everywhere else.
 * 1.21.5+ selects on the display context in the item definition; Forge 1.16.5 uses its separate-perspective
 * model loader around the item model.
 */
export function guiIcon(env: GenEnv, id: string, guiTexture: string, definition: Record<string, unknown>, modelJson: Record<string, unknown>): GuiIcon {
  if (!guiTexture) return { definition, modelJson, files: [] };
  const icon = { parent: "minecraft:item/generated", textures: { layer0: `${env.modId}:item/${id}_gui` } };
  const texture = { from: guiTexture, to: `item/${id}_gui` };
  if (env.mc === "1.16.5") {
    return { definition, modelJson: { loader: "forge:separate-perspective", base: modelJson, perspectives: { gui: icon } }, files: [], texture };
  }
  return {
    definition: { type: "minecraft:select", property: "minecraft:display_context", cases: [{ when: ["gui"], model: { type: "minecraft:model", model: `${env.modId}:item/${id}_gui` } }], fallback: definition },
    modelJson,
    files: [{ path: `assets/${env.modId}/models/item/${id}_gui.json`, json: JSON.stringify(icon, null, 2) }],
    texture,
  };
}
