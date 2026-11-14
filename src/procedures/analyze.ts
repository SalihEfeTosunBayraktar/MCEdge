import { BLOCKS, BLOCKS_BY_ID } from "./blocks/index.ts";
import { codeFor, type BlockDef, type CodeArgs, type Loader } from "./blockTypes.ts";
import { HELPERS, helperCode } from "./helpers.ts";
import { ImportSet, type Gen } from "./javaNames.ts";
import {
  DEPENDENCIES, isDependency, isNode, mainStack, sortDependencies, walkNodes, type BlockNode, type Dependency, type ProcedureIR,
} from "./model.ts";

/**
 * Static checks of a procedure that need no Java: the dependencies it needs (inferred from its blocks, as in
 * MCreator), which blocks need a dependency the caller does not provide, and which blocks an engine does not
 * generate. The editor shows these as live warnings on the blocks; the generator reports them.
 */

/** Dependencies, return type and side of other procedures, for call blocks. */
export interface ProcedureLookup {
  ir(id: string): ProcedureIR | undefined;
  /** Global variables by name: whether reading them needs the world. */
  globalNeedsWorld(name: string): boolean;
}

/** Dependencies one block needs by itself (calls include the callee's). */
export function blockDependencies(node: BlockNode, lookup: ProcedureLookup, seen = new Set<string>()): Dependency[] {
  const def = BLOCKS_BY_ID.get(node.block);
  if (!def) return [];
  const deps = new Set<Dependency>(def.deps ?? []);
  if (def.depField) {
    const dep = String(node.fields?.[def.depField] ?? def.fields?.find((f) => f.name === def.depField)?.default ?? "");
    if (isDependency(dep)) deps.add(dep);
  }
  if (def.id === "java_code") for (const dep of String(node.fields?.deps ?? "").split(/[\s,]+/)) if (isDependency(dep)) deps.add(dep);
  if (def.id.startsWith("call_procedure")) {
    const id = String(node.fields?.procedure ?? "");
    if (id && !seen.has(id)) for (const d of procedureDependencies(id, lookup, seen)) deps.add(d);
  }
  if (def.fields?.some((f) => f.kind === "global" && f.scope === "global") && lookup.globalNeedsWorld(String(node.fields?.var ?? ""))) deps.add("world");
  // Crossing sides sends to the players of the procedure's world.
  if (def.id === "run_on_client") deps.add("world");
  return [...deps];
}

/** Dependencies of a procedure: the union over the blocks of its running stack. */
export function procedureDependencies(id: string, lookup: ProcedureLookup, seen = new Set<string>()): Dependency[] {
  const ir = lookup.ir(id);
  if (!ir) return [];
  seen.add(id);
  return inferDependencies(ir, lookup, seen);
}

export function inferDependencies(ir: ProcedureIR, lookup: ProcedureLookup, seen = new Set<string>()): Dependency[] {
  const deps = new Set<Dependency>();
  const main = mainStack(ir);
  if (!main) return [];
  let crossesSides = false;
  for (const { node, stack } of walkNodes(ir)) {
    if (ir.stacks[stack] !== main || node.disabled) continue;
    for (const d of blockDependencies(node, lookup, seen)) deps.add(d);
    const def = BLOCKS_BY_ID.get(node.block);
    if (def && def.side !== "both") crossesSides = true;
  }
  if (crossesSides) deps.add("world");
  return sortDependencies(deps);
}

// ---- engine coverage of blocks ----

const coverageCache = new Map<string, boolean>();

/** Whether an engine generates a block: it has code there and every helper the code calls exists there too. */
export function blockGenerated(def: BlockDef, gen: Gen, loader: Loader): boolean {
  const key = `${def.id}|${gen}|${loader}`;
  const known = coverageCache.get(key);
  if (known !== undefined) return known;
  const fn = codeFor(def, gen, loader);
  let ok = !!fn;
  if (fn && !def.special) {
    const used = new Set<string>();
    try {
      fn(probeArgs(def, gen, loader, used));
    } catch {
      ok = false;
    }
    const check = (name: string, seen: Set<string>): boolean => {
      if (seen.has(name)) return true;
      seen.add(name);
      const helper = HELPERS[name];
      if (!helper || !helperCode(helper, gen, loader)) return false;
      return (helper.uses ?? []).every((u) => check(u, seen));
    };
    ok = ok && [...used].every((name) => check(name, new Set()));
  }
  coverageCache.set(key, ok);
  return ok;
}

function probeArgs(def: BlockDef, gen: Gen, loader: Loader, used: Set<string>): CodeArgs {
  const i: Record<string, string> = {};
  for (const input of def.inputs ?? []) i[input.name] = input.name;
  const f: Record<string, string | number | boolean> = {};
  for (const field of def.fields ?? []) f[field.name] = field.default ?? "";
  return {
    i, f, gen, loader, modId: "mod", pkg: "mod", modClass: "Mod",
    j: new Proxy({}, { get: (_t, key) => String(key) }) as Record<string, string>,
    h: (name) => {
      used.add(name);
      return name;
    },
    imports: new ImportSet(gen),
    s: (text) => JSON.stringify(text),
    rl: (id) => id,
    local: (name) => name,
    dep: (name) => name,
    globalGet: () => "0",
    globalSet: () => "",
    call: () => ({ className: "P", args: "" }),
    temp: (hint) => hint,
    tag: (id) => id,
  };
}

/** Blocks an engine generates, by id. */
export function generatedBlocks(gen: Gen, loader: Loader): Set<string> {
  return new Set(BLOCKS.filter((b) => blockGenerated(b, gen, loader)).map((b) => b.id));
}

// ---- warnings ----

export interface BlockWarning {
  /** IR path of the block ("stacks[0].blocks[2]"). */
  path: string;
  block: string;
  kind: "missing_dependency" | "not_generated" | "unknown_block" | "unknown_variable" | "unknown_procedure" | "empty_input" | "unattached";
  message: string;
  /** Missing dependencies, for missing_dependency. */
  deps?: Dependency[];
}

export interface AnalyzeOptions {
  lookup: ProcedureLookup;
  /** Dependencies whoever runs the procedure provides; undefined when unknown (no trigger, no callers). */
  provided?: readonly Dependency[];
  /** Engine to check coverage against. */
  engine?: { gen: Gen; loader: Loader; name: string };
  /** Global variable names by kind ("global" / "player") and type. */
  globals?: (scope: "global" | "player", type: string) => string[];
}

export interface Analysis {
  deps: Dependency[];
  warnings: BlockWarning[];
}

export function analyzeProcedure(ir: ProcedureIR, options: AnalyzeOptions): Analysis {
  const { lookup, provided, engine } = options;
  const warnings: BlockWarning[] = [];
  const main = mainStack(ir);
  const locals = new Map(ir.variables.map((v) => [v.name, v.type]));
  for (const { node, path, stack } of walkNodes(ir)) {
    const def = BLOCKS_BY_ID.get(node.block);
    if (!def) {
      warnings.push({ path, block: node.block, kind: "unknown_block", message: `unknown block "${node.block}"` });
      continue;
    }
    if (ir.stacks[stack] !== main) continue;
    if (provided) {
      const missing = blockDependencies(node, lookup).filter((d) => !provided.includes(d));
      if (missing.length) warnings.push({ path, block: node.block, kind: "missing_dependency", deps: missing, message: `needs ${missing.join(", ")}, which the trigger does not provide` });
    }
    if (engine && !blockGenerated(def, engine.gen, engine.loader)) {
      warnings.push({ path, block: node.block, kind: "not_generated", message: `${engine.name} does not generate this block yet` });
    }
    for (const field of def.fields ?? []) {
      const value = String(node.fields?.[field.name] ?? "");
      if (field.kind === "variable" && (!value || locals.get(value) !== field.varType)) {
        warnings.push({ path, block: node.block, kind: "unknown_variable", message: value ? `no ${field.varType} local variable "${value}"` : "choose a local variable" });
      }
      if (field.kind === "global" && options.globals && !options.globals(field.scope ?? "global", field.varType ?? "number").includes(value)) {
        warnings.push({ path, block: node.block, kind: "unknown_variable", message: value ? `no ${field.scope} variable "${value}" of this type` : "choose a variable" });
      }
      if (field.kind === "procedure" && !lookup.ir(value) && !(field.optional && !value)) {
        warnings.push({ path, block: node.block, kind: "unknown_procedure", message: value ? `no procedure "${value}"` : "choose a procedure" });
      }
    }
  }
  if (!main) warnings.push({ path: "", block: "start", kind: "unattached", message: "no start block: nothing runs" });
  return { deps: inferDependencies(ir, lookup), warnings };
}

/** Value types a dependency getter block outputs, for documentation and MCP. */
export const dependencyType = (dep: Dependency) => DEPENDENCIES[dep].type;

/** Whether a stored value looks like a procedure IR node (for MCP validation). */
export const looksLikeNode = isNode;
