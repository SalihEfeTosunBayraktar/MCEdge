/**
 * Three-way merge of JSON values for live co-editing: `base` is what this editor last loaded or saved, `mine` its
 * current draft, `theirs` what is on disk now (written by an AI agent over MCP, or another program). Objects merge
 * key by key, recursively; arrays and scalars are whole values. A key only one side changed takes that side; a key
 * both sides changed to different values keeps mine (the user is editing it right now) and is reported.
 */
export interface MergeResult<T> {
  value: T;
  /** Paths both sides changed differently; mine was kept. */
  conflicts: string[];
  /** Paths taken from theirs. */
  taken: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function merge3<T>(base: T, mine: T, theirs: T, path = ""): MergeResult<T> {
  if (same(mine, theirs)) return { value: mine, conflicts: [], taken: [] };
  if (same(mine, base)) return { value: theirs, conflicts: [], taken: [path || "."] };
  if (same(theirs, base)) return { value: mine, conflicts: [], taken: [] };
  if (isObject(base) && isObject(mine) && isObject(theirs)) {
    const out: Record<string, unknown> = {};
    const conflicts: string[] = [];
    const taken: string[] = [];
    for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const r = merge3(base[key], mine[key], theirs[key], path ? `${path}.${key}` : key);
      if (r.value !== undefined) out[key] = r.value;
      conflicts.push(...r.conflicts);
      taken.push(...r.taken);
    }
    return { value: out as T, conflicts, taken };
  }
  return { value: mine, conflicts: [path || "."], taken: [] };
}
