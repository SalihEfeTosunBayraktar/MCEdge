import type { SpriteName } from "./components/Sprite.tsx";
import { elementTypes, typeOf } from "./types.ts";
import type { CatalogId } from "./strings.ts";

/** Folders of the New element popup (Q233), in the order shown; "other" holds types the list below does not know yet. */
export const CATALOG_GROUPS = ["blocks", "entities", "effects", "world", "interface", "logic", "other"] as const;
export type CatalogGroup = (typeof CATALOG_GROUPS)[number];

export interface CatalogEntry {
  /** Element type id (type.json "id"). */
  typeId: string;
  /** Folder of the New element popup. */
  group: CatalogGroup;
  /** Shortcut letter in the New element popup (MCreator's letters where it has one). */
  key: string;
  sprite: SpriteName;
  /** Shown while the type has no type.json yet. */
  label?: CatalogId;
}

/** Sprites, shortcut letters and placeholder labels of the MCreator element types MCEdge knows about. */
const KNOWN: CatalogEntry[] = [
  { typeId: "advancement", key: "h", group: "world", sprite: "star", label: "advancement" },
  { typeId: "armor", key: "a", group: "blocks", sprite: "chest", label: "armor" },
  { typeId: "armor_trim", key: "", group: "blocks", sprite: "flag", label: "armorTrim" },
  { typeId: "attribute", key: "", group: "entities", sprite: "bars", label: "attribute" },
  { typeId: "banner_pattern", key: "", group: "blocks", sprite: "flag", label: "bannerPattern" },
  { typeId: "biome", key: "o", group: "world", sprite: "biome", label: "biome" },
  { typeId: "block", key: "b", group: "blocks", sprite: "stone", label: "block" },
  { typeId: "bubble", key: "", group: "interface", sprite: "gui", label: "bubble" },
  { typeId: "command", key: "c", group: "logic", sprite: "cmd", label: "command" },
  { typeId: "creative_tab", key: "w", group: "interface", sprite: "tab", label: "creativeTab" },
  { typeId: "custom_element", key: "", group: "logic", sprite: "cmd", label: "customElement" },
  { typeId: "damage_type", key: "", group: "entities", sprite: "heart", label: "damageType" },
  { typeId: "dimension", key: "d", group: "world", sprite: "portal", label: "dimension" },
  { typeId: "enchantment", key: "m", group: "effects", sprite: "book", label: "enchantment" },
  { typeId: "feature", key: "f", group: "world", sprite: "feature", label: "feature" },
  { typeId: "fluid", key: "", group: "blocks", sprite: "drop", label: "fluid" },
  { typeId: "function", key: "u", group: "logic", sprite: "cmd", label: "function" },
  { typeId: "game_rule", key: "", group: "world", sprite: "list", label: "gameRule" },
  { typeId: "gui", key: "g", group: "interface", sprite: "gui", label: "gui" },
  { typeId: "item", key: "i", group: "blocks", sprite: "ingot", label: "item" },
  { typeId: "item_extension", key: "", group: "blocks", sprite: "raw", label: "itemExtension" },
  { typeId: "key_binding", key: "k", group: "interface", sprite: "key", label: "keyBinding" },
  { typeId: "living_entity", key: "e", group: "entities", sprite: "stalker", label: "livingEntity" },
  { typeId: "loot_table", key: "l", group: "world", sprite: "loot", label: "lootTable" },
  { typeId: "overlay", key: "v", group: "interface", sprite: "gui", label: "overlay" },
  { typeId: "painting", key: "", group: "blocks", sprite: "flag", label: "painting" },
  { typeId: "particle", key: "y", group: "effects", sprite: "particle", label: "particle" },
  { typeId: "plant", key: "n", group: "blocks", sprite: "plant", label: "plant" },
  { typeId: "potion_effect", key: "", group: "effects", sprite: "potion", label: "potionEffect" },
  { typeId: "potion_item", key: "z", group: "effects", sprite: "potion", label: "potionItem" },
  { typeId: "procedure", key: "p", group: "logic", sprite: "proc", label: "procedure" },
  { typeId: "projectile", key: "q", group: "entities", sprite: "arrow", label: "projectile" },
  { typeId: "radial_menu", key: "", group: "interface", sprite: "gui", label: "radialMenu" },
  { typeId: "recipe", key: "r", group: "world", sprite: "recipe", label: "recipe" },
  { typeId: "special_entity", key: "", group: "entities", sprite: "infuser", label: "specialEntity" },
  { typeId: "structure", key: "s", group: "world", sprite: "bricks", label: "structure" },
  { typeId: "tool", key: "t", group: "blocks", sprite: "pick", label: "tool" },
  { typeId: "villager_profession", key: "", group: "entities", sprite: "villager", label: "villagerProfession" },
  { typeId: "villager_trade", key: "", group: "entities", sprite: "emerald", label: "villagerTrade" },
];

const FALLBACK_SPRITE: SpriteName = "cmd";

/**
 * Every type for the New element popup: the known MCreator types plus any type.json the list above does not
 * mention yet, so a new type folder shows up without code changes. Sorted by display name.
 */
export function catalog(): CatalogEntry[] {
  const known = new Set(KNOWN.map((e) => e.typeId));
  const extra = elementTypes()
    .filter((type) => !known.has(type.id))
    .map((type): CatalogEntry => ({ typeId: type.id, key: type.shortcut ?? "", group: "other", sprite: FALLBACK_SPRITE }));
  return [...KNOWN.map((e) => ({ ...e, key: typeOf(e.typeId)?.shortcut ?? e.key })), ...extra];
}

/** Sprite shown for an element type when its element has no texture of its own. */
export function spriteFor(typeId: string): SpriteName {
  return KNOWN.find((e) => e.typeId === typeId)?.sprite ?? FALLBACK_SPRITE;
}
