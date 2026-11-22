import { BLOCKS_BY_ID } from "./blocks/index.ts";
import { codeFor, javaCodeLoaderMatches, type BlockDef, type CodeArgs, type Loader } from "./blockTypes.ts";
import { HELPERS } from "./helpers.ts";
import { ImportSet, type Gen } from "./javaNames.ts";
import {
  DEPENDENCIES, isNode, mainStack, type BlockNode, type Dependency, type InputValue, type Literal, type LocalType,
  type ProcedureIR, type Side, type ValueType,
} from "./model.ts";

/** What the compiler needs to know about the generation target. */
export interface ProcEnv {
  gen: Gen;
  loader: Loader;
  modId: string;
  /** Java package of the mod ("dev.example.hello"). */
  pkg: string;
  /** Main mod class name ("HelloMod"). */
  modClass: string;
  /** A tag id ("forge:crops") as the engine has it; unchanged when not given. */
  tag?: (id: string) => string;
  /** Profile runs only (Q219): every procedure times its calls into <pkg>.probe.<modClass>Probe.record. */
  profile?: boolean;
}

/** A procedure as the compiler sees it; built from the project by src/procedures/project.ts. */
export interface ProcedureUnit {
  id: string;
  className: string;
  ir: ProcedureIR;
  /** Parameters of execute(): the inferred dependencies. */
  deps: Dependency[];
  returnType?: ValueType;
  /** Side the procedure is called on. */
  home: "server" | "client";
  skipNullCheck: boolean;
}

/** A global variable from variables.json as the compiler sees it. */
export interface GlobalVar {
  name: string;
  type: LocalType;
  player: boolean;
  /** Needs the world dependency (world and map scopes). */
  world: boolean;
}

/** Everything a procedure can refer to across the project. */
export interface CompileScope {
  procedures: ReadonlyMap<string, ProcedureUnit>;
  globals: ReadonlyMap<string, GlobalVar>;
  /** Class holding the generated global variable accessors. */
  variablesClass: string;
}

/** A side switch in a procedure: the code runs on the other side after a generated network packet. */
export interface Segment {
  /** Payload record / class name, unique in the mod ("WelcomeProcedureS1"). */
  name: string;
  /** Payload id path ("welcome_s1"). */
  path: string;
  direction: "toClient" | "toServer";
  /** Payload fields in order. */
  fields: { name: string; type: Transfer }[];
  /** Static method on the receiving side, called with the decoded fields (entities resolved). */
  method: string;
  /** Class holding the method: the procedure class (server) or its client class. */
  owner: string;
  /** toServer only: the method also gets the player who sent the packet, after the level (Q227). */
  sender?: boolean;
}

/** Types a packet can carry. */
export type Transfer = "number" | "logic" | "text" | "entity" | "itemstack" | "blockstate" | "direction" | "tag";
const TRANSFERABLE = new Set<string>(["number", "logic", "text", "entity", "itemstack", "blockstate", "direction"]);

export interface CompileIssue {
  /** Path of the block in the IR ("stacks[0].blocks[3]"), or "" for the procedure. */
  path: string;
  block?: string;
  kind: "not_generated" | "side" | "empty_input" | "unknown_block" | "unknown_variable" | "missing_procedure" | "return";
  message: string;
  /** For side issues: the side the block needs. */
  side?: "server" | "client";
}

export interface CompiledProcedure {
  className: string;
  /** Java source of <pkg>.procedures.<className>. */
  source: string;
  /** Java source of <pkg>.procedures.client.<className>Client, when the procedure has client code. */
  clientSource?: string;
  segments: Segment[];
  helpers: Set<string>;
  usesQueue: boolean;
  issues: CompileIssue[];
}

export const JAVA_TYPES: Record<ValueType | "world", string> = {
  world: "LevelAccessor", number: "double", logic: "boolean", text: "String", entity: "Entity", itemstack: "ItemStack",
  blockstate: "BlockState", direction: "Direction", damagesource: "DamageSource", actionresult: "InteractionResult",
  list: "java.util.List<Object>",
};

/** Java type of a value type; class names are imported through `imports`. */
export function javaType(type: ValueType | "world" | "commandcontext", imports: ImportSet): string {
  if (type === "commandcontext") return `${imports.qualified("com.mojang.brigadier.context.CommandContext")}<${imports.name("CommandSourceStack")}>`;
  const t = JAVA_TYPES[type];
  return /^[A-Z]/.test(t) && t !== "String" ? imports.name(t) : t;
}

/** Neutral value of a type, used for empty inputs and blocks an engine does not generate. */
export function defaultValue(type: ValueType | "any" | undefined, imports: ImportSet): string {
  switch (type) {
    case "number": return "0";
    case "logic": return "false";
    case "text": return '""';
    case "itemstack": return `${imports.name("ItemStack")}.EMPTY`;
    case "blockstate": return `${imports.name("Blocks")}.AIR.defaultBlockState()`;
    case "direction": return `${imports.name("Direction")}.NORTH`;
    case "actionresult": return `${imports.name("InteractionResult")}.PASS`;
    case "list": return "new java.util.ArrayList<Object>()";
    default: return "null";
  }
}

const ATOMIC = /^(?:[A-Za-z_$][\w$.]*|-?\d+(?:\.\d+)?[DFL]?|"(?:[^"\\]|\\.)*"|true|false|null)$/;

/** Wraps an expression in parentheses unless it is atomic or one call chain. */
export function paren(expr: string): string {
  if (ATOMIC.test(expr)) return expr;
  if (/^[A-Za-z_$][\w$.]*\(/.test(expr) && expr.endsWith(")") && closesAtEnd(expr, expr.indexOf("("))) return expr;
  return `(${expr})`;
}

/** Whether the parenthesis opened at `open` closes on the last character (ignoring string contents). */
function closesAtEnd(expr: string, open: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = open; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i === expr.length - 1 || /^(\.[A-Za-z_$][\w$]*\(.*\))+$/.test(expr.slice(i + 1)) && closesChain(expr.slice(i + 1));
  }
  return false;
}

function closesChain(rest: string): boolean {
  // ".a(...).b(...)": every call closes before the next dot.
  let depth = 0;
  let inString = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /[^\w$.]/.test(ch)) return false;
  }
  return depth === 0;
}

/** Java number literal of a double. */
export const jnum = (n: number) => (Number.isFinite(n) ? (Number.isInteger(n) ? `${n}.0` : String(n)) : "0.0");

/** Re-indents generated Java by brace depth (4 spaces), so block templates need no indentation of their own. */
export function reindent(code: string, base = 0): string {
  let depth = base;
  const out: string[] = [];
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const opens = countOutside(line, "{");
    const closes = countOutside(line, "}");
    const lead = line.startsWith("}") ? 1 : 0;
    out.push("    ".repeat(Math.max(0, depth - lead)) + line);
    depth += opens - closes;
  }
  return out.join("\n");
}

function countOutside(line: string, ch: string): number {
  let n = 0;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "/" && line[i + 1] === "/") break;
    else if (c === ch) n++;
  }
  return n;
}

/** Sides a statement's blocks run on (value inputs excluded, explicit side switches count as their caller side). */
export function statementSides(node: BlockNode, scope?: CompileScope): Set<"server" | "client"> {
  const sides = new Set<"server" | "client">();
  const visit = (n: BlockNode) => {
    if (n.disabled) return;
    const def = BLOCKS_BY_ID.get(n.block);
    if (!def) return;
    const own = blockSide(n, def, scope);
    if (own !== "both") sides.add(own);
    if (n.block === "run_on_client" || n.block === "run_on_server") return;
    for (const value of Object.values(n.inputs ?? {})) if (Array.isArray(value)) value.forEach(visit);
  };
  visit(node);
  return sides;
}

/** Side of one block; calling a procedure runs on that procedure's home side. */
export function blockSide(node: BlockNode, def: BlockDef, scope?: CompileScope): Side {
  if (def.id === "call_procedure" && scope) {
    const callee = scope.procedures.get(String(node.fields?.procedure ?? ""));
    if (callee) return callee.home;
  }
  if (def.id === "run_on_client") return "server";
  if (def.id === "run_on_server") return "client";
  return def.side;
}

interface Ctx {
  side: "server" | "client";
  /** Set inside a segment body: how values from the sending side get in. */
  segment?: SegmentBuilder;
  /** Inside a delayed (wait) body: locals must be boxed. */
  inLambda: boolean;
  /** Imports of the class being written. */
  imports: ImportSet;
  /** Locals referenced by this method (declared at its top). */
  locals: Set<string>;
  /** Inside an "in dimension" body: the Java name of that level, which the world dependency stands for. */
  world?: string;
}

/** Collects what a segment body reads from the sending side. */
class SegmentBuilder {
  /** Captured values: name in the body -> { type, expression on the sending side }. */
  readonly captures = new Map<string, { type: Transfer; sender: string; local?: string }>();
  readonly sender: Ctx;
  readonly direction: "toClient" | "toServer";
  constructor(sender: Ctx, direction: "toClient" | "toServer") {
    this.sender = sender;
    this.direction = direction;
  }
}

/**
 * Compiles one procedure. The body runs on `unit.home`. A run of statements that only runs on the other side
 * becomes a segment: a packet carries the values it reads (dependencies, locals, and expressions of the sending
 * side, evaluated before sending) and the receiver runs the statements. Run on client / Run on server blocks
 * switch sides explicitly; a client segment from the automatic split goes to every player in the world.
 */
export function compileProcedure(unit: ProcedureUnit, scope: CompileScope, env: ProcEnv): CompiledProcedure {
  const c = new Compiler(unit, scope, env);
  return c.run();
}

class Compiler {
  readonly issues: CompileIssue[] = [];
  readonly helpers = new Set<string>();
  readonly segments: Segment[] = [];
  readonly serverImports: ImportSet;
  readonly clientImports: ImportSet;
  readonly serverMethods: string[] = [];
  readonly clientMethods: string[] = [];
  usesQueue = false;
  private temps = 0;
  /** Locals that a delayed body reads or writes: stored in one-element arrays so lambdas may change them. */
  readonly boxed = new Set<string>();
  readonly localTypes: Map<string, LocalType>;

  readonly unit: ProcedureUnit;
  readonly scope: CompileScope;
  readonly env: ProcEnv;

  constructor(unit: ProcedureUnit, scope: CompileScope, env: ProcEnv) {
    this.unit = unit;
    this.scope = scope;
    this.env = env;
    this.serverImports = new ImportSet(env.gen);
    this.clientImports = new ImportSet(env.gen);
    this.localTypes = new Map(unit.ir.variables.map((v) => [v.name, v.type]));
  }

  run(): CompiledProcedure {
    const { unit, env } = this;
    const stack = mainStack(unit.ir);
    this.findBoxed(stack?.blocks ?? []);
    const home = unit.home;
    // execute() always lives in the main class so callers need no client class; client-only helpers it uses
    // are in the client helper class and load only when they run.
    const imports = this.serverImports;
    const ctx: Ctx = { side: home, inLambda: false, imports, locals: new Set() };
    const body = this.statements((stack?.blocks ?? []).slice(1), ctx, `stacks[${stack ? unit.ir.stacks.indexOf(stack) : 0}].blocks`, 1);
    const ret = unit.returnType;
    const retType = ret ? javaType(ret, imports) : "void";
    const params = unit.deps.map((d) => `${javaType(DEPENDENCIES[d].type, imports)} ${d}`).join(", ");
    const nullable = unit.skipNullCheck ? [] : unit.deps.filter((d) => ["entity", "world", "damagesource"].includes(DEPENDENCIES[d].type));
    const guard = nullable.length ? `if (${nullable.map((d) => `${d} == null`).join(" || ")}) return${ret ? ` ${defaultValue(ret, imports)}` : ""};\n` : "";
    const inner = `${guard}${this.declareLocals(ctx)}${body}${ret ? `\nreturn ${defaultValue(ret, imports)};` : ""}`;
    // Profile runs time every call (Q219); normal builds keep the one plain method.
    const method = env.profile
      ? `public static ${retType} execute(${params}) {\nlong start = System.nanoTime();\ntry {\n${ret ? "return " : ""}executeBody(${unit.deps.join(", ")});\n} finally {\n${env.pkg}.probe.${env.modClass}Probe.record(${JSON.stringify(unit.id)}, System.nanoTime() - start);\n}\n}\n\nprivate static ${retType} executeBody(${params}) {\n${inner}\n}`
      : `public static ${retType} execute(${params}) {\n${inner}\n}`;
    this.serverMethods.unshift(method);

    const header = (cls: string, pkg: string, imp: ImportSet, note: string, methods: string[]) =>
      `package ${pkg};\n\n${imp.lines()}\n\n/** Generated by MCEdge from procedure "${unit.id}".${note} */\npublic final class ${cls} {\nprivate ${cls}() {}\n\n${methods.join("\n\n")}\n}\n`;
    const server = header(unit.className, `${env.pkg}.procedures`, this.serverImports, "", this.serverMethods.length ? this.serverMethods : []);
    const client = this.clientMethods.length
      ? header(`${unit.className}Client`, `${env.pkg}.procedures.client`, this.clientImports, " Client side; loaded only on the physical client.", this.clientMethods)
      : undefined;
    return {
      className: unit.className,
      source: reindent(server),
      clientSource: client && reindent(client),
      segments: this.segments,
      helpers: this.helpers,
      usesQueue: this.usesQueue,
      issues: this.issues,
    };
  }

  private issue(path: string, kind: CompileIssue["kind"], message: string, block?: string): void {
    this.issues.push({ path, kind, message, block });
  }

  /** Locals used inside wait bodies need boxing. */
  private findBoxed(blocks: BlockNode[]): void {
    const visit = (n: BlockNode, inWait: boolean) => {
      if (!isNode(n)) return;
      const def = BLOCKS_BY_ID.get(n.block);
      if (inWait && def?.fields?.some((f) => f.kind === "variable")) {
        for (const f of def.fields) if (f.kind === "variable") this.boxed.add(String(n.fields?.[f.name] ?? ""));
      }
      for (const value of Object.values(n.inputs ?? {})) {
        if (Array.isArray(value)) value.forEach((v) => visit(v, inWait || n.block === "wait"));
        else if (isNode(value)) visit(value, inWait);
      }
    };
    blocks.forEach((b) => visit(b, false));
  }

  private declareLocals(ctx: Ctx, skip: ReadonlySet<string> = new Set()): string {
    return [...ctx.locals].filter((name) => !skip.has(name)).map((name) => {
      const type = this.localTypes.get(name)!;
      const jt = javaType(type, ctx.imports);
      const init = defaultValue(type, ctx.imports);
      return this.boxed.has(name) ? `final ${jt}[] var_${name} = {${init}};\n` : `${jt} var_${name} = ${init};\n`;
    }).join("");
  }

  /** A statement list in a context; runs of other-side statements become segments. */
  statements(list: BlockNode[], ctx: Ctx, basePath: string, offset = 0): string {
    const out: string[] = [];
    let run: { node: BlockNode; path: string }[] = [];
    let runSide: "server" | "client" | undefined;
    const flush = () => {
      if (run.length && runSide) out.push(this.segment(run, ctx, runSide));
      run = [];
      runSide = undefined;
    };
    list.forEach((node, i) => {
      const path = `${basePath}[${i + offset}]`;
      if (!isNode(node) || node.disabled) return;
      const sides = statementSides(node, this.scope);
      const other = ctx.side === "server" ? "client" : "server";
      if (sides.size === 1 && sides.has(other) && node.block !== "run_on_client" && node.block !== "run_on_server") {
        if (runSide !== other) flush();
        runSide = other;
        run.push({ node, path });
        return;
      }
      flush();
      out.push(this.statement(node, ctx, path));
    });
    flush();
    return out.join("\n");
  }

  /** Emits the send side of a segment and builds its receiver method. */
  private segment(run: { node: BlockNode; path: string }[], ctx: Ctx, side: "server" | "client", target?: string, explicitDirection?: boolean): string {
    if (ctx.segment) {
      // Already inside a segment of the other direction: a round trip back is a new segment from here.
    }
    const direction = side === "client" ? "toClient" : "toServer";
    if (ctx.world) this.issue(run[0].path, "side", "code for the other side runs in that side's own world, not in the dimension of the surrounding block", run[0].node.block);
    const builder = new SegmentBuilder(ctx, direction);
    const imports = side === "client" ? this.clientImports : this.serverImports;
    const inner: Ctx = { side, segment: builder, inLambda: false, imports, locals: new Set() };
    const body = run.map(({ node, path }) => this.statement(node, inner, path)).join("\n");
    for (const { node, path } of run) this.checkNoReturn(node, path);
    const index = this.segments.length + 1;
    const name = `${this.unit.className}S${index}`;
    const method = `segment${index}`;
    const fields = [...builder.captures].map(([fname, cap]) => ({ name: fname, type: cap.type }));
    // The receiving method gets the captured values; captured locals start from the sent value.
    const params = [`${imports.name("LevelAccessor")} world`, ...fields.map((f) => `${javaType(f.type as ValueType, imports)} ${f.name}`)];
    const capturedLocals = new Set([...builder.captures.values()].map((c) => c.local).filter((l): l is string => !!l));
    const localInit = [...capturedLocals].map((l) => {
      const jt = javaType(this.localTypes.get(l)!, imports);
      return this.boxed.has(l) ? `final ${jt}[] var_${l} = {in_${l}};\n` : `${jt} var_${l} = in_${l};\n`;
    }).join("");
    const renamed = params.map((p) => {
      const local = [...capturedLocals].find((l) => p.endsWith(` var_${l}`));
      return local ? p.replace(` var_${local}`, ` in_${local}`) : p;
    });
    const declared = this.declareLocals(inner, capturedLocals);
    const receiver = `public static void ${method}(${renamed.join(", ")}) {\n${localInit}${declared}${body}\n}`;
    (side === "client" ? this.clientMethods : this.serverMethods).push(receiver);
    const owner = side === "client" ? `${this.env.pkg}.procedures.client.${this.unit.className}Client` : `${this.env.pkg}.procedures.${this.unit.className}`;
    this.segments.push({ name, path: `${this.unit.id}_s${index}`, direction, fields, method, owner });
    const network = ctx.imports.qualified(`${this.env.pkg}.procedures.${this.env.modClass}Network`);
    // Entities and directions travel as ints (entity id, ordinal).
    const args = [...builder.captures.values()]
      .map((c) => (c.type === "entity" ? `${network}.id(${c.sender})` : c.type === "direction" ? `${network}.dir(${c.sender})` : c.sender))
      .join(", ");
    const send = direction === "toServer"
      ? `${ctx.imports.qualified(`${this.env.pkg}.procedures.client.${this.env.modClass}NetworkClient`)}.toServer(new ${network}.${name}(${args}));`
      : target
        ? `${network}.toPlayer(${target}, new ${network}.${name}(${args}));`
        : `${network}.toClients(${this.dep("world", ctx)}, new ${network}.${name}(${args}));`;
    void explicitDirection;
    return `// ${direction === "toClient" ? "runs on the client" : "runs on the server"} (packet ${name})\n${send}`;
  }

  private checkNoReturn(node: BlockNode, path: string): void {
    const visit = (n: BlockNode, p: string) => {
      if (!isNode(n)) return;
      if (n.block.startsWith("return_")) this.issue(p, "return", "a return cannot run on the other side; it is ignored there", n.block);
      for (const [k, v] of Object.entries(n.inputs ?? {})) {
        if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}.inputs.${k}[${i}]`));
      }
    };
    visit(node, path);
  }

  /** One statement in a context. */
  statement(node: BlockNode, ctx: Ctx, path: string): string {
    const def = BLOCKS_BY_ID.get(node.block);
    if (!def) {
      this.issue(path, "unknown_block", `unknown block "${node.block}"`, node.block);
      return `// unknown block ${node.block}`;
    }
    if (def.output) {
      // A loose value block in a chain does nothing.
      return "";
    }
    if (node.block === "run_on_client" || node.block === "run_on_server") return this.sideSwitch(node, def, ctx, path);
    if (node.block === "wait") return this.wait(node, def, ctx, path);
    if (node.block === "in_dimension") return this.inDimension(node, ctx, path);
    const code = this.blockCode(node, def, ctx, path);
    return code ?? `// ${node.block}: not generated for ${this.env.loader} ${this.env.gen}`;
  }

  private sideSwitch(node: BlockNode, def: BlockDef, ctx: Ctx, path: string): string {
    const target = node.block === "run_on_client" ? "client" : "server";
    const list = (Array.isArray(node.inputs?.do) ? node.inputs!.do : []) as BlockNode[];
    if (ctx.side === target) return this.statements(list, ctx, `${path}.inputs.do`);
    const items = list.map((n, i) => ({ node: n, path: `${path}.inputs.do[${i}]` })).filter(({ node: n }) => isNode(n) && !n.disabled);
    if (!items.length) return "";
    const player = target === "client" ? this.value(node.inputs?.player, "entity", ctx, `${path}.inputs.player`) : undefined;
    void def;
    return this.segment(items, ctx, target, player);
  }

  /** The body runs with another dimension's level as "world"; blocks that need a side switch inside it are reported. */
  private inDimension(node: BlockNode, ctx: Ctx, path: string): string {
    const list = (Array.isArray(node.inputs?.do) ? node.inputs!.do : []) as BlockNode[];
    const level = `_level${++this.temps}`;
    const body = this.statements(list, { ...ctx, world: level }, `${path}.inputs.do`);
    const find = `${ctx.imports.qualified(`${this.env.pkg}.procedures.ProcedureHelpers`)}.dimensionLevel`;
    this.useHelper("dimensionLevel");
    const dimension = qualifyId("minecraft", String(node.fields?.dimension ?? "minecraft:overworld"));
    return `${javaType("world", ctx.imports)} ${level} = ${find}(${this.dep("world", ctx)}, ${JSON.stringify(dimension)});
if (${level} != null) {
${body}
}`;
  }

  private wait(node: BlockNode, def: BlockDef, ctx: Ctx, path: string): string {
    const ticks = this.value(node.inputs?.ticks, "number", ctx, `${path}.inputs.ticks`);
    const list = (Array.isArray(node.inputs?.do) ? node.inputs!.do : []) as BlockNode[];
    const body = this.statements(list, { ...ctx, inLambda: true }, `${path}.inputs.do`);
    if (!codeFor(def, this.env.gen, this.env.loader)) {
      this.issue(path, "not_generated", `not generated for ${this.env.loader} ${this.env.gen}`, node.block);
      return "";
    }
    this.usesQueue = true;
    this.useHelper("queue");
    const helpers = ctx.imports.qualified(`${this.env.pkg}.procedures.ProcedureHelpers`);
    return `${helpers}.queue(${this.dep("world", ctx)}, (int) ${paren(ticks)}, () -> {\n${body}\n});`;
  }

  /** Code of a block through its definition; undefined when the engine does not generate it. */
  private blockCode(node: BlockNode, def: BlockDef, ctx: Ctx, path: string): string | undefined {
    if (def.category === "ai") {
      this.issue(path, "not_generated", "AI goal blocks only work in a living entity's AI goals", node.block);
      return "";
    }
    const fn = codeFor(def, this.env.gen, this.env.loader);
    if (!fn) {
      this.issue(path, "not_generated", `not generated for ${this.env.loader} ${this.env.gen}`, node.block);
      return undefined;
    }
    // Java is written against one version's class names; elsewhere the block only logs, which the build must show.
    if (def.id === "java_code" && node.fields?.gen !== this.env.gen) {
      this.issue(path, "not_generated", `Java written for Minecraft ${String(node.fields?.gen)} does nothing on ${this.env.gen}`, node.block);
    } else if (def.id === "java_code" && !javaCodeLoaderMatches(node.fields?.loader, this.env.loader)) {
      this.issue(path, "not_generated", `Java written for ${String(node.fields?.loader)} does nothing on ${this.env.loader}`, node.block);
    }
    const inputs: Record<string, string> = {};
    for (const input of def.inputs ?? []) {
      const value = node.inputs?.[input.name];
      const at = `${path}.inputs.${input.name}`;
      inputs[input.name] = input.type === "statements"
        ? this.statements(Array.isArray(value) ? value : [], ctx, at)
        : this.value(value, input.type, ctx, at, input.default);
    }
    const fields: Record<string, Literal> = {};
    for (const field of def.fields ?? []) fields[field.name] = node.fields?.[field.name] ?? field.default ?? (field.kind === "checkbox" ? false : field.kind === "number" ? 0 : "");
    const args = this.args(inputs, fields, ctx, path);
    let code = fn(args);
    if (!def.output) code = this.bindRepeated(code, def, inputs, ctx, fn, fields, path);
    return code;
  }

  /** Statement inputs used more than once are evaluated once into a temporary. */
  private bindRepeated(code: string, def: BlockDef, inputs: Record<string, string>, ctx: Ctx, fn: (c: CodeArgs) => string, fields: Record<string, Literal>, path: string): string {
    const marked: Record<string, string> = {};
    for (const name of Object.keys(inputs)) marked[name] = `\u0001${name}\u0001`;
    const probe = fn(this.args(marked, fields, { ...ctx, imports: new ImportSet(this.env.gen) }, path, true));
    const bind: string[] = [];
    const replaced = { ...inputs };
    for (const input of def.inputs ?? []) {
      if (input.type === "statements") continue;
      const uses = probe.split(`\u0001${input.name}\u0001`).length - 1;
      if (uses > 1 && !ATOMIC.test(inputs[input.name])) {
        const temp = `_${input.name}${++this.temps}`;
        const type = input.type === "any" ? "Object" : javaType(input.type, ctx.imports);
        bind.push(`final ${type} ${temp} = ${inputs[input.name]};`);
        replaced[input.name] = temp;
      }
    }
    if (!bind.length) return code;
    return `{\n${bind.join("\n")}\n${fn(this.args(replaced, fields, ctx, path))}\n}`;
  }

  /** A value input: a block, a literal, or empty (the input's default, else the type's neutral value). */
  value(value: InputValue | undefined, type: ValueType | "any", ctx: Ctx, path: string, fallback?: Literal): string {
    if (value === undefined || value === null || Array.isArray(value)) {
      if (fallback !== undefined) return this.literal(fallback, type);
      if (type !== "any") this.issue(path, "empty_input", "empty input", undefined);
      return defaultValue(type, ctx.imports);
    }
    if (!isNode(value)) return this.literal(value, type);
    const def = BLOCKS_BY_ID.get(value.block);
    if (!def) {
      this.issue(path, "unknown_block", `unknown block "${value.block}"`, value.block);
      return defaultValue(type, ctx.imports);
    }
    const side = blockSide(value, def, this.scope);
    if (side !== "both" && side !== ctx.side) {
      // A value of the sending side inside a segment is computed there and sent along.
      if (ctx.segment && ctx.segment.sender.side === side && def.output && TRANSFERABLE.has(def.output)) {
        const expr = this.value(value, type, ctx.segment.sender, path, fallback);
        const name = `v${ctx.segment.captures.size + 1}`;
        ctx.segment.captures.set(name, { type: def.output as Transfer, sender: expr });
        return name;
      }
      this.issues.push({ path, kind: "side", message: `runs only on the ${side}; here it runs on the ${ctx.side}`, block: value.block, side });
    }
    const code = this.blockCode(value, def, ctx, path);
    if (code === undefined) return defaultValue(def.output === "any" ? type : def.output, ctx.imports);
    return paren(code);
  }

  literal(value: Literal, type: ValueType | "any"): string {
    if (typeof value === "number") return type === "text" ? JSON.stringify(String(value)) : jnum(value);
    if (typeof value === "boolean") return type === "text" ? JSON.stringify(String(value)) : String(value);
    if (type === "number") return jnum(Number(value) || 0);
    if (type === "logic") return value === "true" ? "true" : "false";
    return JSON.stringify(value);
  }

  /** A dependency in a context: inside a segment it is captured (the world is the receiver's own). */
  dep(name: Dependency, ctx: Ctx): string {
    const seg = ctx.segment;
    if (name === "world") return ctx.world ?? name;
    if (!seg) return name;
    const type = DEPENDENCIES[name].type;
    if (!TRANSFERABLE.has(type)) {
      this.issue("", "side", `the ${name} dependency cannot be sent to the ${ctx.side}`);
      return defaultValue(type as ValueType, ctx.imports);
    }
    if (!seg.captures.has(name)) seg.captures.set(name, { type: type as Transfer, sender: this.dep(name, seg.sender) });
    return name;
  }

  /** A local variable in a context: captured into segments; boxed when a delayed body uses it. */
  local(name: string, ctx: Ctx, path: string): string {
    const type = this.localTypes.get(name);
    if (!type) {
      this.issue(path, "unknown_variable", `unknown local variable "${name}"`);
      return "var_missing";
    }
    if (ctx.segment && !ctx.locals.has(name)) {
      if (TRANSFERABLE.has(type)) {
        const key = `var_${name}`;
        if (!ctx.segment.captures.has(key)) ctx.segment.captures.set(key, { type: type as Transfer, sender: this.local(name, ctx.segment.sender, path), local: name });
        ctx.locals.add(name);
        // Declared by the segment method from its parameter.
        return this.boxed.has(name) ? `var_${name}[0]` : `var_${name}`;
      }
    }
    ctx.locals.add(name);
    return this.boxed.has(name) ? `var_${name}[0]` : `var_${name}`;
  }

  private args(inputs: Record<string, string>, fields: Record<string, Literal>, ctx: Ctx, path: string, probe = false): CodeArgs {
    const { env, scope } = this;
    const imports = ctx.imports;
    return {
      i: inputs,
      f: fields,
      gen: env.gen,
      loader: env.loader,
      modId: env.modId,
      pkg: env.pkg,
      modClass: env.modClass,
      j: imports.proxy(),
      imports,
      h: (name) => {
        if (!HELPERS[name]) throw new Error(`unknown helper ${name}`);
        if (!probe) this.useHelper(name);
        return `${imports.qualified(`${env.pkg}.procedures.${HELPERS[name].client ? "client.ProcedureClientHelpers" : "ProcedureHelpers"}`)}.${name}`;
      },
      s: (text) => JSON.stringify(text),
      rl: (id) => rlExpr(env, qualifyId(env.modId, id)),
      local: (name) => (probe ? `var_${name}` : this.local(name, ctx, path)),
      dep: (name) => (probe ? name : this.dep(name as Dependency, ctx)),
      globalGet: (name, entity) => {
        const g = scope.globals.get(name);
        if (!g) {
          if (!probe) this.issue(path, "unknown_variable", `unknown global variable "${name}"`);
          return "0";
        }
        const arg = g.player ? (entity ?? "null") : g.world ? (probe ? "world" : this.dep("world", ctx)) : "";
        return `${env.pkg}.procedures.${scope.variablesClass}.get_${name}(${arg})`;
      },
      globalSet: (name, value, entity) => {
        const g = scope.globals.get(name);
        if (!g) {
          if (!probe) this.issue(path, "unknown_variable", `unknown global variable "${name}"`);
          return "";
        }
        const arg = g.player ? (entity ?? "null") : g.world ? (probe ? "world" : this.dep("world", ctx)) : "";
        return `${env.pkg}.procedures.${scope.variablesClass}.set_${name}(${arg ? `${arg}, ` : ""}${value});`;
      },
      call: (id) => {
        const callee = scope.procedures.get(id);
        if (!callee) {
          if (!probe) this.issue(path, "missing_procedure", `no procedure "${id}"`);
          return undefined;
        }
        return {
          className: imports.qualified(`${env.pkg}.procedures.${callee.className}`),
          args: callee.deps.map((d) => (probe ? d : this.dep(d, ctx))).join(", "),
        };
      },
      temp: (hint) => `_${hint}${++this.temps}`,
      tag: (id) => env.tag?.(id) ?? id,
    };
  }

  private useHelper(name: string): void {
    if (this.helpers.has(name)) return;
    this.helpers.add(name);
    for (const dep of HELPERS[name].uses ?? []) this.useHelper(dep);
  }
}

/** "stone" -> "<mod>:stone"; "minecraft:stone" stays. */
export function qualifyId(modId: string, id: string): string {
  const clean = id.replace(/^#/, "");
  return clean.includes(":") ? clean : `${modId}:${clean}`;
}

/** Resource id expression per generation. */
export function rlExpr(env: { gen: Gen }, id: string): string {
  if (env.gen === "1.16.5") return `new net.minecraft.util.ResourceLocation(${JSON.stringify(id)})`;
  return `${env.gen === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation"}.parse(${JSON.stringify(id)})`;
}
