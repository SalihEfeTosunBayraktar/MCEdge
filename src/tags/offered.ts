import commonTags from "../../config/common-tags.json" with { type: "json" };
import type { Element } from "../elements/model.ts";
import { TAG_PROVIDERS, type TagType } from "./model.ts";

/**
 * Tags > Common tags (KUYRUK 135): the common tags other mods and the game read (config/common-tags.json "offered"),
 * each with the project's elements it would suggest: ids with a suffix ("_ingot") or prefix ("raw_"), or a field
 * value (destroyTool "pickaxe"). forge: names are written as each version's tag when generated (generator/commonTags.ts).
 */
export interface OfferedTag {
  type: TagType;
  id: string;
  suffix?: string;
  prefix?: string;
  field?: [string, string];
}

export const OFFERED_TAGS = commonTags.offered as OfferedTag[];

/** Ids of the project's elements the tag suggests, among the element types its tag type lists. */
export function suggestedEntries(tag: OfferedTag, elements: Record<string, Element[]>): string[] {
  if (!tag.suffix && !tag.prefix && !tag.field) return [];
  const ids = new Set<string>();
  for (const typeId of TAG_PROVIDERS[tag.type] ?? []) {
    for (const element of elements[typeId] ?? []) {
      const byId = (tag.suffix && element.id.endsWith(tag.suffix)) || (tag.prefix && element.id.startsWith(tag.prefix));
      const byField = tag.field && element[tag.field[0]] === tag.field[1];
      if (byId || byField) ids.add(element.id);
    }
  }
  return [...ids].sort();
}
