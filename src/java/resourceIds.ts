/**
 * The mod's own ids, offered inside Java string literals in code project mode: registry ids (`modid:name`) read from
 * src/main/resources (models, blockstates, textures, sounds.json events, recipes, loot tables, tags, advancements,
 * lang keys) and resource paths (`modid:textures/...png`). Pure: the caller lists the files and reads the JSON.
 */

export type ResourceKind =
  | "item" | "block" | "entity" | "sound" | "recipe" | "loot_table" | "tag" | "advancement" | "model" | "texture" | "particle" | "lang" | "path";

export interface ResourceId {
  /** What goes between the quotes, e.g. "etreco:coin", "etreco:textures/items/coin.png", "item.etreco.coin". */
  id: string;
  /** Every kind the id was found as, in a stable order (an id can be both an item and a block). */
  kinds: ResourceKind[];
}

export interface ModResources {
  /** Paths under src/main/resources, forward slashes ("assets/etreco/models/item/coin.json"). */
  files: string[];
  /** Sound event names of each namespace's sounds.json. */
  sounds?: Record<string, string[]>;
  /** Translation keys of each namespace's lang files. */
  lang?: Record<string, string[]>;
}

const KIND_ORDER: ResourceKind[] = ["item", "block", "entity", "sound", "recipe", "loot_table", "tag", "advancement", "model", "texture", "particle", "lang", "path"];
const DATA_FOLDERS: Record<string, ResourceKind> = {
  recipes: "recipe", recipe: "recipe", loot_tables: "loot_table", loot_table: "loot_table", advancements: "advancement", advancement: "advancement",
};
const LANG_KINDS: Record<string, ResourceKind> = { item: "item", block: "block", entity: "entity" };

/** Every id the mod's resources define, sorted. */
export function collectResourceIds(resources: ModResources): ResourceId[] {
  const found = new Map<string, Set<ResourceKind>>();
  const add = (id: string, kind: ResourceKind) => {
    const kinds = found.get(id) ?? new Set<ResourceKind>();
    kinds.add(kind);
    found.set(id, kinds);
  };
  for (const file of resources.files) {
    const parts = file.split("/");
    const [root, ns, folder] = parts;
    if (!ns || !folder || parts.length < 4) continue;
    const rest = parts.slice(3).join("/");
    const stem = rest.replace(/\.[^./]+$/, "");
    if (root === "assets") {
      if (folder === "blockstates" && rest.endsWith(".json")) add(`${ns}:${stem}`, "block");
      else if (folder === "models" && rest.endsWith(".json")) {
        add(`${ns}:${stem}`, "model");
        if (stem.startsWith("item/")) add(`${ns}:${stem.slice(5)}`, "item");
      } else if (folder === "textures" && rest.endsWith(".png")) {
        add(`${ns}:${stem}`, "texture");
        add(`${ns}:textures/${rest}`, "path");
      } else if (folder === "particles" && rest.endsWith(".json")) add(`${ns}:${stem}`, "particle");
      else if (folder === "sounds" && rest.endsWith(".ogg")) add(`${ns}:sounds/${rest}`, "path");
    } else if (root === "data") {
      if (!rest.endsWith(".json")) continue;
      if (folder === "tags" && parts.length >= 5) add(`${ns}:${parts.slice(4).join("/").replace(/\.json$/, "")}`, "tag");
      else if (DATA_FOLDERS[folder]) add(`${ns}:${stem}`, DATA_FOLDERS[folder]);
    }
  }
  for (const [ns, events] of Object.entries(resources.sounds ?? {})) for (const event of events) add(`${ns}:${event}`, "sound");
  for (const [ns, keys] of Object.entries(resources.lang ?? {})) {
    for (const key of keys) {
      add(key, "lang");
      const match = /^(item|block|entity)\.([a-z0-9_.-]+?)\.([a-z0-9_/.-]+)$/.exec(key);
      if (match && match[2] === ns) add(`${ns}:${match[3]}`, LANG_KINDS[match[1]]);
    }
  }
  return [...found].map(([id, kinds]) => ({ id, kinds: KIND_ORDER.filter((k) => kinds.has(k)) })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Where the string literal around the cursor starts, when the cursor (0-based offset in `line`) is inside one;
 * `prefix` is the text between the opening quote and the cursor. Comments and char literals are skipped.
 */
export function stringAtCursor(line: string, cursor: number): { start: number; prefix: string } | undefined {
  let open = -1;
  for (let i = 0; i < cursor && i < line.length; i++) {
    const ch = line[i];
    if (open >= 0) {
      if (ch === "\\") i++;
      else if (ch === "\"") open = -1;
    } else if (ch === "\"") open = i;
    else if (ch === "'") i = skipChar(line, i);
    else if (ch === "/" && line[i + 1] === "/") return undefined;
  }
  return open >= 0 ? { start: open + 1, prefix: line.slice(open + 1, cursor) } : undefined;
}

function skipChar(line: string, i: number): number {
  let j = i + 1;
  while (j < line.length && line[j] !== "'") j += line[j] === "\\" ? 2 : 1;
  return j;
}

/** The ids worth offering for what is typed so far: those containing the prefix (case-insensitive), at most `limit`. */
export function matchResourceIds(ids: ResourceId[], prefix: string, limit = 400): ResourceId[] {
  const needle = prefix.toLowerCase();
  if (/\s/.test(needle)) return [];
  const starts: ResourceId[] = [];
  const contains: ResourceId[] = [];
  for (const entry of ids) {
    const id = entry.id.toLowerCase();
    if (id.startsWith(needle)) starts.push(entry);
    else if (needle && id.includes(needle)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}
