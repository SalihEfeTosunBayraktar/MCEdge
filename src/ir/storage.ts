import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { typeFields, withDefaults, type Element, type ElementType } from "../elements/model.ts";
import { elementJsonSchema, typeRegistry } from "../elements/registry.ts";
import { ROOT } from "../paths.ts";
import { renameRuleReads, ruleNameOf } from "./gameRules.ts";
import { NO_FOLDERS, type ProjectFolders } from "./folders.ts";
import { loadV1Elements, V1_FOLDERS, V1_SCHEMA_FILES } from "./migrate.ts";
import type { ProblemSettings } from "./problems.ts";
import type { ModInfo, ModProject, Variable } from "./types.ts";

/**
 * On-disk layout (one file per element keeps git diffs and merges small):
 *   mcedge.json                    project header: schema version + mod info
 *   elements/<folder>/<id>.json    one element; <folder> comes from the type's type.json
 *   variables.json                 global and player variables
 *   folders.json                   how the element list is organised (src/ir/folders.ts)
 *   texture-folders.json           how the Textures list is organised, by texture path (same shape)
 *   localization/<lang>.json       translations, one file per language
 *   problems.json                  ignored problems and checks, severities per check (src/ir/problems.ts)
 *   schemas/                       JSON schemas of these files, elements/<type>.schema.json per element type
 *
 * Schema 1 projects (hardcoded kinds) load through src/ir/migrate.ts; the first save of any part of such a
 * project rewrites the whole project in the current layout, so the files never mix both formats.
 */
const PROJECT_FILE = "mcedge.json";
const VARIABLES_FILE = "variables.json";
const LOCALIZATION_DIR = "localization";
const FOLDERS_FILE = "folders.json";
/** Folders of the Resources > Textures list (KUYRUK 177): placement keys are texture paths; texture files never move. */
export const TEXTURE_FOLDERS_FILE = "texture-folders.json";
/** Ignored problems and changed severities (KUYRUK 196); committed with the project, read by MCP and the CLI. */
export const PROBLEMS_FILE = "problems.json";
const SCHEMA_VERSION = 2;

/** Canonical key order per file type, so saving never reorders a diff. */
const KEY_ORDER = {
  project: ["$schema", "schemaVersion", "mod"],
  mod: ["id", "name", "version", "package", "authors", "description", "license", "website", "credits", "logo", "dependencies", "integrations"],
  variable: ["name", "type", "scope", "initial"],
} as const;

/** Defaults for mod fields added after the first schema; older projects load without them. */
const MOD_DEFAULTS: Pick<ModInfo, "license" | "website" | "credits" | "logo" | "dependencies"> = {
  license: "All Rights Reserved",
  website: "",
  credits: "",
  logo: "",
  dependencies: [],
};

interface ProjectHeader {
  schemaVersion: 1 | 2;
  mod: ModInfo;
}

export function isProjectDir(dir: string): boolean {
  return existsSync(join(dir, PROJECT_FILE));
}

function readHeader(dir: string): ProjectHeader {
  return readJson(join(dir, PROJECT_FILE));
}

/** Whether the project on disk still uses a schema the next save will migrate. */
export function needsMigration(dir: string): boolean {
  return readHeader(dir).schemaVersion < SCHEMA_VERSION;
}

export function loadProject(dir: string): ModProject {
  const header = readHeader(dir);
  if (header.schemaVersion > SCHEMA_VERSION) throw new Error(`project schema ${header.schemaVersion} is newer than this MCEdge supports`);
  const variablesFile = join(dir, VARIABLES_FILE);
  const registry = typeRegistry();
  const raw = header.schemaVersion === 1 ? loadV1Elements(dir) : loadElements(dir, registry.types);
  const elements: Record<string, Element[]> = {};
  for (const [typeId, list] of Object.entries(raw)) {
    const type = registry.byId.get(typeId);
    if (type && list.length) elements[typeId] = list.map((e) => withDefaults(type, e));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    mod: { ...MOD_DEFAULTS, ...header.mod },
    elements,
    variables: existsSync(variablesFile) ? readJson<{ variables: Variable[] }>(variablesFile).variables : [],
    localization: loadLocalization(dir),
    folders: existsSync(join(dir, FOLDERS_FILE)) ? readJson<ProjectFolders>(join(dir, FOLDERS_FILE)) : NO_FOLDERS,
    ...(existsSync(join(dir, TEXTURE_FOLDERS_FILE)) ? { textureFolders: readJson<ProjectFolders>(join(dir, TEXTURE_FOLDERS_FILE)) } : {}),
  };
}

/** One element of a current-layout project as loadProject reads it (undefined when its file is missing). */
export function loadElement(dir: string, typeId: string, id: string): Element | undefined {
  const type = typeRegistry().byId.get(typeId);
  const file = elementFile(dir, typeId, id);
  if (!type || !existsSync(file)) return undefined;
  const { $schema: _, ...element } = readJson<Element & { $schema?: string }>(file);
  return withDefaults(type, element);
}

/** Writes the whole project in the current layout and removes files only the old layout used. */
export function saveProject(dir: string, project: ModProject): void {
  const migrating = isProjectDir(dir) && needsMigration(dir);
  // Projects carry their schemas so editors and agents can validate files without MCEdge installed.
  cpSync(join(ROOT, "schemas"), join(dir, "schemas"), { recursive: true });
  if (migrating) removeV1Files(dir);
  writeModInfo(dir, project.mod);
  for (const [typeId, list] of Object.entries(project.elements)) for (const element of list) writeElement(dir, typeId, element);
  writeVariables(dir, project.variables);
  writeLocalization(dir, project.localization);
}

/** Before any partial save, an old-layout project is rewritten as a whole (see the layout note above). */
function ensureCurrent(dir: string): void {
  if (needsMigration(dir)) saveProject(dir, loadProject(dir));
}

export function saveModInfo(dir: string, mod: ModInfo): void {
  ensureCurrent(dir);
  writeModInfo(dir, mod);
}

/**
 * Writes one element file; the rest of the project stays untouched, except that changing the name of a game rule (its
 * ruleName) points the procedures that read it by the old name at the new one (KUYRUK 51).
 */
export function saveElement(dir: string, typeId: string, element: Element): void {
  ensureCurrent(dir);
  if (typeId === "game_rule") {
    const file = elementFile(dir, typeId, element.id);
    const before = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Element) : undefined;
    const [from, to] = [before && ruleNameOf(before), ruleNameOf(element)];
    if (from && from !== to) {
      const elements = loadProject(dir).elements;
      for (const changed of renameRuleReads(elements, from, to)) writeElement(dir, changed.type, changed.element);
    }
  }
  writeElement(dir, typeId, element);
}

/** Path of an element's file. */
export function elementFile(dir: string, typeId: string, id: string): string {
  return join(dir, "elements", elementType(typeId).folder, `${id}.json`);
}

/** Removes one element file. */
export function deleteElement(dir: string, typeId: string, id: string): void {
  ensureCurrent(dir);
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`bad element id: ${id}`);
  rmSync(join(dir, "elements", elementType(typeId).folder, `${id}.json`));
}

export function saveFolders(dir: string, folders: ProjectFolders): void {
  ensureCurrent(dir);
  writeFileSync(join(dir, FOLDERS_FILE), JSON.stringify(folders, null, 2) + "\n");
}

/** Writes texture-folders.json (KUYRUK 177). */
export function saveTextureFolders(dir: string, folders: ProjectFolders): void {
  ensureCurrent(dir);
  writeFileSync(join(dir, TEXTURE_FOLDERS_FILE), JSON.stringify(folders, null, 2) + "\n");
}

export function loadProblemSettings(dir: string): ProblemSettings {
  const file = join(dir, PROBLEMS_FILE);
  return existsSync(file) ? readJson(file) : {};
}

/** Writes problems.json; no settings left removes the file. */
export function saveProblemSettings(dir: string, settings: ProblemSettings): void {
  const file = join(dir, PROBLEMS_FILE);
  if (Object.keys(settings).length) writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  else rmSync(file, { force: true });
}

export function saveVariables(dir: string, variables: Variable[]): void {
  ensureCurrent(dir);
  writeVariables(dir, variables);
}

/** Writes every language file; `removed` languages (removed or renamed away) lose their file. */
export function saveLocalization(dir: string, localization: Record<string, Record<string, string>>, removed: readonly string[] = []): void {
  ensureCurrent(dir);
  writeLocalization(dir, localization);
  for (const code of removed) if (!(code in localization)) rmSync(join(dir, LOCALIZATION_DIR, `${code}.json`), { force: true });
}

function elementType(typeId: string): ElementType {
  const type = typeRegistry().byId.get(typeId);
  if (!type) throw new Error(`unknown element type: ${typeId}`);
  return type;
}

function writeModInfo(dir: string, mod: ModInfo): void {
  writeJson(join(dir, PROJECT_FILE), {
    $schema: "./schemas/project.schema.json",
    schemaVersion: SCHEMA_VERSION,
    mod: ordered(mod, KEY_ORDER.mod),
  }, KEY_ORDER.project);
}

function writeElement(dir: string, typeId: string, element: Element): void {
  const type = elementType(typeId);
  if (!/^[a-z0-9_]+$/.test(element.id)) throw new Error(`bad element id: ${element.id}`);
  const folder = join(dir, "elements", type.folder);
  mkdirSync(folder, { recursive: true });
  writeElementSchema(dir, type);
  const keyOrder = ["$schema", "id", "title", ...typeFields(type).map((f) => f.key)];
  writeJson(join(folder, `${element.id}.json`), { $schema: `../../schemas/elements/${type.id}.schema.json`, ...element }, keyOrder);
}

/** Keeps schemas/elements/<type>.schema.json in step with the type definition; untouched when unchanged. */
function writeElementSchema(dir: string, type: ElementType): boolean {
  return writeIfChanged(join(dir, "schemas", "elements", `${type.id}.schema.json`), JSON.stringify(elementJsonSchema(type), null, 2) + "\n");
}

/** Writes a text file unless it already holds that text (line endings aside: a CRLF checkout is not a change). */
function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8").replace(/\r\n/g, "\n") === text.replace(/\r\n/g, "\n")) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

/**
 * Brings a project's schemas/ up to this MCEdge (KUYRUK 110): the file schemas, and the element schema of every type the
 * project has elements of or a schema file for. Run when a project is opened (app and MCP server), so a newer MCEdge
 * updates them once, by itself, instead of the first unrelated edit of an element pulling a schema change into its diff.
 * Returns the project-relative paths it rewrote.
 */
export function refreshSchemas(dir: string): string[] {
  if (!isProjectDir(dir) || needsMigration(dir)) return [];
  const changed: string[] = [];
  const source = join(ROOT, "schemas");
  for (const name of readdirSync(source).filter((n) => n.endsWith(".json"))) {
    if (writeIfChanged(join(dir, "schemas", name), readFileSync(join(source, name), "utf8"))) changed.push(`schemas/${name}`);
  }
  const existing = existsSync(join(dir, "schemas", "elements")) ? readdirSync(join(dir, "schemas", "elements")) : [];
  for (const type of typeRegistry().types) {
    const folder = join(dir, "elements", type.folder);
    const used = existsSync(folder) && readdirSync(folder).some((n) => n.endsWith(".json"));
    if ((used || existing.includes(`${type.id}.schema.json`)) && writeElementSchema(dir, type)) changed.push(`schemas/elements/${type.id}.schema.json`);
  }
  return changed;
}

function writeVariables(dir: string, variables: Variable[]): void {
  writeJson(join(dir, VARIABLES_FILE), {
    $schema: "./schemas/variables.schema.json",
    variables: variables.map((v) => ordered(v, KEY_ORDER.variable)),
  }, ["$schema", "variables"]);
}

/** Writes every language file; keys are sorted so translations diff cleanly. */
/**
 * Language files keep their key order: keys stay where the file has them and new ones come last, so a small edit is a
 * small diff (KUYRUK 107). Entries are written in the order given: the file's order plus appended keys.
 */
function writeLocalization(dir: string, localization: Record<string, Record<string, string>>): void {
  const folder = join(dir, LOCALIZATION_DIR);
  mkdirSync(folder, { recursive: true });
  for (const [lang, entries] of Object.entries(localization)) {
    const file = join(folder, `${lang}.json`);
    // A language whose keys, order and texts are as on disk is not rewritten, so its line ends and layout stay.
    if (existsSync(file) && sameEntries(file, entries)) continue;
    writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
  }
}

function sameEntries(file: string, entries: Record<string, string>): boolean {
  try {
    return JSON.stringify(readJson(file)) === JSON.stringify(entries);
  } catch {
    return false;
  }
}

/**
 * Old element files are rewritten in place where the folder name survived (items, blocks, tools, recipes);
 * foods/ and tabs/ moved into items/ and creative_tabs/, and the old per-kind schemas are obsolete.
 */
function removeV1Files(dir: string): void {
  const registryFolders = new Set(typeRegistry().types.map((t) => t.folder));
  for (const folder of V1_FOLDERS) {
    const path = join(dir, "elements", folder);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path).filter((n) => n.endsWith(".json"))) rmSync(join(path, name));
    if (!registryFolders.has(folder) && readdirSync(path).length === 0) rmdirSync(path);
  }
  for (const name of V1_SCHEMA_FILES) rmSync(join(dir, "schemas", name), { force: true });
}

function loadElements(dir: string, types: ElementType[]): Record<string, Element[]> {
  const result: Record<string, Element[]> = {};
  for (const type of types) {
    const folder = join(dir, "elements", type.folder);
    if (!existsSync(folder)) continue;
    result[type.id] = readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const { $schema: _, ...element } = readJson<Element & { $schema?: string }>(join(folder, name));
        return element;
      });
  }
  return result;
}

function loadLocalization(dir: string): Record<string, Record<string, string>> {
  const folder = join(dir, LOCALIZATION_DIR);
  if (!existsSync(folder)) return {};
  return Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name.slice(0, -".json".length), readJson<Record<string, string>>(join(folder, name))]),
  );
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: object, keyOrder: readonly string[]): void {
  writeFileSync(path, JSON.stringify(ordered(value, keyOrder), null, 2) + "\n");
}

function ordered<T extends object>(value: T, keyOrder: readonly string[]): T {
  const entries = Object.entries(value);
  const rank = (key: string) => (keyOrder.includes(key) ? keyOrder.indexOf(key) : keyOrder.length);
  return Object.fromEntries(entries.sort(([a], [b]) => rank(a) - rank(b))) as T;
}
