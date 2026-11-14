import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, needsMigration, saveModInfo } from "./storage.ts";

/**
 * Changing the mod id and/or the Java package of a project (KUYRUK 121). The mod id is the namespace of everything the
 * mod registers, so changing it rewrites every "<old>:" id in elements, tags, variables, models and datapack files,
 * renames the translation keys that carry it ("item.<old>.ruby" -> "item.<new>.ruby", and the element values that hold
 * those keys) and moves datapack/<old> to datapack/<new>. The package is rewritten in element code (custom elements,
 * java_code blocks). Everything is computed first; a failed write puts every file back.
 */

const MOD_ID = /^[a-z][a-z0-9_]{1,63}$/;
const PACKAGE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const TEXT_EXTENSIONS = [".json", ".mcfunction", ".txt"];

export interface IdentityChange {
  modId?: string;
  package?: string;
}

export interface IdentityResult {
  modId?: { from: string; to: string };
  package?: { from: string; to: string };
  /** Project-relative files whose text changes (mcedge.json included). */
  filesChanged: string[];
  /** Translation keys renamed, counted once per key (not per language). */
  keysRenamed: number;
  /** Strings rewritten across all files (ids, keys, package names). */
  valuesChanged: number;
  /** The datapack namespace folder that moves. */
  datapackMoved?: { from: string; to: string };
  applied: boolean;
}

/** Why the change cannot be made, or undefined. */
export function identityProblem(current: { id: string; package: string }, change: IdentityChange): string | undefined {
  if (change.modId !== undefined && !MOD_ID.test(change.modId)) return `"${change.modId}" is not a valid mod id: 2-64 lowercase letters, digits and _, starting with a letter`;
  if (change.package !== undefined && !PACKAGE.test(change.package)) return `"${change.package}" is not a valid Java package: lowercase names separated by dots`;
  if ((change.modId ?? current.id) === current.id && (change.package ?? current.package) === current.package) return "nothing to change: the mod id and package are the current ones";
  return undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Project-relative paths of the files that can hold the mod id or package. */
function candidateFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (rel: string, json: boolean) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const path = `${rel}/${name}`;
      if (statSync(join(dir, path)).isDirectory()) walk(path, json);
      else if (json ? name.endsWith(".json") : TEXT_EXTENSIONS.some((e) => name.endsWith(e))) files.push(path);
    }
  };
  walk("elements", true);
  walk("localization", true);
  walk("models", true);
  walk("datapack", false);
  for (const file of ["tags.json", "variables.json"]) if (existsSync(join(dir, file))) files.push(file);
  return files;
}

/** "item.<old>.ruby" -> "item.<new>.ruby": the first dot-separated part equal to the old id. */
function renameKey(key: string, from: string, to: string): string {
  const parts = key.split(".");
  const i = parts.indexOf(from);
  if (i < 0 || parts.length < 2) return key;
  parts[i] = to;
  return parts.join(".");
}

interface Plan {
  result: IdentityResult;
  writes: { path: string; text: string }[];
}

function plan(dir: string, change: IdentityChange): Plan {
  if (needsMigration(dir)) throw new Error("this project uses an older layout; open it in MCEdge once (the first save migrates it) before changing its identity");
  const mod = loadProject(dir).mod;
  const problem = identityProblem(mod, change);
  if (problem) throw new Error(problem);
  const newId = change.modId ?? mod.id;
  const newPackage = change.package ?? mod.package;
  const idChanges = newId !== mod.id;
  const packageChanges = newPackage !== mod.package;

  const files = candidateFiles(dir);
  // Translation keys that carry the mod id, from every language file.
  const keys = new Map<string, string>();
  if (idChanges) {
    const all = new Set<string>();
    for (const file of files.filter((f) => f.startsWith("localization/"))) Object.keys(JSON.parse(readFileSync(join(dir, file), "utf8"))).forEach((k) => all.add(k));
    for (const key of all) {
      const next = renameKey(key, mod.id, newId);
      if (next === key) continue;
      if (all.has(next)) throw new Error(`translation key "${next}" already exists; it would collide with the renamed "${key}"`);
      keys.set(key, next);
    }
  }
  const namespace = new RegExp(`(?<![A-Za-z0-9_.\\-])${escape(mod.id)}:(?=[a-z0-9_./\\-])`, "g");
  const javaName = new RegExp(`(?<![A-Za-z0-9_.$])${escape(mod.package)}(?=[.;\\s]|$)`, "g");
  const classRef = new RegExp(`^${escape(mod.package)}(\\.[A-Za-z_$][A-Za-z0-9_$]*)+$`);

  let valuesChanged = 0;
  /** One string value or key: namespaced ids, translation keys and (element code only) the package. */
  const transform = (value: string, inElement: boolean): string => {
    let next = idChanges ? keys.get(value) ?? value.replace(namespace, `${newId}:`) : value;
    // Package names only in code (several statements) or a fully qualified class name, never in plain texts.
    if (packageChanges && inElement && (/[;\n]/.test(next) || next === mod.package || classRef.test(next))) next = next.replace(javaName, newPackage);
    if (next !== value) valuesChanged++;
    return next;
  };

  const writes: { path: string; text: string }[] = [];
  for (const path of files) {
    const text = readFileSync(join(dir, path), "utf8");
    const inElement = path.startsWith("elements/");
    const next = path.endsWith(".json")
      // Every JSON string literal (keys too), decoded and re-encoded only when it changes, so formatting stays.
      ? text.replace(/"(?:[^"\\]|\\.)*"/g, (literal) => {
          const value = JSON.parse(literal) as string;
          const changed = transform(value, inElement);
          return changed === value ? literal : JSON.stringify(changed);
        })
      : idChanges ? text.replace(namespace, () => (valuesChanged++, `${newId}:`)) : text;
    if (next !== text) writes.push({ path, text: next });
  }

  let datapackMoved: IdentityResult["datapackMoved"];
  if (idChanges && existsSync(join(dir, "datapack", mod.id))) {
    if (existsSync(join(dir, "datapack", newId))) throw new Error(`datapack/${newId} already exists; move or merge it before changing the mod id`);
    datapackMoved = { from: `datapack/${mod.id}`, to: `datapack/${newId}` };
  }
  return {
    writes,
    result: {
      ...(idChanges ? { modId: { from: mod.id, to: newId } } : {}),
      ...(packageChanges ? { package: { from: mod.package, to: newPackage } } : {}),
      filesChanged: ["mcedge.json", ...writes.map((w) => (datapackMoved && w.path.startsWith(`${datapackMoved.from}/`) ? datapackMoved.to + w.path.slice(datapackMoved.from.length) : w.path))],
      keysRenamed: keys.size,
      valuesChanged,
      datapackMoved,
      applied: false,
    },
  };
}

/**
 * Changes the mod id and/or package and rewrites what names them (see the file comment). `dryRun` only reports. Returns
 * the result and every absolute path written (for the file watcher).
 */
export function changeModIdentity(dir: string, change: IdentityChange, options: { dryRun?: boolean; onStep?: (index: number) => void } = {}): IdentityResult & { written: string[] } {
  const { result, writes } = plan(dir, change);
  if (options.dryRun) return { ...result, written: [] };

  const mod = loadProject(dir).mod;
  const touched = [join(dir, "mcedge.json"), ...writes.map((w) => join(dir, w.path))];
  const snapshot = new Map<string, Buffer>(touched.map((file) => [file, readFileSync(file)]));
  const steps: (() => void)[] = [
    ...writes.map((w) => () => writeFileSync(join(dir, w.path), w.text)),
    ...(result.datapackMoved ? [() => renameSync(join(dir, result.datapackMoved!.from), join(dir, result.datapackMoved!.to))] : []),
    () => saveModInfo(dir, { ...mod, id: result.modId?.to ?? mod.id, package: result.package?.to ?? mod.package }),
  ];
  let moved = false;
  try {
    steps.forEach((step, i) => {
      options.onStep?.(i);
      step();
      if (result.datapackMoved && i === writes.length) moved = true;
    });
  } catch (error) {
    const undone: string[] = [];
    const restore = (fn: () => void, what: string) => {
      try {
        fn();
      } catch (restoreError) {
        undone.push(`${what}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    };
    if (moved) restore(() => renameSync(join(dir, result.datapackMoved!.to), join(dir, result.datapackMoved!.from)), result.datapackMoved!.to);
    for (const [file, bytes] of snapshot) restore(() => writeFileSync(file, bytes), file);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(undone.length ? `identity change failed (${reason}) and these could not be restored: ${undone.join("; ")}` : `identity change failed and was undone: ${reason}`);
  }
  const written = result.datapackMoved
    ? touched.map((f) => f.replace(join(dir, result.datapackMoved!.from), join(dir, result.datapackMoved!.to)))
    : touched;
  return { ...result, applied: true, written };
}
