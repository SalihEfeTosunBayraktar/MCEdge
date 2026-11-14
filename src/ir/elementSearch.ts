import type { Element, ElementType } from "../elements/model.ts";
import { elementRows, type ElementRow } from "./elementQuery.ts";
import type { ModProject } from "./types.ts";

export const PREDICATE_OPS = ["equals", "not_equals", "contains", "empty", "not_empty", "matches"] as const;
export type PredicateOp = (typeof PREDICATE_OPS)[number];

/** One condition on a field value; `field` is a dot path ("stackSize", "attributeModifiers.slot", "program.stacks"). */
export interface Predicate {
  field: string;
  op: PredicateOp;
  value?: unknown;
}

export interface ElementMatch extends ElementRow {
  /** The value of every predicate's field (and of `select` fields). */
  values: Record<string, unknown>;
}

/**
 * Values at a dot path. A list on the way is entered row by row, so "drops.item" gives the item of every row;
 * a missing key gives nothing.
 */
export function valuesAt(value: unknown, path: string): unknown[] {
  let current: unknown[] = [value];
  for (const key of path.split(".")) {
    current = current.flatMap((v) => (Array.isArray(v) ? v : [v])).flatMap((v) => (v && typeof v === "object" && key in v ? [(v as Record<string, unknown>)[key]] : []));
  }
  return current;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
const same = (a: unknown, b: unknown) => (typeof a === "object" || typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : a === b || String(a) === String(b));

/** Whether one value satisfies the predicate; `contains` is a substring (case-insensitive) or a list entry. */
function holds(op: PredicateOp, v: unknown, expected: unknown, regex?: RegExp): boolean {
  switch (op) {
    case "equals": return same(v, expected);
    case "not_equals": return !same(v, expected);
    case "empty": return isEmpty(v);
    case "not_empty": return !isEmpty(v);
    case "contains":
      if (Array.isArray(v)) return v.some((x) => same(x, expected) || (typeof x === "string" && x.toLowerCase().includes(String(expected).toLowerCase())));
      if (v && typeof v === "object") return JSON.stringify(v).toLowerCase().includes(String(expected).toLowerCase());
      return v !== undefined && v !== null && String(v).toLowerCase().includes(String(expected).toLowerCase());
    case "matches": return v !== undefined && v !== null && regex!.test(typeof v === "object" ? JSON.stringify(v) : String(v));
  }
}

/** Does the element pass the predicate: a missing field counts as empty; with list rows any row may match. */
export function matchesPredicate(element: Element, predicate: Predicate): boolean {
  const regex = predicate.op === "matches" ? new RegExp(String(predicate.value ?? ""), "i") : undefined;
  const values = valuesAt(element, predicate.field);
  if (!values.length) return predicate.op === "empty" || predicate.op === "not_equals";
  if (predicate.op === "not_equals") return values.every((v) => holds("not_equals", v, predicate.value));
  return values.some((v) => holds(predicate.op, v, predicate.value, regex));
}

/** Elements whose fields pass every predicate (and), with the values of those fields and of `select`. */
export function findElements(project: ModProject, types: ReadonlyMap<string, ElementType>, query: { type?: string; where: Predicate[]; select?: string[] }): ElementMatch[] {
  if (query.where.some((p) => !(PREDICATE_OPS as readonly string[]).includes(p.op))) throw new Error(`op must be one of ${PREDICATE_OPS.join(", ")}`);
  const rows = new Map(elementRows(project, types).map((r) => [`${r.type}/${r.id}`, r]));
  const fields = [...new Set([...query.where.map((p) => p.field), ...(query.select ?? [])])];
  const out: ElementMatch[] = [];
  for (const [typeId, list] of Object.entries(project.elements)) {
    if (query.type && typeId !== query.type) continue;
    for (const element of list) {
      if (!query.where.every((p) => matchesPredicate(element, p))) continue;
      const values = Object.fromEntries(fields.map((f) => {
        const found = valuesAt(element, f);
        return [f, found.length > 1 ? found : found[0]];
      }));
      out.push({ ...rows.get(`${typeId}/${element.id}`)!, values });
    }
  }
  return out;
}
