import { REGISTRY_FIELD_TYPES, REGISTRY_PROVIDERS, typeFields, type Element, type ElementType, type FieldDef, type RegistryKind } from "../elements/model.ts";
import { BLOCKS_BY_ID } from "../procedures/blocks/index.ts";
import { walkNodes, type ProcedureIR } from "../procedures/model.ts";
import { pascal } from "../procedures/project.ts";
import { TAG_PROVIDERS, type ElementTag } from "../tags/model.ts";
import { elementKey, type ProjectFolders } from "./folders.ts";
import { GAME_RULE_BLOCKS, looseRuleName, ruleElementFor, ruleNameOf } from "./gameRules.ts";
import type { ModProject } from "./types.ts";

/**
 * Who uses what. One scanner finds every place a project names one of its own elements, so the reference finder, the
 * unused-element report and rename (which rewrites exactly the places the scanner found) cannot disagree. Pure: the
 * caller loads the project, the tags and the raw datapack texts. The forms it knows:
 *
 *   procedure_field    an element field of type "procedure" (triggers, GUI widget procedures, AI goal conditions, ...)
 *   element_field      a field of type "element", or a select with elementTypes (creative tabs, GUI to open, ...)
 *   registry_field     a registry field (item, block, entity, ...) or a recipe grid slot naming an element of the mod
 *   program_procedure  a procedure block field naming a procedure (call_procedure, AI goals, ...)
 *   program_id         a procedure block registry field naming an element (gui_open, item and block ids, ...)
 *   game_rule_name     a rule field of a world_game_rule_* block naming a game_rule element by its ruleName or id
 *   java_code          a java_code block: the element's generated class name or its quoted "modid:id"
 *   namespaced_id      any other string that is exactly "modid:id" (an input text, an untyped value)
 *   tag_entry          an entry of tags.json
 *   datapack_file      a quoted "modid:id" in a raw datapack/ file
 */
export type RefForm = "procedure_field" | "element_field" | "registry_field" | "program_procedure" | "program_id" | "game_rule_name" | "java_code" | "namespaced_id" | "tag_entry" | "datapack_file";

export interface ElementRef {
  type: string;
  id: string;
}

export type RefSource =
  | { kind: "element"; type: string; id: string }
  | { kind: "tag"; id: string }
  | { kind: "file"; id: string };

export interface Reference {
  from: RefSource;
  to: ElementRef;
  /** Place inside the source: "program.stacks[0].blocks[2].fields.procedure", "components[3].textProcedure". */
  path: string;
  form: RefForm;
  /** The text names an id that exists as an element and as a recipe; rename leaves it alone. */
  ambiguous?: boolean;
}

export interface DatapackFile {
  /** Project-relative, forward slashes ("datapack/mymod/tags/items/money.json"). */
  path: string;
  text: string;
}

/** A project read for scanning: its elements plus what rename needs besides them. */
export interface ProjectScanInput extends ScanInput {
  project: ModProject;
  /** Whether a project-relative file exists. */
  fileExists: (path: string) => boolean;
}

export interface ScanInput {
  modId: string;
  elements: Record<string, Element[]>;
  types: ReadonlyMap<string, ElementType>;
  tags?: ElementTag[];
  datapack?: DatapackFile[];
}

/** Suffixes the generators add to an element's PascalCase id for the classes they write. */
export const CLASS_SUFFIXES = [
  "CommandProgram", "Procedure", "Menu", "Screen", "Block", "BlockEntity", "BlockRenderer", "ItemRenderer", "Fluid", "FluidBlock",
  "FluidOverlayMixin", "FluidFogMixin", "LivingEntity", "MobEffect", "Particle", "Projectile", "StructureFeature", "FeatureCondition", "Model",
];

/** Procedure block registries that name something besides vanilla ids; the rest use REGISTRY_PROVIDERS. */
const PROGRAM_REGISTRIES: Record<string, readonly string[]> = {
  ...REGISTRY_PROVIDERS, fluid: ["fluid"], gui: ["gui"], advancement: ["advancement"], bubble_element: ["bubble"], radial_menu_element: ["radial_menu"],
};

const WIDGET_PROCEDURES = ["procedure", "textProcedure", "condition", "lockCondition", "stateProcedure"];
const LOCAL_ID = /^[a-z0-9_]+$/;

export interface Hit extends Reference {
  /** Points the place at `newId` (the target's id was the old one). */
  apply(newId: string): void;
}

/** Container of a value: an object or array, with the key or index the value sits at. */
type Slot = { holder: Record<string, unknown> | unknown[]; key: string | number };
const read = (s: Slot) => (s.holder as Record<string | number, unknown>)[s.key];
const write = (s: Slot, value: unknown) => void ((s.holder as Record<string | number, unknown>)[s.key] = value);

const classMentions = (text: string): string[] => text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

export function scan(input: ScanInput): Hit[] {
  const { modId } = input;
  const hits: Hit[] = [];
  const ids = new Map<string, Set<string>>();
  for (const [typeId, list] of Object.entries(input.elements)) ids.set(typeId, new Set(list.map((e) => e.id)));
  const typesOf = (id: string): string[] => [...ids].filter(([, set]) => set.has(id)).map(([t]) => t);
  const pascalIds = new Map<string, string[]>();
  for (const [typeId, set] of ids) if (typeId !== "recipe") for (const id of set) pascalIds.set(pascal(id), [...(pascalIds.get(pascal(id)) ?? []), id]);

  /** The element a registry-style value names: a bare id or "modid:id", among the given candidate types. */
  const resolve = (value: unknown, candidates: readonly string[] | undefined): ElementRef | undefined => {
    if (typeof value !== "string" || !value || value.startsWith("#")) return undefined;
    const local = value.startsWith(`${modId}:`) ? value.slice(modId.length + 1) : value;
    if (!LOCAL_ID.test(local)) return undefined;
    const type = (candidates ?? []).find((t) => ids.get(t)?.has(local));
    return type ? { type, id: local } : undefined;
  };
  const retarget = (value: unknown, oldId: string, newId: string): unknown =>
    value === oldId ? newId : value === `${modId}:${oldId}` ? `${modId}:${newId}` : value;

  const recorded = new Set<string>();
  const add = (from: RefSource, path: string, to: ElementRef, form: RefForm, apply: (newId: string) => void, ambiguous?: boolean) => {
    const key = `${from.kind}|${from.id}|${"type" in from ? from.type : ""}|${path}|${to.type}/${to.id}`;
    if (recorded.has(key)) return;
    recorded.add(key);
    hits.push({ from, to, path, form, apply, ...(ambiguous ? { ambiguous } : {}) });
  };

  /** A slot holding an element id. */
  const idSlot = (from: RefSource, path: string, slot: Slot, candidates: readonly string[] | undefined, form: RefForm) => {
    const to = resolve(read(slot), candidates);
    if (to) add(from, path, to, form, (newId) => write(slot, retarget(read(slot), to.id, newId)));
  };

  /** Text of a java_code block (or a datapack file): class names of the element and its quoted "modid:id". */
  const textSlot = (from: RefSource, path: string, slot: Slot, form: "java_code" | "datapack_file") => {
    const text = read(slot);
    if (typeof text !== "string" || !text) return;
    const found = new Set<string>();
    if (form === "java_code") {
      for (const token of classMentions(text)) {
        for (const suffix of CLASS_SUFFIXES) {
          if (!token.endsWith(suffix) || token.length === suffix.length) continue;
          for (const id of pascalIds.get(token.slice(0, -suffix.length)) ?? []) found.add(id);
        }
      }
    }
    for (const match of text.matchAll(new RegExp(`"${modId}:([a-z0-9_]+)"`, "g"))) found.add(match[1]);
    for (const id of found) {
      const kinds = typesOf(id);
      const nonRecipe = kinds.filter((t) => t !== "recipe");
      // A datapack text cannot say which registry a quoted id is in; an id that is also a recipe is left alone.
      const ambiguous = form === "datapack_file" && nonRecipe.length > 0 && kinds.includes("recipe");
      for (const type of form === "datapack_file" && kinds.length > 1 ? kinds : nonRecipe.length ? nonRecipe : kinds) {
        add(from, path, { type, id }, form, (newId) => write(slot, renameInText(read(slot) as string, modId, id, newId, form === "java_code")), ambiguous);
      }
    }
  };

  const scanProgram = (from: RefSource, ir: ProcedureIR, base: string) => {
    for (const { node, path } of walkNodes(ir)) {
      const at = `${base}.${path}`;
      const def = BLOCKS_BY_ID.get(node.block);
      for (const [name, value] of Object.entries(node.fields ?? {})) {
        const slot: Slot = { holder: node.fields!, key: name };
        const field = def?.fields?.find((f) => f.name === name);
        if (field?.kind === "procedure") idSlot(from, `${at}.fields.${name}`, slot, ["procedure"], "program_procedure");
        else if (field?.kind === "id" && field.registry) idSlot(from, `${at}.fields.${name}`, slot, PROGRAM_REGISTRIES[field.registry], "program_id");
        else if (name === "rule" && GAME_RULE_BLOCKS.includes(node.block) && typeof value === "string") ruleSlot(from, `${at}.fields.${name}`, slot);
        else if (node.block === "java_code" && (name === "code" || name === "imports")) textSlot(from, `${at}.fields.${name}`, slot, "java_code");
        else namespaced(from, `${at}.fields.${name}`, slot, value);
      }
      for (const [name, value] of Object.entries(node.inputs ?? {})) {
        if (typeof value === "string") namespaced(from, `${at}.inputs.${name}`, { holder: node.inputs!, key: name }, value);
      }
    }
  };

  /**
   * The rule field of a game rule block: the game_rule element it means by ruleName or id (camelCase or snake_case). Renaming the
   * element's id rewrites the text only when it names the id; a text that names the ruleName keeps working as it is.
   */
  const ruleSlot = (from: RefSource, path: string, slot: Slot) => {
    const text = read(slot) as string;
    const rule = ruleElementFor(text, input.elements.game_rule ?? []);
    if (!rule) return;
    const viaRuleName = !!rule.ruleName && looseRuleName(String(rule.ruleName)) === looseRuleName(text);
    add(from, path, { type: "game_rule", id: rule.id }, "game_rule_name", (newId) => {
      if (viaRuleName) return;
      write(slot, text.includes("_") ? newId : ruleNameOf({ id: newId } as Element));
    });
  };

  /** A string that is exactly "modid:id" of an element, wherever it sits. */
  const namespaced = (from: RefSource, path: string, slot: Slot, value: unknown) => {
    if (typeof value !== "string" || !value.startsWith(`${modId}:`)) return;
    const id = value.slice(modId.length + 1);
    const kinds = typesOf(id);
    const nonRecipe = kinds.filter((t) => t !== "recipe");
    for (const type of nonRecipe.length ? nonRecipe : kinds) {
      add(from, path, { type, id }, "namespaced_id", (newId) => write(slot, retarget(read(slot), id, newId)), kinds.length > 1 && nonRecipe.length > 0);
    }
  };

  const isProgram = (value: unknown): value is ProcedureIR =>
    !!value && typeof value === "object" && !Array.isArray(value) && (value as ProcedureIR).format === 1 && Array.isArray((value as ProcedureIR).stacks);

  /** Everything the typed walk does not know: programs anywhere in the element, and plain "modid:id" strings. */
  const scanAny = (from: RefSource, holder: Record<string, unknown> | unknown[], key: string | number, path: string) => {
    const value = (holder as Record<string | number, unknown>)[key];
    if (typeof value === "string") return namespaced(from, path, { holder, key }, value);
    if (isProgram(value)) return scanProgram(from, value, path);
    if (Array.isArray(value)) value.forEach((_, i) => scanAny(from, value, i, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const k of Object.keys(value)) scanAny(from, value as Record<string, unknown>, k, `${path}.${k}`);
  };

  const scanTyped = (from: RefSource, fields: FieldDef[], values: Record<string, unknown>, prefix: string) => {
    for (const field of fields) {
      const path = prefix + field.key;
      const value = values[field.key];
      const strings = (candidates: readonly string[] | undefined, form: RefForm) => {
        if (Array.isArray(value)) value.forEach((_, i) => idSlot(from, `${path}[${i}]`, { holder: value, key: i }, candidates, form));
        else idSlot(from, path, { holder: values, key: field.key }, candidates, form);
      };
      if (field.type === "procedure") strings(["procedure"], "procedure_field");
      else if (field.type === "element" || field.type === "select" || field.type === "multiselect") {
        if (field.elementTypes) strings(field.elementTypes, "element_field");
      } else if ((REGISTRY_FIELD_TYPES as readonly string[]).includes(field.type)) strings(REGISTRY_PROVIDERS[field.type as RegistryKind], "registry_field");
      else if (field.type === "recipe_grid") strings(REGISTRY_PROVIDERS.item, "registry_field");
      else if (field.type === "tab_order" && Array.isArray(value)) {
        // A creative tab's order names its elements by type and id (src/elements/tabOrder.ts).
        value.forEach((entry, i) => {
          const e = entry as Record<string, unknown>;
          if (e?.kind === "element" && typeof e.type === "string") idSlot(from, `${path}[${i}].id`, { holder: e, key: "id" }, [e.type], "element_field");
        });
      }
      else if (field.type === "gui_layout" && Array.isArray(value)) {
        value.forEach((widget, i) => {
          if (!widget || typeof widget !== "object") return;
          for (const key of WIDGET_PROCEDURES) idSlot(from, `${path}[${i}].${key}`, { holder: widget as Record<string, unknown>, key }, ["procedure"], "procedure_field");
          // A state image's states have their own conditions (KUYRUK 186).
          const states = (widget as Record<string, unknown>).states;
          if (Array.isArray(states)) states.forEach((state, k) => state && typeof state === "object"
            && idSlot(from, `${path}[${i}].states[${k}].condition`, { holder: state as Record<string, unknown>, key: "condition" }, ["procedure"], "procedure_field"));
          idSlot(from, `${path}[${i}].limit`, { holder: widget as Record<string, unknown>, key: "limit" }, REGISTRY_PROVIDERS.item, "registry_field");
          const allowed = (widget as Record<string, unknown>).allowed;
          if (Array.isArray(allowed)) allowed.forEach((row, k) => row && typeof row === "object"
            && idSlot(from, `${path}[${i}].allowed[${k}].item`, { holder: row as Record<string, unknown>, key: "item" }, REGISTRY_PROVIDERS.item, "registry_field"));
        });
      } else if (field.type === "list" && Array.isArray(value)) {
        value.forEach((row, i) => row && typeof row === "object" && scanTyped(from, field.fields ?? [], row as Record<string, unknown>, `${path}[${i}].`));
      } else if (field.type === "map" && field.valueField && value && typeof value === "object" && !Array.isArray(value)) {
        scanTyped(from, Object.keys(value).map((k) => ({ ...field.valueField!, key: k })), value as Record<string, unknown>, `${path}.`);
      }
    }
  };

  for (const [typeId, list] of Object.entries(input.elements)) {
    const type = input.types.get(typeId);
    for (const element of list) {
      const from: RefSource = { kind: "element", type: typeId, id: element.id };
      if (type) scanTyped(from, typeFields(type), element, "");
      for (const key of Object.keys(element)) if (key !== "id" && key !== "title") scanAny(from, element, key, key);
    }
  }
  for (const tag of input.tags ?? []) {
    const from: RefSource = { kind: "tag", id: `${tag.type} ${tag.id}` };
    tag.entries.forEach((_, i) => idSlot(from, `entries[${i}]`, { holder: tag.entries, key: i }, TAG_PROVIDERS[tag.type] ?? [], "tag_entry"));
  }
  for (const file of input.datapack ?? []) textSlot({ kind: "file", id: file.path }, "text", { holder: file as unknown as Record<string, unknown>, key: "text" }, "datapack_file");
  return hits;
}

/** The class names and quoted ids of `oldId` in a text, pointed at `newId`. */
function renameInText(text: string, modId: string, oldId: string, newId: string, classes: boolean): string {
  let result = text.replaceAll(`"${modId}:${oldId}"`, `"${modId}:${newId}"`);
  if (!classes) return result;
  const [from, to] = [pascal(oldId), pascal(newId)];
  result = result.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    for (const suffix of CLASS_SUFFIXES) if (token.endsWith(suffix) && token.slice(0, -suffix.length) === from) return to + suffix;
    return token;
  });
  return result;
}

/** Every reference of the project, in scan order. */
export function findAllReferences(input: ScanInput): Reference[] {
  return scan(input).map(({ apply: _apply, ...reference }) => reference);
}

export const refKey = (ref: ElementRef) => `${ref.type}/${ref.id}`;
export const sourceLabel = (from: RefSource) => (from.kind === "element" ? `${from.type}/${from.id}` : from.kind === "tag" ? `tag ${from.id}` : `file ${from.id}`);

export interface ReferenceReport {
  /** References to the element, from other places. */
  usedBy: Reference[];
  /** References from the element to others. */
  uses: Reference[];
}

export function referencesOf(all: Reference[], target: ElementRef): ReferenceReport {
  const isTarget = (from: RefSource) => from.kind === "element" && from.type === target.type && from.id === target.id;
  return {
    usedBy: all.filter((r) => r.to.type === target.type && r.to.id === target.id && !isTarget(r.from)),
    uses: all.filter((r) => isTarget(r.from) && !(r.to.type === target.type && r.to.id === target.id)),
  };
}

/** Types whose elements do nothing until something points at them: a procedure needs a trigger or a caller, a GUI an opener. */
export const REFERENCE_DRIVEN_TYPES = ["procedure", "gui"];

export interface UnusedReport {
  /** Per type: elements counted, elements nothing uses. */
  summary: Record<string, { total: number; unused: number }>;
  unused: (ElementRef & { reachableOnlyFromUnused?: boolean })[];
}

/**
 * Elements of the given types that no other element, tag or datapack file uses and that no global trigger runs.
 * With `transitive`, elements used only by unused elements are listed too, flagged.
 */
export function unusedElements(input: ScanInput, all: Reference[], types: string[] = REFERENCE_DRIVEN_TYPES, transitive = false): UnusedReport {
  const triggered = (typeId: string, element: Element) => typeId === "procedure" && String(element.globalTrigger ?? "no_ext_trigger") !== "no_ext_trigger";
  const candidates = types.flatMap((typeId) => (input.elements[typeId] ?? []).filter((e) => !triggered(typeId, e)).map((e) => ({ type: typeId, id: e.id })));
  const own = (from: RefSource, to: ElementRef) => from.kind === "element" && from.type === to.type && from.id === to.id;
  const inbound = new Map<string, Reference[]>();
  for (const ref of all) if (!own(ref.from, ref.to)) inbound.set(refKey(ref.to), [...(inbound.get(refKey(ref.to)) ?? []), ref]);
  const dead = new Set(candidates.filter((c) => !inbound.has(refKey(c))).map(refKey));
  const direct = new Set(dead);
  if (transitive) {
    for (let changed = true; changed;) {
      changed = false;
      for (const c of candidates) {
        if (dead.has(refKey(c))) continue;
        const sources = inbound.get(refKey(c)) ?? [];
        if (sources.every((r) => r.from.kind === "element" && dead.has(`${r.from.type}/${r.from.id}`))) (dead.add(refKey(c)), (changed = true));
      }
    }
  }
  const summary: UnusedReport["summary"] = {};
  for (const typeId of types) summary[typeId] = { total: (input.elements[typeId] ?? []).length, unused: 0 };
  const unused = candidates.filter((c) => dead.has(refKey(c))).map((c) => (direct.has(refKey(c)) ? c : { ...c, reachableOnlyFromUnused: true }));
  for (const u of unused) summary[u.type].unused++;
  return { summary, unused };
}
