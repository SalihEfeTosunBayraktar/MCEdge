import { LEGACY_TAG_TYPES, loadTags, qualifyTagRef, TAG_REGISTRY } from "../tags/tags.ts";
import type { GenEnv, TagEntry } from "./typeModule.ts";

/**
 * The project's element tags (<project>/tags.json) as tag entries, merged with the elements' own tag memberships
 * into data/<ns>/tags/... by buildTags. 1.16.5 has item, block, entity, fluid and function tags only; the others
 * are listed in `skipped`.
 */
export function projectTags(env: GenEnv): { tags: TagEntry[]; skipped: string[] } {
  const tags: TagEntry[] = [];
  const skipped: string[] = [];
  for (const tag of loadTags(env.projectDir)) {
    const id = qualifyTagRef(env.modId, tag.id);
    if (env.mc === "1.16.5" && !LEGACY_TAG_TYPES.includes(tag.type)) {
      skipped.push(`${tag.type} tag ${id} (Minecraft ${env.mc} has no ${tag.type} tags)`);
      continue;
    }
    // An empty value still writes the file, so a tag the mod defines exists even with no entries yet.
    if (!tag.entries.length) tags.push({ registry: TAG_REGISTRY[tag.type], tag: id, value: "" });
    for (const entry of tag.entries) tags.push({ registry: TAG_REGISTRY[tag.type], tag: id, value: qualifyTagRef(env.modId, entry) });
  }
  return { tags, skipped };
}
