import { commonTag } from "./commonTags.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * Small Java and JSON building blocks shared by the type context modules. Generated snippets use fully
 * qualified names so templates need no per-element imports.
 */

/** Java string literal (JSON escaping is valid Java for the characters element text contains). */
export const jstr = (text: string) => JSON.stringify(text);

/** Float literal without float noise: 1.2 -> "1.2F". */
export const jfloat = (n: unknown) => `${Math.round(Number(n) * 1e6) / 1e6}F`;

export const str = (value: unknown) => (typeof value === "string" ? value : "");
export const list = <T = string>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** "ruby" -> "mymod:ruby"; "minecraft:stick" stays as it is; a tag follows the version ("#forge:ingots" is "#c:ingots" from 1.21). */
export function qualify(env: GenEnv, ref: string): string {
  if (ref.startsWith("#")) return ref.includes(":") ? `#${commonTag(env, ref.slice(1))}` : `#${env.modId}:${ref.slice(1)}`;
  return ref.includes(":") ? ref : `${env.modId}:${ref}`;
}

/**
 * Java field name of something derived from an element (a block's item, a fluid's bucket): the element's constant and
 * a CamelCase part, "RUBY_LAMP_Item". Element constants are upper case only, so a derived name never equals another
 * element's constant (an item "ruby_lamp_item" is RUBY_LAMP_ITEM).
 */
export const derivedConstant = (constant: string, part: string) => `${constant}_${part}`;

export function pascal(id: string): string {
  return id.split(/[_/]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

export const modern = (env: GenEnv) => env.mc !== "1.16.5";

/** Fully qualified resource id class. */
export function idClass(env: GenEnv): string {
  if (env.mc === "1.16.5") return "net.minecraft.util.ResourceLocation";
  return env.mc === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation";
}

/** Java expression of a resource id. */
export function idExpr(env: GenEnv, id: string): string {
  return env.mc === "1.16.5" ? `new ${idClass(env)}(${jstr(id)})` : `${idClass(env)}.parse(${jstr(id)})`;
}

/** Package of vanilla item classes. */
export const itemPkg = (env: GenEnv) => (env.mc === "1.16.5" ? "net.minecraft.item" : "net.minecraft.world.item");

/** Java expression of an item (vanilla or this mod), looked up lazily from the registry. */
export function itemExpr(env: GenEnv, ref: string): string {
  const id = idExpr(env, qualify(env, ref));
  return env.mc === "1.16.5"
    ? `net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(${id})`
    : `net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(${id})`;
}

export function blockExpr(env: GenEnv, ref: string): string {
  const id = idExpr(env, qualify(env, ref));
  return env.mc === "1.16.5"
    ? `net.minecraftforge.registries.ForgeRegistries.BLOCKS.getValue(${id})`
    : `net.minecraft.core.registries.BuiltInRegistries.BLOCK.getValue(${id})`;
}

export function stackExpr(env: GenEnv, ref: string, count = 1): string {
  return `new ${itemPkg(env)}.ItemStack(${itemExpr(env, ref)}${count !== 1 ? `, ${count}` : ""})`;
}

/** Java expression of an item tag key. */
export function itemTagExpr(env: GenEnv, tag: string): string {
  const id = tag.replace(/^#/, "");
  return env.mc === "1.16.5"
    ? `net.minecraft.tags.ItemTags.createOptional(${idExpr(env, id)})`
    : `net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, id)})`;
}

/** Java expression of an Ingredient matching an item or "#tag" reference. */
export function ingredientExpr(env: GenEnv, ref: string): string {
  const ingredient = env.mc === "1.16.5" ? "net.minecraft.item.crafting.Ingredient" : "net.minecraft.world.item.crafting.Ingredient";
  if (ref.startsWith("#")) {
    return env.mc === "1.16.5"
      ? `${ingredient}.of(${itemTagExpr(env, qualify(env, ref))})`
      : `${ingredient}.of(net.minecraft.core.registries.BuiltInRegistries.ITEM.getOrThrow(${itemTagExpr(env, qualify(env, ref))}))`;
  }
  return `${ingredient}.of(${itemExpr(env, ref)})`;
}

/** Plain text component. */
export function literal(env: GenEnv, text: string): string {
  return env.mc === "1.16.5" ? `new net.minecraft.util.text.StringTextComponent(${jstr(text)})` : `net.minecraft.network.chat.Component.literal(${jstr(text)})`;
}

/** Folder of a tag registry under data/<ns>/tags/: plural before 1.21. */
export function tagFolder(env: GenEnv, registry: string): string {
  if (env.mc !== "1.16.5") return registry;
  return { item: "items", block: "blocks", entity_type: "entity_types", fluid: "fluids", function: "functions" }[registry] ?? registry;
}

/** Recipe/loot ingredient JSON: 1.21+ takes "id" / "#tag" strings, 1.16.5 {"item"} / {"tag"} objects. */
export function ingredientJson(env: GenEnv, ref: string): unknown {
  const id = qualify(env, ref);
  if (env.mc !== "1.16.5") return id;
  return id.startsWith("#") ? { tag: id.slice(1) } : { item: id };
}

type Json = Record<string, unknown>;

/**
 * A loot table written in the 1.21 format, converted for 26.x: "conditions" lists become one "condition"
 * (all_of for several), "functions" become "modifier", and conditions and functions name their kind in "type".
 * Block state checks become match_block and the silk touch tool check the vanilla can_silk_touch predicate.
 */
export function lootJson(env: GenEnv, table: Json): Json {
  return env.mc === "26.3" ? (loot26(table) as Json) : table;
}

function loot26(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(loot26);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "conditions") {
      const conditions = (value as unknown[]).map(condition26);
      out.condition = conditions.length === 1 ? conditions[0] : { type: "minecraft:all_of", terms: conditions };
    } else if (key === "functions") {
      out.modifier = (value as Json[]).map(({ function: type, ...rest }) => ({ type, ...(loot26(rest) as Json) }));
    } else out[key] = loot26(value);
  }
  return out;
}

function condition26(condition: unknown): unknown {
  const { condition: type, ...rest } = condition as Json;
  if (type === "minecraft:block_state_property") return { type: "minecraft:match_block", blocks: rest.block, state: rest.properties };
  if (type === "minecraft:inverted") return { type, term: condition26(rest.term) };
  if (type === "minecraft:match_tool" && JSON.stringify(rest).includes("minecraft:silk_touch")) return "minecraft:tool/can_silk_touch";
  return { type, ...(loot26(rest) as Json) };
}

/** Item stack result JSON of recipes. */
export function resultJson(env: GenEnv, ref: string, count = 1): unknown {
  const id = qualify(env, ref);
  if (env.mc === "1.16.5") return count === 1 ? { item: id } : { item: id, count };
  return count === 1 ? { id } : { id, count };
}

/**
 * Tooltip override adding the lines of a "specialInformation" field. 1.21.5+ hands a line consumer to items;
 * blocks get the same call through their block item.
 */
export function tooltipMethod(env: GenEnv, text: string, target: "item" | "block"): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return "";
  if (env.mc === "1.16.5") {
    const getter = target === "item" ? "net.minecraft.world.World" : "net.minecraft.world.IBlockReader";
    return `
    @Override
    public void appendHoverText(net.minecraft.item.ItemStack stack, ${getter} world, java.util.List<net.minecraft.util.text.ITextComponent> tooltip, net.minecraft.client.util.ITooltipFlag flag) {
        super.appendHoverText(stack, world, tooltip, flag);
${lines.map((line) => `        tooltip.add(${literal(env, line)});`).join("\n")}
    }
`;
  }
  return `
    @Override
    public void appendHoverText(net.minecraft.world.item.ItemStack stack, net.minecraft.world.item.Item.TooltipContext context, net.minecraft.world.item.component.TooltipDisplay display, java.util.function.Consumer<net.minecraft.network.chat.Component> tooltip, net.minecraft.world.item.TooltipFlag flag) {
        super.appendHoverText(stack, context, display, tooltip, flag);
${lines.map((line) => `        tooltip.accept(${literal(env, line)});`).join("\n")}
    }
`;
}

/** Equipment slot group constant (1.21+) for MCEdge slot values. */
export const SLOT_GROUPS: Record<string, string> = {
  any: "ANY", mainhand: "MAINHAND", offhand: "OFFHAND", hand: "HAND", feet: "FEET", legs: "LEGS",
  chest: "CHEST", head: "HEAD", armor: "ARMOR", body: "BODY", saddle: "SADDLE",
};
/** EquipmentSlotType constant (1.16.5), which has no groups. */
export const SLOT_TYPES_1165: Record<string, string> = {
  mainhand: "MAINHAND", offhand: "OFFHAND", feet: "FEET", legs: "LEGS", chest: "CHEST", head: "HEAD",
};
/** AttributeModifier.Operation constants by MCEdge value, 1.16.5 names. */
export const OPERATIONS_1165: Record<string, string> = { ADD_VALUE: "ADDITION", ADD_MULTIPLIED_BASE: "MULTIPLY_BASE", ADD_MULTIPLIED_TOTAL: "MULTIPLY_TOTAL" };

export interface Modifier {
  attribute: string;
  amount: number;
  operation: string;
  slot: string;
  /** Vanilla's base attack damage/speed modifier, so tooltips show the value as the item's own stat. */
  base?: "damage" | "speed";
}

/** Rows of an "attributeModifiers" list field. */
export function modifierRows(value: unknown): Modifier[] {
  return list<Record<string, unknown>>(value)
    .filter((row) => str(row.attribute) !== "")
    .map((row) => ({ attribute: str(row.attribute), amount: Number(row.amount), operation: str(row.operation), slot: str(row.equipmentSlot) }));
}

/** Melee damage and speed as totals (MCreator style) turned into mainhand base modifiers. */
export function meleeModifiers(damage: unknown, speed: unknown): Modifier[] {
  const tidy = (n: number) => Math.round(n * 1e6) / 1e6;
  return [
    { attribute: "minecraft:attack_damage", amount: tidy(Number(damage) - 1), operation: "ADD_VALUE", slot: "mainhand", base: "damage" },
    { attribute: "minecraft:attack_speed", amount: tidy(Number(speed) - 4), operation: "ADD_VALUE", slot: "mainhand", base: "speed" },
  ];
}

/**
 * Attribute modifiers as an ItemAttributeModifiers expression (1.21+). Ids: the vanilla base ids for melee
 * stats so tooltips show them as base values, otherwise <modid>:<element>_<index>.
 */
export function attributeModifiersExpr(env: GenEnv, owner: string, modifiers: Modifier[]): string {
  const attrs = "net.minecraft.world.entity.ai.attributes";
  const lines = modifiers.map((m, i) => {
    const id = m.base === "damage" ? "net.minecraft.world.item.Item.BASE_ATTACK_DAMAGE_ID"
      : m.base === "speed" ? "net.minecraft.world.item.Item.BASE_ATTACK_SPEED_ID" : idExpr(env, `${env.modId}:${owner}_${i}`);
    const holder = `net.minecraft.core.registries.BuiltInRegistries.ATTRIBUTE.get(${idExpr(env, qualify(env, m.attribute))}).orElseThrow()`;
    return `\n                .add(${holder}, new ${attrs}.AttributeModifier(${id}, ${m.amount}, ${attrs}.AttributeModifier.Operation.${m.operation}), net.minecraft.world.entity.EquipmentSlotGroup.${SLOT_GROUPS[m.slot]})`;
  });
  return `net.minecraft.world.item.component.ItemAttributeModifiers.builder()${lines.join("")}\n                .build()`;
}

/** 1.16.5 attribute modifier override; modifiers are keyed by EquipmentSlotType. */
export function attributeMethod1165(env: GenEnv, owner: string, modifiers: Modifier[]): string {
  if (!modifiers.length) return "";
  const slots = [...new Set(modifiers.map((m) => m.slot))];
  const body = slots.map((slot) => {
    const puts = modifiers.map((m, i) => ({ m, i })).filter(({ m }) => m.slot === slot).map(({ m, i }) => {
      const uuid = m.base === "damage" ? "BASE_ATTACK_DAMAGE_UUID" : m.base === "speed" ? "BASE_ATTACK_SPEED_UUID"
          : `java.util.UUID.nameUUIDFromBytes(${jstr(`${env.modId}:${owner}_${i}`)}.getBytes())`;
      return `            builder.put(net.minecraftforge.registries.ForgeRegistries.ATTRIBUTES.getValue(${idExpr(env, qualify(env, m.attribute))}), new net.minecraft.entity.ai.attributes.AttributeModifier(${uuid}, "${owner}", ${m.amount}, net.minecraft.entity.ai.attributes.AttributeModifier.Operation.${OPERATIONS_1165[m.operation]}));`;
    });
    return `        if (slot == net.minecraft.inventory.EquipmentSlotType.${SLOT_TYPES_1165[slot]}) {\n${puts.join("\n")}\n        }`;
  });
  return `
    @Override
    public com.google.common.collect.Multimap<net.minecraft.entity.ai.attributes.Attribute, net.minecraft.entity.ai.attributes.AttributeModifier> getDefaultAttributeModifiers(net.minecraft.inventory.EquipmentSlotType slot) {
        com.google.common.collect.ImmutableMultimap.Builder<net.minecraft.entity.ai.attributes.Attribute, net.minecraft.entity.ai.attributes.AttributeModifier> builder = com.google.common.collect.ImmutableMultimap.builder();
        builder.putAll(super.getDefaultAttributeModifiers(slot));
${body.join("\n")}
        return builder.build();
    }
`;
}

/**
 * The ItemGroup expression of an item in 1.16.5, where an item has one: its first vanilla tab, else its first mod tab.
 * An item without a group is never listed for the search tab, so JEI and creative search did not show it (ETR #73).
 */
export function vanillaTab1165(env: GenEnv, tabs: unknown): string {
  const ids = list<string>(tabs);
  const vanilla = ids.map((tab) => env.engine.creativeTabs[tab]).find(Boolean);
  if (vanilla) return `net.minecraft.item.ItemGroup.${vanilla}`;
  const own = new Set((env.generated.creative_tab ?? []).map((t) => t.id));
  const mod = ids.find((tab) => own.has(tab));
  return mod ? `${env.project.mod.package}.${pascal(env.modId)}Mod.${mod.toUpperCase()}` : "";
}

/** Fields every item-form element shares in the templates: its registry name and creative tab bookkeeping. */
export function itemForm(env: GenEnv, id: string, tabs: unknown): { tabItems: string[]; vanillaTab: string } {
  return { tabItems: [itemExpr(env, id)], vanillaTab: vanillaTab1165(env, tabs) };
}
