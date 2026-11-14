import type { BlockDef, CategoryId, CodeArgs, CodeTable, FieldDef, InputDef } from "../blockTypes.ts";
import type { Dependency, Literal, LocalType, Side, ValueType } from "../model.ts";

/* Compact constructors for block definitions; see blockTypes.ts for the meaning of each key. */

type Spec = Omit<BlockDef, "id" | "category" | "side" | "output" | "code"> & { code: CodeTable | ((c: CodeArgs) => string) };

const table = (code: Spec["code"]): CodeTable => (typeof code === "function" ? { all: code } : code);

export const stmt = (id: string, category: CategoryId, side: Side, spec: Spec): BlockDef =>
  ({ id, category, side, ...spec, code: table(spec.code) });

export const value = (id: string, category: CategoryId, side: Side, output: ValueType | "any", spec: Spec): BlockDef =>
  ({ id, category, side, output, ...spec, code: table(spec.code) });

// inputs
export const num = (name: string, def: number | undefined = 0): InputDef => ({ name, type: "number", ...(def !== undefined ? { default: def } : {}) });
export const txt = (name: string, def: string | undefined = ""): InputDef => ({ name, type: "text", ...(def !== undefined ? { default: def } : {}) });
export const logic = (name: string, def: boolean | undefined = true): InputDef => ({ name, type: "logic", ...(def !== undefined ? { default: def } : {}) });
export const ent = (name = "entity"): InputDef => ({ name, type: "entity" });
export const stack = (name = "itemstack"): InputDef => ({ name, type: "itemstack" });
export const state = (name = "blockstate"): InputDef => ({ name, type: "blockstate" });
export const dir = (name = "direction"): InputDef => ({ name, type: "direction" });
export const source = (name = "damagesource"): InputDef => ({ name, type: "damagesource" });
export const list = (name = "list"): InputDef => ({ name, type: "list" });
export const anyIn = (name: string): InputDef => ({ name, type: "any" });
export const body = (name = "do"): InputDef => ({ name, type: "statements" });
/** x, y, z number inputs (defaulting to the x/y/z dependencies is the author's choice). */
export const xyz = (): InputDef[] => [num("x", 0), num("y", 0), num("z", 0)];

// fields
export const dropdown = (name: string, options: string[], def: Literal = options[0]): FieldDef => ({ name, kind: "dropdown", options, default: def });
export const idField = (name: string, registry: string, def: string): FieldDef => ({ name, kind: "id", registry, default: def });
export const check = (name: string, def = false): FieldDef => ({ name, kind: "checkbox", default: def });
export const numField = (name: string, def = 0): FieldDef => ({ name, kind: "number", default: def });
export const textField = (name: string, def = ""): FieldDef => ({ name, kind: "text", default: def });
export const variable = (varType: LocalType, name = "var"): FieldDef => ({ name, kind: "variable", varType, default: "" });
export const procedure = (name = "procedure"): FieldDef => ({ name, kind: "procedure", default: "" });
export const global = (varType: LocalType, scope: "global" | "player", name = "var"): FieldDef => ({ name, kind: "global", varType, scope, default: "" });

export const W: Dependency[] = ["world"];

/** The coordinates of a block position as one helper call argument list. */
export const at = (c: CodeArgs) => `${c.i.x}, ${c.i.y}, ${c.i.z}`;
export const pos = (c: CodeArgs) => `${c.h("pos")}(${at(c)})`;
export const world = (c: CodeArgs) => c.dep("world");
/** A registry id field qualified with the mod id when it has no namespace. */
export const qid = (c: CodeArgs, field: string) => {
  const id = String(c.f[field] ?? "").replace(/^#/, "");
  return c.s(id.includes(":") ? id : `${c.modId}:${id}`);
};
/** A tag id field, qualified like qid and mapped to the engine's tag ("forge:crops" is "c:crops" on NeoForge and Fabric). */
export const qtag = (c: CodeArgs, field: string) => {
  const id = String(c.f[field] ?? "").replace(/^#/, "");
  return c.s(c.tag(id.includes(":") ? id : `${c.modId}:${id}`));
};
