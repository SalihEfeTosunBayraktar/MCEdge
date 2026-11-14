import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { loadProject } from "../ir/storage.ts";
import { convertBbmodel } from "./blockbench.ts";
import { unzipToFolder, zipFolder } from "./zip.ts";

/**
 * Project resources besides textures, shared by the app (Resources view, menus) and the MCP server:
 *   sounds/<name>.ogg          sound events "<modid>:<name>"
 *   models/<name>.json|java|obj (+ .mtl), .bbmodel   custom models named "<name>"; an imported .bbmodel becomes <name>.json
 *   structures/<name>.nbt      structure templates "<modid>:<name>"
 */
export type ResourceKind = "sound" | "model" | "structure";

export const RESOURCE_FOLDERS: Record<ResourceKind, string> = { sound: "sounds", model: "models", structure: "structures" };
const ACCEPTED: Record<ResourceKind, string[]> = { sound: [".ogg"], model: [".bbmodel", ".json", ".java", ".obj", ".mtl"], structure: [".nbt"] };
const LISTED: Record<ResourceKind, RegExp> = { sound: /\.ogg$/, model: /\.(json|java|obj|bbmodel)$/, structure: /\.nbt$/ };
/** Never put into a workspace export: generated projects, build output, caches, version control. */
const EXPORT_SKIP = new Set(["out", "build", ".gradle", "run", ".git", "node_modules", "dist"]);

export const resourceExtensions = (kind: ResourceKind) => ACCEPTED[kind].map((e) => e.slice(1));

/** File names of imported resources follow resource-location rules: lower case, digits, underscores. */
export const resourceName = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "resource";

/** Project-relative paths of a kind's files. */
export function listResources(dir: string, kind: ResourceKind): string[] {
  const folder = join(dir, RESOURCE_FOLDERS[kind]);
  return existsSync(folder) ? readdirSync(folder).filter((n) => LISTED[kind].test(n)).sort().map((n) => `${RESOURCE_FOLDERS[kind]}/${n}`) : [];
}

/** Copies files into the project (converting .bbmodel); returns the project paths written and conversion warnings. */
export function importResources(dir: string, kind: ResourceKind, files: string[]): { imported: string[]; warnings: string[] } {
  const folder = join(dir, RESOURCE_FOLDERS[kind]);
  mkdirSync(folder, { recursive: true });
  const imported: string[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!ACCEPTED[kind].includes(ext)) throw new Error(`${basename(file)}: a ${kind} must be ${ACCEPTED[kind].join(", ")}`);
    const name = resourceName(basename(file, extname(file)));
    if (ext === ".bbmodel") {
      const converted = convertBbmodel(readFileSync(file, "utf8"), name, loadProject(dir).mod.id);
      for (const [path, bytes] of converted.textures) {
        mkdirSync(join(dir, "textures", "block"), { recursive: true });
        writeFileSync(join(dir, path), bytes);
        imported.push(path);
      }
      writeFileSync(join(folder, `${name}.json`), JSON.stringify(converted.model, null, 2) + "\n");
      warnings.push(...converted.warnings.map((w) => `${basename(file)}: ${w}`));
      imported.push(`${RESOURCE_FOLDERS[kind]}/${name}.json`);
    } else {
      copyFileSync(file, join(folder, `${name}${ext}`));
      imported.push(`${RESOURCE_FOLDERS[kind]}/${name}${ext}`);
    }
  }
  return { imported, warnings };
}

/** Deletes an imported resource; refused while an element names it ("<modid>:<name>" or "<name>"). */
export function deleteResource(dir: string, path: string): void {
  if (!/^(sounds|models|structures)\/[^/\\]+$/.test(path)) throw new Error(`not a resource: ${path}`);
  const name = basename(path, extname(path));
  const elements = JSON.stringify(loadProject(dir).elements);
  if (elements.includes(`:${name}"`) || elements.includes(`"${name}"`)) throw new Error(`resource in use: ${path}`);
  // A sound file a listed sound event plays stays until the event lets go of it (KUYRUK 132).
  const events = existsSync(join(dir, "sound_events.json")) ? JSON.parse(readFileSync(join(dir, "sound_events.json"), "utf8")) as Record<string, { files?: string[] }> : {};
  const player = path.startsWith("sounds/") ? Object.entries(events).find(([event, e]) => event !== name && (e.files ?? []).includes(name)) : undefined;
  if (player) throw new Error(`resource in use: ${path} is a file of sound event "${player[0]}"`);
  const file = resolve(dir, path);
  if (relative(dir, file).startsWith("..")) throw new Error("path outside project");
  rmSync(file);
  // An OBJ model's material file goes with it.
  const mtl = file.replace(/\.obj$/, ".mtl");
  if (mtl !== file && existsSync(mtl)) rmSync(mtl);
}

/** Zips the project under a folder named after the mod id, without generated folders; returns the file count. */
export function exportWorkspace(dir: string, file: string): number {
  return zipFolder(dir, file, loadProject(dir).mod.id, (rel, isDir) => isDir && !rel.includes("/") && EXPORT_SKIP.has(rel));
}

/**
 * File > Import project from ZIP (KUYRUK 135): extracts a workspace export (File > Export workspace, or any zip holding
 * a project's mcedge.json at the top or one folder down) into a new folder under `parent`, named like the zip's
 * project folder; returns that folder. An existing folder of that name is never replaced.
 */
export function importWorkspace(zip: string, parent: string): string {
  mkdirSync(parent, { recursive: true });
  const temp = mkdtempSync(join(parent, ".mcedge-import-"));
  try {
    unzipToFolder(zip, temp);
    const inner = existsSync(join(temp, "mcedge.json")) ? temp
      : readdirSync(temp).map((n) => join(temp, n)).find((p) => statSync(p).isDirectory() && existsSync(join(p, "mcedge.json")));
    if (!inner) throw new Error(`${basename(zip)} holds no MCEdge project (no mcedge.json)`);
    const name = inner === temp ? loadProject(temp).mod.id : basename(inner);
    const target = join(parent, name);
    if (existsSync(target)) throw new Error(`a folder ${target} already exists; move it or import into another folder`);
    renameSync(inner, target);
    return target;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Build & run > Clear Gradle caches (KUYRUK 135): the build output and Gradle state of each engine's generated project, made again on the next build. */
export function clearGradleCaches(dir: string): string[] {
  const out = join(dir, "out");
  if (!existsSync(out)) return [];
  const removed: string[] = [];
  for (const engine of readdirSync(out)) {
    for (const folder of ["build", ".gradle"]) {
      const path = join(out, engine, folder);
      if (!existsSync(path)) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(`out/${engine}/${folder}`);
    }
  }
  return removed;
}
