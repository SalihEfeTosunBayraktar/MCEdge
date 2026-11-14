import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { listEngines, type Engine } from "../engines/registry.ts";
import type { ModProject } from "../ir/types.ts";
import { generatedElements, generateTarget } from "./generate.ts";

/**
 * Locked generated code (KUYRUK 131). Locking an element keeps the files the generator makes for it, per engine, in
 * the project under locked-code/<type>/<id>/<engine>/ (versioned with the project, unlike out/). The user (or an agent)
 * edits them there; every generation then writes those files instead of fresh ones, as long as the element exists
 * and the engine generates it. Files the element shares with others (registries, lang files) are never locked.
 * Unlocking compares the locked files with what the generator makes now and reports the edits that would be lost.
 */
export const LOCK_DIR = "locked-code";

export interface LockedElement {
  type: string;
  id: string;
  /** Per engine: the locked files, relative to the engine's out folder. */
  engines: { engine: string; files: string[] }[];
}

export interface LockedFileChange {
  engine: string;
  path: string;
  /** edited: differs from fresh generation; same: unchanged; gone: the generator no longer makes this file. */
  status: "edited" | "same" | "gone";
  /**
   * For an edited file: lines only the locked file has (lost on unlock) and lines only fresh generation has, with
   * their counts; at most a few of each are listed.
   */
  diff?: { lostLines: number; addedLines: number; lost: { line: number; text: string }[]; added: { line: number; text: string }[] };
}

const lockRoot = (dir: string, type: string, id: string) => join(dir, LOCK_DIR, type, id);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Elements with locked code, with their files per engine. */
export function lockedElements(dir: string): LockedElement[] {
  const root = join(dir, LOCK_DIR);
  if (!existsSync(root)) return [];
  const out: LockedElement[] = [];
  for (const type of readdirSync(root)) {
    if (!statSync(join(root, type)).isDirectory()) continue;
    for (const id of readdirSync(join(root, type))) {
      const base = join(root, type, id);
      if (!statSync(base).isDirectory()) continue;
      const engines = readdirSync(base).filter((e) => statSync(join(base, e)).isDirectory())
        .map((engine) => ({ engine, files: walk(join(base, engine)).map((f) => relative(join(base, engine), f).replaceAll("\\", "/")).sort() }));
      out.push({ type, id, engines });
    }
  }
  return out;
}

export const isLocked = (dir: string, type: string, id: string) => existsSync(lockRoot(dir, type, id));

/** A project's generated files for one engine, generated into a temporary folder (locked code left out). */
function generateFresh(project: ModProject, dir: string, engine: Engine): Map<string, Buffer> {
  const out = mkdtempSync(join(tmpdir(), "mcedge-lock-"));
  try {
    generateTarget(project, dir, engine, out, { lockedCode: false });
    return new Map(walk(join(out, "src")).map((f) => [relative(out, f).replaceAll("\\", "/"), readFileSync(f)]));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * The files the element owns on an engine: generated with it, absent without it. A file another element also needs
 * (a registry class, the lang file) exists either way, so it is not owned.
 */
export function ownedFiles(project: ModProject, dir: string, engine: Engine, type: string, id: string): Map<string, Buffer> {
  if (!generatedElements(project, engine).generated[type]?.some((e) => e.id === id)) return new Map();
  const withIt = generateFresh(project, dir, engine);
  const without: ModProject = { ...project, elements: { ...project.elements, [type]: project.elements[type].filter((e) => e.id !== id) } };
  const withoutIt = generateFresh(without, dir, engine);
  return new Map([...withIt].filter(([path]) => !withoutIt.has(path)));
}

/** Locks an element: its owned files on every engine are written once into locked-code/. */
export function lockElementCode(project: ModProject, dir: string, type: string, id: string): LockedElement {
  if (!project.elements[type]?.some((e) => e.id === id)) throw new Error(`no ${type} "${id}"`);
  if (isLocked(dir, type, id)) throw new Error(`${type}/${id} is already locked`);
  const engines: LockedElement["engines"] = [];
  for (const engine of listEngines()) {
    const files = ownedFiles(project, dir, engine, type, id);
    if (!files.size) continue;
    for (const [path, bytes] of files) {
      const target = join(lockRoot(dir, type, id), engine.id, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    engines.push({ engine: engine.id, files: [...files.keys()].sort() });
  }
  if (!engines.length) throw new Error(`no engine generates files of its own for ${type}/${id}`);
  return { type, id, engines };
}

/** Most lines listed per side of a diff. */
const DIFF_LINES = 8;

/**
 * Line diff (longest common subsequence) of a locked file against fresh generation: the lines only the locked file
 * has (what an unlock loses) and the lines only fresh generation has, with their line numbers.
 */
export function lineDiff(locked: string, generated: string): NonNullable<LockedFileChange["diff"]> {
  const x = locked.split(/\r?\n/);
  const y = generated.split(/\r?\n/);
  // Common prefix and suffix first, so the table only covers the changed middle.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) (endX--, endY--);
  const a = x.slice(start, endX);
  const b = y.slice(start, endY);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lost: { line: number; text: string }[] = [];
  const added: { line: number; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (i++, j++);
    else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) lost.push({ line: start + 1 + i, text: a[i++].trim() });
    else added.push({ line: start + 1 + j, text: b[j++].trim() });
  }
  return { lostLines: lost.length, addedLines: added.length, lost: lost.slice(0, DIFF_LINES), added: added.slice(0, DIFF_LINES) };
}

/** How the locked files differ from what the generator makes now. */
export function lockedChanges(project: ModProject, dir: string, type: string, id: string): LockedFileChange[] {
  const locked = lockedElements(dir).find((l) => l.type === type && l.id === id);
  if (!locked) throw new Error(`${type}/${id} is not locked`);
  const changes: LockedFileChange[] = [];
  for (const { engine: engineId, files } of locked.engines) {
    const engine = listEngines().find((e) => e.id === engineId);
    const fresh = engine && project.elements[type]?.some((e) => e.id === id) ? ownedFiles(project, dir, engine, type, id) : new Map<string, Buffer>();
    for (const path of files) {
      const mine = readFileSync(join(lockRoot(dir, type, id), engineId, path));
      const now = fresh.get(path);
      if (!now) changes.push({ engine: engineId, path, status: "gone" });
      else if (now.equals(mine)) changes.push({ engine: engineId, path, status: "same" });
      else changes.push({ engine: engineId, path, status: "edited", diff: lineDiff(mine.toString("utf8"), now.toString("utf8")) });
    }
  }
  return changes;
}

/**
 * Unlocks an element: the next generation writes its files fresh. Edits in the locked files are lost, so unless
 * `force`, an element with edited files stays locked and the edits are returned for the user to confirm.
 */
export function unlockElementCode(project: ModProject, dir: string, type: string, id: string, force = false): { unlocked: boolean; changes: LockedFileChange[] } {
  const changes = lockedChanges(project, dir, type, id);
  if (changes.some((c) => c.status === "edited") && !force) return { unlocked: false, changes };
  rmSync(lockRoot(dir, type, id), { recursive: true, force: true });
  // Leave no empty type folder behind.
  const typeDir = join(dir, LOCK_DIR, type);
  if (existsSync(typeDir) && !readdirSync(typeDir).length) rmSync(typeDir, { recursive: true, force: true });
  if (existsSync(join(dir, LOCK_DIR)) && !readdirSync(join(dir, LOCK_DIR)).length) rmSync(join(dir, LOCK_DIR), { recursive: true, force: true });
  return { unlocked: true, changes };
}

/**
 * Writes the locked files of an engine over a fresh generation: only elements that still exist and that this engine
 * generates. Returns the written paths (relative to the out folder).
 */
export function applyLockedCode(dir: string, generated: Record<string, { id: string }[]>, engine: Engine, outDir: string): string[] {
  const written: string[] = [];
  for (const locked of lockedElements(dir)) {
    if (!generated[locked.type]?.some((e) => e.id === locked.id)) continue;
    const base = join(lockRoot(dir, locked.type, locked.id), engine.id);
    if (!existsSync(base)) continue;
    cpSync(base, outDir, { recursive: true });
    written.push(...(locked.engines.find((e) => e.engine === engine.id)?.files ?? []));
  }
  return written;
}
