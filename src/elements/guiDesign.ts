/**
 * GUI design helpers for agents (Q272): widget boxes as the generated screen places them, text width in a
 * Minecraft-like pixel font (config/gui-font.json), a headless picture of a GUI or overlay drawn in the generated
 * screen's order, a design check, layout arrangement, and vanilla-style panel textures. Pure apart from the font file.
 */
import { OVERLAY_SIZE } from "./overlayLayout.ts";
import { glyph, textWidth } from "./pixelFont.ts";
import { applyImageFilter, imageFilterOf } from "../resources/imageFilter.ts";

export interface Pixels { width: number; height: number; data: Uint8Array }
export interface Box { x: number; y: number; w: number; h: number }
export type Widget = Record<string, unknown> & { kind: string; x: number; y: number };
type Rgb = [number, number, number];

const make = (width: number, height: number): Pixels => ({ width, height, data: new Uint8Array(width * height * 4) });
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const hexRgb = (hex: string, fallback: Rgb): Rgb => (/^#[0-9a-f]{6}$/i.test(hex) ? [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as Rgb : fallback);

// --- Font. ---

// The shared preview font (pixelFont.ts, Q276): the editor canvas measures and draws with it too.
export { textWidth };

// --- The GUI as the generated screen lays it out. ---

export interface Layout {
  kind: "gui" | "overlay";
  width: number;
  height: number;
  widgets: Widget[];
  /** Player inventory slot frames (27 + 9), GUIs with an inventory only. */
  inventory: Box[];
  panel: boolean;
}
/** A GUI or overlay element's layout (fields as stored in elements/gui|overlay/<id>.json). */
export function layoutOf(kind: "gui" | "overlay", e: Record<string, unknown>): Layout {
  const width = kind === "overlay" ? OVERLAY_SIZE.width : num(e.width, 176), height = kind === "overlay" ? OVERLAY_SIZE.height : num(e.height, 166);
  const inventory: Box[] = [];
  if (kind === "gui" && Number(e.type) === 1) {
    const ix = Math.floor((width - 176) / 2) + 7 + num(e.inventoryOffsetX, 0), iy = height - 83 + num(e.inventoryOffsetY, 0);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) inventory.push({ x: ix + col * 18, y: iy + row * 18, w: 18, h: 18 });
    for (let col = 0; col < 9; col++) inventory.push({ x: ix + col * 18, y: iy + 58, w: 18, h: 18 });
  }
  const widgets = (Array.isArray(e.components) ? e.components : []) as Widget[];
  return { kind, width, height, widgets, inventory, panel: kind === "gui" && e.renderBgLayer !== false };
}

const scaleOf = (w: Widget) => num(w.textScale, 1);
/** The box a widget covers, as the generated screen draws it; `imageSize` gives a project PNG's size. */
export function boxOf(w: Widget, imageSize: (path: string) => { width: number; height: number } | undefined): Box {
  const x = num(w.x, 0), y = num(w.y, 0);
  switch (w.kind) {
    case "slot": return { x, y, w: 18, h: 18 };
    case "button": return { x, y, w: num(w.width, 60), h: num(w.height, 20) };
    case "text_field": return { x, y, w: num(w.width, 120), h: num(w.height, 20) };
    case "checkbox": return { x, y, w: 21 + textWidth(str(w.text)), h: 17 };
    case "label": {
      const s = scaleOf(w), tw = Math.ceil(textWidth(str(w.text) || "[text]") * s), th = Math.ceil(8 * s);
      const left = w.align === "center" ? x - Math.floor(tw / 2) : w.align === "right" ? x - tw : x;
      return { x: left, y, w: tw, h: th };
    }
    default: {
      const first = str(w.image) || str((w.states as { image?: string }[] | undefined)?.[0]?.image);
      const size = first ? imageSize(first) : undefined;
      // An animation strip or the old two-state image button counts one frame.
      const frameH = size ? (size.height > size.width && size.height % size.width === 0 ? size.width : w.kind === "image_button" && !w.hoverImage ? size.height / 2 : size.height) : 16;
      return { x, y, w: num(w.width, size?.width ?? 16), h: num(w.height, frameH) };
    }
  }
}
const interactive = (w: Widget) => ["slot", "button", "image_button", "toggle_button", "text_field", "checkbox"].includes(w.kind);
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const label = (w: Widget, i: number) => `${i} ${w.kind}${w.name ? ` "${w.name}"` : ""}`;

// --- Drawing. ---

type Canvas = { image: Pixels; scale: number; ox: number; oy: number };
function rect(c: Canvas, b: Box, rgb: Rgb, alpha = 1) {
  const x0 = Math.round((c.ox + b.x) * c.scale), y0 = Math.round((c.oy + b.y) * c.scale);
  const x1 = Math.round((c.ox + b.x + b.w) * c.scale), y1 = Math.round((c.oy + b.y + b.h) * c.scale);
  for (let y = Math.max(0, y0); y < Math.min(c.image.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(c.image.width, x1); x++) {
    const o = (y * c.image.width + x) * 4, d = c.image.data;
    for (let k = 0; k < 3; k++) d[o + k] = Math.round(d[o + k] * (1 - alpha) + rgb[k] * alpha);
    d[o + 3] = 255;
  }
}
/** Text at GUI position x, y (top of the glyph cell) in GUI pixels times `size`. */
function text(c: Canvas, s: string, x: number, y: number, rgb: Rgb, size = 1, shadow = false) {
  if (shadow) text(c, s, x + size, y + size, rgb.map((v) => Math.floor(v / 4)) as Rgb, size);
  let pen = x;
  for (const ch of s) {
    const rows = glyph(ch);
    rows.forEach((row, ry) => [...row].forEach((p, rx) => { if (p === "#") rect(c, { x: pen + rx * size, y: y + ry * size, w: size, h: size }, rgb); }));
    pen += (rows[0].length + 1) * size;
  }
}
function bevel(c: Canvas, b: Box, fill: Rgb, light: Rgb, dark: Rgb) {
  rect(c, b, fill);
  rect(c, { x: b.x, y: b.y, w: b.w - 1, h: 1 }, light);
  rect(c, { x: b.x, y: b.y, w: 1, h: b.h - 1 }, light);
  rect(c, { x: b.x + 1, y: b.y + b.h - 1, w: b.w - 1, h: 1 }, dark);
  rect(c, { x: b.x + b.w - 1, y: b.y + 1, w: 1, h: b.h - 1 }, dark);
}
/** A slot frame as the generated screen draws it. */
const slotFrame = (c: Canvas, b: Box) => bevel(c, b, [139, 139, 139], [55, 55, 55], [255, 255, 255]);
function picture(c: Canvas, src: Pixels, b: Box, sourceH: number) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const sx = Math.min(src.width - 1, Math.floor((x * src.width) / b.w)), sy = Math.min(sourceH - 1, Math.floor((y * sourceH) / b.h));
    const o = (sy * src.width + sx) * 4, a = src.data[o + 3] / 255;
    if (a > 0) rect(c, { x: b.x + x, y: b.y + y, w: 1, h: 1 }, [src.data[o], src.data[o + 1], src.data[o + 2]], a);
  }
}

export interface PreviewOptions { scale?: number; numbers?: boolean; highlight?: (string | number)[] }
/**
 * The layout drawn in the generated screen's order: panel, slot frames (own and the player inventory), images at
 * z <= 0, buttons, text fields, checkboxes, labels, then images and labels with z > 0. Text uses the preview font;
 * images are the project PNGs (first frame, first state). `numbers` tags every widget with its index.
 */
export function preview(layout: Layout, loadImage: (path: string) => Pixels | undefined, options: PreviewOptions = {}): Pixels {
  const margin = layout.kind === "gui" ? 8 : 0;
  const scale = options.scale ?? (layout.kind === "gui" ? 3 : 2);
  const c: Canvas = { image: make((layout.width + margin * 2) * scale, (layout.height + margin * 2) * scale), scale, ox: margin, oy: margin };
  const size = (p: string) => loadImage(p);
  rect(c, { x: -margin, y: -margin, w: layout.width + margin * 2, h: layout.height + margin * 2 }, layout.kind === "gui" ? [30, 30, 34] : [92, 122, 150]);
  if (layout.kind === "overlay") {
    // The game's HUD as a guide: hotbar, health and hunger rows, crosshair.
    const hx = Math.floor((layout.width - 182) / 2);
    rect(c, { x: hx, y: layout.height - 22, w: 182, h: 22 }, [20, 20, 20], 0.6);
    rect(c, { x: hx, y: layout.height - 39, w: 81, h: 9 }, [170, 30, 30], 0.5);
    rect(c, { x: hx + 101, y: layout.height - 39, w: 81, h: 9 }, [150, 100, 40], 0.5);
    rect(c, { x: Math.floor(layout.width / 2) - 4, y: Math.floor(layout.height / 2), w: 9, h: 1 }, [255, 255, 255], 0.8);
    rect(c, { x: Math.floor(layout.width / 2), y: Math.floor(layout.height / 2) - 4, w: 1, h: 9 }, [255, 255, 255], 0.8);
  }
  if (layout.panel) {
    rect(c, { x: 0, y: 0, w: layout.width, h: layout.height }, [198, 198, 198]);
    rect(c, { x: 0, y: 0, w: layout.width - 1, h: 1 }, [255, 255, 255]);
    rect(c, { x: 0, y: 0, w: 1, h: layout.height - 1 }, [255, 255, 255]);
    rect(c, { x: 1, y: layout.height - 1, w: layout.width - 1, h: 1 }, [85, 85, 85]);
    rect(c, { x: layout.width - 1, y: 1, w: 1, h: layout.height - 1 }, [85, 85, 85]);
  }
  const items = layout.widgets.map((w, i) => ({ w, i, box: boxOf(w, size) }));
  for (const b of layout.inventory) slotFrame(c, b);
  for (const { w, box } of items) if (w.kind === "slot") slotFrame(c, box);
  const drawImage = (w: Widget, box: Box) => {
    const states = w.states as { image?: string; frame?: number }[] | undefined;
    const state = states?.[num(w.previewState, 0)] ?? states?.[0];
    const path = str(w.image) || str(state?.image);
    const src = path ? loadImage(path) : undefined;
    if (!src) return rect(c, box, [255, 0, 255], 0.5);
    const strip = src.height > src.width && src.height % src.width === 0;
    const frameH = strip ? src.width : w.kind === "image_button" && !w.hoverImage ? src.height / 2 : src.height;
    const frame = state?.frame ?? 0;
    // Q273: the opacity and tint the generator bakes into the texture, on visible pixels only.
    const filter = imageFilterOf({ opacity: w.opacity, tint: w.tint, tintStrength: w.tintStrength });
    const data = src.data.slice(frame * frameH * src.width * 4);
    if (filter) applyImageFilter(data, filter);
    picture(c, { width: src.width, height: src.height, data }, box, frameH);
  };
  const zOf = (w: Widget) => num(w.z, 0);
  for (const { w, box } of items) if ((w.kind === "image" || w.kind === "state_image") && zOf(w) <= 0) drawImage(w, box);
  for (const { w, box } of items) {
    if (w.kind === "button" && w.invisible !== true) {
      rect(c, box, [0, 0, 0]);
      bevel(c, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, [111, 111, 111], [170, 170, 170], [72, 72, 72]);
      const s = scaleOf(w), t = str(w.text);
      text(c, t, box.x + (box.w - textWidth(t) * s) / 2, box.y + (box.h - 8 * s) / 2 + s, [255, 255, 255], s, true);
    } else if (w.kind === "image_button" || w.kind === "toggle_button") drawImage(w, box);
    else if (w.kind === "text_field") {
      rect(c, box, [160, 160, 160]);
      rect(c, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, [0, 0, 0]);
      // The hint in dark grey with a shadow, as the 1.21+ EditBox draws it (Q276).
      text(c, str(w.text), box.x + 4, box.y + Math.floor((box.h - 8) / 2), [85, 85, 85], 1, true);
    } else if (w.kind === "checkbox") {
      // 1.21+: a 17 x 17 box, the text 4 pixels to its right, centred on the box (Q276).
      const square = { x: box.x, y: box.y, w: 17, h: 17 };
      rect(c, square, [160, 160, 160]);
      rect(c, { x: square.x + 1, y: square.y + 1, w: 15, h: 15 }, [40, 40, 40]);
      if (w.checked === true) text(c, "x", square.x + 6, square.y + 4, [255, 255, 255]);
      text(c, str(w.text), box.x + 21, box.y + 4, [224, 224, 224], 1, true);
    }
  }
  const drawLabel = (w: Widget, box: Box) => {
    const s = scaleOf(w), t = str(w.text) || (w.textProcedure ? `[${str(w.textProcedure)}]` : "[text]");
    if (str(w.background)) {
      const pad = num(w.backgroundPadding, 1);
      rect(c, { x: box.x - pad * s, y: box.y - pad * s, w: box.w + pad * 2 * s, h: box.h + pad * 2 * s }, hexRgb(str(w.background), [0, 0, 0]), num(w.backgroundOpacity, 50) / 100);
    }
    text(c, t, box.x, box.y, hexRgb(str(w.color), [64, 64, 64]), s);
  };
  for (const { w, box } of items) if (w.kind === "label" && zOf(w) <= 0) drawLabel(w, box);
  for (const { w, box } of items) if (zOf(w) > 0) w.kind === "label" ? drawLabel(w, box) : drawImage(w, box);
  const marked = new Set((options.highlight ?? []).map(String));
  for (const { w, i, box } of items) {
    if (marked.has(String(i)) || marked.has(str(w.name))) {
      for (const edge of [{ x: box.x - 1, y: box.y - 1, w: box.w + 2, h: 1 }, { x: box.x - 1, y: box.y + box.h, w: box.w + 2, h: 1 }, { x: box.x - 1, y: box.y, w: 1, h: box.h }, { x: box.x + box.w, y: box.y, w: 1, h: box.h }]) rect(c, edge, [255, 40, 200]);
    }
    if (options.numbers) {
      const tag = String(i);
      rect(c, { x: box.x, y: box.y, w: textWidth(tag) + 1, h: 9 }, [0, 0, 0], 0.75);
      text(c, tag, box.x + 1, box.y + 1, [255, 230, 0]);
    }
  }
  return c.image;
}

// --- Check. ---

export interface Finding { kind: string; message: string; widgets?: number[] }
const VANILLA_PANEL: Rgb = [198, 198, 198];
const lum = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Design problems of a layout: outside the canvas, overlaps, text too wide, near-misses of alignment, slot spacing, margins, contrast, the game HUD. */
export function check(layout: Layout, imageSize: (path: string) => { width: number; height: number } | undefined): Finding[] {
  const out: Finding[] = [];
  const items = layout.widgets.map((w, i) => ({ w, i, box: boxOf(w, imageSize) }));
  for (const { w, i, box } of items) {
    if (box.x < 0 || box.y < 0 || box.x + box.w > layout.width || box.y + box.h > layout.height) out.push({ kind: "outside", message: `${label(w, i)} (${box.x},${box.y} ${box.w}x${box.h}) reaches outside the ${layout.width}x${layout.height} canvas`, widgets: [i] });
  }
  // Clickable things on top of each other, or on the player inventory.
  const clickable = items.filter((x) => interactive(x.w));
  for (let a = 0; a < clickable.length; a++) for (let b = a + 1; b < clickable.length; b++) {
    if (overlaps(clickable[a].box, clickable[b].box)) out.push({ kind: "overlap", message: `${label(clickable[a].w, clickable[a].i)} overlaps ${label(clickable[b].w, clickable[b].i)}`, widgets: [clickable[a].i, clickable[b].i] });
  }
  for (const { w, i, box } of items) {
    if (layout.inventory.some((s) => overlaps(s, box)) && w.kind !== "image" && w.kind !== "state_image") out.push({ kind: "overlaps_inventory", message: `${label(w, i)} lies on the player inventory`, widgets: [i] });
  }
  // Text that does not fit.
  for (const { w, i, box } of items) {
    if (w.kind === "button" && str(w.text) && textWidth(str(w.text)) * scaleOf(w) > box.w - 6) out.push({ kind: "text_too_wide", message: `${label(w, i)}: "${str(w.text)}" is ${textWidth(str(w.text))} px wide, the button ${box.w} (keep 3 px each side)`, widgets: [i] });
    if (w.kind === "label") {
      const hit = clickable.find((x) => overlaps(x.box, box) && x.i !== i);
      if (hit) out.push({ kind: "text_overlap", message: `${label(w, i)} runs into ${label(hit.w, hit.i)} (text ${box.w} px wide)`, widgets: [i, hit.i] });
      if (!str(w.background) && layout.panel) {
        const contrast = Math.abs(lum(hexRgb(str(w.color), [64, 64, 64])) - lum(VANILLA_PANEL));
        if (contrast < 0.35) out.push({ kind: "low_contrast", message: `${label(w, i)}: colour ${str(w.color) || "#404040"} is hard to read on the grey panel; vanilla labels use #404040`, widgets: [i] });
      }
    }
    if (w.kind === "button" && !str(w.text) && w.invisible !== true) out.push({ kind: "empty_button", message: `${label(w, i)} has no text`, widgets: [i] });
  }
  // Alignment near-misses: edges or centres 1-2 px apart look like mistakes.
  const near: string[] = [];
  const nearIds = new Set<number>();
  // Only pairs where the edge is visible: left, right and centre of widgets in one column (x ranges overlap), top and
  // bottom of widgets in one row (y ranges overlap); a pair centred on each other on that axis is aligned on purpose.
  const column = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;
  const row = (a: Box, b: Box) => a.y < b.y + b.h && b.y < a.y + a.h;
  const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;
  const keys: [string, (b: Box) => number, (a: Box, b: Box) => boolean][] = [
    ["left", (b) => b.x, (a, b) => column(a, b) && Math.abs(cx(a) - cx(b)) > 1],
    ["right", (b) => b.x + b.w, (a, b) => column(a, b) && Math.abs(cx(a) - cx(b)) > 1],
    ["centre", cx, column],
    ["top", (b) => b.y, (a, b) => row(a, b) && Math.abs(cy(a) - cy(b)) > 1],
    ["bottom", (b) => b.y + b.h, (a, b) => row(a, b) && Math.abs(cy(a) - cy(b)) > 1],
  ];
  // A label anchors at its align point, so its centre only counts when it is centred.
  const centred = (w: Widget) => w.kind !== "label" || w.align === "center";
  for (const [name, f, visible] of keys) for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const A = items[a].box, B = items[b].box;
    if (name === "centre" && !(centred(items[a].w) && centred(items[b].w))) continue;
    const d = Math.abs(f(A) - f(B));
    if (d > 0 && d <= 2 && visible(A, B) && near.length < 12) (near.push(`${name} of ${items[a].i} and ${items[b].i} differ by ${d}`), nearIds.add(items[a].i), nearIds.add(items[b].i));
  }
  if (near.length) out.push({ kind: "almost_aligned", message: `edges 1-2 px apart: ${near.join("; ")}; align them (arrange_gui_widgets align) or move them clearly apart`, widgets: [...nearIds] });
  // Slots in a row or column on the 18 px pitch.
  const slots = items.filter((x) => x.w.kind === "slot");
  const pitch: string[] = [];
  for (const [axis, other] of [["x", "y"], ["y", "x"]] as const) {
    const lines = new Map<number, number[]>();
    for (const s of slots) lines.set(s.box[other], [...(lines.get(s.box[other]) ?? []), s.box[axis]]);
    for (const [at, values] of lines) {
      const sorted = values.sort((p, q) => p - q);
      for (let k = 1; k < sorted.length; k++) {
        const gap = sorted[k] - sorted[k - 1];
        if (gap > 18 && gap < 22) pitch.push(`${axis === "x" ? "row" : "column"} ${other}=${at}: ${gap} px between slots (vanilla rows touch at 18)`);
      }
    }
  }
  if (pitch.length) out.push({ kind: "slot_pitch", message: pitch.slice(0, 8).join("; ") });
  if (layout.panel) {
    const tight = items.filter(({ box }) => box.x >= 0 && box.y >= 0 && (box.x < 4 || box.y < 4 || layout.width - (box.x + box.w) < 4 || layout.height - (box.y + box.h) < 4));
    if (tight.length) out.push({ kind: "tight_margin", message: `closer than 4 px to the panel edge: ${tight.map((t) => label(t.w, t.i)).join(", ")} (vanilla keeps 7-8 px)`, widgets: tight.map((t) => t.i) });
  }
  if (layout.kind === "overlay") {
    const hx = Math.floor((layout.width - 182) / 2);
    const hud: Box = { x: hx, y: layout.height - 40, w: 182, h: 40 };
    const under = items.filter(({ box }) => overlaps(box, hud));
    if (under.length) out.push({ kind: "under_hud", message: `over the game's hotbar, health and hunger area: ${under.map((u) => label(u.w, u.i)).join(", ")}`, widgets: under.map((u) => u.i) });
  }
  return out;
}

// --- Arranging. ---

export type Arrange =
  | { action: "slot_grid"; x: number; y: number; rows: number; columns: number; firstId?: number; spacing?: number }
  | { action: "align"; widgets: (number | string)[]; to: "left" | "right" | "top" | "bottom" | "center_x" | "center_y" }
  | { action: "distribute"; widgets: (number | string)[]; axis: "x" | "y"; gap?: number }
  | { action: "center"; widgets: (number | string)[]; axis: "x" | "y" | "both" }
  | { action: "move"; widgets: (number | string)[]; dx?: number; dy?: number };

/** Applies the steps in order to a copy of the widgets; widgets are picked by index or name. */
export function arrange(layout: Layout, steps: Arrange[], imageSize: (path: string) => { width: number; height: number } | undefined): Widget[] {
  const widgets = layout.widgets.map((w) => ({ ...w }));
  const pick = (refs: (number | string)[]) => refs.map((r) => {
    const i = typeof r === "number" ? r : widgets.findIndex((w) => w.name === r);
    if (i < 0 || i >= widgets.length) throw new Error(`no widget ${JSON.stringify(r)}`);
    return i;
  });
  const box = (i: number) => boxOf(widgets[i], imageSize);
  // Moving a widget moves its box; a centred or right-aligned label keeps its anchor offset.
  const shift = (i: number, dx: number, dy: number) => { widgets[i].x = num(widgets[i].x, 0) + Math.round(dx); widgets[i].y = num(widgets[i].y, 0) + Math.round(dy); };
  for (const step of steps) {
    if (step.action === "slot_grid") {
      const spacing = step.spacing ?? 18;
      let id = step.firstId ?? widgets.filter((w) => w.kind === "slot").reduce((n, w) => Math.max(n, num(w.id, 0) + 1), 0);
      for (let r = 0; r < step.rows; r++) for (let col = 0; col < step.columns; col++) widgets.push({ kind: "slot", id: id++, x: step.x + col * spacing, y: step.y + r * spacing });
      continue;
    }
    const ids = pick(step.widgets);
    const boxes = ids.map(box);
    if (step.action === "move") ids.forEach((i) => shift(i, step.dx ?? 0, step.dy ?? 0));
    else if (step.action === "align") {
      const target = step.to === "left" ? Math.min(...boxes.map((b) => b.x)) : step.to === "right" ? Math.max(...boxes.map((b) => b.x + b.w))
        : step.to === "top" ? Math.min(...boxes.map((b) => b.y)) : step.to === "bottom" ? Math.max(...boxes.map((b) => b.y + b.h))
        : step.to === "center_x" ? boxes[0].x + boxes[0].w / 2 : boxes[0].y + boxes[0].h / 2;
      ids.forEach((i, k) => {
        const b = boxes[k];
        if (step.to === "left") shift(i, target - b.x, 0);
        else if (step.to === "right") shift(i, target - (b.x + b.w), 0);
        else if (step.to === "top") shift(i, 0, target - b.y);
        else if (step.to === "bottom") shift(i, 0, target - (b.y + b.h));
        else if (step.to === "center_x") shift(i, target - (b.x + b.w / 2), 0);
        else shift(i, 0, target - (b.y + b.h / 2));
      });
    } else if (step.action === "distribute") {
      const horizontal = step.axis === "x";
      const order = ids.map((i, k) => ({ i, b: boxes[k] })).sort((p, q) => (horizontal ? p.b.x - q.b.x : p.b.y - q.b.y));
      const start = (b: Box) => (horizontal ? b.x : b.y), len = (b: Box) => (horizontal ? b.w : b.h);
      const first = order[0].b, last = order[order.length - 1].b;
      const total = order.reduce((n, o) => n + len(o.b), 0);
      const gap = step.gap ?? (order.length > 1 ? (start(last) + len(last) - start(first) - total) / (order.length - 1) : 0);
      let pen = start(first);
      for (const o of order) {
        const d = Math.round(pen) - start(o.b);
        shift(o.i, horizontal ? d : 0, horizontal ? 0 : d);
        pen += len(o.b) + gap;
      }
    } else {
      const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w));
      const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
      const dx = step.axis === "y" ? 0 : Math.round((layout.width - (right - left)) / 2) - left;
      const dy = step.axis === "x" ? 0 : Math.round((layout.height - (bottom - top)) / 2) - top;
      ids.forEach((i) => shift(i, dx, dy));
    }
  }
  return widgets;
}

// --- Panel textures. ---

export type PanelStyle = "vanilla" | "inset" | "dark" | "slot";
/**
 * A panel PNG in the vanilla look: "vanilla" the grey container panel with rounded dark outline and bevel, "inset" a
 * recessed box (progress bar or text area frame), "dark" a dark panel with the same bevel, "slot" one slot frame
 * stretched to the size.
 */
export function panel(width: number, height: number, style: PanelStyle): Pixels {
  const image = make(width, height);
  const c: Canvas = { image, scale: 1, ox: 0, oy: 0 };
  const all = { x: 0, y: 0, w: width, h: height };
  if (style === "slot") return (slotFrame(c, all), image);
  if (style === "inset") return (bevel(c, all, [139, 139, 139], [55, 55, 55], [255, 255, 255]), image);
  const [fill, light, dark]: Rgb[] = style === "dark" ? [[49, 49, 54], [95, 95, 102], [24, 24, 27]] : [[198, 198, 198], [255, 255, 255], [85, 85, 85]];
  // Black outline with cut corners, then a 2 px bevel inside it.
  rect(c, { x: 1, y: 0, w: width - 2, h: height }, [0, 0, 0]);
  rect(c, { x: 0, y: 1, w: width, h: height - 2 }, [0, 0, 0]);
  rect(c, { x: 1, y: 1, w: width - 2, h: height - 2 }, fill);
  rect(c, { x: 1, y: 1, w: width - 3, h: 2 }, light);
  rect(c, { x: 1, y: 1, w: 2, h: height - 3 }, light);
  rect(c, { x: 2, y: height - 3, w: width - 3, h: 2 }, dark);
  rect(c, { x: width - 3, y: 2, w: 2, h: height - 3 }, dark);
  // The bevel corners: the light and dark meet with the fill colour, like vanilla's container texture.
  rect(c, { x: width - 3, y: 1, w: 1, h: 1 }, fill);
  rect(c, { x: 1, y: height - 3, w: 1, h: 1 }, fill);
  for (const [x, y] of [[1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2]]) image.data.set([0, 0, 0, 255], (y * width + x) * 4);
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) image.data.set([0, 0, 0, 0], (y * width + x) * 4);
  return image;
}
