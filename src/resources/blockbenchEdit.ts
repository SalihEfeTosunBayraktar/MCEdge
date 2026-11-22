import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { projectTexturePath } from "./blockModel.ts";

/**
 * Edit in Blockbench (KUYRUK 171): a project JSON model is copied with its textures into a work folder laid out like
 * a resource pack (assets/<namespace>/models/<name>.json, assets/<namespace>/textures/<path>.png), which is how
 * Blockbench finds the textures a Java block model names. Blockbench opens the model there; what it saves (the model,
 * its textures, new textures) is copied back into the project. A block's own texture mapping (customModelTextures)
 * is shown in Blockbench and taken out again on the way back, so the shared model keeps its own textures.
 */

export interface BlockbenchSession {
  dir: string;
  model: string;
  modId: string;
  /** The work folder of this model. */
  work: string;
  /** The model file Blockbench opens. */
  file: string;
  /** Work file (relative to `work`, "/" separated) -> project file it came from. */
  textures: Record<string, string>;
  /** Slots the block maps to its own texture: what the work copy names, and what the model names in the project. */
  slots: Record<string, { shown: string; original: string }>;
  /** Content hash of each work file as last copied either way. */
  hashes: Record<string, string>;
}

const hash = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");
const slash = (path: string) => path.replaceAll("\\", "/");

/** Every PNG under textures/ and models/ of the project, project-relative. */
function projectPngs(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.toLowerCase().endsWith(".png")) out.push(path);
    }
  };
  walk("textures");
  walk("models");
  return out;
}

/** "modid:block/x" -> ["modid", "block/x"]; a reference without a namespace is the mod's. */
const splitRef = (ref: string, modId: string): [string, string] => {
  const [ns, path] = ref.includes(":") ? (ref.split(":", 2) as [string, string]) : [modId, ref];
  return [ns || modId, path.replace(/\.png$/i, "")];
};

/** A project texture as a reference of the mod: "textures/blocks/x.png" -> "modid:blocks/x". */
export const projectTextureRef = (file: string, modId: string) => `${modId}:${file.replace(/^(textures|models)\//, "").replace(/\.png$/i, "")}`;

/** Work folder for a model of a project: <temp>/mcedge-blockbench/<project hash>/<model>. */
export function workFolder(dir: string, model: string): string {
  const id = createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 10);
  return join(tmpdir(), "mcedge-blockbench", id, model);
}

/**
 * Copies models/<model>.json and the project textures it names (the block's mapped textures in `overrides`, slot ->
 * project PNG) into a fresh work folder. Throws when the model is not a project JSON model.
 */
export function prepareBlockbench(dir: string, modId: string, model: string, overrides: Record<string, string> = {}): BlockbenchSession {
  const source = join(dir, "models", `${model}.json`);
  if (!existsSync(source)) throw new Error(`no JSON model models/${model}.json`);
  const json = JSON.parse(readFileSync(source, "utf8")) as { textures?: Record<string, string> };
  const work = workFolder(dir, model);
  rmSync(work, { recursive: true, force: true });
  const session: BlockbenchSession = { dir, model, modId, work, file: join(work, "assets", modId, "models", `${model}.json`), textures: {}, slots: {}, hashes: {} };
  const files = projectPngs(dir);
  const textures = { ...(json.textures ?? {}) };
  for (const [slot, file] of Object.entries(overrides)) {
    if (!(slot in textures) || !files.includes(file)) continue;
    const shown = projectTextureRef(file, modId);
    session.slots[slot] = { shown, original: textures[slot] };
    textures[slot] = shown;
  }
  for (const ref of new Set(Object.values(textures))) {
    if (typeof ref !== "string" || ref.startsWith("#")) continue;
    const [ns, path] = splitRef(ref, modId);
    const file = projectTexturePath(ref, modId, files);
    if (!file) continue;
    const target = `assets/${ns}/textures/${path}.png`;
    mkdirSync(dirname(join(work, target)), { recursive: true });
    copyFileSync(join(dir, file), join(work, target));
    // Blockbench plays and keeps an animated texture's .mcmeta.
    if (existsSync(join(dir, `${file}.mcmeta`))) {
      copyFileSync(join(dir, `${file}.mcmeta`), join(work, `${target}.mcmeta`));
      session.hashes[`${target}.mcmeta`] = hash(join(work, `${target}.mcmeta`));
    }
    session.textures[target] = file;
    session.hashes[target] = hash(join(work, target));
  }
  mkdirSync(dirname(session.file), { recursive: true });
  writeFileSync(session.file, JSON.stringify({ ...json, textures }, null, 2) + "\n");
  session.hashes[slash(relative(work, session.file))] = hash(session.file);
  return session;
}

/**
 * Copies what changed in the work folder back into the project: the model (with the block's own slots put back) and
 * every PNG that is new or changed (a new one goes to textures/<path>.png of the mod's namespace). Returns the project
 * files written.
 */
export function syncBlockbench(session: BlockbenchSession): string[] {
  const written: string[] = [];
  const modelKey = slash(relative(session.work, session.file));
  if (existsSync(session.file)) {
    const now = hash(session.file);
    if (now !== session.hashes[modelKey]) {
      let text = readFileSync(session.file, "utf8");
      try {
        const json = JSON.parse(text) as { textures?: Record<string, string> };
        let restored = false;
        for (const [slot, { shown, original }] of Object.entries(session.slots)) {
          if (json.textures?.[slot] === shown) (json.textures[slot] = original, (restored = true));
        }
        if (restored) text = JSON.stringify(json, null, 2) + "\n";
        writeFileSync(join(session.dir, "models", `${session.model}.json`), text);
        written.push(`models/${session.model}.json`);
      } catch {
        // A half-written save: the next change event brings the whole file.
        return written;
      }
      session.hashes[modelKey] = now;
    }
  }
  const assets = join(session.work, "assets");
  const walk = (abs: string) => {
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const file = join(abs, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.png(\.mcmeta)?$/i.test(entry.name)) {
        const key = slash(relative(session.work, file));
        const now = hash(file);
        if (now === session.hashes[key]) continue;
        const match = /^assets\/([^/]+)\/textures\/(.+)$/.exec(key);
        const meta = key.toLowerCase().endsWith(".mcmeta");
        const png = meta ? key.slice(0, -".mcmeta".length) : key;
        const known = session.textures[png];
        const target = known ? (meta ? `${known}.mcmeta` : known) : match && match[1] === session.modId ? `textures/${match[2]}` : undefined;
        if (!target) continue;
        mkdirSync(dirname(join(session.dir, target)), { recursive: true });
        copyFileSync(file, join(session.dir, target));
        if (!meta && !known) session.textures[png] = target;
        session.hashes[key] = now;
        written.push(target);
      }
    }
  };
  walk(assets);
  return written;
}

/** Watches the work folder and syncs a moment after Blockbench writes; returns the watcher to close. */
export function watchBlockbench(session: BlockbenchSession, onSynced: (files: string[]) => void): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(session.work, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = syncBlockbench(session);
      if (files.length) onSynced(files);
    }, 300);
  });
  watcher.on("error", () => watcher.close());
  return watcher;
}

/** Where Blockbench usually is, after the path set in the preferences. */
export function blockbenchCandidates(configured?: string): string[] {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return [
    ...(configured?.trim() ? [configured.trim()] : []),
    ...(process.platform === "win32"
      ? [join(local, "Programs", "Blockbench", "Blockbench.exe"), join(process.env.ProgramFiles ?? "C:\\Program Files", "Blockbench", "Blockbench.exe")]
      : process.platform === "darwin"
        ? ["/Applications/Blockbench.app/Contents/MacOS/Blockbench", join(homedir(), "Applications", "Blockbench.app", "Contents", "MacOS", "Blockbench")]
        : ["/usr/bin/blockbench", "/opt/Blockbench/blockbench", join(homedir(), ".local", "bin", "blockbench")]),
  ];
}

/** The Blockbench executable to start, or undefined when none of the candidates exists. */
export function findBlockbench(configured?: string): string | undefined {
  return blockbenchCandidates(configured).find((path) => existsSync(path));
}

/** Starts Blockbench on the model, on its own (it outlives MCEdge). */
export function launchBlockbench(exe: string, file: string): void {
  // visible-on-purpose: Blockbench is a GUI app the user asked to open, so its window must show.
  spawn(exe, [file], { detached: true, stdio: "ignore", windowsHide: false }).unref();
}
