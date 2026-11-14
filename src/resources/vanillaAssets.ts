import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import vanillaIds from "../../config/vanilla-ids.json" with { type: "json" };

/**
 * Vanilla items, blocks and entities for the item and block picker (KUYRUK 127). MCEdge ships no Minecraft art; the
 * names and icons come from a Minecraft client jar Gradle already downloaded for an engine (Fabric Loom, NeoForm,
 * ForgeGradle caches under the Gradle user home). Without one, the picker offers the bundled id list
 * (config/vanilla-ids.json) without icons. Nothing is written: the jar is only read.
 */

export type PickerKind = "item" | "block" | "entity";

export interface VanillaCatalog {
  /** The client jar the names and icons come from; undefined when no engine has downloaded Minecraft yet. */
  jar?: string;
  /** Minecraft version of that jar, when known from its path. */
  minecraft?: string;
  /** Namespaced ids, sorted. */
  ids: string[];
  /** Item and block tags ("#minecraft:logs") the picker offers for fields that take tags. */
  tags: string[];
  /** In-game names by id in the asked language (English when that language is not downloaded); missing ids have none. */
  names: Record<string, string>;
}

const gradleHome = () => process.env.GRADLE_USER_HOME ?? join(homedir(), ".gradle");

/** Client jars on this machine, by Minecraft version: Loom, NeoForm and ForgeGradle cache them. */
export function clientJars(): { minecraft: string; file: string }[] {
  const caches = join(gradleHome(), "caches");
  const out: { minecraft: string; file: string }[] = [];
  const list = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
  for (const version of list(join(caches, "fabric-loom"))) {
    const file = join(caches, "fabric-loom", version, "minecraft-client.jar");
    if (existsSync(file)) out.push({ minecraft: version, file });
  }
  for (const name of list(join(caches, "neoformruntime", "artifacts"))) {
    const match = /^minecraft_(.+)_client\.jar$/.exec(name);
    if (match) out.push({ minecraft: match[1], file: join(caches, "neoformruntime", "artifacts", name) });
  }
  for (const version of list(join(caches, "forge_gradle", "minecraft_repo", "versions"))) {
    const file = join(caches, "forge_gradle", "minecraft_repo", "versions", version, "client.jar");
    if (existsSync(file)) out.push({ minecraft: version, file });
  }
  return out.filter((j) => statSync(j.file).size > 1_000_000);
}

const versionKey = (v: string) => v.split(/[.-]/).map((n) => n.padStart(4, "0")).join(".");

/** The jar for `minecraft` when there is one, else the newest. */
export function clientJar(minecraft?: string): { minecraft: string; file: string } | undefined {
  const jars = clientJars();
  return jars.find((j) => j.minecraft === minecraft) ?? jars.sort((a, b) => versionKey(b.minecraft).localeCompare(versionKey(a.minecraft)))[0];
}

// ---- zip reading (central directory once per jar, entries on demand) ----

interface Entry { method: number; size: number; local: number }
const indexes = new Map<string, Map<string, Entry>>();

function zipIndex(file: string): Map<string, Entry> {
  const known = indexes.get(file);
  if (known) return known;
  const fd = openSync(file, "r");
  try {
    const length = statSync(file).size;
    const tail = Buffer.alloc(Math.min(length, 65_557));
    readSync(fd, tail, 0, tail.length, length - tail.length);
    let end = tail.length - 22;
    while (end >= 0 && tail.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0) throw new Error(`not a zip: ${file}`);
    const count = tail.readUInt16LE(end + 10);
    const dirSize = tail.readUInt32LE(end + 12);
    const dir = Buffer.alloc(dirSize);
    readSync(fd, dir, 0, dirSize, tail.readUInt32LE(end + 16));
    const index = new Map<string, Entry>();
    for (let i = 0, at = 0; i < count; i++) {
      const nameLength = dir.readUInt16LE(at + 28);
      index.set(dir.toString("utf8", at + 46, at + 46 + nameLength), {
        method: dir.readUInt16LE(at + 10), size: dir.readUInt32LE(at + 20), local: dir.readUInt32LE(at + 42),
      });
      at += 46 + nameLength + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    }
    indexes.set(file, index);
    return index;
  } finally {
    closeSync(fd);
  }
}

function readEntry(file: string, entry: Entry): Buffer {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(30);
    readSync(fd, header, 0, 30, entry.local);
    const data = Buffer.alloc(entry.size);
    readSync(fd, data, 0, entry.size, entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28));
    return entry.method === 8 ? inflateRawSync(data) : data;
  } finally {
    closeSync(fd);
  }
}

// ---- catalog ----

const bundled = vanillaIds as unknown as Record<string, string[]>;
const catalogs = new Map<string, VanillaCatalog>();

/** Names of the files in a jar folder: "assets/minecraft/items/" -> ["minecraft:apple", ...]. */
function namesIn(index: Map<string, Entry>, folder: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of index.keys()) {
    if (name.startsWith(folder) && name.endsWith(ext) && !name.slice(folder.length).includes("/")) out.push(`minecraft:${name.slice(folder.length, -ext.length)}`);
  }
  return out;
}

/**
 * Every vanilla id of a kind the jar knows: items from the item definitions (items/, or models/item/ before 1.21.4),
 * blocks from the blockstates, entities from the bundled list plus every spawn egg. Without a jar: the bundled list.
 */
export function vanillaCatalog(kind: PickerKind, minecraft?: string, language = "en_us"): VanillaCatalog {
  const jar = clientJar(minecraft);
  const key = `${kind}|${jar?.file ?? ""}|${language}`;
  const known = catalogs.get(key);
  if (known) return known;
  // The jar's own list is exact for its version; the bundled list is the fallback (and the base for entities, which have no asset list).
  const ids = new Set(!jar || kind === "entity" ? bundled[kind] ?? [] : []);
  if (jar) {
    const index = zipIndex(jar.file);
    const items = namesIn(index, "assets/minecraft/items/", ".json");
    if (kind === "item") {
      // Before 1.21.4 there are no item definitions; the item models also hold parents such as "generated" and "template_bed".
      const models = namesIn(index, "assets/minecraft/models/item/", ".json").filter((id) => !/^minecraft:(generated|handheld.*|template_.*)$/.test(id));
      for (const id of items.length ? items : models) ids.add(id);
    }
    if (kind === "block") for (const id of namesIn(index, "assets/minecraft/blockstates/", ".json")) ids.add(id);
    if (kind === "entity") for (const id of items) if (id.endsWith("_spawn_egg")) ids.add(id.slice(0, -"_spawn_egg".length));
  }
  for (const id of ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]) ids.delete(id);
  const tags = kind === "entity" ? [] : [...new Set(bundled.tag ?? [])].sort();
  const lang = jar ? langFile(jar, language) : {};
  const prefixes = kind === "entity" ? ["entity"] : kind === "block" ? ["block", "item"] : ["item", "block"];
  const names: Record<string, string> = {};
  for (const id of ids) {
    const path = id.replace(/^minecraft:/, "");
    const name = prefixes.map((p) => lang[`${p}.minecraft.${path}`]).find(Boolean);
    if (name) names[id] = name;
  }
  const catalog = { jar: jar?.file, minecraft: jar?.minecraft, ids: [...ids].sort(), tags, names };
  catalogs.set(key, catalog);
  return catalog;
}

/**
 * A language file of the game: en_us is in the client jar; the others are downloaded game assets, found through the
 * asset indexes Loom and NeoForm keep (indexes/<version>-*.json names objects/<hash>). English when it is not there.
 */
function langFile(jar: { minecraft: string; file: string }, language: string): Record<string, string> {
  const read = (): Record<string, string> => {
    const en = zipIndex(jar.file).get("assets/minecraft/lang/en_us.json");
    return en ? JSON.parse(readEntry(jar.file, en).toString("utf8")) : {};
  };
  if (language === "en_us") return read();
  for (const base of [join(gradleHome(), "caches", "fabric-loom", "assets"), join(gradleHome(), "caches", "minecraft", "assets")]) {
    const indexes = join(base, "indexes");
    if (!existsSync(indexes)) continue;
    const files = readdirSync(indexes).filter((f) => f.endsWith(".json")).sort((a, b) => Number(b.startsWith(`${jar.minecraft}-`)) - Number(a.startsWith(`${jar.minecraft}-`)));
    for (const file of files) {
      try {
        const object = JSON.parse(readFileSync(join(indexes, file), "utf8")).objects?.[`minecraft/lang/${language}.json`] as { hash: string } | undefined;
        const path = object && join(base, "objects", object.hash.slice(0, 2), object.hash);
        if (path && existsSync(path)) return { ...read(), ...JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        // a broken index is skipped
      }
    }
  }
  return read();
}

// ---- icons ----

const icons = new Map<string, string | null>();

const TEXTURE_KEYS = ["layer0", "all", "texture", "side", "front", "cross", "plant", "top", "end", "wool", "pattern", "particle"];

/** The texture a model shows first (its own or a parent's), as a jar path: "minecraft:block/acacia_planks" via "#texture". */
function modelTexture(index: Map<string, Entry>, jar: string, model: string): string | undefined {
  const textures: Record<string, string> = {};
  for (let name: string | undefined = model, depth = 0; name && depth < 8; depth++) {
    const entry = index.get(`assets/minecraft/models/${name.replace(/^minecraft:/, "")}.json`);
    if (!entry) break;
    let json: { parent?: string; textures?: Record<string, string | { sprite?: string }> };
    try {
      json = JSON.parse(readEntry(jar, entry).toString("utf8"));
    } catch {
      break;
    }
    // 26.x writes a texture as { sprite, force_translucent }.
    for (const [k, v] of Object.entries(json.textures ?? {})) if (!(k in textures) && (typeof v === "string" || v?.sprite)) textures[k] = typeof v === "string" ? v : v.sprite!;
    name = json.parent;
  }
  const resolve = (value: string | undefined, depth = 0): string | undefined =>
    value?.startsWith("#") && depth < 8 ? resolve(textures[value.slice(1)], depth + 1) : value;
  for (const key of TEXTURE_KEYS) {
    const found = resolve(textures[key]);
    if (found && !found.startsWith("#")) return `assets/minecraft/textures/${found.replace(/^minecraft:/, "")}.png`;
  }
  return undefined;
}

/** Texture paths tried for an id, most specific first: the item or block model's texture, then files named after it. */
function texturesFor(kind: PickerKind, path: string, index: Map<string, Entry>, jar: string): string[] {
  const t = (folder: string, name: string) => `assets/minecraft/textures/${folder}/${name}.png`;
  if (kind === "entity") return [t("item", `${path}_spawn_egg`), t("item", path)];
  const state = index.get(`assets/minecraft/blockstates/${path}.json`);
  const stateModel = state ? /"model"\s*:\s*"([^"]+)"/.exec(readEntry(jar, state).toString("utf8"))?.[1] : undefined;
  const models = kind === "block" ? [`block/${path}`, `block/${path}_inventory`, stateModel, `item/${path}`] : [`item/${path}`, `block/${path}_inventory`, `block/${path}`, stateModel];
  const fromModels = models.filter((m): m is string => !!m).map((m) => modelTexture(index, jar, m));
  // Clocks and compasses are animated through numbered textures.
  const named = kind === "block" ? [t("block", path), t("item", path)] : [t("item", path), t("block", path), t("item", `${path}_00`), t("item", `${path}_16`)];
  return [...fromModels.filter((p): p is string => !!p), ...named];
}

/**
 * PNG data URLs of vanilla ids ("minecraft:apple"), null where the jar has no picture for it (or there is no jar).
 * Animated textures are strips; the picker shows their first frame.
 */
export function vanillaIcons(kind: PickerKind, ids: string[], minecraft?: string): Record<string, string | null> {
  const jar = clientJar(minecraft);
  const out: Record<string, string | null> = {};
  for (const id of ids) {
    const key = `${kind}|${jar?.file ?? ""}|${id}`;
    if (!icons.has(key)) {
      let url: string | null = null;
      const [ns, path] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
      if (jar && ns === "minecraft" && path) {
        const index = zipIndex(jar.file);
        const found = texturesFor(kind, path, index, jar.file).map((name) => index.get(name)).find(Boolean);
        if (found) url = `data:image/png;base64,${readEntry(jar.file, found).toString("base64")}`;
      }
      icons.set(key, url);
    }
    out[id] = icons.get(key)!;
  }
  return out;
}
