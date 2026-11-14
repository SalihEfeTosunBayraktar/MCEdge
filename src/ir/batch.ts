import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { loadTags, validateTags } from "../tags/tags.ts";
import { elementKey, NO_FOLDERS, type ProjectFolders } from "./folders.ts";
import { scan, type ScanInput } from "./references.ts";
import { deleteElement, elementFile, loadProblemSettings, loadProject, needsMigration, saveElement, saveFolders } from "./storage.ts";
import { classify } from "./problems.ts";
import type { ModProject } from "./types.ts";
import { validateProject, type ValidationIssue } from "./validate.ts";

const ID = /^[a-z][a-z0-9_]*$/;

export type BatchOp =
  | { op: "create"; type: string; id: string; values?: Record<string, unknown>; folder?: string }
  | { op: "update"; type: string; id: string; values: Record<string, unknown> }
  | { op: "delete"; type: string; id: string };

export interface BatchResult {
  /** Whether the files were written: no op failed, and no new problem unless allowed, and not a dry run. */
  applied: boolean;
  dryRun: boolean;
  /** Ops that cannot run (unknown type, taken or missing id), by index; any of them stops the whole batch. */
  errors: { index: number; message: string }[];
  /** Problems the project would have after the batch that it did not have before. */
  newProblems: ValidationIssue[];
  /** Problems the batch removes. */
  fixedProblems: number;
  changes: { op: BatchOp["op"]; element: string }[];
}

const sameNamespace = (a: string, b: string) => (a === "recipe") === (b === "recipe");
const issueKey = (i: ValidationIssue) => `${i.path}\n${i.message}`;
/** Problems with their severity, without the ones problems.json ignores (KUYRUK 196). */
const problemsOf = (project: ModProject, dir: string) => classify([...validateProject(project, dir), ...validateTags(loadTags(dir), project)], loadProblemSettings(dir)).shown;

/**
 * Creates, updates and deletes many elements as one change. Every op is checked against the project as the earlier
 * ops leave it, then the whole resulting project is validated; nothing is written when an op fails, or when the
 * result has problems the project did not have (unless `allowProblems`). The files the batch touches are read first
 * and written back if a write fails halfway.
 */
export function applyBatch(dir: string, ops: BatchOp[], options: { dryRun?: boolean; allowProblems?: boolean } = {}): BatchResult {
  if (needsMigration(dir)) throw new Error("this project uses an older layout; open it in MCEdge once before a batch");
  const types = typeRegistry().byId;
  const project = loadProject(dir);
  const elements: Record<string, Element[]> = Object.fromEntries(Object.entries(project.elements).map(([t, list]) => [t, [...list]]));
  const folders: ProjectFolders = structuredClone(project.folders ?? NO_FOLDERS);
  let foldersChanged = false;
  const errors: BatchResult["errors"] = [];
  const writes = new Map<string, { type: string; element?: Element }>();

  ops.forEach((op, index) => {
    const type = types.get(op.type);
    if (!type) return errors.push({ index, message: `unknown element type "${op.type}"` });
    if (!ID.test(op.id)) return errors.push({ index, message: `id "${op.id}" must be lower_snake_case, starting with a letter` });
    const list = (elements[op.type] ??= []);
    const at = list.findIndex((e) => e.id === op.id);
    if (op.op === "create") {
      const clash = Object.entries(elements).find(([t, l]) => sameNamespace(t, op.type) && l.some((e) => e.id === op.id));
      if (clash) return errors.push({ index, message: `id "${op.id}" is already used by ${clash[0]}/${op.id}` });
      const element = { ...newElement(type, op.id), ...(op.values ?? {}), id: op.id };
      list.push(element);
      writes.set(`${op.type}/${op.id}`, { type: op.type, element });
      if (op.folder) {
        if (!folders.folders.includes(op.folder)) return errors.push({ index, message: `no folder "${op.folder}"` });
        folders.placement[elementKey(op.type, op.id)] = op.folder;
        foldersChanged = true;
      }
    } else if (at < 0) {
      return errors.push({ index, message: `no ${op.type} "${op.id}"` });
    } else if (op.op === "update") {
      const element = { ...list[at], ...op.values, id: op.id };
      list[at] = element;
      writes.set(`${op.type}/${op.id}`, { type: op.type, element });
    } else {
      list.splice(at, 1);
      writes.set(`${op.type}/${op.id}`, { type: op.type });
      const key = elementKey(op.type, op.id);
      if (key in folders.placement) {
        delete folders.placement[key];
        foldersChanged = true;
      }
    }
    return undefined;
  });

  const changes = ops.map((op) => ({ op: op.op, element: `${op.type}/${op.id}` }));
  if (errors.length) return { applied: false, dryRun: !!options.dryRun, errors, newProblems: [], fixedProblems: 0, changes };

  const before = new Set(problemsOf(project, dir).map(issueKey));
  const afterIssues = problemsOf({ ...project, elements, folders }, dir);
  const after = new Set(afterIssues.map(issueKey));
  const newProblems = afterIssues.filter((i) => !before.has(issueKey(i)));
  const fixedProblems = [...before].filter((k) => !after.has(k)).length;
  const result = { dryRun: !!options.dryRun, errors, newProblems, fixedProblems, changes };
  if (options.dryRun || (newProblems.length && !options.allowProblems)) return { ...result, applied: false };

  // Snapshot every file the writes may touch; a game rule's new name also rewrites the procedures reading it.
  const files = new Set<string>();
  for (const { type } of writes.values()) files.add(join(dir, "schemas", "elements", `${type}.schema.json`));
  for (const [key, { type }] of writes) files.add(elementFile(dir, type, key.slice(type.length + 1)));
  if ([...writes.values()].some((w) => w.type === "game_rule")) {
    const procedures = join(dir, "elements", types.get("procedure")!.folder);
    if (existsSync(procedures)) for (const name of readdirSync(procedures)) files.add(join(procedures, name));
  }
  if (foldersChanged) files.add(join(dir, "folders.json"));
  const snapshot = new Map([...files].map((f) => [f, existsSync(f) ? readFileSync(f) : null]));
  try {
    for (const [key, { type, element }] of writes) {
      if (element) saveElement(dir, type, element);
      else deleteElement(dir, type, key.slice(type.length + 1));
    }
    if (foldersChanged) saveFolders(dir, folders);
  } catch (error) {
    for (const [file, bytes] of snapshot) {
      if (bytes === null) rmSync(file, { force: true });
      else writeFileSync(file, bytes);
    }
    throw new Error(`batch failed and was undone: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...result, applied: true };
}

/** Replaces every exact occurrence of each pair in the strings of a value (keys stay). */
export function replaceText<T>(value: T, pairs: { from: string; to: string }[]): T {
  if (!pairs.length) return value;
  const sorted = [...pairs].filter((p) => p.from).sort((a, b) => b.from.length - a.from.length);
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      let out = "";
      for (let i = 0; i < v.length;) {
        const pair = sorted.find((p) => v.startsWith(p.from, i));
        if (pair) {
          out += pair.to;
          i += pair.from.length;
        } else out += v[i++];
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  return visit(value) as T;
}

export interface CloneRequest {
  elements: { type: string; id: string; newId: string; values?: Record<string, unknown> }[];
  /** Text replaced in every string of the copies ("Ruby" -> "Sapphire"), after the references are rewired. */
  replace?: { from: string; to: string }[];
}

/**
 * Create ops for copies of a set of elements. A reference from one copy to another element of the set points at
 * that element's copy (the same scanner rename uses); references to elements outside the set stay. Each copy goes
 * into its source's folder.
 */
export function cloneOps(dir: string, request: CloneRequest): BatchOp[] {
  const project = loadProject(dir);
  const types = typeRegistry().byId;
  const copies: Record<string, Element[]> = {};
  for (const { type, id } of request.elements) {
    const source = project.elements[type]?.find((e) => e.id === id);
    if (!source) throw new Error(`no ${type} "${id}"`);
    if ((copies[type] ??= []).some((e) => e.id === id)) throw new Error(`${type}/${id} is listed twice`);
    copies[type].push(structuredClone(source));
  }
  const newIds = request.elements.map((e) => `${e.type === "recipe" ? "recipe" : "shared"}/${e.newId}`);
  if (new Set(newIds).size !== newIds.length) throw new Error("two copies get the same new id");
  // Rewire inside the copies only: the scanner sees just them, so it resolves only references within the set.
  const virtual: ScanInput = { modId: project.mod.id, elements: copies, types, tags: [], datapack: [] };
  const final = new Map<string, string>(); // "type/oldId" -> newId
  for (const { type, id, newId } of request.elements) final.set(`${type}/${id}`, newId);
  // Temporary ids first, so a new id that equals another source id cannot be mistaken for it.
  const temp = (i: number) => `zzclone${i}tmp`;
  request.elements.forEach(({ type, id }, i) => {
    for (const hit of scan(virtual)) if (hit.to.type === type && hit.to.id === id && !hit.ambiguous) hit.apply(temp(i));
    copies[type].find((e) => e.id === id)!.id = temp(i);
  });
  request.elements.forEach(({ type, newId }, i) => {
    for (const hit of scan(virtual)) if (hit.to.type === type && hit.to.id === temp(i) && !hit.ambiguous) hit.apply(newId);
    copies[type].find((e) => e.id === temp(i))!.id = newId;
  });
  const placement = (project.folders ?? NO_FOLDERS).placement;
  return request.elements.map(({ type, id, newId, values }) => {
    const { id: _id, ...copy } = replaceText(copies[type].find((e) => e.id === newId)!, request.replace ?? []);
    const folder = placement[elementKey(type, id)];
    return { op: "create" as const, type, id: newId, values: { ...copy, ...(values ?? {}) }, ...(folder ? { folder } : {}) };
  });
}

// ---- templates: templates/<name>.json in the project ----

export interface ElementTemplate {
  name: string;
  description?: string;
  /** Parameter -> the value it replaced when the template was saved (an example). */
  params: Record<string, string>;
  elements: { type: string; id: string; values: Record<string, unknown> }[];
}

const TEMPLATE_NAME = /^[a-z0-9_-]+$/;
const templateFile = (dir: string, name: string) => {
  if (!TEMPLATE_NAME.test(name)) throw new Error("template name: lowercase letters, digits, _ and -");
  return join(dir, "templates", `${name}.json`);
};
const words = (value: string) => value.split(/[_\s]+/).filter(Boolean);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * The spellings of a parameter in a template: "{{name}}" (ruby_gem), "{{Name}}" (RubyGem), "{{Name Words}}"
 * (Ruby Gem) and "{{NAME}}" (RUBY_GEM), each paired with the value written that way.
 */
function spellings(param: string, value: string): { placeholder: string; text: string }[] {
  const w = words(value.toLowerCase());
  const all = [
    { placeholder: `{{${param}}}`, text: w.join("_") },
    { placeholder: `{{${cap(param)}}}`, text: w.map(cap).join("") },
    { placeholder: `{{${cap(param)} Words}}`, text: w.map(cap).join(" ") },
    { placeholder: `{{${param.toUpperCase()}}}`, text: w.join("_").toUpperCase() },
  ];
  return all.filter((s, i) => all.findIndex((o) => o.text === s.text) === i);
}

export function listTemplates(dir: string): { name: string; description?: string; params: Record<string, string>; elements: string[] }[] {
  const folder = join(dir, "templates");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((n) => n.endsWith(".json")).map((n) => {
    const t = JSON.parse(readFileSync(join(folder, n), "utf8")) as ElementTemplate;
    return { name: t.name, description: t.description, params: t.params, elements: t.elements.map((e) => `${e.type}/${e.id}`) };
  });
}

/** Saves elements as a template: each parameter's value (in every spelling) becomes its placeholder. */
export function saveTemplate(dir: string, template: { name: string; description?: string; params: Record<string, string>; elements: { type: string; id: string }[] }): ElementTemplate {
  const project = loadProject(dir);
  const pairs = Object.entries(template.params).flatMap(([p, v]) => spellings(p, v).map((s) => ({ from: s.text, to: s.placeholder })));
  const elements = template.elements.map(({ type, id }) => {
    const element = project.elements[type]?.find((e) => e.id === id);
    if (!element) throw new Error(`no ${type} "${id}"`);
    const { id: _id, ...values } = element;
    return { type, id: replaceText(id, pairs), values: replaceText(values, pairs) };
  });
  const saved: ElementTemplate = { name: template.name, ...(template.description ? { description: template.description } : {}), params: template.params, elements };
  const file = templateFile(dir, template.name);
  mkdirSync(join(dir, "templates"), { recursive: true });
  writeFileSync(file, JSON.stringify(saved, null, 2) + "\n");
  return saved;
}

/** Create ops for a template with its parameters filled in (every spelling). */
export function templateOps(dir: string, name: string, params: Record<string, string>, folder?: string): BatchOp[] {
  const file = templateFile(dir, name);
  if (!existsSync(file)) throw new Error(`no template "${name}"; see list_templates`);
  const template = JSON.parse(readFileSync(file, "utf8")) as ElementTemplate;
  const missing = Object.keys(template.params).filter((p) => !params[p]);
  if (missing.length) throw new Error(`missing parameters: ${missing.join(", ")}`);
  const pairs = Object.entries(params).flatMap(([p, v]) => spellings(p, v).map((s) => ({ from: s.placeholder, to: s.text })));
  return template.elements.map((e) => ({ op: "create" as const, type: e.type, id: replaceText(e.id, pairs), values: replaceText(e.values, pairs), ...(folder ? { folder } : {}) }));
}
