import type { Coverage, ElementType, TypeCatalog } from "../../shared/api.ts";

/**
 * Element types from the core's registry. They never change while the app runs, so they are loaded once at
 * start-up (App) and read from here instead of travelling with every project snapshot.
 */
let catalog: TypeCatalog = { types: [], problems: [], integrations: [] };
let byId = new Map<string, ElementType>();

export function setTypeCatalog(next: TypeCatalog): void {
  catalog = next;
  byId = new Map(next.types.map((type) => [type.id, type]));
}

export const elementTypes = (): ElementType[] => catalog.types;
export const typeProblems = (): string[] => catalog.problems;
export const integrations = () => catalog.integrations ?? [];
export const typeOf = (id: string): ElementType | undefined => byId.get(id);

/** How far an engine generates a type or field: everything, some values only, or not at all (yet). */
export type Generated = "yes" | "partly" | "no";

export function typeGenerated(coverage: Coverage | undefined, typeId: string): Generated {
  if (!coverage) return "yes";
  return coverage[typeId] ? "yes" : "no";
}

/** Field path without list indexes: "repairItems.item". */
export function fieldGenerated(coverage: Coverage | undefined, typeId: string, path: string): { state: Generated; values?: unknown[] } {
  if (!coverage) return { state: "yes" };
  const fields = coverage[typeId];
  if (!fields) return { state: "no" };
  const entry = fields[path];
  if (entry === undefined) return { state: "no" };
  return entry === true ? { state: "yes" } : { state: "partly", values: entry };
}
