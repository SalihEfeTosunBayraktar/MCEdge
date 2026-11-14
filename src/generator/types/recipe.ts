import type { Element } from "../../elements/model.ts";
import { ingredientExpr, ingredientJson, itemExpr, itemPkg, list, qualify, resultJson, str } from "../java.ts";
import { itemRows } from "../itemTraits.ts";
import type { Context } from "../render.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/** Cooking recipe types: JSON type and the element's input/result fields. */
const COOKING: Record<string, [string, string]> = {
  Smelting: ["smelting", "smelting"], Blasting: ["blasting", "blasting"], Smoking: ["smoking", "smoking"], "Campfire cooking": ["campfire_cooking", "campfireCooking"],
};

function element(recipe: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const type = str(recipe.recipeType);
  const ns = recipe.namespace === "minecraft" ? "minecraft" : env.modId;
  const name = str(recipe.name) || recipe.id;
  const fullId = `${ns}:${name}`;
  const ing = (ref: unknown) => ingredientJson(env, str(ref));
  const group = str(recipe.group) ? { group: str(recipe.group) } : {};
  let json: Record<string, unknown> | undefined;

  if (type === "Crafting") {
    const slots = list<string>(recipe.recipeSlots);
    const result = resultJson(env, str(recipe.recipeReturnStack), Number(recipe.recipeRetstackSize));
    const category = legacy ? {} : { category: str(recipe.craftingBookCategory).toLowerCase() };
    if (recipe.recipeShapeless === true) {
      json = { type: "minecraft:crafting_shapeless", ...group, ...category, ingredients: slots.filter(Boolean).map(ing), result };
    } else {
      const grid = trimGrid(slots);
      const symbols = [...new Set(grid.flat().filter((slot) => slot !== ""))];
      const symbol = (slot: string) => (slot === "" ? " " : String.fromCharCode(65 + symbols.indexOf(slot)));
      json = {
        type: "minecraft:crafting_shaped", ...group, ...category,
        pattern: grid.map((row) => row.map(symbol).join("")),
        key: Object.fromEntries(symbols.map((slot) => [symbol(slot), ing(slot)])),
        result,
      };
    }
  } else if (COOKING[type]) {
    const [jsonType, field] = COOKING[type];
    const result = str(recipe[`${field}ReturnStack`]);
    json = {
      type: `minecraft:${jsonType}`, ...group,
      ...(legacy ? {} : { category: str(recipe.cookingBookCategory).toLowerCase() }),
      ingredient: ing(recipe[`${field}InputStack`]),
      result: legacy ? qualify(env, result) : resultJson(env, result),
      experience: Number(recipe.xpReward),
      cookingtime: Number(recipe.cookingTime),
    };
  } else if (type === "Stone cutting") {
    const result = str(recipe.stoneCuttingReturnStack);
    const count = Number(recipe.recipeRetstackSize);
    json = legacy
      ? { type: "minecraft:stonecutting", ingredient: ing(recipe.stoneCuttingInputStack), result: qualify(env, result), count }
      : { type: "minecraft:stonecutting", ingredient: ing(recipe.stoneCuttingInputStack), result: resultJson(env, result, count) };
  } else if (type === "Smithing") {
    const template = str(recipe.smithingInputTemplateStack);
    json = legacy
      ? { type: "minecraft:smithing", base: ing(recipe.smithingInputStack), addition: ing(recipe.smithingInputAdditionStack), result: resultJson(env, str(recipe.smithingReturnStack)) }
      : {
        type: "minecraft:smithing_transform", template: template ? ing(template) : [],
        base: ing(recipe.smithingInputStack), addition: ing(recipe.smithingInputAdditionStack), result: resultJson(env, str(recipe.smithingReturnStack)),
      };
  } else if (type === "Brewing" && env.mc === "26.3") {
    // 26.x brewing is data driven; earlier versions register it in code (global() below).
    json = {
      type: "minecraft:brewing",
      input: { item: qualify(env, str(recipe.brewingInputStack)) },
      reagent: { item: qualify(env, str(recipe.brewingIngredientStack)) },
      output: { id: qualify(env, str(recipe.brewingReturnStack)) },
    };
  }

  const unlocking = itemRows(recipe.unlockingItems);
  const folder = legacy ? "recipes" : "recipe";
  return {
    datapack: json !== undefined,
    dataPath: `${ns}/${folder}/${name}`,
    json: JSON.stringify(json ?? {}, null, 2),
    hasUnlock: json !== undefined && unlocking.length > 0,
    advancementPath: `${ns}/${legacy ? "advancements" : "advancement"}/recipes/${name}`,
    advancementJson: JSON.stringify(unlockAdvancement(env, fullId, unlocking), null, 2),
  };
}

/** The recipe book unlocks the recipe once the player holds any of the items. */
function unlockAdvancement(env: GenEnv, recipeId: string, items: string[]): unknown {
  const legacy = env.mc === "1.16.5";
  // 26.x renamed the recipe_unlocked condition to "recipes".
  const criteria: Record<string, unknown> = { has_the_recipe: { trigger: "minecraft:recipe_unlocked", conditions: { [env.mc === "26.3" ? "recipes" : "recipe"]: recipeId } } };
  items.forEach((ref, i) => {
    const id = qualify(env, ref);
    const predicate = legacy ? (id.startsWith("#") ? { tag: id.slice(1) } : { item: id }) : { items: id };
    criteria[`has_item_${i}`] = { trigger: "minecraft:inventory_changed", conditions: { items: [predicate] } };
  });
  return { parent: "minecraft:recipes/root", criteria, requirements: [Object.keys(criteria)], rewards: { recipes: [recipeId] } };
}

/** Drops empty outer rows and columns so the recipe works anywhere in the crafting grid. */
export function trimGrid(pattern: string[]): string[][] {
  const rows = [0, 1, 2].map((r) => pattern.slice(r * 3, r * 3 + 3));
  const used = (cells: string[]) => cells.some((slot) => slot !== "");
  const usedRows = [0, 1, 2].filter((r) => used(rows[r]));
  const usedCols = [0, 1, 2].filter((c) => used(rows.map((row) => row[c])));
  if (!usedRows.length) return [];
  return rows
    .slice(usedRows[0], usedRows[usedRows.length - 1] + 1)
    .map((row) => row.slice(usedCols[0], usedCols[usedCols.length - 1] + 1));
}

/** Brewing before 26.x is registered from code: Forge's registry on 1.16.5, NeoForge's event on 1.21.5. */
function brewingCode(recipes: ElementContext[], env: GenEnv): string {
  const brewing = recipes.filter((r) => r.recipeType === "Brewing");
  if (!brewing.length || env.mc === "26.3") return "";
  const lines = brewing.map((r) => {
    const out = `new ${itemPkg(env)}.ItemStack(${itemExpr(env, str(r.brewingReturnStack))})`;
    const args = `${ingredientExpr(env, str(r.brewingInputStack))}, ${ingredientExpr(env, str(r.brewingIngredientStack))}, ${out}`;
    return env.mc === "1.16.5"
      ? `            net.minecraftforge.common.brewing.BrewingRecipeRegistry.addRecipe(${args});`
      : `            event.getBuilder().addRecipe(${args});`;
  });
  return env.mc === "1.16.5"
    ? `        modBus.addListener((net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) -> event.enqueueWork(() -> {\n${lines.join("\n")}\n        }));\n`
    : `        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.brewing.RegisterBrewingRecipesEvent event) -> {\n${lines.join("\n")}\n        });\n`;
}

export default {
  element,
  global: (recipes: ElementContext[], env: GenEnv): Context => ({ brewingCode: brewingCode(recipes, env) }),
} satisfies TypeModule;
