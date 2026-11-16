import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Engine } from "../engines/registry.ts";
import type { ModInfo } from "../ir/types.ts";
import { userDataDir } from "../userData.ts";
import { git } from "../vcs/git.ts";
import { engineSetup, logPath, runGradle } from "./gradle.ts";
import { serverTasks } from "./runs.ts";

/**
 * Publishing a mod (Q238): the jars of one version go to Modrinth and CurseForge, each with its game version and loader,
 * after a gate that every chosen engine passes first (build, then a dedicated server that starts with the mod). A
 * failed gate uploads nothing. The tokens belong to this computer (Preferences or $MCEDGE_MODRINTH_TOKEN /
 * $MCEDGE_CURSEFORGE_TOKEN), never to a project; the project only names its Modrinth and CurseForge projects.
 */

export type Platform = "modrinth" | "curseforge";
export const PLATFORMS: Platform[] = ["modrinth", "curseforge"];
export type ReleaseType = "release" | "beta" | "alpha";

const modrinthApi = () => process.env.MCEDGE_MODRINTH_API ?? "https://api.modrinth.com/v2";
const curseforgeUploadApi = () => process.env.MCEDGE_CURSEFORGE_UPLOAD_API ?? "https://minecraft.curseforge.com/api";

// ---- tokens ----

interface TokenPrefs { modrinthToken?: string; curseforgeToken?: string }
let prefsReader: (() => TokenPrefs | undefined) | undefined;
/** The app reads its own Preferences; the CLI and the MCP server read app-state.json in the user data folder. */
export function setPublishTokenReader(read: () => TokenPrefs | undefined): void {
  prefsReader = read;
}
export function publishToken(platform: Platform): string | undefined {
  const env = process.env[platform === "modrinth" ? "MCEDGE_MODRINTH_TOKEN" : "MCEDGE_CURSEFORGE_TOKEN"]?.trim();
  if (env) return env;
  let prefs: TokenPrefs | undefined;
  try {
    prefs = prefsReader ? prefsReader() : (JSON.parse(readFileSync(join(userDataDir(), "app-state.json"), "utf8")) as { preferences?: TokenPrefs }).preferences;
  } catch {
    prefs = undefined;
  }
  return (platform === "modrinth" ? prefs?.modrinthToken : prefs?.curseforgeToken)?.trim() || undefined;
}

// ---- the check before anything runs ----

export type PublishProblem =
  | { kind: "noProject"; platform: Platform }
  | { kind: "noToken"; platform: Platform }
  | { kind: "tagExists"; tag: string };

export const versionTag = (version: string) => `v${version}`;

/** Tags only go into the project's own repository, never into one the project folder merely sits inside. */
async function ownRepo(dir: string): Promise<boolean> {
  const top = (await git(dir, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
  return !!top && resolve(top).toLowerCase() === resolve(dir).toLowerCase();
}

/** What stops a publish before any build: a platform without its project or token, or a version already tagged. */
export async function publishProblems(dir: string, mod: ModInfo, platforms: Platform[]): Promise<PublishProblem[]> {
  const problems: PublishProblem[] = [];
  for (const platform of platforms) {
    if (!mod.publish?.[platform]?.trim()) problems.push({ kind: "noProject", platform });
    if (!publishToken(platform)) problems.push({ kind: "noToken", platform });
  }
  const tag = versionTag(mod.version);
  const tagged = (await ownRepo(dir)) ? await git(dir, ["tag", "--list", tag]).catch(() => "") : "";
  if (tagged.trim() === tag) problems.push({ kind: "tagExists", tag });
  return problems;
}

export function problemText(p: PublishProblem): string {
  if (p.kind === "tagExists") return `version ${p.tag} is already tagged: raise the mod version first`;
  return p.kind === "noProject" ? `no ${p.platform} project set in the mod settings` : `no ${p.platform} token on this computer (Preferences)`;
}

// ---- the server smoke test ----

const SERVER_READY = /Done \(\d/;
const SMOKE_TIMEOUT = () => Number(process.env.MCEDGE_SMOKE_TIMEOUT_MS ?? 600_000);

export interface SmokeResult { ok: boolean; reason?: string; logFile: string }

/** Starts the engine's dedicated server with the built mod, waits for "Done (" and stops it. */
export function smokeTestServer(engine: Engine, projectDir: string, onLine: (line: string) => void = () => {}): Promise<SmokeResult> {
  const setup = engineSetup(engine, projectDir);
  const logFile = logPath(setup, "mcedge-publish-server.log");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Omit<SmokeResult, "logFile">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.stop();
      resolve({ ...result, logFile });
    };
    const run = runGradle(setup, serverTasks(setup), logFile, (line) => {
      onLine(line);
      if (SERVER_READY.test(line)) finish({ ok: true });
      else if (/Failed to start the minecraft server|Encountered an unexpected exception|Mod loading has failed|crash-reports/i.test(line)) finish({ ok: false, reason: line.trim() });
    });
    const timer = setTimeout(() => finish({ ok: false, reason: `the server did not start within ${Math.round(SMOKE_TIMEOUT() / 1000)} s` }), SMOKE_TIMEOUT());
    void run.done.then((code) => finish({ ok: false, reason: `the server stopped before it was ready (exit ${code})` }));
  });
}

// ---- uploads ----

export interface UploadJar { engine: Engine; jar: string }
export interface UploadOptions { releaseType: ReleaseType; changelog: string }
export interface UploadResult { platform: Platform; engineId: string; ok: boolean; url?: string; error?: string }

/** Each jar is its own version on the platform, so the number names the engine: "1.2.0+neoforge-1.21.5". */
export const versionNumber = (mod: ModInfo, engine: Engine) => `${mod.version}+${engine.loader}-${engine.minecraft}`;
const displayName = (mod: ModInfo, engine: Engine) => `${mod.name} ${mod.version} (${loaderTitle(engine.loader)} ${engine.minecraft})`;
const loaderTitle = (loader: string) => ({ neoforge: "NeoForge", forge: "Forge", fabric: "Fabric", quilt: "Quilt" })[loader] ?? loader;

async function failText(res: Response): Promise<string> {
  const body = (await res.text().catch(() => "")).slice(0, 400);
  return `HTTP ${res.status}${body ? `: ${body}` : ""}`;
}

function jarBlob(path: string): Blob {
  return new Blob([readFileSync(path)], { type: "application/java-archive" });
}

async function uploadModrinth(mod: ModInfo, jars: UploadJar[], options: UploadOptions): Promise<UploadResult[]> {
  const token = publishToken("modrinth")!;
  const headers = { Authorization: token, "User-Agent": "MCEdge (mod publishing)" };
  // The project may be named by slug; versions need its id.
  const projectRes = await fetch(`${modrinthApi()}/project/${encodeURIComponent(mod.publish!.modrinth!.trim())}`, { headers });
  if (!projectRes.ok) {
    const error = `project ${mod.publish!.modrinth}: ${await failText(projectRes)}`;
    return jars.map(({ engine }) => ({ platform: "modrinth", engineId: engine.id, ok: false, error }));
  }
  const project = (await projectRes.json()) as { id: string; slug: string };
  const results: UploadResult[] = [];
  for (const { engine, jar } of jars) {
    const form = new FormData();
    form.append("data", JSON.stringify({
      name: displayName(mod, engine), version_number: versionNumber(mod, engine), changelog: options.changelog,
      dependencies: [], game_versions: [engine.minecraft], version_type: options.releaseType, loaders: [engine.loader],
      featured: options.releaseType === "release", project_id: project.id, file_parts: ["file"], primary_file: "file",
    }));
    form.append("file", jarBlob(jar), basename(jar));
    const res = await fetch(`${modrinthApi()}/version`, { method: "POST", headers, body: form });
    if (!res.ok) {
      results.push({ platform: "modrinth", engineId: engine.id, ok: false, error: await failText(res) });
      continue;
    }
    const version = (await res.json()) as { id: string };
    results.push({ platform: "modrinth", engineId: engine.id, ok: true, url: `https://modrinth.com/mod/${project.slug}/version/${version.id}` });
  }
  return results;
}

interface CfGameVersion { id: number; gameVersionTypeID: number; name: string }
interface CfVersionType { id: number; name: string; slug: string }

/** CurseForge names game versions and loaders by id: the Minecraft version among the "minecraft-*" types, the loader among "modloader". */
async function curseforgeVersionIds(engine: Engine, headers: Record<string, string>): Promise<number[] | string> {
  const [typesRes, versionsRes] = await Promise.all([
    fetch(`${curseforgeUploadApi()}/game/version-types`, { headers }),
    fetch(`${curseforgeUploadApi()}/game/versions`, { headers }),
  ]);
  if (!typesRes.ok) return `version types: ${await failText(typesRes)}`;
  if (!versionsRes.ok) return `versions: ${await failText(versionsRes)}`;
  const types = (await typesRes.json()) as CfVersionType[];
  const versions = (await versionsRes.json()) as CfGameVersion[];
  const minecraftTypes = new Set(types.filter((t) => t.slug.startsWith("minecraft-")).map((t) => t.id));
  const loaderTypes = new Set(types.filter((t) => t.slug === "modloader").map((t) => t.id));
  const game = versions.find((v) => minecraftTypes.has(v.gameVersionTypeID) && v.name === engine.minecraft);
  const loader = versions.find((v) => loaderTypes.has(v.gameVersionTypeID) && v.name.toLowerCase() === engine.loader);
  if (!game) return `CurseForge has no Minecraft version ${engine.minecraft}`;
  if (!loader) return `CurseForge has no loader ${loaderTitle(engine.loader)}`;
  return [game.id, loader.id];
}

async function uploadCurseforge(mod: ModInfo, jars: UploadJar[], options: UploadOptions): Promise<UploadResult[]> {
  const headers = { "X-Api-Token": publishToken("curseforge")!, "User-Agent": "MCEdge (mod publishing)" };
  const projectId = mod.publish!.curseforge!.trim();
  const results: UploadResult[] = [];
  for (const { engine, jar } of jars) {
    const ids = await curseforgeVersionIds(engine, headers);
    if (typeof ids === "string") {
      results.push({ platform: "curseforge", engineId: engine.id, ok: false, error: ids });
      continue;
    }
    const form = new FormData();
    form.append("metadata", JSON.stringify({
      changelog: options.changelog, changelogType: "markdown", displayName: displayName(mod, engine), gameVersions: ids, releaseType: options.releaseType,
    }));
    form.append("file", jarBlob(jar), basename(jar));
    const res = await fetch(`${curseforgeUploadApi()}/projects/${encodeURIComponent(projectId)}/upload-file`, { method: "POST", headers, body: form });
    if (!res.ok) {
      results.push({ platform: "curseforge", engineId: engine.id, ok: false, error: await failText(res) });
      continue;
    }
    const file = (await res.json()) as { id: number };
    results.push({ platform: "curseforge", engineId: engine.id, ok: true, url: `https://www.curseforge.com/projects/${projectId}/files/${file.id}` });
  }
  return results;
}

/** Uploads every jar to every platform; a network error becomes a failed result, not a throw. */
export async function uploadJars(mod: ModInfo, platforms: Platform[], jars: UploadJar[], options: UploadOptions): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const platform of platforms) {
    try {
      results.push(...await (platform === "modrinth" ? uploadModrinth : uploadCurseforge)(mod, jars, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(...jars.map(({ engine }) => ({ platform, engineId: engine.id, ok: false, error: message })));
    }
  }
  return results;
}

/** The checkpoint of a published version: an annotated tag on the current commit (a project without git has none). */
export async function tagVersion(dir: string, version: string): Promise<string | undefined> {
  const head = (await ownRepo(dir)) ? await git(dir, ["rev-parse", "--verify", "HEAD"]).catch(() => "") : "";
  if (!head.trim()) return undefined;
  const tag = versionTag(version);
  await git(dir, ["tag", "-a", tag, "-m", `Published ${version}`]);
  return tag;
}

// ---- the whole publish after the builds ----

export interface PublishOptions extends UploadOptions { platforms: Platform[] }
export interface BuiltJar extends UploadJar { projectDir: string }
export interface PublishOutcome {
  /** Server smoke test per engine; an engine that failed it stops every upload. */
  smoke: { engineId: string; ok: boolean; reason?: string; logFile: string }[];
  /** The version's tag, when the project is its own git repository. */
  tag?: string;
  uploads: UploadResult[];
  /** Why nothing was uploaded, when the gate stopped it. */
  stopped?: string;
}

/**
 * The gate and the uploads, once every chosen engine has built: each engine's server must start with the mod, then the
 * version is tagged and every jar goes to every platform. Builds that failed never reach here (the caller stops first).
 */
export async function gateAndUpload(dir: string, mod: ModInfo, built: BuiltJar[], options: PublishOptions, onLine: (engineId: string, line: string) => void): Promise<PublishOutcome> {
  const smoke: PublishOutcome["smoke"] = [];
  for (const { engine, projectDir } of built) {
    onLine(engine.id, "[mcedge] publish gate: starting the server with the mod");
    const result = await smokeTestServer(engine, projectDir, (line) => onLine(engine.id, line));
    smoke.push({ engineId: engine.id, ...result });
    onLine(engine.id, result.ok ? "[mcedge] publish gate: the server started" : `[mcedge] publish gate failed: ${result.reason}`);
    if (!result.ok) return { smoke, uploads: [], stopped: `${engine.id}: ${result.reason}` };
  }
  const tag = await tagVersion(dir, mod.version);
  const uploads = await uploadJars(mod, options.platforms, built, options);
  return { smoke, tag, uploads };
}
