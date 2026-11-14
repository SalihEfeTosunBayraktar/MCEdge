import * as Blockly from "blockly/core";
import * as BlocklyEn from "blockly/msg/en";
import * as BlocklyTr from "blockly/msg/tr";
import en from "../../../../config/procedure-blocks/en.json" with { type: "json" };
import tr from "../../../../config/procedure-blocks/tr.json" with { type: "json" };
import { BLOCKS, BLOCKS_BY_ID } from "../../../../src/procedures/blocks/index.ts";
import { CATEGORIES, CATEGORY_HUES, type BlockDef, type FieldDef, type InputDef } from "../../../../src/procedures/blockTypes.ts";
import type { Side } from "../../../../src/procedures/model.ts";

/*
 * Procedure blocks for Blockly, built from the core block library (src/procedures/blocks) and the labels in
 * config/procedure-blocks/<lang>.json. Every block carries a side marker; typed inputs only accept their type.
 */

type Labels = typeof en;
const LABELS: Record<string, Labels> = { en, tr: tr as unknown as Labels };

let labels: Labels = en;
let fallback: Labels = en;

/** Options that change while the editor runs: locals of the open procedure, the project's globals and procedures. */
export interface ChoiceSource {
  locals(type: string): string[];
  globals(scope: "global" | "player", type: string): string[];
  procedures(): { id: string; name: string }[];
  /** Every global and player variable of the project, for the Variables category. */
  allGlobals(): { name: string; type: string; player: boolean }[];
}

let choices: ChoiceSource = { locals: () => [], globals: () => [], procedures: () => [], allGlobals: () => [] };
export const setChoiceSource = (source: ChoiceSource) => (choices = source);

export const blockLabel = (id: string): string => (labels.blocks as Record<string, string>)[id] ?? (fallback.blocks as Record<string, string>)[id] ?? id;
export const categoryLabel = (id: string): string => (labels.categories as Record<string, string>)[id] ?? (fallback.categories as Record<string, string>)[id] ?? id;
export const sideLabel = (side: Side): string => labels.sides[side] ?? fallback.sides[side];
const optionLabel = (block: string, value: string): string => {
  const o = labels.options as Record<string, string>;
  const f = fallback.options as Record<string, string>;
  return o[`${block}.${value}`] ?? o[value] ?? f[value] ?? value;
};
const tip = (id: string): string => (labels.tips as Record<string, string>)[id] ?? (fallback.tips as Record<string, string>)[id] ?? "";

// ---- custom fields ----

/** Text field whose editor autocompletes registry ids from a <datalist id="ref-<registry>">. */
class FieldRegistryId extends Blockly.FieldTextInput {
  registry = "";

  static fromJson(options: Blockly.FieldTextInputFromJsonConfig & { registry?: string }): FieldRegistryId {
    const field = new FieldRegistryId(options.text ?? "");
    field.registry = options.registry ?? "";
    return field;
  }

  protected override widgetCreate_(): HTMLInputElement | HTMLTextAreaElement {
    const input = super.widgetCreate_();
    if (this.registry) input.setAttribute("list", `ref-${this.registry}`);
    input.spellcheck = false;
    return input;
  }
}

/**
 * Dropdown whose options come from the editor state (variables, procedures, dependencies). It keeps any value,
 * even one no longer offered, so loading a program never drops what it refers to; the analysis warns instead.
 */
class FieldChoice extends Blockly.FieldDropdown {
  readonly produce: () => [string, string][];
  /** "local", "global", "procedure" or "options". */
  readonly choice: string;

  constructor(produce: () => [string, string][], choice: string) {
    super(() => [["", ""]]);
    this.produce = produce;
    this.choice = choice;
  }

  static fromJson(options: { choice: string; varType?: string; scope?: "global" | "player"; options?: [string, string][] }): FieldChoice {
    const produce = (): [string, string][] => {
      switch (options.choice) {
        case "local": return choices.locals(options.varType ?? "number").map((n) => [n, n]);
        case "global": return choices.globals(options.scope ?? "global", options.varType ?? "number").map((n) => [n, n]);
        case "procedure": return choices.procedures().map((p) => [p.name, p.id]);
        default: return options.options ?? [];
      }
    };
    return new FieldChoice(produce, options.choice);
  }

  override getOptions(): Blockly.MenuOption[] {
    // The base constructor asks for options before this.produce is set.
    if (!this.produce) return [["-", ""]];
    const list = this.produce();
    const value = this.getValue() ?? "";
    if (value && !list.some(([, v]) => v === value)) list.push([value, value]);
    return list.length ? list : [["-", ""]];
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return newValue ?? "";
  }
}

let registered = false;

type NeighbourSearch = (connection: Blockly.RenderedConnection, maxRadius: number) => Blockly.RenderedConnection[];

/**
 * Blockly 13's ConnectionDB.getNeighbours walks the y-sorted connections back and forth from the closest one, but the
 * forward walk tests `dy < maxRadius` with a negative dy and so scans the whole rest of the database. Every render ends
 * with bumpNeighbours over each connection of the stack, which makes one field edit quadratic in the program size
 * (~160 ms per keystroke on a 5,000-block program). This version stops the forward walk at the first connection more
 * than maxRadius below, which cannot be a neighbour (the list is sorted): same neighbours in the same order. While the
 * database is in a bulk update (not sorted yet) Blockly's own walk is used.
 */
function boundNeighbourSearch(): void {
  const proto = Blockly.ConnectionDB.prototype as unknown as { getNeighbours: NeighbourSearch };
  const original = proto.getNeighbours;
  proto.getNeighbours = function (this: { connections: Blockly.RenderedConnection[]; bulkCounter: number }, connection, maxRadius) {
    const db = this.connections;
    if (this.bulkCounter !== 0 || !Array.isArray(db)) return original.call(this, connection, maxRadius);
    const currentX = connection.x;
    const currentY = connection.y;
    let pointerMin = 0;
    let pointerMax = db.length - 2;
    let pointerMid = pointerMax;
    while (pointerMin < pointerMid) {
      if (db[pointerMid].y < currentY) pointerMin = pointerMid;
      else pointerMax = pointerMid;
      pointerMid = Math.floor((pointerMin + pointerMax) / 2);
    }
    const neighbours: Blockly.RenderedConnection[] = [];
    const near = (i: number) => {
      const dx = currentX - db[i].x;
      const dy = currentY - db[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= maxRadius) neighbours.push(db[i]);
    };
    pointerMin = pointerMid;
    pointerMax = pointerMid;
    if (db.length) {
      while (pointerMin >= 0) {
        near(pointerMin);
        if (!(currentY - db[pointerMin].y < maxRadius)) break;
        pointerMin--;
      }
      while (++pointerMax < db.length) {
        const dy = currentY - db[pointerMax].y;
        // Further below than the radius: so is every later connection.
        if (-dy > maxRadius) break;
        near(pointerMax);
        if (!(dy < maxRadius)) break;
      }
    }
    return neighbours;
  };
}

/**
 * Workspace.remainingCapacity counts every block of the program even when maxBlocks is Infinity (the answer is then
 * Infinity anyway). The editor sets maxInstances (one start block), so Blockly asks it for each block a flyout shows
 * and for every flyout block after each block creation or deletion: a block search on a 5,000-block program spent
 * ~0.2 s in these counts. Same answer without the count.
 */
function skipUnlimitedCapacityCount(): void {
  const proto = Blockly.Workspace.prototype;
  const original = proto.remainingCapacity;
  proto.remainingCapacity = function (this: Blockly.Workspace) {
    return this.options.maxBlocks === Infinity ? Infinity : original.call(this);
  };
}

/** Registers fields, locale and every block once; labels follow the UI language. */
export function setupBlockly(language: string): void {
  labels = LABELS[language] ?? en;
  fallback = en;
  Blockly.setLocale((language === "tr" ? BlocklyTr : BlocklyEn) as unknown as { [key: string]: string });
  if (!registered) {
    Blockly.fieldRegistry.register("field_mcedge_id", FieldRegistryId as unknown as Blockly.fieldRegistry.RegistrableField);
    Blockly.fieldRegistry.register("field_mcedge_choice", FieldChoice as unknown as Blockly.fieldRegistry.RegistrableField);
    boundNeighbourSearch();
    skipUnlimitedCapacityCount();
    registered = true;
  }
  for (const def of BLOCKS) Blockly.Blocks[def.id] = blockInit(def);
}

const SIDE_COLORS: Record<Side, string> = { server: "#4f8fd6", client: "#5fbf5a", both: "#9a8f80" };
const sideImage = (side: Side) => {
  const color = SIDE_COLORS[side];
  const letter = side === "server" ? "S" : side === "client" ? "C" : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="18"><rect x="0" y="0" width="4" height="18" fill="${color}"/>${letter ? `<text x="9" y="13" font-family="Verdana" font-size="10" font-weight="bold" text-anchor="middle" fill="${color}">${letter}</text>` : ""}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** Blockly connection check of a value type ("any" accepts all). */
const check = (type: string) => (type === "any" ? null : [type]);

function fieldJson(block: BlockDef, field: FieldDef): Record<string, unknown> {
  switch (field.kind) {
    case "dropdown":
      return { type: "field_dropdown", name: field.name, options: (field.options ?? []).map((o) => [optionLabel(block.id, o), o]) };
    case "number":
      return { type: "field_number", name: field.name, value: Number(field.default ?? 0) };
    case "text":
      return { type: "field_input", name: field.name, text: String(field.default ?? "") };
    case "checkbox":
      return { type: "field_checkbox", name: field.name, checked: field.default === true };
    case "id":
      return { type: "field_mcedge_id", name: field.name, text: String(field.default ?? ""), registry: field.registry };
    case "variable":
      return { type: "field_mcedge_choice", name: field.name, choice: "local", varType: field.varType };
    case "global":
      return { type: "field_mcedge_choice", name: field.name, choice: "global", varType: field.varType, scope: field.scope };
    case "procedure":
      return { type: "field_mcedge_choice", name: field.name, choice: "procedure" };
  }
}

function inputJson(input: InputDef): Record<string, unknown> {
  return input.type === "statements"
    ? { type: "input_statement", name: input.name }
    : { type: "input_value", name: input.name, check: check(input.type) };
}

/** Blockly JSON definition of a block: its label with %1.. arguments in label order. */
export function blockJson(def: BlockDef): Record<string, unknown> {
  const label = blockLabel(def.id);
  const args: Record<string, unknown>[] = [];
  const message = label.replace(/%(\w+)/g, (_, name: string) => {
    const input = def.inputs?.find((i) => i.name === name);
    const field = def.fields?.find((f) => f.name === name);
    if (input) args.push(inputJson(input));
    else if (field) args.push(fieldJson(def, field));
    else return name;
    return `%${args.length}`;
  });
  const hasStatements = def.inputs?.some((i) => i.type === "statements");
  return {
    type: def.id,
    message0: message,
    args0: args,
    colour: CATEGORY_HUES[def.category],
    tooltip: [tip(def.id), sideLabel(def.side)].filter(Boolean).join("\n"),
    inputsInline: !hasStatements,
    ...(def.output ? { output: check(def.output) } : {
      ...(def.hat ? {} : { previousStatement: null }),
      ...(def.terminal ? {} : { nextStatement: null }),
    }),
  };
}

const LITERALS = new Set(["math_number", "text", "logic_boolean"]);

function blockInit(def: BlockDef) {
  return {
    init(this: Blockly.Block) {
      this.jsonInit(blockJson(def));
      // The side marker sits first on the block; literals (numbers, text, logic) stay plain.
      const first = this.inputList[0];
      if (first && !LITERALS.has(def.id)) first.insertFieldAt(0, new Blockly.FieldImage(sideImage(def.side), 12, 18, sideLabel(def.side)));
    },
  };
}

// ---- toolbox ----

export interface ToolboxOptions {
  /** Block ids not offered here (blocks of another procedure kind). */
  hidden?: (def: BlockDef) => boolean;
  /** Names and empty-state hints of the Favourites and Recently used categories (UI strings). */
  personal?: { favourites: string; favouritesEmpty: string; recent: string; recentEmpty: string };
  /** The variables to list first in the Variables category, with the headings and the empty-state hint (UI strings). */
  variables?: {
    locals: { name: string; type: string }[];
    globals: { name: string; type: string; player: boolean }[];
    labels: { local: string; global: string; player: string; none: string; more: string };
  };
}

/** Category toolbox: Favourites and Recently used first (when `personal` names them), then every block by category. */
export function toolbox(options: ToolboxOptions = {}): Blockly.utils.toolbox.ToolboxDefinition {
  const offered = (ids: string[]) => ids.map((id) => BLOCKS_BY_ID.get(id)!).filter((b) => !options.hidden?.(b)).map((b) => toolboxBlock(b));
  const personal = (name: string, empty: string, ids: string[]) => {
    const blocks = offered(ids);
    return { kind: "category", name, colour: "#e8a33c", contents: blocks.length ? blocks : [{ kind: "label", text: empty }] };
  };
  const p = options.personal;
  return {
    kind: "categoryToolbox",
    contents: [
      ...(p ? [personal(p.favourites, p.favouritesEmpty, favouriteBlocks()), personal(p.recent, p.recentEmpty, recentBlocks()), { kind: "sep" }] : []),
      ...CATEGORIES.map((category) => ({
        kind: "category",
        name: categoryLabel(category),
        colour: String(CATEGORY_HUES[category]),
        contents: [
          ...(category === "variables" && options.variables ? variableBlocks(options.variables, options.hidden) : []),
          ...BLOCKS.filter((b) => b.category === category && b.id !== "start" && !options.hidden?.(b)).map((b) => toolboxBlock(b)),
        ],
      })),
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}

/** Get, set and (numbers) change blocks of each variable with the variable already chosen, under headings; then a heading for the generic ones. */
function variableBlocks(vars: NonNullable<ToolboxOptions["variables"]>, hidden?: (def: BlockDef) => boolean): Blockly.utils.toolbox.FlyoutItemInfo[] {
  const ready = (prefix: string, type: string, name: string) =>
    [`${prefix}_${type}_get`, `${prefix}_${type}_set`, ...(type === "number" ? [`${prefix}_number_change`] : [])]
      .map((id) => BLOCKS_BY_ID.get(id)).filter((def): def is BlockDef => !!def && !hidden?.(def)).map((def) => toolboxBlock(def, { var: name }));
  const group = (label: string, blocks: Blockly.utils.toolbox.FlyoutItemInfo[]) => (blocks.length ? [{ kind: "label", text: label }, ...blocks] : []);
  const items = [
    ...group(vars.labels.local, vars.locals.flatMap((v) => ready("local", v.type, v.name))),
    ...group(vars.labels.player, vars.globals.filter((v) => v.player).flatMap((v) => ready("player", v.type, v.name))),
    ...group(vars.labels.global, vars.globals.filter((v) => !v.player).flatMap((v) => ready("global", v.type, v.name))),
  ] as Blockly.utils.toolbox.FlyoutItemInfo[];
  return [...(items.length ? items : [{ kind: "label", text: vars.labels.none }]), { kind: "label", text: vars.labels.more }] as Blockly.utils.toolbox.FlyoutItemInfo[];
}

// ---- favourites and recently used blocks: per user, kept in this app's local storage ----

const FAVOURITES_KEY = "mcedge.procedures.favourites";
const RECENT_KEY = "mcedge.procedures.recent";
const MAX_RECENT = 12;

function readIds(key: string): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && BLOCKS_BY_ID.has(id) && id !== "start") : [];
  } catch {
    return [];
  }
}
function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage unavailable: the lists last for this session only.
  }
}
export const favouriteBlocks = (): string[] => readIds(FAVOURITES_KEY);
export const recentBlocks = (): string[] => readIds(RECENT_KEY);
export const isFavourite = (id: string): boolean => favouriteBlocks().includes(id);
export function toggleFavourite(id: string): void {
  const list = favouriteBlocks();
  writeIds(FAVOURITES_KEY, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}
/** Puts a block first in Recently used; returns whether the list changed. */
export function noteUsed(id: string): boolean {
  if (!BLOCKS_BY_ID.has(id) || LITERALS.has(id) || id === "start") return false;
  const list = recentBlocks();
  if (list[0] === id) return false;
  writeIds(RECENT_KEY, [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT));
  return true;
}

/** The procedure a block's procedure dropdown names (run procedure blocks), if any. */
export function calledProcedure(block: Blockly.Block): string | undefined {
  for (const input of block.inputList) {
    for (const field of input.fieldRow) {
      if (field instanceof FieldChoice && field.choice === "procedure" && field.getValue()) return field.getValue() ?? undefined;
    }
  }
  return undefined;
}

/** A block as the toolbox offers it: literal inputs as editable shadows. */
export function toolboxBlock(def: BlockDef, fields?: Record<string, string>): Blockly.utils.toolbox.BlockInfo {
  const inputs: Record<string, unknown> = {};
  for (const input of def.inputs ?? []) {
    const shadow = literalShadow(input.type, input.default);
    if (shadow) inputs[input.name] = { shadow };
  }
  return { kind: "block", type: def.id, ...(fields ? { fields } : {}), ...(Object.keys(inputs).length ? { inputs } : {}) } as Blockly.utils.toolbox.BlockInfo;
}

/** Shadow block holding a literal for a number, text or logic input. */
export function literalShadow(type: string, value: unknown): Record<string, unknown> | undefined {
  if (type === "number") return { type: "math_number", fields: { value: typeof value === "number" ? value : Number(value) || 0 } };
  if (type === "text") return { type: "text", fields: { value: value === undefined ? "" : String(value) } };
  if (type === "logic") return { type: "logic_boolean", fields: { value: value === false || value === "false" ? "false" : "true" } };
  return undefined;
}

/**
 * Blocks whose label or id matches a search, for the search flyout. Ranked: an exact label first, then favourites, then
 * labels that start with the search (or a word of the label does), then other label matches, then id and category
 * matches; the library order breaks ties.
 */
export function searchBlocks(query: string, hidden?: (def: BlockDef) => boolean): Blockly.utils.toolbox.BlockInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const favourites = new Set(favouriteBlocks());
  const ranked: { def: BlockDef; rank: number[] }[] = [];
  for (const def of BLOCKS) {
    if (def.id === "start" || hidden?.(def)) continue;
    const label = blockLabel(def.id).toLowerCase();
    const text = `${label} ${def.id.replaceAll("_", " ")} ${categoryLabel(def.category)}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    const inLabel = words.every((w) => label.includes(w));
    const wordStart = inLabel && label.split(/\s+/).some((word) => word.startsWith(words[0]));
    ranked.push({ def, rank: [label === q ? 0 : 1, favourites.has(def.id) ? 0 : 1, label.startsWith(q) ? 0 : wordStart ? 1 : 2, inLabel ? 0 : 1, ranked.length] });
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    return 0;
  });
  return ranked.slice(0, 60).map((r) => toolboxBlock(r.def));
}

// ---- theme ----

/** Workbench colours for the Blockly chrome, read from the app's CSS tokens. */
export function workbenchTheme(name: "dark" | "light"): Blockly.Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (token: string) => css.getPropertyValue(token).trim();
  return Blockly.Theme.defineTheme(`mcedge-${name}`, {
    name: `mcedge-${name}`,
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: v("--slot"),
      toolboxBackgroundColour: v("--plank"),
      toolboxForegroundColour: v("--fg"),
      flyoutBackgroundColour: v("--surface"),
      flyoutForegroundColour: v("--fg"),
      flyoutOpacity: 0.97,
      scrollbarColour: v("--plank-2"),
      scrollbarOpacity: 0.9,
      insertionMarkerColour: v("--accent"),
      insertionMarkerOpacity: 0.4,
      cursorColour: v("--accent"),
      selectedGlowColour: v("--accent"),
    },
    fontStyle: { family: "'Trebuchet MS', 'Segoe UI', sans-serif", size: 11 },
    startHats: false,
  });
}

export { BLOCKS_BY_ID };
