import type { SpriteName } from "./components/Sprite.tsx";
import { elementTypes, typeOf } from "./types.ts";
import type { CatalogId } from "./strings.ts";

export interface CatalogEntry {
  /** Element type id (type.json "id"). */
  typeId: string;
  /** Shortcut letter in the New element popup (MCreator's letters where it has one). */
  key: string;
  sprite: SpriteName;
  /** Shown while the type has no type.json yet. */
  label?: CatalogId;
}

/** Sprites, shortcut letters and placeholder labels of the MCreator element types MCEdge knows about. */
const KNOWN: CatalogEntry[] = [
  { typeId: "advancement", key: "h", sprite: "star", label: "advancement" },
  { typeId: "armor", key: "a", sprite: "chest", label: "armor" },
  { typeId: "armor_trim", key: "", sprite: "flag", label: "armorTrim" },
  { typeId: "attribute", key: "", sprite: "bars", label: "attribute" },
  { typeId: "banner_pattern", key: "", sprite: "flag", label: "bannerPattern" },
  { typeId: "biome", key: "o", sprite: "biome", label: "biome" },
  { typeId: "block", key: "b", sprite: "stone", label: "block" },
  { typeId: "bubble", key: "", sprite: "gui", label: "bubble" },
  { typeId: "command", key: "c", sprite: "cmd", label: "command" },
  { typeId: "creative_tab", key: "w", sprite: "tab", label: "creativeTab" },
  { typeId: "custom_element", key: "", sprite: "cmd", label: "customElement" },
  { typeId: "damage_type", key: "", sprite: "heart", label: "damageType" },
  { typeId: "dimension", key: "d", sprite: "portal", label: "dimension" },
  { typeId: "enchantment", key: "m", sprite: "book", label: "enchantment" },
  { typeId: "feature", key: "f", sprite: "feature", label: "feature" },
  { typeId: "fluid", key: "", sprite: "drop", label: "fluid" },
  { typeId: "function", key: "u", sprite: "cmd", label: "function" },
  { typeId: "game_rule", key: "", sprite: "list", label: "gameRule" },
  { typeId: "gui", key: "g", sprite: "gui", label: "gui" },
  { typeId: "item", key: "i", sprite: "ingot", label: "item" },
  { typeId: "item_extension", key: "", sprite: "raw", label: "itemExtension" },
  { typeId: "key_binding", key: "k", sprite: "key", label: "keyBinding" },
  { typeId: "living_entity", key: "e", sprite: "stalker", label: "livingEntity" },
  { typeId: "loot_table", key: "l", sprite: "loot", label: "lootTable" },
  { typeId: "overlay", key: "v", sprite: "gui", label: "overlay" },
  { typeId: "painting", key: "", sprite: "flag", label: "painting" },
  { typeId: "particle", key: "y", sprite: "particle", label: "particle" },
  { typeId: "plant", key: "n", sprite: "plant", label: "plant" },
  { typeId: "potion_effect", key: "", sprite: "potion", label: "potionEffect" },
  { typeId: "potion_item", key: "z", sprite: "potion", label: "potionItem" },
  { typeId: "procedure", key: "p", sprite: "proc", label: "procedure" },
  { typeId: "projectile", key: "q", sprite: "arrow", label: "projectile" },
  { typeId: "radial_menu", key: "", sprite: "gui", label: "radialMenu" },
  { typeId: "recipe", key: "r", sprite: "recipe", label: "recipe" },
  { typeId: "special_entity", key: "", sprite: "infuser", label: "specialEntity" },
  { typeId: "structure", key: "s", sprite: "bricks", label: "structure" },
  { typeId: "tool", key: "t", sprite: "pick", label: "tool" },
  { typeId: "villager_profession", key: "", sprite: "villager", label: "villagerProfession" },
  { typeId: "villager_trade", key: "", sprite: "emerald", label: "villagerTrade" },
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
    .map((type): CatalogEntry => ({ typeId: type.id, key: type.shortcut ?? "", sprite: FALLBACK_SPRITE }));
  return [...KNOWN.map((e) => ({ ...e, key: typeOf(e.typeId)?.shortcut ?? e.key })), ...extra];
}

/** Sprite shown for an element type when its element has no texture of its own. */
export function spriteFor(typeId: string): SpriteName {
  return KNOWN.find((e) => e.typeId === typeId)?.sprite ?? FALLBACK_SPRITE;
}
