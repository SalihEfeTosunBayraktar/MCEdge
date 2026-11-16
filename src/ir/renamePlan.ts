import { typeFields, type Element, type ElementType, type FieldDef } from "../elements/model.ts";
import { walkNodes, type ProcedureIR } from "../procedures/model.ts";
import type { ElementTag } from "../tags/model.ts";
import { elementKey, type ProjectFolders } from "./folders.ts";
import { registryIdIssues } from "./registryIds.ts";
import { findAllReferences, refKey, scan, sourceLabel, type DatapackFile, type ElementRef, type ProjectScanInput, type Reference, type ScanInput } from "./references.ts";

/**
 * Renaming an element, computed without touching disk (src/ir/rename.ts writes the result). The scanner of
 * src/ir/references.ts finds every place that names the element, so the rewrite covers exactly what the reference
 * finder reports.
 */

const NEW_ID = /^[a-z][a-z0-9_]*$/;

export interface RenamePlan {
  target: ElementRef;
  newId: string;
  /** The renamed element (its own references already pointed at the new id). */
  element: Element;
  /** Other elements whose references changed. */
  changedElements: { type: string; element: Element }[];
  /** The whole tag list when an entry changed. */
  tags?: ElementTag[];
  /** Datapack files whose text changed. */
  datapack: DatapackFile[];
  /** Whole language maps that changed. */
  localization: Record<string, Record<string, string>>;
  renamedKeys: { language: string; from: string; to: string }[];
  folders?: ProjectFolders;
  /** Owned textures moving to the new name (a .mcmeta beside them moves too). */
  textures: { from: string; to: string }[];
  /** Places the rename could not safely change, and parts it left as they were. */
  warnings: string[];
  /** Number of places that point at the element and were changed. */
  referencesChanged: number;
}

/** Why `newId` cannot be the element's id, or undefined. */
export function newIdProblem(input: ScanInput, target: ElementRef, newId: string): string | undefined {
  if (!NEW_ID.test(newId)) return `"${newId}" is not a valid id: lowercase letters, digits and _, starting with a letter`;
  if (newId === target.id) return "the new id is the current id";
  const clash = Object.entries(input.elements).find(([typeId, list]) => (typeId === "recipe") === (target.type === "recipe") && list.some((e) => e.id === newId));
  return clash ? `id "${newId}" is already used by ${clash[0]}/${newId}` : undefined;
}

/** Paths of the textures an element names (texture fields, list rows, GUI widget images), with where. */
export function texturePaths(type: ElementType | undefined, element: Element): string[] {
  const found: string[] = [];
  const visit = (fields: FieldDef[], values: Record<string, unknown>) => {
    for (const field of fields) {
      const value = values[field.key];
      if (field.type === "texture" && typeof value === "string" && value) found.push(value);
      else if (field.type === "list" && Array.isArray(value)) value.forEach((row) => row && typeof row === "object" && visit(field.fields ?? [], row as Record<string, unknown>));
      else if (field.type === "map" && field.valueField?.type === "texture" && value && typeof value === "object" && !Array.isArray(value)) {
        for (const v of Object.values(value)) if (typeof v === "string" && v) found.push(v);
      } else if (field.type === "gui_layout" && Array.isArray(value)) {
        for (const w of value as Record<string, unknown>[]) {
          for (const key of ["image", "hoverImage", "onImage", "onHoverImage"]) if (typeof w?.[key] === "string" && w[key]) found.push(w[key] as string);
          // A state image's states (KUYRUK 186).
          if (Array.isArray(w?.states)) for (const s of w.states as Record<string, unknown>[]) if (typeof s?.image === "string" && s.image) found.push(s.image);
        }
      }
    }
  };
  if (type) visit(typeFields(type), element);
  return found;
}

/**
 * Everything renaming `target` to `newId` changes, computed without touching disk: every reference found by the scanner,
 * the element itself, translation keys ("item.<mod>.<id>"), folders.json, the texture files named after the element when
 * nothing else uses them, tags and datapack files. Throws when the new id is unusable or the rewritten project would not
 * keep exactly the references the old one had.
 */
export function planRename(input: ProjectScanInput, target: ElementRef, newId: string): RenamePlan {
  const problem = newIdProblem(input, target, newId);
  if (problem) throw new Error(problem);
  const source = input.elements[target.type]?.find((e) => e.id === target.id);
  if (!source) throw new Error(`no ${target.type} "${target.id}"`);
  const { modId } = input;
  const warnings: string[] = [];

  const before = findAllReferences(input);
  const clone: ScanInput = {
    ...input,
    elements: structuredClone(input.elements),
    tags: structuredClone(input.tags ?? []),
    datapack: structuredClone(input.datapack ?? []),
  };
  let referencesChanged = 0;
  for (const hit of scan(clone)) {
    if (hit.to.type !== target.type || hit.to.id !== target.id) continue;
    if (hit.ambiguous) {
      warnings.push(`${sourceLabel(hit.from)} ${hit.path} names "${modId}:${target.id}" and the id is also a recipe; left as it is`);
      continue;
    }
    hit.apply(newId);
    referencesChanged++;
  }
  const renamed = clone.elements[target.type].find((e) => e.id === target.id)!;
  renamed.id = newId;

  // Owned textures: a file named after the element that only this element uses.
  const textures: RenamePlan["textures"] = [];
  const usedElsewhere = new Set<string>(input.project.mod.logo ? [input.project.mod.logo] : []);
  for (const [typeId, list] of Object.entries(input.elements)) {
    for (const e of list) if (!(typeId === target.type && e.id === target.id)) for (const p of texturePaths(input.types.get(typeId), e)) usedElsewhere.add(p);
  }
  for (const path of new Set(texturePaths(input.types.get(target.type), source))) {
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    if (dot < slash + 1 || path.slice(slash + 1, dot) !== target.id || usedElsewhere.has(path) || !input.fileExists(path)) continue;
    const to = `${path.slice(0, slash + 1)}${newId}${path.slice(dot)}`;
    if (input.fileExists(to)) {
      warnings.push(`texture ${path} kept: ${to} already exists`);
      continue;
    }
    textures.push({ from: path, to });
  }
  const retexture = (value: unknown): unknown => (typeof value === "string" ? textures.find((t) => t.from === value)?.to ?? value : value);
  const retextureElement = (typeId: string, element: Element) => {
    const visit = (fields: FieldDef[], values: Record<string, unknown>) => {
      for (const field of fields) {
        if (field.type === "texture") values[field.key] = retexture(values[field.key]);
        else if (field.type === "list" && Array.isArray(values[field.key])) (values[field.key] as unknown[]).forEach((row) => row && typeof row === "object" && visit(field.fields ?? [], row as Record<string, unknown>));
        else if (field.type === "map" && field.valueField?.type === "texture" && values[field.key] && typeof values[field.key] === "object") {
          const map = values[field.key] as Record<string, unknown>;
          for (const key of Object.keys(map)) map[key] = retexture(map[key]);
        }
        else if (field.type === "gui_layout" && Array.isArray(values[field.key])) for (const w of values[field.key] as Record<string, unknown>[]) {
          if (w && "image" in w) w.image = retexture(w.image);
          for (const key of ["hoverImage", "onImage", "onHoverImage"]) if (w && key in w) w[key] = retexture(w[key]);
          if (Array.isArray(w?.states)) for (const s of w.states as Record<string, unknown>[]) if (s && "image" in s) s.image = retexture(s.image);
        }
      }
    };
    const type = input.types.get(typeId);
    if (type) visit(typeFields(type), element);
  };
  if (textures.length) retextureElement(target.type, renamed);

  // Ids the generators derive (a bucket, a spawn egg, a wall sign) must not collide with another element's ids.
  const claimsBefore = registryIdIssues(input.project);
  const claimsAfter = registryIdIssues({ ...input.project, elements: clone.elements });
  if (claimsAfter.length > claimsBefore.length) throw new Error(`"${newId}" collides with an id MCEdge derives: ${claimsAfter[claimsAfter.length - 1].message}`);

  const changedElements: RenamePlan["changedElements"] = [];
  for (const [typeId, list] of Object.entries(clone.elements)) {
    list.forEach((element, i) => {
      if (typeId === target.type && element === renamed) return;
      if (JSON.stringify(element) !== JSON.stringify(input.elements[typeId][i])) changedElements.push({ type: typeId, element });
    });
  }

  // Translation keys carry "<mod id>.<element id>" as two neighbouring segments ("item.mymod.ruby", "gui.mymod.shop.title").
  const localization: RenamePlan["localization"] = {};
  const renamedKeys: RenamePlan["renamedKeys"] = [];
  if (target.type !== "recipe") {
    for (const [language, entries] of Object.entries(input.project.localization)) {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [key, text] of Object.entries(entries)) {
        const parts = key.split(".");
        const at = parts.findIndex((part, i) => i > 0 && part === modId && parts[i + 1] === target.id);
        const to = at < 0 ? key : [...parts.slice(0, at + 1), newId, ...parts.slice(at + 2)].join(".");
        if (to !== key) {
          if (to in entries) throw new Error(`translation key "${to}" (${language}) already exists`);
          changed = true;
          renamedKeys.push({ language, from: key, to });
        }
        next[to] = text;
      }
      if (changed) localization[language] = next;
    }
  }

  let folders: ProjectFolders | undefined;
  const oldKey = elementKey(target.type, target.id);
  const placement = input.project.folders?.placement ?? {};
  if (oldKey in placement) {
    const { [oldKey]: folder, ...rest } = placement;
    folders = { folders: input.project.folders!.folders, placement: { ...rest, [elementKey(target.type, newId)]: folder } };
  }

  // The rewritten project must keep exactly the references the old one had.
  const mapRef = (r: Reference): string => {
    const fromIsTarget = r.from.kind === "element" && r.from.type === target.type && r.from.id === target.id;
    const toIsTarget = r.to.type === target.type && r.to.id === target.id;
    const from = fromIsTarget ? { ...r.from, id: newId } : r.from;
    const to = toIsTarget ? { ...r.to, id: newId } : r.to;
    return `${sourceLabel(from)}|${r.path}|${refKey(to)}|${r.form}`;
  };
  const after = findAllReferences(clone);
  const place = (r: Reference) => `${sourceLabel(r.from)}|${r.path}`;
  const skipped = new Set(before.filter((r) => r.ambiguous).map(place));
  const expected = before.filter((r) => !skipped.has(place(r))).map(mapRef);
  const actual = new Set(after.filter((r) => !skipped.has(place(r))).map((r) => `${place(r)}|${refKey(r.to)}|${r.form}`));
  const lost = expected.filter((k) => !actual.has(k));
  if (lost.length) throw new Error(`rename would lose ${lost.length} of ${expected.length} references; first: ${lost.slice(0, 5).join("; ")}`);
  const adopted = after.filter((r) => r.to.type === target.type && r.to.id === newId && !expected.includes(`${place(r)}|${refKey(r.to)}|${r.form}`));
  if (adopted.length) warnings.push(`${adopted.length} existing reference(s) to "${newId}" that named nothing now point at this element, e.g. ${place(adopted[0])}`);

  const tags = JSON.stringify(clone.tags) !== JSON.stringify(input.tags ?? []) ? clone.tags : undefined;
  const datapack = (clone.datapack ?? []).filter((f, i) => f.text !== input.datapack![i].text);

  // Text mentions the scanner does not rewrite (a bare word in java_code, an id in an unknown file) are reported.
  const leftover = new RegExp(`(?<![A-Za-z0-9_])${target.id}(?![A-Za-z0-9_])`);
  const reportLeft = (label: string, text: unknown) => typeof text === "string" && leftover.test(text) && warnings.push(`${label} still mentions "${target.id}" as a plain word`);
  for (const [typeId, list] of Object.entries(clone.elements)) {
    for (const element of list) {
      for (const [key, value] of Object.entries(element)) {
        if (!value || typeof value !== "object") continue;
        for (const { node, path } of isProgramValue(value) ? walkNodes(value) : []) {
          if (node.block === "java_code") reportLeft(`${typeId}/${element.id} ${key}.${path} (java_code)`, `${node.fields?.code ?? ""} ${node.fields?.imports ?? ""}`);
        }
      }
    }
  }
  return { target, newId, element: renamed, changedElements, tags, datapack, localization, renamedKeys, folders, textures, warnings, referencesChanged };
}

const isProgramValue = (value: unknown): value is ProcedureIR =>
  !!value && typeof value === "object" && !Array.isArray(value) && (value as ProcedureIR).format === 1 && Array.isArray((value as ProcedureIR).stacks);
