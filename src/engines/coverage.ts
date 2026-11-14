import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { typeFields, visibility, type Element, type ElementType, type OptionValue } from "../elements/model.ts";
import { layerDirs, type Engine } from "./registry.ts";

/**
 * What an engine actually generates, by element type and field. Each template layer that generates element
 * code declares it next to its templates in layer.json:
 *
 *   { "generates": { "item": ["name", "texture", "stackSize"], "tool": ["toolType=Pickaxe|Axe|Spade|Hoe|Sword"] } }
 *
 * A type listed in any layer is generated (it also needs a context module in src/generator/types/<typeId>.ts);
 * fields not listed are kept in the element but have no effect yet. List a field only when changing it changes
 * the built mod. An engine's coverage is the union of its layers, so a field restricted with "=" must not also be
 * listed unrestricted by another layer of the same engine.
 * "field=a|b" restricts a field to the listed values: an element using another value is skipped with a
 * warning instead of producing wrong code. The editor reads the same record to badge what is not generated.
 *
 * "editor" lists fields that only steer the editor (a layout grid, snapping) and never reach the built mod; they count
 * as handled on every engine of the layer, so they are not badged:
 *
 *   { "editor": { "gui": ["gridSx", "snapOnGrid"] } }
 */
export const LAYER_MANIFEST = "layer.json";

/** Field key ("stackSize", "repairItems.item") -> true for any value, or the generated values. */
export type FieldCoverage = Record<string, true | OptionValue[]>;
/** Element type id -> generated fields. */
export type Coverage = Record<string, FieldCoverage>;

export function engineCoverage(engine: Engine): Coverage {
  const coverage: Coverage = {};
  for (const dir of layerDirs(engine)) {
    const manifest = join(dir, LAYER_MANIFEST);
    if (!existsSync(manifest)) continue;
    const { generates = {}, editor = {} } = JSON.parse(readFileSync(manifest, "utf8")) as { generates?: Record<string, string[]>; editor?: Record<string, string[]> };
    for (const [typeId, keys] of Object.entries(editor)) {
      const fields = (coverage[typeId] ??= {});
      for (const key of keys) fields[key] = true;
    }
    for (const [typeId, entries] of Object.entries(generates)) {
      const fields = (coverage[typeId] ??= {});
      for (const entry of entries) {
        const [key, values] = entry.split("=");
        const parsed = values?.split("|").map(parseValue);
        const known = fields[key];
        fields[key] = !parsed || known === true ? true : [...new Set([...(known ?? []), ...parsed])];
      }
    }
  }
  return coverage;
}

/** "10" -> 10 and "true" -> true, so restrictions match numeric and boolean option values. */
function parseValue(text: string): OptionValue {
  if (text === "true" || text === "false") return text === "true";
  return text !== "" && !Number.isNaN(Number(text)) ? Number(text) : text;
}

/**
 * Why an engine cannot generate an element, or undefined when it can: the type is not generated, or a shown
 * field holds a value outside its generated values.
 */
export function unsupportedReason(type: ElementType, element: Element, coverage: Coverage): string | undefined {
  const fields = coverage[type.id];
  if (!fields) return `${type.name} elements are not generated yet`;
  const all = typeFields(type);
  const visible = visibility({ fields: all, values: element });
  for (const field of all) {
    if (!visible(field.key)) continue;
    const allowed = fields[field.key];
    if (Array.isArray(allowed) && !allowed.includes(element[field.key] as OptionValue)) {
      return `${field.label} "${String(element[field.key])}" is not generated yet`;
    }
    // Restricted sub-fields of a list ("attributeModifiers.equipmentSlot=mainhand|head") apply to every row.
    if (field.type !== "list" || !Array.isArray(element[field.key])) continue;
    for (const sub of field.fields ?? []) {
      const subAllowed = fields[`${field.key}.${sub.key}`];
      if (!Array.isArray(subAllowed)) continue;
      const row = (element[field.key] as Record<string, unknown>[]).find((r) => !subAllowed.includes(r[sub.key] as OptionValue));
      if (row) return `${field.label}: ${sub.label} "${String(row[sub.key])}" is not generated yet`;
    }
  }
  return undefined;
}

/** Coverage entries that name a type or field the registry does not know (typos in layer.json). */
export function unknownCoverage(coverage: Coverage, types: ReadonlyMap<string, ElementType>): string[] {
  const problems: string[] = [];
  for (const [typeId, fields] of Object.entries(coverage)) {
    const type = types.get(typeId);
    if (!type) {
      problems.push(`unknown type "${typeId}"`);
      continue;
    }
    for (const key of Object.keys(fields)) {
      const [head, sub] = key.split(".");
      const field = typeFields(type).find((f) => f.key === head);
      if (!field || (sub && !field.fields?.some((f) => f.key === sub))) problems.push(`${typeId}: unknown field "${key}"`);
    }
  }
  return problems;
}
