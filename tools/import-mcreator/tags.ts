// MCreator 1.16.5 import of the mod's data tags (KUYRUK #193): data/<ns>/tags/<folder>/<path>.json become element tags
// in tags.json, so the Element tags section and list_tags show them. A tag tags.json cannot hold stays a datapack file.
// The importer reads the exported sources only (no .mcreator workspace), so these files are the one copy of each tag.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadTags, qualifyTagRef, saveTags, type ElementTag, type TagType } from "../../src/tags/tags.ts";

/** 1.16.5 tag folders and their tags.json type. */
const FOLDERS: Record<string, TagType> = { items: "item", blocks: "block", entity_types: "entity_type", fluids: "fluid", functions: "function" };

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** Why a tag file stays in datapack/, or undefined when tags.json can hold it. */
function keepReason(folder: string, json: { replace?: boolean; values?: unknown[] }): string | undefined {
  if (!FOLDERS[folder]) return `no element tag type for tags/${folder}`;
  if (json.replace) return `"replace": true`;
  if (!Array.isArray(json.values) || json.values.some((v) => typeof v !== "string")) return "entries that are not plain ids";
  return undefined;
}

/**
 * Imports every tag file under the legacy data folder: the mod's own ids lose the mod namespace, minecraft:air
 * (MCreator's empty slot) is dropped, and an empty tag of another namespace (adds nothing) is skipped. An existing
 * tags.json entry of the same tag is replaced, and an earlier raw copy in datapack/ is removed.
 */
export function importTags(dataDir: string, modId: string, projectDir: string): number {
  const imported: ElementTag[] = [];
  for (const namespace of readdirSync(dataDir)) {
    const tagsDir = join(dataDir, namespace, "tags");
    if (!existsSync(tagsDir)) continue;
    for (const file of walk(tagsDir).filter((f) => f.endsWith(".json"))) {
      const rel = relative(tagsDir, file).replaceAll("\\", "/");
      const folder = rel.slice(0, rel.indexOf("/"));
      const copy = join(projectDir, "datapack", namespace, "tags", rel);
      const json = JSON.parse(readFileSync(file, "utf8")) as { replace?: boolean; values?: unknown[] };
      const reason = keepReason(folder, json);
      if (reason) {
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(file, copy);
        console.log(`tag ${namespace}:${rel}: kept in datapack/ (${reason})`);
        continue;
      }
      rmSync(copy, { force: true });
      const entries = (json.values as string[]).filter((v) => v !== "minecraft:air").map((v) => (v.startsWith(`${modId}:`) ? v.slice(modId.length + 1) : v));
      const id = `${namespace}:${rel.slice(folder.length + 1, -5)}`;
      if (!entries.length && namespace !== modId) {
        console.log(`tag ${id}: empty, adds nothing to the ${namespace} tag, not imported`);
        continue;
      }
      imported.push({ type: FOLDERS[folder], id, entries });
    }
  }
  const key = (tag: ElementTag) => `${tag.type} ${qualifyTagRef(modId, tag.id)}`;
  const replaced = new Set(imported.map(key));
  saveTags(projectDir, [...loadTags(projectDir).filter((tag) => !replaced.has(key(tag))), ...imported]);
  return imported.length;
}
