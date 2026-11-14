import type { Element } from "../../elements/model.ts";
import { idExpr, list, lootJson, qualify, str } from "../java.ts";
import type { ElementContext, GenEnv, ResourceFile, TypeModule } from "../typeModule.ts";

const TYPES: Record<string, string> = {
  Block: "block", Entity: "entity", Generic: "generic", Chest: "chest", Fishing: "fishing", Empty: "empty",
  "Advancement reward": "advancement_reward", Gift: "gift", Barter: "barter", Archaeology: "archaeology",
};

type Row = Record<string, unknown>;

function element(table: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const ns = table.namespace === "minecraft" ? "minecraft" : env.modId;
  const range = (min: unknown, max: unknown) => (Number(min) === Number(max) ? Number(min) : { type: "minecraft:uniform", min: Number(min), max: Number(max) });
  const silkTouch = legacy
    ? { condition: "minecraft:match_tool", predicate: { enchantments: [{ enchantment: "minecraft:silk_touch", levels: { min: 1 } }] } }
    : { condition: "minecraft:match_tool", predicate: { predicates: { "minecraft:enchantments": [{ enchantments: "minecraft:silk_touch", levels: { min: 1 } }] } } };

  const entry = (row: Row) => {
    const functions: unknown[] = [];
    if (Number(row.minCount) !== 1 || Number(row.maxCount) !== 1) functions.push({ function: "minecraft:set_count", count: range(row.minCount, row.maxCount) });
    if (Number(row.maxEnchantmentLevel) > 0) {
      const levels = range(row.minEnchantmentLevel, row.maxEnchantmentLevel);
      functions.push(legacy ? { function: "minecraft:enchant_with_levels", levels, treasure: false }
        : { function: "minecraft:enchant_with_levels", levels, options: "#minecraft:in_enchanting_table" });
    }
    if (row.affectedByFortune === true) functions.push({ function: "minecraft:apply_bonus", enchantment: "minecraft:fortune", formula: "minecraft:ore_drops" });
    if (row.explosionDecay === true) functions.push({ function: "minecraft:explosion_decay" });
    const mode = Number(row.silkTouchMode);
    const conditions = mode === 1 ? [silkTouch] : mode === 2 ? [{ condition: "minecraft:inverted", term: silkTouch }] : [];
    return {
      type: "minecraft:item",
      name: qualify(env, str(row.item)),
      ...(Number(row.weight) !== 1 ? { weight: Number(row.weight) } : {}),
      ...(functions.length ? { functions } : {}),
      ...(conditions.length ? { conditions } : {}),
    };
  };

  const pools = list<Row>(table.pools).map((pool) => ({
    rolls: range(pool.minrolls, pool.maxrolls),
    ...(pool.hasbonusrolls === true ? { bonus_rolls: range(pool.minbonusrolls, pool.maxbonusrolls) } : {}),
    entries: list<Row>(pool.entries).filter((row) => str(row.item)).map(entry),
  }));

  // Added to an existing table: the whole table rolls once more whenever the other one does.
  const tableId = `${ns}:${str(table.name)}`;
  const target = str(table.lootTableToModify).trim();
  const targetId = target.includes(":") ? target : `minecraft:${target}`;
  const init: string[] = [];
  const files: ResourceFile[] = [];
  if (target) {
    const key = (id: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.LOOT_TABLE, ${idExpr(env, id)})`;
    if (legacy) {
      init.push(`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.LootTableLoadEvent.class, event -> {
            if (event.getName().equals(${idExpr(env, targetId)})) event.getTable().addPool(net.minecraft.loot.LootPool.lootPool().name(${JSON.stringify(`${env.modId}:${table.id}`)}).add(net.minecraft.loot.TableLootEntry.lootTableReference(${idExpr(env, tableId)})).build());
        });`);
    } else if (env.loader === "neoforge") {
      const condition = env.mc === "26.3" ? { condition: { type: "neoforge:loot_table_id", loot_table_id: targetId } }
        : { conditions: [{ condition: "neoforge:loot_table_id", loot_table_id: targetId }] };
      files.push({ path: `data/${env.modId}/loot_modifiers/${table.id}.json`, json: JSON.stringify({ type: "neoforge:add_table", ...condition, table: tableId }, null, 2) });
    } else if (env.mc === "26.3") {
      init.push(`net.fabricmc.fabric.api.loot.v3.LootTableEvents.MODIFY_DROPS.register((table, context, drops) -> {
            if (table.is(${key(targetId)})) context.getLevel().getServer().reloadableRegistries().getLootTable(${key(tableId)}).getRandomItemsRaw(context, drops::add);
        });`);
    } else {
      init.push(`net.fabricmc.fabric.api.loot.v3.LootTableEvents.MODIFY.register((key, builder, source, registries) -> {
            if (key.location().equals(${idExpr(env, targetId)})) builder.withPool(net.minecraft.world.level.storage.loot.LootPool.lootPool().add(net.minecraft.world.level.storage.loot.entries.NestedLootTable.lootTableReference(${key(tableId)})));
        });`);
    }
  }

  return {
    dataPath: `${ns}/${legacy ? "loot_tables" : "loot_table"}/${str(table.name)}`,
    json: JSON.stringify(lootJson(env, { type: `minecraft:${TYPES[str(table.type)]}`, pools }), null, 2),
    init,
    files,
    lootModifier: target !== "",
  };
}

export default {
  element,
  // NeoForge 1.21.5 only loads loot modifiers listed in its global list; 26.x loads every file in the folder.
  files: (tables: ElementContext[], env: GenEnv): ResourceFile[] => {
    const entries = tables.filter((t) => t.lootModifier).map((t) => `${env.modId}:${t.id}`);
    if (env.loader !== "neoforge" || env.mc !== "1.21.5" || !entries.length) return [];
    return [{ path: "data/neoforge/loot_modifiers/global_loot_modifiers.json", json: JSON.stringify({ replace: false, entries }, null, 2) }];
  },
} satisfies TypeModule;
