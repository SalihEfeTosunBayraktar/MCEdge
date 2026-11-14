/**
 * Procedure IR: a typed block tree stored as JSON inside a procedure element (and in every `blockly` field).
 * No file system access here, so the editor, the generator and the MCP server share it.
 *
 *   {
 *     "format": 1,
 *     "variables": [{ "name": "count", "type": "number" }],
 *     "stacks": [{ "x": 20, "y": 20, "blocks": [
 *       { "block": "start" },
 *       { "block": "entity_send_chat", "inputs": { "entity": { "block": "dep_entity", "fields": { "dep": "entity" } }, "text": "Hello" } },
 *       { "block": "if", "inputs": { "cond": { "block": "logic_boolean", "fields": { "value": "true" } }, "then": [ ... ] } }
 *     ] }]
 *   }
 *
 * A stack is a chain of statement blocks, or a single value block lying loose on the canvas. Only the stack
 * starting with "start" runs; the others are kept as drafts. Inputs hold a value block, a statement list (an
 * array) or a JSON literal: a number, string or boolean stands for an editable number, text or logic literal.
 */

export const IR_FORMAT = 1;

/** Types of values flowing between blocks; the editor only connects matching types. */
export const VALUE_TYPES = [
  "number", "logic", "text", "entity", "itemstack", "blockstate", "direction", "damagesource", "actionresult", "list",
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** Where a block can run: the logical server, the client, or either. */
export type Side = "server" | "client" | "both";

/** Types a local variable may have. */
export const LOCAL_TYPES = ["number", "logic", "text", "entity", "itemstack", "blockstate", "direction", "list"] as const;
export type LocalType = (typeof LOCAL_TYPES)[number];

export interface LocalVariable {
  name: string;
  type: LocalType;
}

export type Literal = number | string | boolean;
export type InputValue = BlockNode | BlockNode[] | Literal;

export interface BlockNode {
  block: string;
  fields?: Record<string, Literal>;
  inputs?: Record<string, InputValue>;
  collapsed?: boolean;
  disabled?: boolean;
  comment?: string;
}

export interface Stack {
  x: number;
  y: number;
  blocks: BlockNode[];
}

export interface ProcedureIR {
  format: typeof IR_FORMAT;
  variables: LocalVariable[];
  stacks: Stack[];
}

export const emptyProgram = (withStart = true): ProcedureIR => ({
  format: IR_FORMAT,
  variables: [],
  stacks: withStart ? [{ x: 40, y: 40, blocks: [{ block: "start" }] }] : [],
});

/** Reads a stored field value as IR; older stores ("" or MCreator XML) become an empty program. */
export function asProgram(value: unknown, withStart = true): ProcedureIR {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as ProcedureIR).format === IR_FORMAT) {
    const ir = value as ProcedureIR;
    return { format: IR_FORMAT, variables: Array.isArray(ir.variables) ? ir.variables : [], stacks: Array.isArray(ir.stacks) ? ir.stacks : [] };
  }
  return emptyProgram(withStart);
}

export const isNode = (value: unknown): value is BlockNode =>
  !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as BlockNode).block === "string";

/** The stack that runs: the one starting with the start block. */
export function mainStack(ir: ProcedureIR): Stack | undefined {
  return ir.stacks.find((s) => s.blocks[0]?.block === "start");
}

/** Every block node of a program, depth first, with its path ("stacks[0].blocks[2].inputs.then[1]"). */
export function* walkNodes(ir: ProcedureIR): Generator<{ node: BlockNode; path: string; stack: number }> {
  for (let s = 0; s < ir.stacks.length; s++) {
    const blocks = ir.stacks[s].blocks ?? [];
    for (let i = 0; i < blocks.length; i++) yield* walkNode(blocks[i], `stacks[${s}].blocks[${i}]`, s);
  }
}

function* walkNode(node: BlockNode, path: string, stack: number): Generator<{ node: BlockNode; path: string; stack: number }> {
  if (!isNode(node)) return;
  yield { node, path, stack };
  for (const [name, value] of Object.entries(node.inputs ?? {})) {
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* walkNode(value[i], `${path}.inputs.${name}[${i}]`, stack);
    else if (isNode(value)) yield* walkNode(value, `${path}.inputs.${name}`, stack);
  }
}

/** Number of blocks of a program (literals count as one block, as in the editor). */
export function countBlocks(ir: ProcedureIR): number {
  let count = 0;
  for (const { node } of walkNodes(ir)) {
    count++;
    for (const value of Object.values(node.inputs ?? {})) if (!Array.isArray(value) && !isNode(value)) count++;
  }
  return count;
}

/**
 * Dependencies: values a procedure receives from whatever runs it (the trigger, the element field or the
 * calling procedure). Blocks name the ones they need; the procedure's parameters are the union (MCreator's model).
 * Order here is the parameter order of generated procedures.
 */
export const DEPENDENCIES = {
  world: { type: "world" },
  x: { type: "number" },
  y: { type: "number" },
  z: { type: "number" },
  entity: { type: "entity" },
  sourceentity: { type: "entity" },
  immediatesourceentity: { type: "entity" },
  itemstack: { type: "itemstack" },
  blockstate: { type: "blockstate" },
  oldState: { type: "blockstate" },
  direction: { type: "direction" },
  damagesource: { type: "damagesource" },
  amount: { type: "number" },
  distance: { type: "number" },
  time: { type: "number" },
  slot: { type: "number" },
  hitX: { type: "number" },
  hitY: { type: "number" },
  hitZ: { type: "number" },
  moving: { type: "logic" },
  text: { type: "text" },
  command: { type: "text" },
  arguments: { type: "commandcontext" },
} as const satisfies Record<string, { type: ValueType | "world" | "commandcontext" }>;
export type Dependency = keyof typeof DEPENDENCIES;
export const DEPENDENCY_NAMES = Object.keys(DEPENDENCIES) as Dependency[];
export const isDependency = (name: string): name is Dependency => name in DEPENDENCIES;

/** Dependencies of a value type, for the "dependency" getter blocks. */
export function dependenciesOfType(type: ValueType): Dependency[] {
  return DEPENDENCY_NAMES.filter((d) => DEPENDENCIES[d].type === type);
}

/** Sorts dependency names into parameter order and drops unknown ones. */
export function sortDependencies(deps: Iterable<string>): Dependency[] {
  const set = new Set(deps);
  return DEPENDENCY_NAMES.filter((d) => set.has(d));
}

/** Procedure return types (type.json "returnType" values) mapped to value types. */
export const RETURN_TYPES: Record<string, ValueType | undefined> = {
  none: undefined, logic: "logic", number: "number", string: "text", itemstack: "itemstack", blockstate: "blockstate",
  entity: "entity", direction: "direction", damagesource: "damagesource", actionresulttype: "actionresult",
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isIdentifier = (name: string) => IDENTIFIER.test(name);
