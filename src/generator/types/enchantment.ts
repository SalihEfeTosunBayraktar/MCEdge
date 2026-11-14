import type { Element } from "../../elements/model.ts";
import { idExpr, list, qualify, str } from "../java.ts";
import { registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/**
 * Enchantments: a data-driven enchantment file with its tags on 1.21.5+, an Enchantment subclass registered in
 * code on 1.16.5. The effects blockly field needs the enchantment effect block set and is not generated.
 */

type Row = Record<string, unknown>;

/** Vanilla 1.21 item tags that name a 1.16.5 enchantment type. */
const TYPES_1165: Record<string, string> = {
  "#minecraft:enchantable/foot_armor": "ARMOR_FEET", "#minecraft:enchantable/leg_armor": "ARMOR_LEGS",
  "#minecraft:enchantable/chest_armor": "ARMOR_CHEST", "#minecraft:enchantable/head_armor": "ARMOR_HEAD",
  "#minecraft:enchantable/armor": "ARMOR", "#minecraft:enchantable/weapon": "WEAPON", "#minecraft:enchantable/sword": "WEAPON",
  "#minecraft:enchantable/mining": "DIGGER", "#minecraft:enchantable/fishing": "FISHING_ROD", "#minecraft:enchantable/trident": "TRIDENT",
  "#minecraft:enchantable/durability": "BREAKABLE", "#minecraft:enchantable/bow": "BOW", "#minecraft:enchantable/equippable": "WEARABLE",
  "#minecraft:enchantable/crossbow": "CROSSBOW", "#minecraft:enchantable/vanishing": "VANISHABLE",
};

/** EquipmentSlotType constants of an MCEdge slot group on 1.16.5, which has no groups. */
const SLOTS_1165: Record<string, string[]> = {
  any: ["HEAD", "CHEST", "LEGS", "FEET", "MAINHAND", "OFFHAND"], hand: ["MAINHAND", "OFFHAND"], armor: ["HEAD", "CHEST", "LEGS", "FEET"],
  body: ["CHEST"], saddle: ["CHEST"], mainhand: ["MAINHAND"], offhand: ["OFFHAND"], feet: ["FEET"], legs: ["LEGS"], chest: ["CHEST"], head: ["HEAD"],
};

/** Vanilla rarity weights, used to pick the 1.16.5 rarity (which also sets the anvil cost there). */
const rarity1165 = (weight: number) => (weight <= 1 ? "VERY_RARE" : weight <= 2 ? "RARE" : weight <= 5 ? "UNCOMMON" : "COMMON");

const refs = (value: unknown, key: string) => list<Row>(value).map((row) => str(row[key])).filter(Boolean);

function element(ench: Element, env: GenEnv): ElementContext {
  const items = refs(ench.supportedItems, "item").map((ref) => qualify(env, ref));
  const exclusive = refs(ench.incompatibleEnchantments, "enchantment").map((ref) => qualify(env, ref));
  if (env.mc === "1.16.5") return {};

  const id = qualify(env, ench.id);
  const tags: TagEntry[] = [];
  const files: ResourceFile[] = [];
  // A holder set is one "#tag" or a list of ids; anything else goes through a tag of this mod.
  const holderSet = (refsIn: string[], registry: string, folder: string): unknown => {
    if (refsIn.length === 1) return refsIn[0];
    if (!refsIn.some((r) => r.startsWith("#"))) return refsIn;
    const tag = `${env.modId}:${folder}/${ench.id}`;
    tags.push(...refsIn.map((value) => ({ registry, tag, value })));
    return `#${tag}`;
  };
  const damage = Number(ench.damageModifier);
  const json = {
    description: { translate: `enchantment.${env.modId}.${ench.id}` },
    supported_items: holderSet(items, "item", "enchantable"),
    weight: Number(ench.weight),
    max_level: Number(ench.maxLevel),
    min_cost: { base: 1, per_level_above_first: 10 },
    max_cost: { base: 6, per_level_above_first: 10 },
    anvil_cost: Number(ench.anvilCost),
    slots: [str(ench.supportedSlots)],
    ...(exclusive.length ? { exclusive_set: holderSet(exclusive, "enchantment", "exclusive_set") } : {}),
    ...(damage ? {
      effects: {
        "minecraft:damage_protection": [{
          effect: { type: "minecraft:add", value: { type: "minecraft:linear", base: damage, per_level_above_first: damage } },
          requirements: { [env.mc === "26.3" ? "type" : "condition"]: "minecraft:damage_source_properties", predicate: { tags: [{ id: `${env.mc === "26.3" ? "#" : ""}minecraft:bypasses_invulnerability`, expected: false }] } },
        }],
      },
    } : {}),
  };
  files.push({ path: `data/${env.modId}/enchantment/${ench.id}.json`, json: JSON.stringify(json, null, 2) });
  const tag = (name: string, when: unknown) => { if (when === true) tags.push({ registry: "enchantment", tag: `minecraft:${name}`, value: id }); };
  tag("tradeable", ench.canVillagerTrade);
  tag("on_random_loot", ench.canGenerateInLootTables);
  tag("curse", ench.isCurse);
  tag("treasure", ench.isTreasureEnchantment);
  // Non-treasure enchantments are offered by enchanting tables and found on enchanted mob gear.
  tag("non_treasure", ench.isTreasureEnchantment !== true);
  return { files, tags };
}

/** 1.16.5: one Enchantment subclass per element, registered with Forge. */
function enchantmentClass1165(env: GenEnv, ench: ElementContext): string {
  const items = refs(ench.supportedItems, "item").map((ref) => qualify(env, ref));
  const exclusive = refs(ench.incompatibleEnchantments, "enchantment").map((ref) => qualify(env, ref)).filter((ref) => !ref.startsWith("#"));
  const known = items.length === 1 ? TYPES_1165[items[0]] : undefined;
  const itemTest = items.map((ref) => ref.startsWith("#")
    ? `net.minecraft.tags.ItemTags.getAllTags().getTagOrEmpty(${idExpr(env, ref.slice(1))}).contains(item)`
    : `item == net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(${idExpr(env, ref)})`).join(" || ") || "false";
  const category = known ? `net.minecraft.enchantment.EnchantmentType.${known}`
    : `net.minecraft.enchantment.EnchantmentType.create(${JSON.stringify(`${env.modId}_${ench.id}`)}, item -> ${itemTest})`;
  const slots = (SLOTS_1165[str(ench.supportedSlots)] ?? SLOTS_1165.any).map((s) => `net.minecraft.inventory.EquipmentSlotType.${s}`).join(", ");
  const E = "net.minecraft.enchantment.Enchantment";
  const methods: string[] = [
    `public int getMinCost(int level) { return 1 + (level - 1) * 10; }`,
    `public int getMaxCost(int level) { return 6 + (level - 1) * 10; }`,
    `public int getMaxLevel() { return ${Number(ench.maxLevel)}; }`,
  ];
  const damage = Number(ench.damageModifier);
  if (damage) methods.push(`public int getDamageProtection(int level, net.minecraft.util.DamageSource source) { return source.isBypassInvul() ? 0 : level * ${damage}; }`);
  if (exclusive.length) {
    methods.push(`protected boolean checkCompatibility(${E} other) {
            return super.checkCompatibility(other) && !java.util.Arrays.asList(${exclusive.map((ref) => JSON.stringify(ref)).join(", ")}).contains(String.valueOf(other.getRegistryName()));
        }`);
  }
  if (ench.isTreasureEnchantment === true) methods.push("public boolean isTreasureOnly() { return true; }");
  if (ench.isCurse === true) methods.push("public boolean isCurse() { return true; }");
  if (ench.canGenerateInLootTables !== true) methods.push("public boolean isDiscoverable() { return false; }");
  if (ench.canVillagerTrade !== true) methods.push("public boolean isTradeable() { return false; }");
  return `new ${E}(${E}.Rarity.${rarity1165(Number(ench.weight))}, ${category}, new net.minecraft.inventory.EquipmentSlotType[] { ${slots} }) {
${methods.map((m) => `        @Override\n        ${m}`).join("\n\n")}
    }`;
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (env.mc !== "1.16.5" || !contexts.length) return {};
    const reg = registryClass(env, {
      name: "Enchantments",
      valueType: "net.minecraft.enchantment.Enchantment",
      forge: "net.minecraftforge.registries.ForgeRegistries.ENCHANTMENTS",
      entries: contexts.map((ctx) => ({ constant: String(ctx.constant), id: String(ctx.id), factory: enchantmentClass1165(env, ctx) })),
    });
    return { sources: [reg.source], init: [reg.init] };
  },
} satisfies TypeModule;
