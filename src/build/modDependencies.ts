import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import type { Engine } from "../engines/registry.ts";
import { toolchainsDir } from "../engines/toolchains.ts";
import type { Dependency } from "../ir/types.ts";
import { userDataDir } from "../userData.ts";

/**
 * Other mods in dev runs (KUYRUK 152). A project's dependencies resolve to real jars, from Modrinth (by mod id or the
 * dependency's `source.modrinth`), CurseForge (`source.curseforge`, or the mod id when Modrinth has no version; KUYRUK
 * 173, needs this computer's API key) or a Maven repository (`source.maven` + `source.repository`), with the required
 * dependencies of those jars. The jars are cached once per machine under <toolchains>/mods as a local Maven repository,
 * and the generator adds them to the engine's Gradle project the way its loader needs, so runClient and runServer
 * load them. Resolving needs the network; generating only reads the cache (mods/index.json).
 */

export const MODS_DIR = "mods";
const GROUP = "mcedge.mods";
/** API roots; the environment overrides them for tests (a local mock server). */
const modrinthApi = () => process.env.MCEDGE_MODRINTH_API ?? "https://api.modrinth.com/v2";
const curseforgeApi = () => process.env.MCEDGE_CURSEFORGE_API ?? "https://api.curseforge.com/v1";
const USER_AGENT = "MCEdge (https://github.com/SalihEfeTosunBayraktar/MCEdge)";
/** Projects every engine of the loader already has: Fabric API comes with the Fabric engines. */
const PROVIDED: Record<string, string[]> = { fabric: ["P7dR8mSH", "fabric-api", "306612"] };

export interface DependencyJar {
  /** Modrinth slug, or the Maven artifact. */
  project: string;
  title?: string;
  version: string;
  /** Coordinates in the local repository: "mcedge.mods:geckolib-fabric-1.21.5:5.1.0". */
  coords: string;
  /** The cached jar, absolute. */
  file: string;
  size: number;
  /** Set for a jar another dependency needs: that dependency's project. */
  via?: string;
  /** The mod id in the jar's metadata (fabric.mod.json, mods.toml); it can differ from the project's ("geckolib3"). */
  modId?: string;
}

export interface DependencyResolution {
  modId: string;
  constraint: string;
  required: boolean;
  status: "resolved" | "unavailable" | "failed" | "unresolved";
  message?: string;
  source: "modrinth" | "maven" | "curseforge";
  resolvedAt?: string;
  /** The dependency's own jar first, then the jars it needs. */
  jars: DependencyJar[];
}

interface IndexEntry {
  status: DependencyResolution["status"];
  message?: string;
  source: DependencyResolution["source"];
  resolvedAt: string;
  jars: (Omit<DependencyJar, "file"> & { file: string })[];
}

const modsDir = () => join(toolchainsDir(), MODS_DIR);
const repoDir = () => join(modsDir(), "maven");
const indexFile = () => join(modsDir(), "index.json");
const keyOf = (dep: Dependency, engine: Engine) => [engine.loader, engine.minecraft, dep.modId, dep.version, dep.source?.modrinth ?? "", dep.source?.maven ?? "",
  ...(dep.source?.curseforge ? [`cf:${dep.source.curseforge}`] : [])].join("|");

// ---- the CurseForge API key (KUYRUK 173) ----

/**
 * The CurseForge API key of this computer, never of a project: $MCEDGE_CURSEFORGE_KEY, else the app's Preferences
 * (the app sets its own reader; the CLI and the MCP server read app-state.json in the app's user data folder,
 * $MCEDGE_USER_DATA or the platform's default).
 */
let keyReader: (() => string | undefined) | undefined;
export function setCurseforgeKeyReader(read: () => string | undefined): void {
  keyReader = read;
}
export function curseforgeKey(): string | undefined {
  const env = process.env.MCEDGE_CURSEFORGE_KEY?.trim();
  if (env) return env;
  if (keyReader) return keyReader()?.trim() || undefined;
  try {
    const key = (JSON.parse(readFileSync(join(userDataDir(), "app-state.json"), "utf8")) as { preferences?: { curseforgeKey?: string } }).preferences?.curseforgeKey;
    return key?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readIndex(): Record<string, IndexEntry> {
  try {
    return (JSON.parse(readFileSync(indexFile(), "utf8")) as { entries: Record<string, IndexEntry> }).entries ?? {};
  } catch {
    return {};
  }
}

function writeIndex(update: (entries: Record<string, IndexEntry>) => void): void {
  // Read again right before writing, so runs resolving other engines at the same time keep their entries.
  const entries = readIndex();
  update(entries);
  mkdirSync(modsDir(), { recursive: true });
  const tmp = `${indexFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ entries }, null, 2) + "\n");
  renameSync(tmp, indexFile());
}

// ---- versions ----

/** The numeric parts of a version text: "geckolib-fabric-1.21.5-5.1.0" -> the last x.y.z run, [5, 1, 0]. */
export function versionParts(text: string): number[] {
  const runs = text.match(/\d+(?:\.\d+)+|\d+/g) ?? [];
  const last = runs.at(-1) ?? "0";
  return last.split(".").map(Number);
}

export function compareVersions(a: string, b: string): number {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Whether a version meets a project constraint: "*", an exact "1.2.0" (also matches 1.2.0.x) or a minimum ">=1.2.0". */
export function versionMatches(version: string, constraint: string): boolean {
  const c = constraint.trim();
  if (!c || c === "*") return true;
  if (c.startsWith(">=")) return compareVersions(version, c.slice(2).trim()) >= 0;
  const want = versionParts(c);
  const have = versionParts(version);
  return want.every((n, i) => have[i] === n);
}

// ---- downloads ----

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!response.ok) throw new HttpError(response.status, `${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Downloads into the local repository (jar + a minimal pom) unless it is there; returns the jar path. */
async function store(url: string, artifact: string, version: string, sha1?: string): Promise<{ file: string; size: number }> {
  const dir = join(repoDir(), ...GROUP.split("."), artifact, version);
  const file = join(dir, `${artifact}-${version}.jar`);
  if (!existsSync(file)) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha1 && createHash("sha1").update(bytes).digest("hex") !== sha1) throw new Error(`checksum mismatch: ${url}`);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
    writeFileSync(join(dir, `${artifact}-${version}.pom`), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>${GROUP}</groupId><artifactId>${artifact}</artifactId><version>${version}</version><packaging>jar</packaging></project>
`);
  }
  return { file, size: statSync(file).size };
}

const safe = (text: string) => text.replace(/[^A-Za-z0-9._+-]/g, "_");

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  date_published: string;
  files: { url: string; filename: string; primary: boolean; hashes: { sha1?: string } }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}

/** The newest Modrinth version of a project for the engine's loader and Minecraft version that meets the constraint. */
async function modrinthVersion(project: string, engine: Engine, constraint: string): Promise<ModrinthVersion | undefined> {
  const query = `loaders=${encodeURIComponent(JSON.stringify([engine.loader]))}&game_versions=${encodeURIComponent(JSON.stringify([engine.minecraft]))}`;
  const versions = await json<ModrinthVersion[]>(`${modrinthApi()}/project/${encodeURIComponent(project)}/version?${query}`);
  return versions
    .filter((v) => versionMatches(v.version_number, constraint))
    .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published))[0];
}

/** A Modrinth project and the required projects it needs, depth first; `seen` stops cycles and duplicates. */
async function modrinthJars(project: string, engine: Engine, constraint: string, seen: Set<string>, via?: string, pinned?: string): Promise<DependencyJar[]> {
  const version = pinned ? await json<ModrinthVersion>(`${modrinthApi()}/version/${pinned}`) : await modrinthVersion(project, engine, constraint);
  if (!version) return [];
  if (seen.has(version.project_id)) return [];
  seen.add(version.project_id);
  const info = await json<{ slug: string; title: string }>(`${modrinthApi()}/project/${version.project_id}`);
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error(`${info.slug} ${version.version_number} has no file`);
  const artifact = `${safe(info.slug)}-${engine.loader}-${engine.minecraft}`;
  const v = safe(version.version_number);
  const stored = await store(file.url, artifact, v, file.hashes.sha1);
  const jars: DependencyJar[] = [{ project: info.slug, title: info.title, version: version.version_number, coords: `${GROUP}:${artifact}:${v}`, ...stored, ...(via ? { via } : {}) }];
  for (const dep of version.dependencies) {
    if (dep.dependency_type !== "required" || !dep.project_id) continue;
    if (PROVIDED[engine.loader]?.includes(dep.project_id) || seen.has(dep.project_id)) continue;
    const more = await modrinthJars(dep.project_id, engine, "*", seen, info.slug, dep.version_id ?? undefined);
    if (!more.length) throw new Error(`${info.slug} needs ${dep.project_id}, which has no version for ${engine.loader} ${engine.minecraft}`);
    jars.push(...more);
  }
  return jars;
}

// ---- CurseForge (KUYRUK 173) ----

const CF_MINECRAFT = 432;
const CF_MODS = 6;
/** CurseForge's mod loader types. */
const CF_LOADER: Record<string, number> = { forge: 1, fabric: 4, neoforge: 6 };
const CF_REQUIRED = 3;

interface CurseForgeMod { id: number; slug: string; name: string }
interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  downloadUrl: string | null;
  hashes?: { value: string; algo: number }[];
  dependencies?: { modId: number; relationType: number }[];
}

/** A CurseForge project by numeric id or slug. */
async function curseforgeMod(project: string, key: string): Promise<CurseForgeMod | undefined> {
  const headers = { "x-api-key": key };
  if (/^\d+$/.test(project)) return (await json<{ data: CurseForgeMod }>(`${curseforgeApi()}/mods/${project}`, headers)).data;
  const found = await json<{ data: CurseForgeMod[] }>(`${curseforgeApi()}/mods/search?gameId=${CF_MINECRAFT}&classId=${CF_MODS}&slug=${encodeURIComponent(project)}`, headers);
  return found.data.find((m) => m.slug === project) ?? found.data[0];
}

/** A CurseForge project's newest file for the engine that meets the constraint, and the required projects it needs. */
async function curseforgeJars(project: string, engine: Engine, constraint: string, key: string, seen: Set<string>, via?: string): Promise<DependencyJar[]> {
  const mod = await curseforgeMod(project, key);
  if (!mod || seen.has(`cf:${mod.id}`)) return [];
  seen.add(`cf:${mod.id}`);
  const query = `gameVersion=${encodeURIComponent(engine.minecraft)}&modLoaderType=${CF_LOADER[engine.loader] ?? 0}&pageSize=50`;
  const files = (await json<{ data: CurseForgeFile[] }>(`${curseforgeApi()}/mods/${mod.id}/files?${query}`, { "x-api-key": key })).data;
  const file = files
    .filter((f) => versionMatches(f.displayName || f.fileName, constraint) || versionMatches(f.fileName.replace(/\.jar$/i, ""), constraint))
    .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0];
  if (!file) return [];
  // An author can keep files off third-party downloads; the API then gives no URL.
  if (!file.downloadUrl) throw new Error(`${mod.slug} does not allow downloads outside CurseForge; put the jar in a Maven repository (source.maven)`);
  const version = versionParts(file.fileName.replace(/\.jar$/i, "")).join(".");
  const artifact = `${safe(mod.slug)}-${engine.loader}-${engine.minecraft}`;
  const v = safe(`${version}-cf${file.id}`);
  const stored = await store(file.downloadUrl, artifact, v, file.hashes?.find((h) => h.algo === 1)?.value);
  const jars: DependencyJar[] = [{ project: mod.slug, title: mod.name, version: file.displayName || version, coords: `${GROUP}:${artifact}:${v}`, ...stored, ...(via ? { via } : {}) }];
  for (const dep of file.dependencies ?? []) {
    if (dep.relationType !== CF_REQUIRED || PROVIDED[engine.loader]?.includes(String(dep.modId)) || seen.has(`cf:${dep.modId}`)) continue;
    const more = await curseforgeJars(String(dep.modId), engine, "*", key, seen, mod.slug);
    if (!more.length) throw new Error(`${mod.slug} needs CurseForge project ${dep.modId}, which has no file for ${engine.loader} ${engine.minecraft}`);
    jars.push(...more);
  }
  return jars;
}

const NO_KEY = "CurseForge needs an API key: set it in Preferences > Mod sources (or MCEDGE_CURSEFORGE_KEY)";

/** "{loader}" and "{mc}" in Maven coordinates are the engine's. */
async function mavenJar(dep: Dependency, engine: Engine): Promise<DependencyJar> {
  const coords = dep.source!.maven!.replaceAll("{loader}", engine.loader).replaceAll("{mc}", engine.minecraft);
  const [group, artifact, version] = coords.split(":");
  if (!group || !artifact || !version) throw new Error(`maven coordinates must be group:artifact:version: ${coords}`);
  const repository = (dep.source?.repository ?? "https://repo1.maven.org/maven2").replace(/\/$/, "");
  const url = `${repository}/${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}.jar`;
  const local = `${safe(artifact)}-${engine.loader}-${engine.minecraft}`;
  const stored = await store(url, local, safe(version));
  return { project: artifact, version, coords: `${GROUP}:${local}:${safe(version)}`, ...stored };
}

/**
 * Resolves and downloads the project's dependencies for one engine (cached results are reused unless `refresh`).
 * Never throws for one dependency: each answer carries its status, so an optional mod with no version for the
 * engine is reported without stopping the others.
 */
export async function resolveModDependencies(deps: readonly Dependency[], engine: Engine, options: { refresh?: boolean; onLine?: (line: string) => void } = {}): Promise<DependencyResolution[]> {
  const cfKey = curseforgeKey();
  const cached = readIndex();
  const out: DependencyResolution[] = [];
  for (const dep of deps) {
    const key = keyOf(dep, engine);
    const known = cached[key];
    const fresh = known?.status === "resolved" ? known.jars.every((j) => existsSync(join(modsDir(), j.file)))
      // A mod with no version for the engine is asked again after a day, not on every build.
      : known?.status === "unavailable" && Date.now() - Date.parse(known.resolvedAt) < 86_400_000;
    if (!options.refresh && known && fresh) {
      out.push(toResolution(dep, known));
      continue;
    }
    let source: DependencyResolution["source"] = dep.source?.maven ? "maven" : dep.source?.curseforge ? "curseforge" : "modrinth";
    let entry: IndexEntry;
    try {
      options.onLine?.(`[mcedge] resolving ${dep.modId} ${dep.version} for ${engine.id}`);
      let jars: DependencyJar[];
      if (source === "maven") jars = [await mavenJar(dep, engine)];
      else if (source === "curseforge") {
        if (!cfKey) throw new Error(NO_KEY);
        jars = await curseforgeJars(dep.source!.curseforge!, engine, dep.version, cfKey, new Set());
      } else {
        // Modrinth first; a mod it does not have (or has no version of for the engine) is looked up on CurseForge by
        // its mod id when this computer has a key.
        try {
          jars = await modrinthJars(dep.source?.modrinth ?? dep.modId, engine, dep.version, new Set());
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 404) || !cfKey) throw error;
          jars = [];
        }
        if (!jars.length && cfKey && !dep.source?.modrinth) {
          source = "curseforge";
          jars = await curseforgeJars(dep.modId, engine, dep.version, cfKey, new Set());
        }
      }
      const where = source === "curseforge" ? "on CurseForge" : `on Modrinth${cfKey ? " or CurseForge" : ` (${NO_KEY.replace("CurseForge needs", "CurseForge also works with")})`}`;
      entry = jars.length
        ? { status: "resolved", source, resolvedAt: new Date().toISOString(), jars: jars.map((j) => ({ ...j, file: relative(modsDir(), j.file) })) }
        : { status: "unavailable", source, resolvedAt: new Date().toISOString(), message: `no ${dep.modId} version ${dep.version} for ${engine.loader} ${engine.minecraft} ${where}`, jars: [] };
    } catch (error) {
      entry = { status: "failed", source, resolvedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), jars: [] };
    }
    writeIndex((entries) => (entries[key] = entry));
    const resolution = toResolution(dep, entry);
    options.onLine?.(`[mcedge] ${dep.modId}: ${resolution.status}${resolution.jars.length ? ` ${resolution.jars.map((j) => `${j.project} ${j.version}`).join(", ")}` : ""}${resolution.message ? ` (${resolution.message})` : ""}`);
    out.push(resolution);
  }
  return out;
}

function toResolution(dep: Dependency, entry: IndexEntry | undefined): DependencyResolution {
  const source = entry?.source ?? (dep.source?.maven ? "maven" : dep.source?.curseforge ? "curseforge" : "modrinth");
  if (!entry) return { modId: dep.modId, constraint: dep.version, required: dep.required, status: "unresolved", source, jars: [] };
  const jars = entry.jars.map((j) => ({ ...j, file: join(modsDir(), j.file) })).filter((j) => existsSync(j.file))
    .map((j) => {
      const modId = jarModId(j.file);
      return modId ? { ...j, modId } : j;
    });
  const lost = entry.status === "resolved" && jars.length !== entry.jars.length;
  return {
    modId: dep.modId, constraint: dep.version, required: dep.required, source, resolvedAt: entry.resolvedAt,
    status: lost ? "unresolved" : entry.status, ...(entry.message ? { message: entry.message } : lost ? { message: "cached jar missing; resolve again" } : {}),
    jars: lost ? [] : jars,
  };
}

/** What the cache knows for one engine, without the network. */
export function cachedModDependencies(deps: readonly Dependency[], engine: Engine): DependencyResolution[] {
  const cached = readIndex();
  return deps.map((dep) => toResolution(dep, cached[keyOf(dep, engine)]));
}

/**
 * Gradle lines that put the resolved jars into the engine's project: required dependencies are on the compile
 * classpath too (code may use their API), optional ones only at runtime. Fabric 1.21.5 remaps with mod*
 * configurations, Forge 1.16.5 deobfuscates with fg.deobf; NeoForge and Fabric 26.3 use the jars as they are.
 */
export function dependencyGradle(deps: readonly Dependency[], engine: Engine): { repositories: string[]; lines: string[]; unresolved: DependencyResolution[]; modIds: Record<string, string> } {
  const resolutions = cachedModDependencies(deps, engine);
  // Project mod id -> the id the engine's jar has, where they differ.
  const modIds = Object.fromEntries(resolutions.flatMap((r) => (r.jars[0]?.modId && r.jars[0].modId !== r.modId ? [[r.modId, r.jars[0].modId]] : [])));
  const lines: string[] = [];
  const added = new Set<string>();
  for (const r of resolutions) {
    for (const jar of r.jars) {
      if (added.has(jar.coords)) continue;
      added.add(jar.coords);
      const compile = r.required;
      const notation = `'${jar.coords}'`;
      if (engine.loader === "forge") {
        // Forge 1.16.5 finds mods only in run/mods (no classpath locator): the deobfuscated jar goes there (below);
        // required ones are also on the compile classpath.
        if (compile) lines.push(`compileOnly fg.deobf(${notation})`);
        lines.push(`${FORGE_RUN_MODS} fg.deobf(${notation})`);
      } else if (engine.loader === "fabric" && engine.minecraft.startsWith("1.")) lines.push(`${compile ? "modImplementation" : "modRuntimeOnly"} ${notation}`);
      else lines.push(`${compile ? "implementation" : "runtimeOnly"} ${notation}`);
    }
  }
  if (engine.loader === "forge" && lines.length) {
    // The configuration must exist before the lines above use it; the copy runs when ForgeGradle prepares a run.
    lines.unshift(`project.configurations.maybeCreate('${FORGE_RUN_MODS}')`);
    lines.push(`project.tasks.matching { it.name.startsWith('prepareRun') }.configureEach { doLast { project.delete(project.fileTree('run/mods') { include '${FORGE_RUN_PREFIX}*.jar' }); project.copy { from project.configurations.${FORGE_RUN_MODS}; into 'run/mods'; rename { '${FORGE_RUN_PREFIX}' + it } } } }`);
  }
  return { repositories: lines.length ? [pathToFileURL(repoDir()).href] : [], lines, unresolved: resolutions.filter((r) => r.status !== "resolved"), modIds };
}

// ---- the mod id inside a jar ----

const modIdCache = new Map<string, string | undefined>();

/** The first mod id a mod jar declares: fabric.mod.json "id", else the first modId of (neoforge.)mods.toml. */
export function jarModId(file: string): string | undefined {
  if (modIdCache.has(file)) return modIdCache.get(file);
  let id: string | undefined;
  try {
    const entries = readZip(readFileSync(file), ["fabric.mod.json", "META-INF/neoforge.mods.toml", "META-INF/mods.toml"]);
    const fabric = entries.get("fabric.mod.json");
    if (fabric) id = (JSON.parse(fabric.replace(/^﻿/, "")) as { id?: string }).id;
    const toml = entries.get("META-INF/neoforge.mods.toml") ?? entries.get("META-INF/mods.toml");
    if (!id && toml) id = /^\s*modId\s*=\s*"([^"]+)"/m.exec(toml.split(/^\s*\[\[dependencies/m)[0])?.[1];
  } catch {
    id = undefined;
  }
  modIdCache.set(file, id);
  return id;
}

/** Text of the named entries of a zip (stored or deflated), read through its central directory. */
function readZip(zip: Buffer, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  let at = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    if (names.includes(name)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    }
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

/** Forge 1.16.5: the configuration of deobfuscated dependency mods copied into run/mods, and their file prefix there. */
const FORGE_RUN_MODS = "mcedgeRunMods";
const FORGE_RUN_PREFIX = "mcedge-dep-";
