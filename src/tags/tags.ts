import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TAGS_FILE, type ElementTag } from "./model.ts";

/** Reading and writing <project>/tags.json; the tag model and its checks are in ./model.ts (also used by the app UI). */
export * from "./model.ts";

export function loadTags(dir: string): ElementTag[] {
  const file = join(dir, TAGS_FILE);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { tags?: ElementTag[] };
  return Array.isArray(data.tags) ? data.tags : [];
}

export function saveTags(dir: string, tags: ElementTag[]): void {
  const sorted = [...tags].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  writeFileSync(join(dir, TAGS_FILE), JSON.stringify({ tags: sorted }, null, 2) + "\n");
}
