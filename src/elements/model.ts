/**
 * Element types as described by element-types/<id>/type.json (see docs/ELEMENT-TYPES.md), and the pure
 * operations on them: defaults, showIf and per-element validation. No file system access here, so the
 * renderer can use the same code as the core.
 */

import EN from "../../config/ui-strings/en.json" with { type: "json" };
import { upgradeTimingFields } from "./transitions.ts";

export const FIELD_TYPES = [
  "text", "multiline", "integer", "number", "boolean", "select", "multiselect", "texture", "model", "sound",
  "color", "item", "block", "entity", "biome", "effect", "enchantment", "potion", "particle", "dimension",
  "damage_type", "villager_profession", "structure", "attribute", "tag", "element", "procedure", "range", "vector",
  "list", "map", "recipe_grid", "gui_layout", "blockly", "tab_order",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types holding a registry id (vanilla or this mod). */
export const REGISTRY_FIELD_TYPES = [
  "item", "block", "entity", "biome", "effect", "enchantment", "potion", "particle", "dimension",
  "damage_type", "villager_profession", "structure", "attribute",
] as const satisfies FieldType[];
export type RegistryKind = (typeof REGISTRY_FIELD_TYPES)[number];

/**
 * Element types whose elements register an entry in a registry, so registry fields can refer to them by id.
 * Registry fields are typed by what they hold, not by element type, so this mapping lives in code.
 */
export const REGISTRY_PROVIDERS: Record<RegistryKind, string[]> = {
  item: ["item", "tool", "block", "plant", "potion_item", "fluid"],
  block: ["block", "plant", "fluid"],
  entity: ["living_entity", "projectile", "special_entity"],
  biome: ["biome"],
  effect: ["potion_effect"],
  enchantment: ["enchantment"],
  potion: ["potion_item"],
  particle: ["particle"],
  dimension: ["dimension"],
  damage_type: ["damage_type"],
  villager_profession: ["villager_profession"],
  structure: ["structure"],
  attribute: ["attribute"],
};

export type OptionValue = string | number | boolean;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { key: string; equals?: unknown; notEquals?: unknown; in?: unknown[]; notIn?: unknown[]; gt?: number; gte?: number; lt?: number; lte?: number };

export interface FieldDef {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  default?: unknown;
  required?: boolean;
  showIf?: Condition;
  mcreator?: string;
  min?: number;
  max?: number;
  /** Soft limits: a value past them is legal but unusual, reported as an info problem (KUYRUK 196). */
  warnAbove?: number;
  warnBelow?: number;
  step?: number;
  maxLength?: number;
  pattern?: string;
  options?: { value: OptionValue; label: string }[];
  textureKind?: string;
  modelKinds?: string[];
  /** A map of texture slots: the model field (sibling key) whose model's slots it maps (KUYRUK 161). */
  modelField?: string;
  /** A block texture drawn on this cube face; the form shows such fields together on a clickable 3D cube (KUYRUK 187). */
  cubeFace?: "down" | "up" | "north" | "south" | "east" | "west";
  allowTags?: boolean;
  tagKind?: string;
  elementTypes?: string[];
  multiple?: boolean;
  allowCustom?: boolean;
  trigger?: string;
  dependencies?: string[];
  returns?: string;
  fields?: FieldDef[];
  minItems?: number;
  maxItems?: number;
  keyField?: FieldDef;
  valueField?: FieldDef;
  size?: number;
}

export interface GroupDef {
  title: string;
  fields: FieldDef[];
  /** Set on a group an optional mod integration adds (src/elements/integrations.ts); shown while the project uses it. */
  integration?: string;
}

export interface PageDef {
  id: string;
  title: string;
  groups: GroupDef[];
}

export interface ElementType {
  id: string;
  folder: string;
  name: string;
  description: string;
  icon: string;
  shortcut?: string;
  langKey?: string | null;
  mcreator?: string;
  pages: PageDef[];
}

/**
 * A stored element: its registry id, an optional editor-only title (for types without a display name field)
 * and the values of its type's fields. Keys the type does not know are kept as they are.
 */
export interface Element {
  id: string;
  title?: string;
  [key: string]: unknown;
}

export type Values = Record<string, unknown>;

/** Top-level fields of a type in page and group order. */
/**
 * The type as a project sees it: groups of optional mod integrations the project does not use are left out, and a
 * page left without groups too (KUYRUK 101).
 */
export function typeForProject(type: ElementType, integrations: readonly { id: string }[] | undefined): ElementType {
  const used = new Set((integrations ?? []).map((i) => i.id));
  if (type.pages.every((p) => p.groups.every((g) => !g.integration || used.has(g.integration)))) return type;
  const pages = type.pages.map((p) => ({ ...p, groups: p.groups.filter((g) => !g.integration || used.has(g.integration)) })).filter((p) => p.groups.length);
  return { ...type, pages };
}

export function typeFields(type: ElementType): FieldDef[] {
  return type.pages.flatMap((page) => page.groups.flatMap((group) => group.fields));
}

/** Value a field starts with: its `default`, or a neutral value of its type. Always a fresh copy. */
export function defaultValue(field: FieldDef): unknown {
  if (field.default !== undefined) return structuredClone(field.default);
  switch (field.type) {
    case "integer":
    case "number":
      return field.min !== undefined && field.min > 0 ? field.min : 0;
    case "boolean":
      return false;
    case "select":
      return field.options?.[0]?.value ?? "";
    case "multiselect":
    case "list":
      return [];
    case "element":
      return field.multiple ? [] : "";
    case "map":
      return {};
    case "range":
      return { min: field.min ?? 0, max: field.max ?? field.min ?? 0 };
    case "vector":
      return { x: 0, y: 0, z: 0 };
    case "recipe_grid":
      return Array((field.size ?? 3) ** 2).fill("");
    default:
      return "";
  }
}

/** Default values of a field list (a type's fields or a list row). */
export function defaultValues(fields: FieldDef[]): Values {
  return Object.fromEntries(fields.map((field) => [field.key, defaultValue(field)]));
}

/** A new element of a type with every field at its default. */
export function newElement(type: ElementType, id: string): Element {
  return { id, ...defaultValues(typeFields(type)) };
}

/** Fills fields missing from a stored element (fields added to the type later) with their defaults. */
export function withDefaults(type: ElementType, stored: Element): Element {
  // Fields renamed or merged later keep their old stored values working (Q228: one animation became show/hide timing).
  const element = typeFields(type).some((f) => f.key === "appear") ? upgradeTimingFields(stored) : stored;
  const filled: Element = { id: element.id };
  if (element.title !== undefined) filled.title = element.title;
  for (const field of typeFields(type)) filled[field.key] = field.key in element ? element[field.key] : defaultValue(field);
  return { ...element, ...filled };
}

/**
 * Field values visible to showIf conditions. Inside a list row a key refers to the row's own fields first,
 * then to the enclosing scope.
 */
export interface Scope {
  fields: FieldDef[];
  values: Values;
  parent?: Scope;
}

/**
 * Which fields of a scope are shown. A field is hidden when its condition fails, or when the condition reads
 * a field that is itself hidden; conditions that refer to each other (A hides B, B hides A) are evaluated
 * as if the other field were shown.
 */
export function visibility(scope: Scope, parentVisible?: (key: string) => boolean): (key: string) => boolean {
  const memo = new Map<string, boolean>();
  const byKey = new Map(scope.fields.map((field) => [field.key, field]));
  const visible = (key: string): boolean => {
    const field = byKey.get(key);
    if (!field) return parentVisible ? parentVisible(key) : true;
    const known = memo.get(key);
    if (known !== undefined) return known;
    memo.set(key, true); // cycle guard
    const result = !field.showIf || (holds(field.showIf, scope) && conditionKeys(field.showIf).every(visible));
    memo.set(key, result);
    return result;
  };
  return visible;
}

/** Keys a condition reads. */
export function conditionKeys(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionKeys);
  if ("any" in condition) return condition.any.flatMap(conditionKeys);
  return [condition.key];
}

function lookup(scope: Scope, key: string): unknown {
  for (let s: Scope | undefined = scope; s; s = s.parent) if (s.fields.some((f) => f.key === key)) return s.values[key];
  return undefined;
}

export function holds(condition: Condition, scope: Scope): boolean {
  if ("all" in condition) return condition.all.every((c) => holds(c, scope));
  if ("any" in condition) return condition.any.some((c) => holds(c, scope));
  const value = lookup(scope, condition.key);
  if ("equals" in condition) return same(value, condition.equals);
  if ("notEquals" in condition) return !same(value, condition.notEquals);
  if (condition.in) return condition.in.some((v) => same(value, v));
  if (condition.notIn) return !condition.notIn.some((v) => same(value, v));
  if (typeof value !== "number") return false;
  if (condition.gt !== undefined) return value > condition.gt;
  if (condition.gte !== undefined) return value >= condition.gte;
  if (condition.lt !== undefined) return value < condition.lt;
  if (condition.lte !== undefined) return value <= condition.lte;
  return true;
}

function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));
}

/**
 * The field holding a translated type's display name: "name", or else its first required text field named
 * like one ("mobName", "achievementName"). type.json has no explicit marker for it.
 */
export function displayNameField(type: ElementType | undefined): FieldDef | undefined {
  if (!type?.langKey) return undefined;
  const text = typeFields(type).filter((f) => f.type === "text");
  return text.find((f) => f.key === "name") ?? text.find((f) => f.required && /name$/i.test(f.key));
}

/** Name shown for an element: its display name field when the type is translated, else its title or id. */
export function displayName(type: ElementType | undefined, element: Element): string {
  const field = displayNameField(type);
  const name = field && element[field.key];
  return typeof name === "string" && name ? name : element.title || element.id;
}

/**
 * Lang key of an element's display name ("item.mymod.ruby"), from its type's langKey; undefined when the
 * type has no translated name.
 */
export function nameLangKey(type: ElementType | undefined, modId: string, element: Element): string | undefined {
  const field = displayNameField(type);
  return field && typeof element[field.key] === "string" ? `${type!.langKey}.${modId}.${element.id}` : undefined;
}

/** Every non-empty value of the given field type in an element, list rows included ("texture" -> paths). */
export function valuesOfType(fields: FieldDef[], values: Values, fieldType: FieldType): string[] {
  return fields.flatMap((field) => {
    const value = values[field.key];
    if (field.type === fieldType && typeof value === "string" && value) return [value];
    if (field.type === "list" && Array.isArray(value)) return value.flatMap((row) => valuesOfType(field.fields ?? [], row as Values, fieldType));
    if (field.type === "map" && field.valueField?.type === fieldType && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value as Values).filter((v): v is string => typeof v === "string" && v !== "");
    }
    return [];
  });
}

/** What validation needs to know about the project around an element. */
export interface ValidationContext {
  /** Ids of this project's elements by type id. */
  elementIds: (typeId: string) => ReadonlySet<string>;
  /** Whether a project-relative file exists; undefined skips the check (renderer). */
  fileExists?: (path: string) => boolean;
}

/** Element ids by type id, as validation needs them; built once per project snapshot. */
export function elementIdLookup(elements: Record<string, Element[]>): (typeId: string) => ReadonlySet<string> {
  const sets = new Map(Object.entries(elements).map(([typeId, list]) => [typeId, new Set(list.map((e) => e.id))]));
  const none: ReadonlySet<string> = new Set();
  return (typeId) => sets.get(typeId) ?? none;
}

export interface FieldIssue {
  /** Field path inside the element: "stackSize", "repairItems[0].item". */
  path: string;
  /** In English (MCP, CLI); the app shows `code` and `values` in its own language (KUYRUK 149). */
  message: string;
  /** The check that failed: the string "check.<code>" of config/ui-strings. */
  code?: CheckCode;
  values?: CheckValues;
}

/** Field checks; their texts are the "check.<code>" strings of config/ui-strings (en here, every language in the app). */
export type CheckCode =
  | "required" | "missingValue" | "number" | "wholeNumber" | "atLeast" | "atMost" | "text" | "maxLength" | "format" | "boolean"
  | "unknownOption" | "list" | "filePath" | "fileNotFound" | "color" | "tag" | "unknownProcedure" | "elementId" | "unknownElement"
  | "range" | "minAboveMax" | "vector" | "slots" | "ingredient" | "minItems" | "maxItems" | "entry" | "map" | "id" | "tagRef"
  | "noTags" | "unknownRef" | "unusualHigh" | "unusualLow"
  // Project-level checks (KUYRUK 157): ids, mod settings, variables, languages, registry ids, game rules, tags, sound events.
  | "schemaVersion" | "snakeCase" | "javaPackage" | "unknownEngine" | "unknownType" | "duplicateId" | "unknownIntegration" | "modId"
  | "dependencyVersion" | "javaIdentifier" | "duplicateVariable" | "unknownVariableType" | "unknownScope" | "languageCode" | "registryIdClash"
  | "unknownGameRule" | "translatedStore" | "tagType" | "tagId" | "tagTwice" | "tagEntryId" | "tagNoElement" | "soundEventName" | "soundCategory" | "soundFile"
  // Translation keys no element, procedure or GUI uses (Q222).
  | "unusedTranslation"
  // GUI images drawn at a size that blurs them, or larger than the GUI (Q275).
  | "guiImageScale" | "guiImageTooBig";
export type CheckValues = Record<string, string | number | undefined>;
/** A project-level problem: an English message (MCP, CLI) and, for the app, a check code with its values (KUYRUK 157). */
export interface ProjectIssue { path: string; message: string; code?: CheckCode; values?: CheckValues }

const fill = (text: string, values: CheckValues) => text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
/** An issue with its English message; `kind` (a registry kind) is named with its "check.kind.<kind>" text. */
export function checkIssue(path: string, code: CheckCode, values: CheckValues = {}): FieldIssue {
  const strings = EN as Record<string, string>;
  const english = { ...values, ...(values.kind ? { kind: strings[`check.kind.${values.kind}`] ?? values.kind } : {}) };
  return { path, message: fill(strings[`check.${code}`], english), code, values };
}

const NAMESPACED_ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const LOCAL_ID = /^[a-z0-9_]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Ids of this mod's elements that a registry field of the given kind may refer to. */
export function providerIds(ctx: ValidationContext, kind: RegistryKind): Set<string> {
  return new Set(REGISTRY_PROVIDERS[kind].flatMap((typeId) => [...ctx.elementIds(typeId)]));
}

/** Checks the visible fields of an element against its type; returns every issue found. */
export function validateElement(type: ElementType, element: Element, ctx: ValidationContext): FieldIssue[] {
  const issues: FieldIssue[] = [];
  validateFields(typeFields(type), { fields: typeFields(type), values: element }, "", ctx, issues);
  return issues;
}

function validateFields(fields: FieldDef[], scope: Scope, prefix: string, ctx: ValidationContext, issues: FieldIssue[], parentVisible?: (key: string) => boolean): void {
  const visible = visibility(scope, parentVisible);
  for (const field of fields) {
    if (!visible(field.key)) continue;
    validateValue(field, scope.values[field.key], prefix + field.key, scope, ctx, issues, visible);
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function validateValue(field: FieldDef, value: unknown, path: string, scope: Scope, ctx: ValidationContext, issues: FieldIssue[], visible: (key: string) => boolean): void {
  const fail = (code: CheckCode, values: CheckValues = {}, at = path): void => void issues.push(checkIssue(at, code, values));
  if (value === undefined || value === null) return fail(field.required ? "required" : "missingValue");
  if (field.required && isEmpty(value)) return fail("required");
  // An empty string means "none" (or "vanilla default" for colors); selects check it against their options.
  if (value === "" && !["select", "integer", "number", "boolean"].includes(field.type)) return;
  const numberIn = (n: unknown, integer: boolean, at = path) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return fail("number", {}, at);
    if (integer && !Number.isInteger(n)) return fail("wholeNumber", {}, at);
    if (field.min !== undefined && n < field.min) return fail("atLeast", { min: field.min }, at);
    if (field.max !== undefined && n > field.max) return fail("atMost", { max: field.max }, at);
    if (field.warnAbove !== undefined && n > field.warnAbove) return fail("unusualHigh", { limit: field.warnAbove }, at);
    if (field.warnBelow !== undefined && n < field.warnBelow) return fail("unusualLow", { limit: field.warnBelow }, at);
  };
  const option = (v: unknown) =>
    field.options?.some((o) => o.value === v)
    || (typeof v === "string" && !!field.elementTypes?.some((t) => ctx.elementIds(t).has(v)));

  switch (field.type) {
    case "text":
    case "multiline":
      if (typeof value !== "string") return fail("text");
      if (field.maxLength !== undefined && value.length > field.maxLength) fail("maxLength", { max: field.maxLength });
      if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) fail("format");
      return;
    case "integer":
      return numberIn(value, true);
    case "number":
      return numberIn(value, false);
    case "boolean":
      if (typeof value !== "boolean") fail("boolean");
      return;
    case "select":
      if (!option(value)) fail("unknownOption", { value: String(value) });
      return;
    case "multiselect":
      if (!Array.isArray(value)) return fail("list");
      value.forEach((v, i) => option(v) || fail("unknownOption", { value: String(v) }, `${path}[${i}]`));
      return;
    case "texture":
      if (typeof value !== "string") return fail("filePath");
      if (ctx.fileExists && !ctx.fileExists(value)) fail("fileNotFound", { path: value });
      return;
    case "color":
      if (typeof value !== "string" || !COLOR.test(value)) fail("color");
      return;
    case "tag":
      if (typeof value !== "string" || !NAMESPACED_ID.test(value.replace(/^#/, ""))) fail("tag");
      return;
    case "procedure":
      if (typeof value !== "string" || !ctx.elementIds("procedure").has(value)) fail("unknownProcedure", { value: String(value) });
      return;
    case "element": {
      const one = (v: unknown, at: string) => {
        if (typeof v !== "string") return fail("elementId", {}, at);
        if (field.options?.some((o) => o.value === v)) return;
        if (field.elementTypes?.some((t) => ctx.elementIds(t).has(v))) return;
        if (field.allowCustom && NAMESPACED_ID.test(v)) return;
        fail("unknownElement", { value: v }, at);
      };
      if (field.multiple) {
        if (!Array.isArray(value)) return fail("list");
        value.forEach((v, i) => one(v, `${path}[${i}]`));
      } else one(value, path);
      return;
    }
    case "range": {
      const range = value as { min?: unknown; max?: unknown };
      if (typeof range !== "object") return fail("range");
      numberIn(range.min, false, `${path}.min`);
      numberIn(range.max, false, `${path}.max`);
      if (typeof range.min === "number" && typeof range.max === "number" && range.min > range.max) fail("minAboveMax");
      return;
    }
    case "vector": {
      const vector = value as Record<string, unknown>;
      if (typeof vector !== "object") return fail("vector");
      for (const axis of ["x", "y", "z"]) if (typeof vector[axis] !== "number") fail("number", {}, `${path}.${axis}`);
      return;
    }
    case "recipe_grid": {
      const size = (field.size ?? 3) ** 2;
      if (!Array.isArray(value) || value.length !== size) return fail("slots", { count: size });
      value.forEach((slot, i) => slot === "" || checkRef("item", true, slot, `${path}[${i}]`, ctx, fail));
      if (value.every((slot) => slot === "")) fail("ingredient");
      return;
    }
    case "list": {
      if (!Array.isArray(value)) return fail("list");
      if (field.minItems !== undefined && value.length < field.minItems) fail("minItems", { count: field.minItems });
      if (field.maxItems !== undefined && value.length > field.maxItems) fail("maxItems", { count: field.maxItems });
      value.forEach((row, i) => {
        if (typeof row !== "object" || row === null) return fail("entry", {}, `${path}[${i}]`);
        validateFields(field.fields ?? [], { fields: field.fields ?? [], values: row as Values, parent: scope }, `${path}[${i}].`, ctx, issues, visible);
      });
      return;
    }
    case "map": {
      if (typeof value !== "object" || Array.isArray(value)) return fail("map");
      for (const [key, entry] of Object.entries(value as Values)) {
        if (field.keyField) validateValue(field.keyField, key, `${path}.${key}`, scope, ctx, issues, visible);
        if (field.valueField) validateValue(field.valueField, entry, `${path}.${key}`, scope, ctx, issues, visible);
      }
      return;
    }
    default:
      if ((REGISTRY_FIELD_TYPES as readonly string[]).includes(field.type)) checkRef(field.type as RegistryKind, !!field.allowTags, value, path, ctx, fail);
  }
}

/** A registry reference is "#ns:tag" (when tags are allowed), "ns:path" or the id of an element of this mod. */
function checkRef(kind: RegistryKind, allowTags: boolean, value: unknown, path: string, ctx: ValidationContext, fail: (code: CheckCode, values?: CheckValues, at?: string) => void): void {
  if (typeof value !== "string") return fail("id", {}, path);
  if (value.startsWith("#")) {
    if (!allowTags || !NAMESPACED_ID.test(value.slice(1))) fail(allowTags ? "tagRef" : "noTags", {}, path);
    return;
  }
  if (NAMESPACED_ID.test(value)) return;
  if (LOCAL_ID.test(value) && providerIds(ctx, kind).has(value)) return;
  fail("unknownRef", { kind, value }, path);
}
