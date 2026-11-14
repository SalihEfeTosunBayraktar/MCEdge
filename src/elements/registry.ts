import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../paths.ts";
import { loadIntegrations, withIntegrationGroups } from "./integrations.ts";
import { conditionKeys, defaultValue, FIELD_TYPES, typeFields, type Condition, type ElementType, type FieldDef } from "./model.ts";

/**
 * Every element type in <root>/element-types/<id>/type.json. A new folder is picked up without code changes;
 * a definition that breaks the format is left out and reported in `problems` instead of failing the app.
 */
export interface TypeRegistry {
  /** Types sorted by id. */
  types: ElementType[];
  byId: ReadonlyMap<string, ElementType>;
  byFolder: ReadonlyMap<string, ElementType>;
  problems: string[];
}

export const TYPES_DIR = join(ROOT, "element-types");

let cached: TypeRegistry | undefined;

/** The registry of the running MCEdge, with the fields of the optional mod integrations; loaded once. */
export function typeRegistry(): TypeRegistry {
  if (!cached) {
    const registry = loadTypeRegistry(TYPES_DIR);
    const { integrations, problems } = loadIntegrations();
    const types = withIntegrationGroups(registry.types, integrations);
    for (const type of types) {
      const errors: string[] = [];
      checkFields(typeFields(type), "", errors);
      problems.push(...errors.map((e) => `${type.id} with integrations: ${e}`));
    }
    cached = { types, byId: new Map(types.map((t) => [t.id, t])), byFolder: new Map(types.map((t) => [t.folder, t])), problems: [...registry.problems, ...problems] };
  }
  return cached;
}

export function loadTypeRegistry(dir: string): TypeRegistry {
  const types: ElementType[] = [];
  const problems: string[] = [];
  const ids = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "type.json"))).sort() : [];
  for (const name of ids) {
    const file = join(dir, name, "type.json");
    try {
      const { $schema: _, ...type } = JSON.parse(readFileSync(file, "utf8")) as ElementType & { $schema?: string };
      const errors = checkType(type, name);
      if (errors.length) problems.push(...errors.map((e) => `${name}: ${e}`));
      else types.push(type);
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const byFolder = new Map<string, ElementType>();
  for (const type of [...types]) {
    if (byFolder.has(type.folder)) {
      problems.push(`${type.id}: folder "${type.folder}" is already used by ${byFolder.get(type.folder)!.id}`);
      types.splice(types.indexOf(type), 1);
    } else byFolder.set(type.folder, type);
  }
  return { types, byId: new Map(types.map((t) => [t.id, t])), byFolder, problems };
}

const ID = /^[a-z][a-z0-9_]*$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** Structural checks the code relies on; the JSON schema in schemas/ documents the full format. */
function checkType(type: ElementType, folderName: string): string[] {
  const errors: string[] = [];
  if (type.id !== folderName) errors.push(`id "${type.id}" does not match its folder`);
  if (!ID.test(type.folder ?? "")) errors.push("folder must be snake_case");
  for (const key of ["name", "description", "icon"] as const) if (typeof type[key] !== "string") errors.push(`${key} is missing`);
  if (!Array.isArray(type.pages) || type.pages.length === 0) return [...errors, "needs at least one page"];
  const pageIds = new Set<string>();
  for (const page of type.pages) {
    if (pageIds.has(page.id)) errors.push(`duplicate page "${page.id}"`);
    pageIds.add(page.id);
    if (!Array.isArray(page.groups)) errors.push(`page "${page.id}" has no groups`);
  }
  if (errors.length) return errors;
  checkFields(typeFields(type), "", errors);
  return errors;
}

function checkFields(fields: FieldDef[], prefix: string, errors: string[], outer: string[] = []): void {
  const keys = new Set<string>();
  for (const field of fields) {
    const at = prefix + field.key;
    if (!KEY.test(field.key ?? "")) errors.push(`bad field key "${at}"`);
    if (keys.has(field.key)) errors.push(`duplicate field "${at}"`);
    keys.add(field.key);
    if (!(FIELD_TYPES as readonly string[]).includes(field.type)) errors.push(`${at}: unknown field type "${field.type}"`);
    if (typeof field.label !== "string") errors.push(`${at}: label is missing`);
    if ((field.type === "select" || field.type === "multiselect") && !field.options?.length && !field.elementTypes?.length)
      errors.push(`${at}: needs options or elementTypes`);
    if (field.type === "select" && field.options?.length && !field.elementTypes && !field.options.some((o) => o.value === defaultValue(field)))
      errors.push(`${at}: default is not one of the options`);
    if (field.type === "list") checkFields(field.fields ?? [], `${at}.`, errors, [...outer, ...fields.map((f) => f.key)]);
  }
  const known = new Set([...keys, ...outer]);
  for (const field of fields) {
    if (!field.showIf) continue;
    for (const key of conditionKeys(field.showIf as Condition)) if (!known.has(key)) errors.push(`${prefix}${field.key}: showIf refers to unknown field "${key}"`);
  }
}

/**
 * Translated texts of element types, one file per UI language (config/element-types/<language>.json):
 *   { "<typeId>": { "name": "...", "description": "...", "pages": { "<pageId>": "..." },
 *                   "groups": { "<group title>": "..." },
 *                   "fields": { "<key>" | "<list>.<key>": { "label": "...", "help": "...", "options": { "<value>": "..." } } } } }
 * A map field's key and value fields are "<map>.keyField" and "<map>.valueField". The English text of type.json
 * stays the source: anything left out keeps it.
 */
export interface FieldLabels {
  label?: string;
  help?: string;
  options?: Record<string, string>;
}

export type TypeLabels = Record<string, {
  name?: string;
  description?: string;
  pages?: Record<string, string>;
  groups?: Record<string, string>;
  fields?: Record<string, FieldLabels>;
}>;

export function localizeTypes(types: ElementType[], labels: TypeLabels): ElementType[] {
  if (!Object.keys(labels).length) return types;
  return types.map((type) => {
    const l = labels[type.id];
    if (!l) return type;
    const field = (f: FieldDef, prefix: string): FieldDef => {
      const o = l.fields?.[prefix + f.key];
      const inner = `${prefix}${f.key}.`;
      return {
        ...f,
        ...(o?.label ? { label: o.label } : {}),
        ...(o?.help ? { help: o.help } : {}),
        ...(f.options ? { options: f.options.map((opt) => ({ ...opt, label: o?.options?.[String(opt.value)] ?? opt.label })) } : {}),
        ...(f.fields ? { fields: f.fields.map((s) => field(s, inner)) } : {}),
        ...(f.keyField ? { keyField: field({ ...f.keyField, key: "keyField" }, inner) } : {}),
        ...(f.valueField ? { valueField: field({ ...f.valueField, key: "valueField" }, inner) } : {}),
      };
    };
    return {
      ...type,
      name: l.name ?? type.name,
      description: l.description ?? type.description,
      pages: type.pages.map((page) => ({
        ...page,
        title: l.pages?.[page.id] ?? page.title,
        groups: page.groups.map((group) => ({ ...group, title: l.groups?.[group.title] ?? group.title, fields: group.fields.map((f) => field(f, "")) })),
      })),
    };
  });
}

/**
 * JSON schema for the element files of one type, written into each project so editors and agents can check
 * element files without MCEdge. It describes value shapes; cross-element rules stay in the validator.
 */
export function elementJsonSchema(type: ElementType): object {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `mcedge/elements/${type.id}.schema.json`,
    title: `MCEdge ${type.name} element`,
    description: type.description,
    type: "object",
    required: ["id"],
    properties: {
      $schema: { type: "string" },
      id: { type: "string", pattern: "^[a-z0-9_]+$" },
      title: { type: "string" },
      ...Object.fromEntries(typeFields(type).map((field) => [field.key, fieldSchema(field)])),
    },
  };
}

function fieldSchema(field: FieldDef): object {
  const base = { title: field.label, ...(field.help ? { description: field.help } : {}) };
  const limits = { ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
  switch (field.type) {
    case "integer":
      return { ...base, type: "integer", ...limits };
    case "number":
      return { ...base, type: "number", ...limits };
    case "boolean":
      return { ...base, type: "boolean" };
    case "select":
      return field.elementTypes ? base : { ...base, enum: field.options?.map((o) => o.value) };
    case "multiselect":
      return { ...base, type: "array", items: field.elementTypes ? {} : { enum: field.options?.map((o) => o.value) } };
    case "element":
      return field.multiple ? { ...base, type: "array", items: { type: "string" } } : { ...base, type: "string" };
    case "range":
      return { ...base, type: "object", properties: { min: { type: "number" }, max: { type: "number" } } };
    case "vector":
      return { ...base, type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } };
    case "recipe_grid":
      return { ...base, type: "array", items: { type: "string" }, minItems: (field.size ?? 3) ** 2, maxItems: (field.size ?? 3) ** 2 };
    case "list":
      return {
        ...base, type: "array",
        ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
        ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
        items: { type: "object", properties: Object.fromEntries((field.fields ?? []).map((f) => [f.key, fieldSchema(f)])) },
      };
    case "map":
      return { ...base, type: "object", additionalProperties: field.valueField ? fieldSchema(field.valueField) : {} };
    case "gui_layout":
      return base;
    case "tab_order":
      // src/elements/tabOrder.ts: elements in order, titled sections, spacers, section ends.
      return {
        ...base, type: "array",
        items: {
          type: "object", required: ["kind"],
          properties: { kind: { enum: ["element", "section", "spacer", "end"] }, type: { type: "string" }, id: { type: "string" }, title: { type: "string" }, slots: { type: "integer", minimum: 0, maximum: 8 } },
        },
      };
    case "blockly":
      // Procedure IR (src/procedures/model.ts); an empty string before the first edit.
      return { ...base, type: ["object", "string"] };
    default:
      return { ...base, type: "string" };
  }
}
