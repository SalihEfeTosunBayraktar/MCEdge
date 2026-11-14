import { BLOCKS_BY_ID } from "../../../../src/procedures/blocks/index.ts";
import { IR_FORMAT, isNode, type BlockNode, type InputValue, type Literal, type LocalVariable, type ProcedureIR } from "../../../../src/procedures/model.ts";
import { literalShadow } from "./blocklySetup.ts";

/*
 * Procedure IR <-> Blockly serialization state. Literal inputs become editable shadow blocks; a shadow or a
 * literal block in an input becomes a JSON literal again, so the stored IR stays short and readable.
 */

interface BState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  collapsed?: boolean;
  disabledReasons?: string[];
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BState; shadow?: BState }>;
  next?: { block?: BState };
}

const LITERAL_BLOCKS: Record<string, "number" | "text" | "logic"> = { math_number: "number", text: "text", logic_boolean: "logic" };

export function irToBlockly(ir: ProcedureIR): { blocks: { languageVersion: number; blocks: BState[] } } {
  return {
    blocks: {
      languageVersion: 0,
      blocks: ir.stacks.filter((s) => s.blocks?.length).map((stack) => ({ ...chain(stack.blocks)!, x: stack.x, y: stack.y })),
    },
  };
}

function chain(nodes: BlockNode[]): BState | undefined {
  let head: BState | undefined;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!isNode(nodes[i])) continue;
    const state = node(nodes[i]);
    if (head) state.next = { block: head };
    head = state;
  }
  return head;
}

function node(n: BlockNode): BState {
  const def = BLOCKS_BY_ID.get(n.block);
  const state: BState = { type: n.block };
  if (n.collapsed) state.collapsed = true;
  if (n.disabled) state.disabledReasons = ["MANUALLY_DISABLED"];
  if (n.fields && Object.keys(n.fields).length) {
    state.fields = {};
    for (const [name, value] of Object.entries(n.fields)) {
      const field = def?.fields?.find((f) => f.name === name);
      state.fields[name] = field?.kind === "checkbox" ? (value === true ? "TRUE" : "FALSE") : value;
    }
  }
  const inputs: NonNullable<BState["inputs"]> = {};
  for (const input of def?.inputs ?? []) {
    const value = n.inputs?.[input.name];
    if (input.type === "statements") {
      const body = Array.isArray(value) ? chain(value) : undefined;
      if (body) inputs[input.name] = { block: body };
      continue;
    }
    const literal = !isNode(value) && !Array.isArray(value) && value !== undefined ? value : undefined;
    const shadow = literalShadow(input.type, literal ?? input.default) as BState | undefined;
    const slot: { block?: BState; shadow?: BState } = {};
    if (shadow) slot.shadow = shadow;
    if (isNode(value)) slot.block = node(value);
    else if (literal !== undefined && !shadow) slot.block = literalNode(literal);
    if (slot.block || slot.shadow) inputs[input.name] = slot;
  }
  // Inputs the definition does not know (an older block) are kept on the IR side only by the round trip of
  // known inputs; unknown blocks keep nothing, which the analysis reports.
  if (Object.keys(inputs).length) state.inputs = inputs;
  return state;
}

/** A literal in an input that takes any type ("any") is shown as a literal block. */
function literalNode(value: Literal): BState {
  if (typeof value === "number") return { type: "math_number", fields: { value } };
  if (typeof value === "boolean") return { type: "logic_boolean", fields: { value: String(value) } };
  return { type: "text", fields: { value } };
}

/** Blockly state -> IR. `paths` receives the IR path of every block id, for placing warnings. */
export function blocklyToIr(state: { blocks?: { blocks?: BState[] } }, variables: LocalVariable[], paths?: Map<string, string>): ProcedureIR {
  const top = state.blocks?.blocks ?? [];
  // The start stack comes first so its path is stacks[0] in every save.
  const ordered = [...top].sort((a, b) => Number(b.type === "start") - Number(a.type === "start"));
  return {
    format: IR_FORMAT,
    variables,
    stacks: ordered.map((b, s) => ({ x: Math.round(b.x ?? 0), y: Math.round(b.y ?? 0), blocks: unchain(b, `stacks[${s}].blocks`, paths) })),
  };
}

function unchain(first: BState | undefined, base: string, paths?: Map<string, string>): BlockNode[] {
  const out: BlockNode[] = [];
  for (let b = first; b; b = b.next?.block) out.push(toNode(b, `${base}[${out.length}]`, paths));
  return out;
}

function toNode(b: BState, path: string, paths?: Map<string, string>): BlockNode {
  if (b.id) paths?.set(b.id, path);
  const def = BLOCKS_BY_ID.get(b.type);
  const n: BlockNode = { block: b.type };
  if (b.fields && Object.keys(b.fields).length) {
    n.fields = {};
    for (const [name, value] of Object.entries(b.fields)) {
      const field = def?.fields?.find((f) => f.name === name);
      n.fields[name] = field?.kind === "checkbox" ? value === true || value === "TRUE" : (value as Literal);
    }
  }
  const inputs: Record<string, InputValue> = {};
  for (const [name, slot] of Object.entries(b.inputs ?? {})) {
    const input = def?.inputs?.find((i) => i.name === name);
    if (input?.type === "statements") {
      const body = unchain(slot.block, `${path}.inputs.${name}`, paths);
      if (body.length) inputs[name] = body;
      continue;
    }
    const value = slot.block ?? slot.shadow;
    if (!value) continue;
    const literal = asLiteral(value);
    if (literal !== undefined) {
      if (slot.block?.id) paths?.set(slot.block.id, `${path}.inputs.${name}`);
      inputs[name] = literal;
    } else inputs[name] = toNode(value, `${path}.inputs.${name}`, paths);
  }
  if (Object.keys(inputs).length) n.inputs = inputs;
  if (b.collapsed) n.collapsed = true;
  if (b.disabledReasons?.length) n.disabled = true;
  return n;
}

function asLiteral(b: BState): Literal | undefined {
  const kind = LITERAL_BLOCKS[b.type];
  if (!kind || b.next?.block) return undefined;
  const value = b.fields?.value;
  if (kind === "number") return typeof value === "number" ? value : Number(value) || 0;
  if (kind === "logic") return value === "true" || value === true;
  return value === undefined ? "" : String(value);
}
