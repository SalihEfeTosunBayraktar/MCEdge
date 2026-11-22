import type { Gen, ImportSet } from "./javaNames.ts";
import type { Dependency, Literal, LocalType, Side, ValueType } from "./model.ts";

/**
 * A procedure block: its shape (inputs, fields, output), where it may run, the dependencies it reads and its
 * Java code per generation. Labels and tooltips live in config/procedure-blocks/<lang>.json, keyed by id.
 */
export interface BlockDef {
  id: string;
  category: CategoryId;
  side: Side;
  /** Value type of a value block; undefined for statement blocks. "any" fits every input. */
  output?: ValueType | "any";
  /** Statement block that ends a chain (return, break): nothing can follow it. */
  terminal?: boolean;
  /** No previous connection: the head of a stack (start). */
  hat?: boolean;
  inputs?: InputDef[];
  fields?: FieldDef[];
  /** Dependencies the block needs wherever it is used. */
  deps?: Dependency[];
  /** A dropdown field whose value is the dependency the block reads ("dep_entity"). */
  depField?: string;
  /** Java code per engine. */
  code: CodeTable;
  /** Codegen handled by the compiler itself (flow blocks with special semantics). */
  special?: boolean;
}

export interface InputDef {
  name: string;
  /** "statements" makes a statement list; "any" accepts every value type. */
  type: ValueType | "any" | "statements";
  /** Literal the input starts with (number, text or logic inputs get an editable literal). */
  default?: Literal;
  /** Block the toolbox puts in the input instead of a plain literal (a block with a picker field for the value). */
  shadowBlock?: string;
}

export type FieldKind =
  /** Fixed options; values are stored as given. */
  | "dropdown"
  | "number"
  | "text"
  | "checkbox"
  /** A registry id with autocomplete: `registry` names the list in config/vanilla-ids.json plus the mod's elements. */
  | "id"
  /** A local variable of the procedure (`varType`). */
  | "variable"
  /** A procedure element of the project. */
  | "procedure"
  /** A global variable from variables.json (`varType`, `scope` global or player). */
  | "global";

export interface FieldDef {
  name: string;
  kind: FieldKind;
  options?: string[];
  registry?: string;
  varType?: LocalType;
  scope?: "global" | "player";
  default?: Literal;
  /** A procedure field that may stay empty (AI goal conditions). */
  optional?: boolean;
}

export const CATEGORIES = [
  "flow", "logic", "loops", "math", "text", "lists", "variables", "world", "blocks", "entity", "player", "bubbles", "items",
  "effects", "damage", "projectiles", "particles", "sounds", "commands", "advancements", "scoreboard", "gui", "directions", "ai",
] as const;
export type CategoryId = (typeof CATEGORIES)[number];

/** Toolbox colour (hue) per category. */
export const CATEGORY_HUES: Record<CategoryId, number> = {
  flow: 30, logic: 210, loops: 120, math: 230, text: 160, lists: 260, variables: 330, world: 95, blocks: 45,
  entity: 195, player: 175, bubbles: 185, items: 350, effects: 290, damage: 0, projectiles: 15, particles: 300, sounds: 270,
  commands: 70, advancements: 55, scoreboard: 140, gui: 240, directions: 20, ai: 110,
};

/** Code variants: the most specific key wins ("fabric-1.21.5", "neoforge", "1.21.5", "modern", "all"). null: not generated. */
export type CodeKey = "all" | "modern" | Gen | `${Loader}` | `${Loader}-${Gen}`;
export type Loader = "forge" | "neoforge" | "fabric";
export type CodeTable = Partial<Record<CodeKey, CodeFn | null>>;
export type CodeFn = (c: CodeArgs) => string;

/** What block code may use. Inputs and statement lists are already compiled Java. */
export interface CodeArgs {
  /** Compiled inputs by name: expressions for values, statement code for statement lists. */
  i: Record<string, string>;
  /** Field values. */
  f: Record<string, Literal>;
  gen: Gen;
  loader: Loader;
  modId: string;
  /** Java package of the mod and the mod class name prefix ("RubyMod"), for generated element classes. */
  pkg: string;
  modClass: string;
  /** Simple class names, imported on use: `c.j.Player`. */
  j: Record<string, string>;
  /** Static helper method of the generated ProcedureHelpers class, emitted on use: `${c.h("chat")}(...)`. */
  h: (name: string) => string;
  /** Java string literal. */
  s: (text: string) => string;
  /** Resource id expression of a registry id ("stone" -> "<modid>:stone"). */
  rl: (id: string) => string;
  /** Imports of the generated class. */
  imports: ImportSet;
  /** Java name of a local variable, as an assignable expression. */
  local: (name: string) => string;
  /** A dependency of the procedure ("world", "entity", "x"). */
  dep: (name: string) => string;
  /** Code that reads / writes a global variable from variables.json. */
  globalGet: (name: string, entity?: string) => string;
  globalSet: (name: string, value: string, entity?: string) => string;
  /** Class of another procedure and the call arguments for its dependencies. */
  call: (procedureId: string) => { className: string; args: string } | undefined;
  /** A fresh Java identifier for temporaries. */
  temp: (hint: string) => string;
  /** A qualified tag id as the engine has it (a Forge tag becomes its c: tag on NeoForge and Fabric). */
  tag: (id: string) => string;
}

/** Whether a java_code block's optional loader field admits the target loader; empty or "any" (older projects) admits all. */
export function javaCodeLoaderMatches(field: unknown, loader: Loader): boolean {
  return field === undefined || field === null || field === "" || field === "any" || field === loader;
}

/** The engine-specific code of a block, or undefined when the engine does not generate it. */
export function codeFor(def: BlockDef, gen: Gen, loader: Loader): CodeFn | undefined {
  const keys: CodeKey[] = [`${loader}-${gen}`, loader, gen, ...(gen === "1.16.5" ? [] : ["modern" as const]), "all"];
  for (const key of keys) {
    if (key in def.code) return def.code[key] ?? undefined;
  }
  return undefined;
}
