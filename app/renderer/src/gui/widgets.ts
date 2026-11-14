import type { Element, FieldDef } from "../../../../src/elements/model.ts";
import { t, type StringKey } from "../strings.ts";
import { ANCHORS } from "../../../../src/elements/overlayLayout.ts";

/**
 * Widgets of a gui_layout value (docs/ELEMENT-TYPES.md "GUI widgets"), positions relative to the GUI's top left
 * corner. Sizes left out fall back to the generator's defaults (src/generator/types/gui.ts).
 */
export interface Widget {
  kind: WidgetKind;
  name?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  procedure?: string;
  textProcedure?: string;
  condition?: string;
  checked?: boolean;
  image?: string;
  /** image_button: hover state in its own PNG; without it `image` holds the normal state above the hover state. toggle_button: off, hover. */
  hoverImage?: string;
  /** toggle_button: the on state's textures, plain and under the mouse; `stateProcedure` says on or off. */
  onImage?: string;
  onHoverImage?: string;
  /** toggle_button: logic, on while true. state_image (KUYRUK 186): number, the state shown (`stateValue`: its index or a percentage). */
  stateProcedure?: string;
  /** state_image: its states, each a picture (a still frame of a strip with `frame`) with an optional condition. */
  states?: ImageState[];
  stateValue?: string;
  /** state_image: the state is read every N ticks (0 every frame); entering a state starts its animation from its first frame. */
  updateTicks?: number;
  restartAnimation?: boolean;
  /** Editor only: the state the canvas shows. */
  previewState?: number;
  id?: number;
  output?: boolean;
  limit?: string;
  locked?: boolean;
  lockCondition?: string;
  keepOnClose?: boolean;
  /** Editor only: the layer the widget is on (gui/layers.ts) and whether the canvas leaves it alone. */
  layer?: string;
  editLocked?: boolean;
  /** Editor only: the named group the widget belongs to; a group is selected, moved and copied as one. */
  group?: string;
  /** Editor only: not drawn on the canvas (a hidden group). */
  editHidden?: boolean;
  /** button: a click area that draws nothing (over a picture the GUI shows). */
  invisible?: boolean;
  /** label, button: text size, 1 = the normal font. */
  textScale?: number;
  /** image, label: drawing order, higher on top; above 0 over slots, items and buttons (KUYRUK 103). */
  z?: number;
  /** image: old flag for drawing over slots; counts as z 1 while `z` is unset. */
  overlay?: boolean;
  /** image: a strip of frames played without a .mcmeta, ticks per frame, and how many frames play (as generated). */
  animated?: boolean;
  frameTime?: number;
  frameCount?: number;
  /** Overlay label, image: the screen point it keeps its distance to (src/elements/overlayLayout.ts); unset: the overlay's. */
  anchor?: string;
  /** label (KUYRUK 182): a box behind the text, "#rrggbb", opacity 0-100 (default 50) and padding (default 1). */
  background?: string;
  backgroundOpacity?: number;
  backgroundPadding?: number;
  /** label (KUYRUK 183): x is the text's left edge (default), centre or right edge. */
  align?: string;
}

/** One state of a state_image (the generator's ImageState, src/generator/types/gui.ts). */
export interface ImageState {
  image?: string;
  frame?: number;
  condition?: string;
}

/** A state image's states (rows that are objects). */
export const imageStates = (w: Widget): ImageState[] => (Array.isArray(w.states) ? w.states.filter((s) => s && typeof s === "object") : []);

/** The state the canvas shows: the chosen preview state, kept inside the list (0 without one). */
export function previewStateOf(w: Widget): number {
  const n = imageStates(w).length, k = Math.round(Number(w.previewState));
  return n && Number.isFinite(k) ? Math.max(0, Math.min(n - 1, k)) : 0;
}

/** A label's background as CSS (the generator's rule, labelBackground in src/generator/types/gui.ts), or undefined. */
export function labelBackgroundCss(w: Widget): { color: string; padding: number } | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(w.background ?? "")) return undefined;
  const o = Number(w.backgroundOpacity), p = Math.round(Number(w.backgroundPadding));
  const alpha = Math.round((w.backgroundOpacity !== undefined && Number.isFinite(o) ? Math.max(0, Math.min(100, o)) : 50) * 2.55) / 255;
  const hex = w.background!.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { color: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`, padding: w.backgroundPadding !== undefined && Number.isFinite(p) ? Math.max(0, Math.min(8, p)) : 1 };
}

export const WIDGET_KINDS = ["label", "button", "image_button", "toggle_button", "text_field", "checkbox", "image", "state_image", "slot"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** Overlays draw labels and images (still or by state) only (src/generator/types/overlay.ts). */
export const OVERLAY_KINDS: WidgetKind[] = ["label", "image", "state_image"];

/** Overlay widgets sit on a 427x240 canvas, placed on the game screen by their anchors. */
export { OVERLAY_SIZE } from "../../../../src/elements/overlayLayout.ts";

/** Kinds whose width and height the user sets (and drags). */
export const SIZED: WidgetKind[] = ["button", "image_button", "toggle_button", "text_field", "image", "state_image"];

const DEFAULT_SIZE: Partial<Record<WidgetKind, { w: number; h: number }>> = {
  button: { w: 60, h: 20 }, text_field: { w: 120, h: 20 }, checkbox: { w: 20, h: 20 }, slot: { w: 18, h: 18 },
};

/** Minecraft's font: about 6 px per character and 9 px per line at GUI scale 1. */
export const textWidth = (text: string) => Math.max(6, [...text].length * 6);

/** Text size of a label or button: 1 unless 0.25 to 8 is set (the generator's rule, src/generator/types/gui.ts). */
export function textScaleOf(w: Widget): number {
  const s = Number(w.textScale);
  return w.textScale !== undefined && Number.isFinite(s) && s >= 0.25 && s <= 8 ? s : 1;
}

/** toggle_button: textures in state order (off, off hover, on, on hover), a missing one falling back to the nearest set (the generator's rule). */
/**
 * image_button: the hover state's own file, or "" for the old one-file layout (normal above hover), which a hover
 * texture naming the same file as the normal one also means (KUYRUK 167), as the generator reads it.
 */
export function hoverFile(w: Widget): string {
  return w.hoverImage && w.hoverImage !== w.image ? w.hoverImage : "";
}

export function toggleTextures(w: Widget): string[] {
  const off = w.image ?? "", on = w.onImage || off;
  return [off, w.hoverImage || off, on, w.onHoverImage || on];
}

/** Drawing order of an image or label: the generator's rule (zOf in src/generator/types/gui.ts). */
export function zOf(w: Widget): number {
  const z = Number(w.z);
  if (w.z !== undefined && w.z !== null && Number.isFinite(z)) return Math.max(-99, Math.min(99, Math.round(z)));
  return w.overlay === true ? 1 : 0;
}

/**
 * Widget indices in the order the generated screen draws them: slot frames, images with z <= 0, the game's own
 * widgets (buttons, fields, check boxes), labels with z <= 0, (slot items), then images and labels with z > 0.
 * Inside one step by z, then list order. Overlays have images and labels only, so they are simply by z.
 */
export function drawOrder(widgets: Widget[]): number[] {
  const key = (w: Widget) => {
    const z = zOf(w);
    if (w.kind === "slot") return -1000;
    const image = w.kind === "image" || w.kind === "state_image";
    if (!image && w.kind !== "label") return -300;
    if (z > 0) return z;
    return (image ? -600 : -200) + z;
  };
  return widgets.map((w, i) => ({ k: key(w), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.i);
}

/** Box of a widget in GUI pixels; images without a size use their PNG size. */
export function widgetBox(w: Widget, imageSize?: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const x = num(w.x), y = num(w.y);
  switch (w.kind) {
    case "label": {
      // Centred or right-aligned text stands around x (KUYRUK 183), as the generator draws it.
      const tw = Math.round(textWidth(w.text || (w.textProcedure ? t("gui.procText") : t("gui.kind.label"))) * textScaleOf(w));
      return { x: w.align === "center" ? x - Math.floor(tw / 2) : w.align === "right" ? x - tw : x, y, w: tw, h: Math.round(9 * textScaleOf(w)) };
    }
    case "checkbox":
      return { x, y, w: 24 + textWidth(w.text ?? ""), h: 20 };
    case "image":
      return { x, y, w: num(w.width, imageSize?.w ?? 16), h: num(w.height, imageSize?.h ?? 16) };
    default: {
      const size = DEFAULT_SIZE[w.kind] ?? { w: 16, h: 16 };
      return { x, y, w: num(w.width, size.w), h: num(w.height, size.h) };
    }
  }
}

export function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? Math.round(n) : fallback;
}

export const asWidgets = (value: unknown): Widget[] => (Array.isArray(value) ? value.filter((w) => w && typeof w === "object") as Widget[] : []);

/** A new widget of a kind, with the values a fresh widget needs to show and generate. */
export function newWidget(kind: WidgetKind, at: { x: number; y: number }, existing: Widget[], textures: string[]): Widget {
  switch (kind) {
    case "label":
      return { kind, x: at.x, y: at.y, text: t("gui.kind.label"), color: "" };
    case "button":
      return { kind, x: at.x, y: at.y, width: 60, height: 20, text: t("gui.kind.button"), procedure: "" };
    case "image_button":
      return { kind, x: at.x, y: at.y, width: 16, height: 16, image: textures[0] ?? "", hoverImage: textures[0] ?? "", procedure: "" };
    case "toggle_button":
      return { kind, x: at.x, y: at.y, width: 16, height: 16, image: textures[0] ?? "", hoverImage: "", onImage: "", onHoverImage: "", stateProcedure: "", procedure: "" };
    case "text_field":
      return { kind, x: at.x, y: at.y, width: 120, height: 20, text: "" };
    case "checkbox":
      return { kind, x: at.x, y: at.y, text: t("gui.kind.checkbox"), checked: false };
    case "image":
      return { kind, x: at.x, y: at.y, image: textures[0] ?? "" };
    case "state_image":
      return { kind, x: at.x, y: at.y, width: 16, height: 16, states: [{ image: textures[0] ?? "" }], stateProcedure: "" };
    case "slot": {
      const used = new Set(existing.filter((w) => w.kind === "slot").map((w) => num(w.id)));
      let id = 0;
      while (used.has(id)) id++;
      return { kind, x: at.x, y: at.y, id, output: false, limit: "" };
    }
  }
}

/**
 * Copies of widgets for a duplicate or paste, moved by dx, dy: slots get the next free ids (consecutive, in order),
 * names already used get a free `_2`, `_3` suffix (a name is a language key), and the editor lock is dropped so the copy can be
 * moved away.
 */
export function cloneWidgets(source: Widget[], existing: Widget[], dx: number, dy: number): Widget[] {
  const ids = new Set(existing.filter((w) => w.kind === "slot").map((w) => num(w.id)));
  const names = new Set(existing.map((w) => w.name).filter(Boolean));
  // A group copied into a GUI that has a group of that name becomes a new group.
  const groups = new Map<string, string>();
  const taken = [...existing];
  return source.map((w) => {
    const copy: Widget = { ...structuredClone(w), x: num(w.x) + dx, y: num(w.y) + dy };
    delete copy.editLocked;
    if (copy.kind === "slot") {
      let id = 0;
      while (ids.has(id)) id++;
      ids.add(id);
      copy.id = id;
    }
    if (copy.group) {
      if (!groups.has(copy.group)) {
        const group = existing.some((o) => o.group === copy.group) ? freeGroupName(taken, copy.group.replace(/ \d+$/, "")) : copy.group;
        groups.set(copy.group, group);
        taken.push({ ...copy, group });
      }
      copy.group = groups.get(copy.group);
    }
    if (copy.name && names.has(copy.name)) {
      const base = copy.name.replace(/_\d+$/, "");
      let n = 2;
      while (names.has(`${base}_${n}`)) n++;
      copy.name = `${base}_${n}`;
      names.add(copy.name);
    }
    return copy;
  });
}

/** Indices of the widgets in the same groups as `indices`, those first, in order and without repeats. */
export function withGroups(widgets: Widget[], indices: number[]): number[] {
  const groups = new Set(indices.map((i) => widgets[i]?.group).filter(Boolean));
  const out = [...indices];
  widgets.forEach((w, i) => w.group && groups.has(w.group) && !out.includes(i) && out.push(i));
  return out;
}

/** A group name not used yet: "<base> 1", "<base> 2", ... */
export function freeGroupName(widgets: Widget[], base: string): string {
  const used = new Set(widgets.map((w) => w.group));
  for (let n = 1; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * An N x M grid made from `base`: `base` stays the top left cell, the copies follow row by row `stepX`, `stepY`
 * apart. Every cell is put in `group`; slots number on from the base slot's id (skipping used ids), images and
 * buttons keep their texture.
 */
export function gridCells(base: Widget, existing: Widget[], rows: number, cols: number, stepX: number, stepY: number, group: string): Widget[] {
  const others = existing.filter((w) => w !== base);
  const first: Widget = { ...base, group };
  const cells: Widget[] = [first];
  const ids = new Set(others.filter((w) => w.kind === "slot").map((w) => num(w.id)));
  let id = num(base.id);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      // Cloned without the group (a clone of a group already in the GUI becomes a new group), then put in it.
      const [copy] = cloneWidgets([base], [...others, ...cells], c * stepX, r * stepY);
      copy.group = group;
      if (copy.kind === "slot") {
        do id++; while (ids.has(id));
        copy.id = id;
      }
      cells.push(copy);
    }
  }
  return cells;
}

/** Marks clipboard text written by the GUI editor, so a paste can tell widgets from other text. */
export const CLIPBOARD_TAG = "mcedge.guiWidgets";

/**
 * The change for one edited field of a widget. Picking a button's normal texture while its hover texture still is
 * the old normal one sets the hover texture too: `<name>_hover.png` when the project has it, else the
 * same texture. A hover texture the user chose on purpose is left alone.
 */
export function fieldChange(widget: Widget, key: string, value: unknown, textures: string[]): Partial<Widget> {
  if (widget.kind !== "image_button" || key !== "image" || typeof value !== "string") return { [key]: value };
  // An old one-file button (no hoverImage) keeps its stacked layout.
  const follows = widget.hoverImage !== undefined && widget.hoverImage === widget.image;
  if (!follows) return { [key]: value };
  const hover = value.replace(/\.png$/i, "_hover.png");
  return { image: value, hoverImage: textures.includes(hover) ? hover : value };
}

/** Form of the selected widget, rendered by the generic form engine. */
export function widgetFields(kind: WidgetKind, overlay: boolean): FieldDef[] {
  const f = (key: string, type: FieldDef["type"], label: StringKey, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, label: t(label), ...extra });
  const name = f("name", "text", "gui.field.name", { help: t("gui.field.nameHelp") });
  const pos = [f("x", "integer", "gui.field.x", { step: 1 }), f("y", "integer", "gui.field.y", { step: 1 })];
  const size = [f("width", "integer", "gui.field.width", { step: 1, min: 1 }), f("height", "integer", "gui.field.height", { step: 1, min: 1 })];
  const textScale = f("textScale", "number", "gui.field.textScale", { min: 0.25, max: 8, step: 0.25, help: t("gui.field.textScaleHelp") });
  const deps = { dependencies: ["x", "y", "z", "world", "entity"] };
  const condition = f("condition", "procedure", "gui.field.condition", { help: t("gui.field.conditionHelp"), ...deps });
  const z = f("z", "integer", "gui.field.z", { step: 1, min: -99, max: 99, help: t(overlay ? "gui.field.zHelpOverlay" : "gui.field.zHelp") });
  // Overlays only (KUYRUK 170): unset follows the overlay's anchor.
  const anchor = overlay ? [f("anchor", "select", "gui.field.anchor", { help: t("gui.field.anchorHelp"), default: "",
    options: [{ value: "", label: t("gui.anchor.overlay") }, ...ANCHORS.map((a) => ({ value: a, label: t(`gui.anchor.${a}`) }))] })] : [];
  switch (kind) {
    case "label":
      return [name, f("text", "text", "gui.field.text"), textScale, f("textProcedure", "procedure", "gui.field.textProcedure", { help: t("gui.field.textProcedureHelp"), ...deps }), condition,
        f("color", "color", "gui.field.color", { help: t(overlay ? "gui.field.colorHelpOverlay" : "gui.field.colorHelp") }),
        f("align", "select", "gui.field.align", { help: t("gui.field.alignHelp"), default: "left",
          options: (["left", "center", "right"] as const).map((a) => ({ value: a, label: t(`gui.align.text.${a}`) })) }),
        f("background", "color", "gui.field.background", { help: t("gui.field.backgroundHelp") }),
        f("backgroundOpacity", "integer", "gui.field.backgroundOpacity", { min: 0, max: 100, step: 5, help: t("gui.field.backgroundOpacityHelp") }),
        f("backgroundPadding", "integer", "gui.field.backgroundPadding", { min: 0, max: 8, step: 1, help: t("gui.field.backgroundPaddingHelp") }),
        ...pos, ...anchor, z];
    case "button":
      return [name, f("text", "text", "gui.field.text"), textScale, f("invisible", "boolean", "gui.field.invisible", { help: t("gui.field.invisibleHelp") }), ...pos, ...size,
        f("procedure", "procedure", "gui.field.procedure", { help: t("gui.field.procedureHelp"), ...deps }), condition];
    case "image_button":
      return [name, f("image", "texture", "gui.field.normalImage", { help: t("gui.field.imageButtonHelp") }),
        f("hoverImage", "texture", "gui.field.hoverImage", { help: t("gui.field.hoverImageHelp") }), ...pos, ...size,
        f("procedure", "procedure", "gui.field.procedure", { help: t("gui.field.procedureHelp"), ...deps }), condition];
    case "toggle_button":
      return [name, f("image", "texture", "gui.field.offImage", { help: t("gui.field.offImageHelp") }),
        f("hoverImage", "texture", "gui.field.offHoverImage", { help: t("gui.field.offHoverImageHelp") }),
        f("onImage", "texture", "gui.field.onImage", { help: t("gui.field.onImageHelp") }),
        f("onHoverImage", "texture", "gui.field.onHoverImage", { help: t("gui.field.onHoverImageHelp") }),
        f("stateProcedure", "procedure", "gui.field.stateProcedure", { help: t("gui.field.stateProcedureHelp"), ...deps }), ...pos, ...size,
        f("procedure", "procedure", "gui.field.procedure", { help: t("gui.field.toggleProcedureHelp"), ...deps }), condition];
    case "text_field":
      return [name, f("text", "text", "gui.field.hint"), ...pos, ...size];
    case "checkbox":
      return [name, f("text", "text", "gui.field.text"), f("checked", "boolean", "gui.field.checked"), ...pos];
    case "image":
      return [name, f("image", "texture", "gui.field.image"), ...pos, ...anchor, ...size.map((s) => ({ ...s, help: t("gui.field.imageSizeHelp") })), z, condition];
    case "state_image":
      // KUYRUK 186: the states, then what picks one (a number procedure, else the states' conditions) and when.
      return [name,
        f("states", "list", "gui.field.states", { help: t("gui.field.statesHelp"), minItems: 1, fields: [
          f("image", "texture", "gui.field.image"),
          f("frame", "integer", "gui.field.stateFrame", { min: 0, step: 1, help: t("gui.field.stateFrameHelp") }),
          f("condition", "procedure", "gui.field.stateCondition", { help: t("gui.field.stateConditionHelp"), ...deps }),
        ] }),
        f("stateProcedure", "procedure", "gui.field.stateNumber", { help: t("gui.field.stateNumberHelp"), ...deps }),
        f("stateValue", "select", "gui.field.stateValue", { help: t("gui.field.stateValueHelp"), default: "index",
          options: (["index", "percent"] as const).map((v) => ({ value: v, label: t(`gui.stateValue.${v}`) })) }),
        f("updateTicks", "integer", "gui.field.updateTicks", { min: 0, max: 1200, step: 1, help: t("gui.field.updateTicksHelp") }),
        f("restartAnimation", "boolean", "gui.field.restartAnimation", { help: t("gui.field.restartAnimationHelp") }),
        ...pos, ...anchor, ...size, z, condition];
    case "slot":
      return [f("id", "integer", "gui.field.slotId", { min: 0, step: 1, help: t("gui.field.slotIdHelp") }), ...pos,
        f("output", "boolean", "gui.field.output", { help: t("gui.field.outputHelp") }),
        f("limit", "item", "gui.field.limit", { help: t("gui.field.limitHelp") }),
        f("locked", "boolean", "gui.field.locked", { help: t("gui.field.lockedHelp") }),
        f("lockCondition", "procedure", "gui.field.lockCondition", { help: t("gui.field.lockConditionHelp"), ...deps }),
        f("keepOnClose", "boolean", "gui.field.keepOnClose", { help: t("gui.field.keepOnCloseHelp") })];
  }
}

/**
 * Fields every one of these widgets has (KUYRUK 180), to edit them together: the same key and type in each kind's
 * form, in the first one's order. The name, a slot's id and the position stay per widget.
 */
export function sharedFields(list: Widget[], overlay: boolean): FieldDef[] {
  const own = new Set(["name", "id", "x", "y"]);
  const [first = [], ...rest] = list.map((w) => widgetFields(w.kind, overlay));
  return first.filter((f) => !own.has(f.key) && rest.every((fields) => fields.some((g) => g.key === f.key && g.type === f.type)));
}

/** The value of `key` the widgets share, or `mixed` when they differ. */
export function sharedValue(list: Widget[], key: string): { value: unknown; mixed: boolean } {
  const values = list.map((w) => (w as unknown as Record<string, unknown>)[key]);
  const mixed = values.some((v) => JSON.stringify(v) !== JSON.stringify(values[0]));
  return { value: mixed ? undefined : values[0], mixed };
}

/** Grid settings of the element: gui uses snapOnGrid, overlay gridSnap. */
export interface Grid {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  snap: boolean;
  snapKey?: string;
}

export function gridOf(element: Element, fieldKeys: string[]): Grid {
  const snapKey = fieldKeys.find((k) => k === "snapOnGrid" || k === "gridSnap");
  return {
    sx: Math.max(1, num(element.gridSx, 18)), sy: Math.max(1, num(element.gridSy, 18)),
    ox: num(element.gridOx, 0), oy: num(element.gridOy, 0),
    snap: snapKey ? element[snapKey] === true : false, snapKey,
  };
}

export const snapX = (g: Grid, x: number) => (g.snap ? g.ox + Math.round((x - g.ox) / g.sx) * g.sx : Math.round(x));
export const snapY = (g: Grid, y: number) => (g.snap ? g.oy + Math.round((y - g.oy) / g.sy) * g.sy : Math.round(y));

/** Frames of the player inventory as the generated menu places them (18x18 frame = slot position - 1). */
export function inventoryFrames(width: number, height: number, offsetX: number, offsetY: number): { x: number; y: number }[] {
  const invX = Math.floor((width - 176) / 2) + 8 + offsetX, invY = height - 82 + offsetY;
  const frames: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) frames.push({ x: invX - 1 + col * 18, y: invY - 1 + row * 18 });
  for (let col = 0; col < 9; col++) frames.push({ x: invX - 1 + col * 18, y: invY + 57 });
  return frames;
}
