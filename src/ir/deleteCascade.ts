/**
 * Deleting an element together with what only it used (Q220): procedures and GUIs nobody else calls or opens, recipes
 * that make it, textures and models no other element names, translation keys no other element uses, and the folder
 * entries of everything that goes. The planner reuses the reference scanner (src/ir/references.ts) and the key rules of
 * src/ir/translationUse.ts, so it agrees with Usages, Unused and the unused-translation report.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { typeFields, valuesOfType, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import type { Engine } from "../engines/registry.ts";
import { generatedLangKeys } from "../generator/langKeys.ts";
import { listEngines } from "../engines/registry.ts";
import { deleteResource, listResources } from "../resources/files.ts";
import { elementKey, kindFolders, withKindFolders, type FolderKind, type ProjectFolders } from "./folders.ts";
import { findAllReferences, REFERENCE_DRIVEN_TYPES, refKey, sourceLabel, type ElementRef } from "./references.ts";
import { loadReferenceInput } from "./referenceInput.ts";
import { texturePaths } from "./renamePlan.ts";
import { deleteElement, saveFolders, saveLocalization, saveTextureFolders } from "./storage.ts";
import { keyUsers, withoutKeys } from "./translationUse.ts";

/** A recipe's result slots ("recipeReturnStack", "smeltingReturnStack", ...): a recipe that makes the element. */
const RESULT_SLOT = /ReturnStack$/;
const basename = (path: string) => path.replace(/^.*\//, "").replace(/\.[^.]*$/, "");

export interface PlanFile { path: string; /** Folder it sits in (Resources). */ folder?: string }
export interface PlanElement extends ElementRef { /** Folder it sits in (element list). */ folder?: string; /** What it is for: who uses it, or the recipe's result. */ usedBy: string[] }

export interface DeletePlan {
  element: ElementRef & { folder?: string };
  /** Procedures, GUIs and recipes only this element uses or needs. */
  elements: PlanElement[];
  textures: PlanFile[];
  models: PlanFile[];
  /** Typed translation keys only this element (and the listed ones) use, with the languages that have text for them. */
  langKeys: { key: string; languages: string[] }[];
}

/** What to delete besides the element: names from the plan. `"all"` is everything the plan lists. */
export interface DeleteSelection {
  elements?: string[];
  textures?: string[];
  models?: string[];
  langKeys?: string[];
}

export interface DeleteOutcome {
  deleted: string[];
  textures: string[];
  models: string[];
  langKeys: string[];
  /** Folder entries removed: "folders.json: item/ruby", "texture-folders.json: textures/ruby.png". */
  folderEntries: string[];
  /** Absolute paths of files written or removed (for a watcher that ignores the app's own writes). */
  files: string[];
}

/**
 * What deleting `target` would leave behind that only it used. `engine` decides which keys the generator writes for it
 * (default: the first engine). Nothing is written.
 */
export function planDelete(dir: string, target: ElementRef, engine: Engine = listEngines()[0]): DeletePlan {
  const input = loadReferenceInput(dir);
  const { project } = input;
  if (!input.elements[target.type]?.some((e) => e.id === target.id)) throw new Error(`no ${target.type} "${target.id}"`);
  const refs = findAllReferences(input).filter((r) => r.from.kind !== "element" || refKey(r.from) !== refKey(r.to));
  const elementRefs = (key: string) => refs.filter((r) => r.from.kind === "element" && refKey(r.from) === key);
  const triggered = (e: Element, type: string) => type === "procedure" && String(e.globalTrigger ?? "no_ext_trigger") !== "no_ext_trigger";
  const find = (type: string, id: string) => input.elements[type]?.find((e) => e.id === id);

  // Procedures and GUIs reachable from the element, then the ones something else uses taken out until none changes
  // (a cycle only the element reaches goes with it).
  const goes = new Set<string>([refKey(target)]);
  const reach: ElementRef[] = [];
  for (const queue = [refKey(target)]; queue.length;) {
    for (const r of elementRefs(queue.shift()!)) {
      const e = find(r.to.type, r.to.id);
      if (!e || !REFERENCE_DRIVEN_TYPES.includes(r.to.type) || triggered(e, r.to.type) || goes.has(refKey(r.to))) continue;
      goes.add(refKey(r.to));
      reach.push(r.to);
      queue.push(refKey(r.to));
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const c of reach) {
      if (!goes.has(refKey(c))) continue;
      if (refs.some((r) => refKey(r.to) === refKey(c) && !(r.from.kind === "element" && goes.has(refKey(r.from))))) (goes.delete(refKey(c)), (changed = true));
    }
  }
  const owned: PlanElement[] = reach.filter((c) => goes.has(refKey(c))).map((c) => ({ ...c, usedBy: [...new Set(refs.filter((r) => refKey(r.to) === refKey(c)).map((r) => sourceLabel(r.from)))] }));
  // Recipes with the element (or a dependent) as their result.
  const made = new Set(goes);
  for (const r of refs) {
    if (r.from.kind !== "element" || r.from.type !== "recipe" || !made.has(refKey(r.to)) || !RESULT_SLOT.test(r.path)) continue;
    if (goes.has(refKey(r.from))) continue;
    goes.add(refKey(r.from));
    owned.push({ type: "recipe", id: r.from.id, usedBy: [`makes ${refKey(r.to)}`] });
  }

  const gone = (typeId: string, e: Element) => goes.has(elementKey(typeId, e.id));
  const typeOf = (id: string) => typeRegistry().byId.get(id);
  const others = Object.entries(input.elements).flatMap(([typeId, list]) => list.filter((e) => !gone(typeId, e)).map((e) => ({ typeId, e })));
  const goingOut = Object.entries(input.elements).flatMap(([typeId, list]) => list.filter((e) => gone(typeId, e)).map((e) => ({ typeId, e })));

  const folderOf = (state: ProjectFolders | undefined, key: string) => state?.placement[key];
  const placed = (key: string) => ({ folder: folderOf(project.folders, key) });
  const usedOutside = new Set<string>(project.mod.logo ? [project.mod.logo] : []);
  for (const { typeId, e } of others) texturePaths(typeOf(typeId), e).forEach((p) => usedOutside.add(p));
  const textureFolders = kindFolders(project.textureFolders, "textures");
  const textures = [...new Set(goingOut.flatMap(({ typeId, e }) => texturePaths(typeOf(typeId), e)))]
    .filter((p) => !usedOutside.has(p) && input.fileExists(p)).sort()
    .map((path) => ({ path, ...(folderOf(textureFolders, path) ? { folder: folderOf(textureFolders, path) } : {}) }));

  const modelNames = (list: { typeId: string; e: Element }[]) => new Set(list.flatMap(({ typeId, e }) => { const t = typeOf(typeId); return t ? valuesOfType(typeFields(t), e, "model") : []; }));
  const keptModels = modelNames(others);
  const wantedModels = modelNames(goingOut);
  const modelFolders = kindFolders(project.textureFolders, "models");
  const models = listResources(dir, "model").filter((path) => wantedModels.has(basename(path)) && !keptModels.has(basename(path)))
    .map((path) => ({ path, ...(folderOf(modelFolders, path) ? { folder: folderOf(modelFolders, path) } : {}) }));

  // Translation keys: used by the going elements and by nothing that stays. The generator is run for the going elements only.
  const going: Record<string, Element[]> = {};
  for (const { typeId, e } of goingOut) (going[typeId] ??= []).push(e);
  let generated: ReturnType<typeof generatedLangKeys> = {};
  try {
    generated = generatedLangKeys({ ...project, elements: going }, dir, engine);
  } catch {
    // The keys the generator adds are left out; names and the "<mod>.<id>" rule still apply.
  }
  const users = keyUsers(project, typeOf, generated);
  const langKeys = [...users].filter(([, who]) => [...who].every((u) => goes.has(u))).map(([key]) => key).sort()
    .map((key) => ({ key, languages: Object.entries(project.localization).filter(([, entries]) => key in entries).map(([language]) => language) }));

  return {
    element: { ...target, ...placed(elementKey(target.type, target.id)) },
    elements: owned.map((o) => ({ ...o, ...placed(elementKey(o.type, o.id)) })),
    textures, models, langKeys,
  };
}

/** The selection as a list of everything a plan names, for "delete all". */
export const everything = (plan: DeletePlan): Required<DeleteSelection> => ({
  elements: plan.elements.map((e) => elementKey(e.type, e.id)),
  textures: plan.textures.map((t) => t.path),
  models: plan.models.map((m) => m.path),
  langKeys: plan.langKeys.map((k) => k.key),
});

/**
 * Deletes the element and the chosen part of its plan; every name must be in the plan (what others still use is refused).
 * The folder entries of everything deleted go too. The plan is made again by the caller right before, from the same project.
 */
export function applyDelete(dir: string, plan: DeletePlan, selection: DeleteSelection): DeleteOutcome {
  const pick = <T>(chosen: string[] | undefined, listed: T[], name: (item: T) => string, what: string): T[] => {
    const wanted = chosen ?? [];
    const unknown = wanted.filter((n) => !listed.some((item) => name(item) === n));
    if (unknown.length) throw new Error(`not something only ${elementKey(plan.element.type, plan.element.id)} uses (${what}): ${unknown.join(", ")}`);
    return listed.filter((item) => wanted.includes(name(item)));
  };
  const elements = pick(selection.elements, plan.elements, (e) => elementKey(e.type, e.id), "elements");
  const textures = pick(selection.textures, plan.textures, (t) => t.path, "textures");
  const models = pick(selection.models, plan.models, (m) => m.path, "models");
  const langKeys = pick(selection.langKeys, plan.langKeys, (k) => k.key, "translation keys");

  const files: string[] = [];
  const doomed: ElementRef[] = [plan.element, ...elements];
  for (const { type, id } of doomed) {
    deleteElement(dir, type, id);
    files.push(join(dir, "elements", typeRegistry().byId.get(type)!.folder, `${id}.json`));
  }
  for (const { path } of textures) {
    for (const file of [join(dir, path), `${join(dir, path)}.mcmeta`]) if (existsSync(file)) (rmSync(file), files.push(file));
  }
  for (const { path } of models) (deleteResource(dir, path), files.push(join(dir, path)));

  // Folder entries, read again: the deletions above changed nothing in them.
  const folderEntries: string[] = [];
  const loaded = loadReferenceInput(dir).project;
  const elementKeys = new Set(doomed.map((d) => elementKey(d.type, d.id)));
  const listed = loaded.folders;
  const placedKeys = Object.keys(listed?.placement ?? {}).filter((k) => elementKeys.has(k));
  if (listed && placedKeys.length) {
    placedKeys.forEach((k) => folderEntries.push(`folders.json: ${k}`));
    saveFolders(dir, { ...listed, placement: Object.fromEntries(Object.entries(listed.placement).filter(([k]) => !elementKeys.has(k))) });
  }
  let resourceFolders = loaded.textureFolders;
  for (const [kind, paths] of [["textures", textures.map((t) => t.path)], ["models", models.map((m) => m.path)]] as [FolderKind, string[]][]) {
    const state = kindFolders(resourceFolders, kind);
    const hit = paths.filter((p) => p in state.placement);
    if (!hit.length) continue;
    hit.forEach((p) => folderEntries.push(`texture-folders.json: ${p}`));
    resourceFolders = withKindFolders(resourceFolders, kind, { ...state, placement: Object.fromEntries(Object.entries(state.placement).filter(([k]) => !hit.includes(k))) });
  }
  if (resourceFolders !== loaded.textureFolders && resourceFolders) saveTextureFolders(dir, resourceFolders);

  if (langKeys.length) saveLocalization(dir, withoutKeys(loaded.localization, new Set(langKeys.map((k) => k.key))));
  return {
    deleted: doomed.map((d) => elementKey(d.type, d.id)), textures: textures.map((t) => t.path), models: models.map((m) => m.path),
    langKeys: langKeys.map((k) => k.key), folderEntries, files,
  };
}
