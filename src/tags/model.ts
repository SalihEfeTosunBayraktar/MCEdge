import { REGISTRY_PROVIDERS, type ProjectIssue } from "../elements/model.ts";
import type { ModProject } from "../ir/types.ts";

/**
 * Element tags (the Element tags section, MCreator's tag lists): named lists of items, blocks, entities, ...
 * stored in <project>/tags.json and generated as data/<ns>/tags/<registry>/<path>.json. A tag either adds this mod's
 * (and vanilla) entries to an existing tag ("minecraft:logs") or defines one of the mod's own ("mymod:gems").
 *
 *   { "tags": [{ "type": "item", "id": "mymod:gems", "entries": ["ruby", "minecraft:diamond", "#c:gems"] }] }
 *
 * Entries: a mod element id ("ruby" or "mymod:ruby"), a vanilla id, or "#ns:tag" for a whole tag.
 */
export const TAG_TYPES = ["item", "block", "entity_type", "fluid", "biome", "function", "damage_type", "enchantment", "game_event"] as const;
export type TagType = (typeof TAG_TYPES)[number];

export interface ElementTag {
  type: TagType;
  /** "namespace:path"; the namespace defaults to the mod id. */
  id: string;
  entries: string[];
}

export const TAGS_FILE = "tags.json";

/** Registry folder under data/<ns>/tags/ on 1.21+ (TagEntry.registry). */
export const TAG_REGISTRY: Record<TagType, string> = {
  item: "item", block: "block", entity_type: "entity_type", fluid: "fluid", biome: "worldgen/biome", function: "function",
  damage_type: "damage_type", enchantment: "enchantment", game_event: "game_event",
};

/** Tag types Minecraft 1.16.5 has as data-driven tags; the others came with later versions. */
export const LEGACY_TAG_TYPES: TagType[] = ["item", "block", "entity_type", "fluid", "function"];

/** Mod element types whose ids a tag type can list (functions: the mod's function elements). */
export const TAG_PROVIDERS: Record<TagType, string[]> = {
  item: REGISTRY_PROVIDERS.item, block: REGISTRY_PROVIDERS.block, entity_type: REGISTRY_PROVIDERS.entity, fluid: ["fluid"],
  biome: ["biome"], function: ["function"], damage_type: ["damage_type"], enchantment: ["enchantment"], game_event: [],
};

/** "gems" -> "mymod:gems"; "#minecraft:logs" keeps its #. */
export function qualifyTagRef(modId: string, ref: string): string {
  const hash = ref.startsWith("#") ? "#" : "";
  const id = ref.replace(/^#/, "").trim();
  return hash + (id.includes(":") ? id : `${modId}:${id}`);
}

const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/** Problems of the tag list: bad ids, duplicate tags, unknown types, mod entries that name no element. */
export function validateTags(tags: ElementTag[], project: ModProject): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const seen = new Set<string>();
  tags.forEach((tag, i) => {
    const at = `tags[${i}]`;
    if (!(TAG_TYPES as readonly string[]).includes(tag.type)) issues.push({ path: `${at}.type`, message: `unknown tag type "${tag.type}"`, code: "tagType", values: { value: tag.type } });
    const id = qualifyTagRef(project.mod.id, tag.id);
    if (!ID.test(id)) issues.push({ path: `${at}.id`, message: `"${tag.id}" is not a tag id (namespace:path, lower case)`, code: "tagId", values: { value: tag.id } });
    if (seen.has(`${tag.type} ${id}`)) issues.push({ path: `${at}.id`, message: `${tag.type} tag ${id} is listed twice`, code: "tagTwice", values: { tagType: tag.type, value: id } });
    seen.add(`${tag.type} ${id}`);
    const own = new Set((TAG_PROVIDERS[tag.type] ?? []).flatMap((t) => (project.elements[t] ?? []).map((e) => e.id)));
    tag.entries.forEach((entry, j) => {
      const ref = qualifyTagRef(project.mod.id, entry);
      if (!ID.test(ref.replace(/^#/, ""))) issues.push({ path: `${at}.entries[${j}]`, message: `"${entry}" is not an id`, code: "tagEntryId", values: { value: entry } });
      else if (!ref.startsWith("#") && ref.startsWith(`${project.mod.id}:`) && !own.has(ref.slice(project.mod.id.length + 1))) {
        issues.push({ path: `${at}.entries[${j}]`, message: `no ${tag.type} element "${entry}" in this mod`, code: "tagNoElement", values: { tagType: tag.type, value: entry } });
      }
    });
  });
  return issues;
}
