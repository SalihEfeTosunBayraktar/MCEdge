import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Element } from "../elements/model.ts";

/**
 * Schema 1 projects had six hardcoded element kinds. They are read here and turned into elements of the
 * data-driven types; storage writes the result only when the project is next saved.
 *
 *   items   -> item                 maxStackSize -> stackSize
 *   foods   -> item, food on        nutrition -> nutritionalValue, alwaysEdible -> isAlwaysEdible
 *   blocks  -> block
 *   tools   -> tool                 tier -> blockDropsTier; damage and speed become the totals MCreator stores
 *   recipes -> recipe               shaped -> Crafting, smelting -> Smelting; name -> title
 *   tabs    -> creative_tab         each listed element gets the tab in its creativeTabs
 *
 * Keys the mapping does not know are carried over unchanged.
 */
export const V1_FOLDERS = ["items", "blocks", "foods", "tools", "recipes", "tabs"] as const;

type Old = Record<string, unknown> & { id: string };

/** Vanilla tool tier stats; the old format took these from the tier, the new one stores them. */
const TIERS: Record<string, { constant: string; damageBonus: number; speed: number; uses: number; enchantability: number }> = {
  wood: { constant: "WOOD", damageBonus: 0, speed: 2, uses: 59, enchantability: 15 },
  stone: { constant: "STONE", damageBonus: 1, speed: 4, uses: 131, enchantability: 5 },
  iron: { constant: "IRON", damageBonus: 2, speed: 6, uses: 250, enchantability: 14 },
  gold: { constant: "GOLD", damageBonus: 0, speed: 12, uses: 32, enchantability: 22 },
  diamond: { constant: "DIAMOND", damageBonus: 3, speed: 8, uses: 1561, enchantability: 10 },
  netherite: { constant: "NETHERITE", damageBonus: 4, speed: 9, uses: 2031, enchantability: 15 },
};
const TOOL_TYPES: Record<string, string> = { pickaxe: "Pickaxe", axe: "Axe", shovel: "Spade", hoe: "Hoe", sword: "Sword" };

/** Base attack damage of a player's hand and base attack speed; MCreator stores tool totals including these. */
export const BASE_ATTACK_DAMAGE = 1;
export const BASE_ATTACK_SPEED = 4;
/** Attack damage bonus of each vanilla tier, by MCreator tier constant. */
export const TIER_DAMAGE_BONUS: Record<string, number> = Object.fromEntries(Object.values(TIERS).map((t) => [t.constant, t.damageBonus]));

/** Rounds away float noise such as -2.8 + 4 = 1.2000000000000002. */
export const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

export function loadV1Elements(dir: string): Record<string, Element[]> {
  const read = (folder: string): Old[] => {
    const path = join(dir, "elements", folder);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const { $schema: _, ...element } = JSON.parse(readFileSync(join(path, name), "utf8"));
        return element as Old;
      });
  };
  const tabs = read("tabs");
  const tabsOf = (id: string) => tabs.filter((tab) => (tab.elements as string[] | undefined)?.includes(id)).map((tab) => tab.id);

  const items = [
    ...read("items").map(({ maxStackSize, ...rest }) => ({ ...rest, stackSize: maxStackSize, creativeTabs: ["MATERIALS", ...tabsOf(rest.id)] })),
    ...read("foods").map(({ maxStackSize, nutrition, saturation, alwaysEdible, ...rest }) => ({
      ...rest, stackSize: maxStackSize, creativeTabs: ["FOOD", ...tabsOf(rest.id)],
      isFood: true, nutritionalValue: nutrition, saturation, isAlwaysEdible: alwaysEdible,
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const blocks = read("blocks").map((block) => ({ ...block, creativeTabs: ["BUILDING_BLOCKS", ...tabsOf(block.id)] }));

  const tools = read("tools").map(({ toolType, tier, attackDamage, attackSpeed, ...rest }) => {
    const stats = TIERS[String(tier)] ?? TIERS.iron;
    return {
      ...rest,
      toolType: TOOL_TYPES[String(toolType)] ?? toolType,
      blockDropsTier: stats.constant,
      damageVsEntity: tidy(BASE_ATTACK_DAMAGE + stats.damageBonus + Number(attackDamage)),
      attackSpeed: tidy(BASE_ATTACK_SPEED + Number(attackSpeed)),
      efficiency: stats.speed,
      usageCount: stats.uses,
      enchantability: stats.enchantability,
      creativeTabs: [toolType === "sword" ? "COMBAT" : "TOOLS", ...tabsOf(rest.id)],
    };
  });

  const recipes = read("recipes").map(({ name, type, result, count, pattern, input, experience, cookingTime, ...rest }) => ({
    ...rest,
    title: name,
    recipeType: type === "smelting" ? "Smelting" : "Crafting",
    recipeShapeless: false,
    recipeSlots: pattern,
    recipeReturnStack: type === "smelting" ? "" : result,
    recipeRetstackSize: count,
    smeltingInputStack: input,
    smeltingReturnStack: type === "smelting" ? result : "",
    xpReward: experience,
    cookingTime,
  }));

  const creativeTabs = tabs.map(({ elements: _, ...tab }) => tab);
  return { item: items, block: blocks, tool: tools, recipe: recipes, creative_tab: creativeTabs } as Record<string, Element[]>;
}

/** Schema files that only described the old element kinds. */
export const V1_SCHEMA_FILES = ["item", "block", "food", "tool", "recipe", "tab"].map((name) => `${name}.schema.json`);
