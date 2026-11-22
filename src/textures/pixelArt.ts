/**
 * Pixel art helpers for the MCP texture tools (Q271): palettes and shading ramps, palette snapping, flood fill,
 * dithered gradients, outlines, animation frame edits, atlas packing and slicing, an enlarged preview and a quality
 * check. Pure: images are RGBA rows, 4 bytes per pixel; edits change the image passed in unless they say otherwise.
 */
import type { Image, Rect } from "./edit.ts";

export type Color = [number, number, number, number];
export type Point = [number, number];

/** An image this module creates: always plain bytes, so it can be written as a PNG directly. */
export type Bytes = Image & { data: Uint8Array };
const make = (width: number, height: number): Bytes => ({ width, height, data: new Uint8Array(width * height * 4) });
const at = (image: Image, x: number, y: number) => (y * image.width + x) * 4;
export const colorAt = (image: Image, x: number, y: number): Color => [...image.data.subarray(at(image, x, y), at(image, x, y) + 4)] as Color;
const put = (image: Image, x: number, y: number, c: Color) => image.data.set(c[3] === 0 ? [0, 0, 0, 0] : c, at(image, x, y));
const same = (a: Color, b: Color) => (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
const inside = (image: Image, x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height;
const whole = (image: Image): Rect => ({ x: 0, y: 0, w: image.width, h: image.height });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const toHex = (c: Color) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export function parseHex(color: string): Color {
  if (color === "transparent") return [0, 0, 0, 0];
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!m) throw new Error(`bad colour "${color}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

/** Perceived colour distance ("redmean"), 0 for equal colours, about 765 for black against white. */
export function distance(a: Color, b: Color): number {
  const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}
/** Relative luminance 0..1. */
export const luminance = (c: Color) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

function toHsl([r, g, b]: Color): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number, a = 255): Color {
  const k = (n: number) => (n + h / 30) % 12, q = s * Math.min(l, 1 - l);
  const f = (n: number) => l - q * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), a];
}
/** Moves hue `h` towards `target` by up to `by` degrees, the short way round. */
function hueTowards(h: number, target: number, by: number): number {
  const diff = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), by) + 360) % 360;
}

/** Colours of the opaque (alpha > 0) pixels in `rect`, most used first. */
export function paletteOf(image: Image, rect = whole(image)): { color: string; count: number }[] {
  const counts = new Map<string, number>();
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const c = colorAt(image, x, y);
    if (c[3] > 0) counts.set(toHex(c), (counts.get(toHex(c)) ?? 0) + 1);
  }
  return [...counts].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

/**
 * A shading ramp of `steps` colours around `base`, darkest first. Lightness spreads by `contrast` (0..1); shadows turn
 * their hue towards blue and highlights towards yellow by up to `hueShift` degrees, the way pixel artists hue-shift
 * instead of only darkening; the darkest and lightest steps lose a little saturation.
 */
export function ramp(base: Color, steps: number, hueShift = 20, contrast = 0.6): Color[] {
  const [h, s, l] = toHsl(base);
  const mid = (steps - 1) / 2;
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 0 : (i - mid) / mid; // -1 darkest .. 1 lightest
    const light = clamp(l + t * contrast * 0.5, 0.04, 0.96);
    const hue = t < 0 ? hueTowards(h, 240, -t * hueShift) : hueTowards(h, 60, t * hueShift);
    const sat = clamp(s * (1 - 0.25 * Math.abs(t) ** 2) + (t < 0 ? 0.08 * -t : 0), 0, 1);
    return fromHsl(hue, s === 0 ? 0 : sat, light, base[3]);
  });
}

// Ordered (Bayer 4x4) dithering thresholds, 0..1.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Every opaque pixel in `rect` takes its nearest palette colour (keeping its alpha); ordered dithering mixes the two nearest. */
export function snapToPalette(image: Image, palette: Color[], dither = false, rect = whole(image)): number {
  if (!palette.length) throw new Error("the palette is empty");
  let changed = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const c = colorAt(image, x, y);
    if (c[3] === 0) continue;
    const ranked = palette.map((p) => ({ p, d: distance(c, p) })).sort((a, b) => a.d - b.d);
    let pick = ranked[0].p;
    if (dither && ranked.length > 1 && ranked[0].d > 0) {
      // The share of the second colour grows as the pixel lies closer to it.
      const share = ranked[0].d / (ranked[0].d + ranked[1].d);
      if (bayer(x, y) < share) pick = ranked[1].p;
    }
    const out: Color = [pick[0], pick[1], pick[2], c[3]];
    if (!same(out, c)) (put(image, x, y, out), changed++);
  }
  return changed;
}

/** Flood fill from x,y (4-connected, or 8 with diagonal) or, with contiguous false, every pixel of that colour. */
export function fill(image: Image, x: number, y: number, color: Color, contiguous = true, diagonal = false, rect = whole(image)): number {
  const inRect = (px: number, py: number) => px >= rect.x && py >= rect.y && px < rect.x + rect.w && py < rect.y + rect.h;
  if (!inRect(x, y)) throw new Error(`pixel ${x},${y} outside the area`);
  const target = colorAt(image, x, y);
  if (same(target, color)) return 0;
  let count = 0;
  if (!contiguous) {
    for (let py = rect.y; py < rect.y + rect.h; py++) for (let px = rect.x; px < rect.x + rect.w; px++) if (same(colorAt(image, px, py), target)) (put(image, px, py, color), count++);
    return count;
  }
  const steps: Point[] = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const stack: Point[] = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop()!;
    if (!inRect(px, py) || !same(colorAt(image, px, py), target)) continue;
    put(image, px, py, color);
    count++;
    for (const [dx, dy] of steps) stack.push([px + dx, py + dy]);
  }
  return count;
}

export type GradientDirection = "horizontal" | "vertical" | "diagonal" | "diagonal_up" | "radial";
/**
 * A gradient over `rect` through the colour stops (first to last); "dither" mixes neighbouring stops with an ordered
 * pattern instead of hard bands. mask "opaque" paints only pixels that are already drawn (to shade a shape) and keeps
 * their alpha.
 */
export function gradient(image: Image, rect: Rect, stops: Color[], direction: GradientDirection, dither: boolean, mask: "all" | "opaque"): number {
  if (stops.length < 2) throw new Error("a gradient needs at least two colours");
  let count = 0;
  const span = (v: number, size: number) => (size <= 1 ? 0 : v / (size - 1));
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const c = colorAt(image, x, y);
    if (mask === "opaque" && c[3] === 0) continue;
    const u = span(x - rect.x, rect.w), v = span(y - rect.y, rect.h);
    const t = direction === "horizontal" ? u : direction === "vertical" ? v : direction === "diagonal" ? (u + v) / 2
      : direction === "diagonal_up" ? (u + 1 - v) / 2 : clamp(Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2, 0, 1);
    const pos = t * (stops.length - 1), low = Math.floor(pos), frac = pos - low;
    const index = dither ? (frac > bayer(x, y) ? Math.min(low + 1, stops.length - 1) : low) : Math.round(pos);
    const s = stops[index];
    put(image, x, y, mask === "opaque" ? [s[0], s[1], s[2], c[3]] : s);
    count++;
  }
  return count;
}

/** A darker, hue-shifted shade of `c` for selective outlines. */
export const shadeOf = (c: Color): Color => ramp([c[0], c[1], c[2], 255], 5, 25, 0.9)[0];

/**
 * Outline around the drawn (opaque) pixels in `rect`: "outer" paints the transparent pixels touching them, "inner"
 * repaints the drawn pixels on their edge. Without a colour each outline pixel takes a dark shade of the drawn pixel
 * next to it (selective outline); shades too close to tell apart are merged.
 */
export function outline(image: Image, mode: "outer" | "inner", color: Color | undefined, diagonal = false, rect = whole(image)): number {
  const steps: Point[] = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const opaque = (x: number, y: number) => inside(image, x, y) && image.data[at(image, x, y) + 3] > 0;
  const paint: { x: number; y: number; c: Color }[] = [];
  // Shades that would be too close to tell apart share one colour, so the outline adds few colours.
  const used: Color[] = [];
  const shade = (c: Color): Color => {
    const s = shadeOf(c);
    const near = used.find((u) => distance(u, s) < 40);
    return near ?? (used.push(s), s);
  };
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const self = opaque(x, y);
    if (mode === "outer" ? self : !self) continue;
    // Outer: a drawn neighbour; inner: a transparent neighbour or the image edge.
    const hit = steps.find(([dx, dy]) => (mode === "outer" ? opaque(x + dx, y + dy) : !opaque(x + dx, y + dy)));
    if (!hit) continue;
    const source = mode === "outer" ? colorAt(image, x + hit[0], y + hit[1]) : colorAt(image, x, y);
    paint.push({ x, y, c: color ?? shade(source) });
  }
  for (const p of paint) put(image, p.x, p.y, p.c);
  return paint.length;
}

// --- Animation strips: square frames stacked top to bottom. ---

export function frameCount(image: Image): number {
  if (image.height % image.width !== 0) throw new Error(`${image.width}x${image.height} is not a strip of square frames`);
  return image.height / image.width;
}
export const frameRect = (image: Image, frame: number): Rect => {
  const n = frameCount(image);
  if (frame < 0 || frame >= n) throw new Error(`frame ${frame} outside 0..${n - 1}`);
  return { x: 0, y: frame * image.width, w: image.width, h: image.width };
};

export type FrameAction = { action: "add"; index: number } | { action: "duplicate"; index: number } | { action: "delete"; index: number } | { action: "move"; index: number; to: number };
/**
 * Adds a blank frame before `index` (index = count appends), duplicates a frame after itself, deletes or moves one.
 * Returns the new strip and, for every old frame index, its new index (undefined when deleted).
 */
export function editFrames(image: Image, edit: FrameAction): { image: Bytes; remap: (number | undefined)[] } {
  const n = frameCount(image), size = image.width * image.width * 4;
  const frames = Array.from({ length: n }, (_, i) => ({ old: i as number | undefined, data: image.data.slice(i * size, (i + 1) * size) }));
  const check = (i: number, max = n - 1) => { if (i < 0 || i > max) throw new Error(`frame ${i} outside 0..${max}`); };
  if (edit.action === "add") (check(edit.index, n), frames.splice(edit.index, 0, { old: undefined, data: new Uint8Array(size) }));
  else if (edit.action === "duplicate") (check(edit.index), frames.splice(edit.index + 1, 0, { old: undefined, data: frames[edit.index].data.slice() }));
  else if (edit.action === "delete") {
    check(edit.index);
    if (n === 1) throw new Error("the only frame cannot be deleted");
    frames.splice(edit.index, 1);
  } else (check(edit.index), check(edit.to), frames.splice(edit.to, 0, ...frames.splice(edit.index, 1)));
  const out = make(image.width, image.width * frames.length);
  frames.forEach((f, i) => out.data.set(f.data, i * size));
  const remap = Array.from({ length: n }, (_, i) => { const j = frames.findIndex((f) => f.old === i); return j < 0 ? undefined : j; });
  return { image: out, remap };
}

// --- Atlases. ---

/**
 * Shelf packing, tallest first: every piece gets a rectangle on one sheet, `padding` pixels apart. Several sheet widths
 * are tried and the smallest sheet wins (on a tie the squarer, then the wider one).
 */
export function pack(pieces: { name: string; image: Image }[], padding = 0, powerOfTwo = false, maxWidth = 512): { sheet: Bytes; rects: Record<string, Rect> } {
  if (!pieces.length) throw new Error("nothing to pack");
  const widest = Math.max(...pieces.map((p) => p.image.width));
  if (widest > maxWidth) throw new Error(`a piece is wider than ${maxWidth}`);
  const order = [...pieces].sort((a, b) => b.image.height - a.image.height || b.image.width - a.image.width);
  const layout = (width: number) => {
    const rects: Record<string, Rect> = {};
    let x = 0, y = 0, shelf = 0;
    for (const p of order) {
      if (x > 0 && x + p.image.width > width) (y += shelf + padding, x = 0, shelf = 0);
      rects[p.name] = { x, y, w: p.image.width, h: p.image.height };
      x += p.image.width + padding;
      shelf = Math.max(shelf, p.image.height);
    }
    let w = Math.max(...Object.values(rects).map((r) => r.x + r.w)), h = y + shelf;
    if (powerOfTwo) (w = 2 ** Math.ceil(Math.log2(w)), h = 2 ** Math.ceil(Math.log2(h)));
    return { rects, w, h };
  };
  // Candidate widths: each point where a shelf could end, so every distinct row split is tried.
  const ends = order.map((_, i) => order.slice(0, i + 1).reduce((s, p) => s + p.image.width + padding, -padding));
  const candidates = [...new Set([widest, ...ends])].filter((w) => w >= widest && w <= maxWidth);
  const best = candidates.map(layout).sort((a, b) => a.w * a.h - b.w * b.h || Math.max(a.w, a.h) - Math.max(b.w, b.h) || b.w - a.w)[0];
  const sheet = make(best.w, best.h);
  for (const p of pieces) {
    const r = best.rects[p.name];
    for (let row = 0; row < r.h; row++) sheet.data.set(p.image.data.subarray(row * r.w * 4, (row + 1) * r.w * 4), at(sheet, r.x, r.y + row));
  }
  return { sheet, rects: best.rects };
}

/** Cuts `rect` out as its own image. */
export function crop(image: Image, r: Rect): Bytes {
  const out = make(r.w, r.h);
  for (let row = 0; row < r.h; row++) out.data.set(image.data.subarray(at(image, r.x, r.y + row), at(image, r.x, r.y + row) + r.w * 4), row * r.w * 4);
  return out;
}
export const isEmpty = (image: Image) => !image.data.some((v, i) => i % 4 === 3 && v > 0);

// --- Preview. ---

export interface PreviewOptions { scale?: number; grid?: boolean; tile?: boolean; frames?: boolean }
/**
 * The picture enlarged without blurring on a checkerboard (so transparency shows), for an agent to look at: a pixel
 * grid when the scale allows it, 3x3 tiling to show seams, and an animation strip laid out side by side.
 */
export function preview(image: Image, options: PreviewOptions = {}): { image: Bytes; scale: number; layout: string } {
  let animated = false;
  try { animated = !!options.frames && frameCount(image) > 1; } catch { animated = false; }
  // The source laid out: frames side by side with a 1 pixel gap, then tiled 3x3.
  const cells = animated ? Array.from({ length: frameCount(image) }, (_, i) => crop(image, frameRect(image, i))) : [image];
  const cw = cells[0].width, ch = cells[0].height, rep = options.tile ? 3 : 1;
  const gap = animated ? 1 : 0;
  const lw = cells.length * cw * rep + (cells.length - 1) * gap, lh = ch * rep;
  const scale = options.scale ?? clamp(Math.floor(512 / Math.max(lw, lh)), 1, 32);
  const out = make(lw * scale, lh * scale);
  const gridOn = (options.grid ?? scale >= 8) && scale >= 4;
  for (let Y = 0; Y < out.height; Y++) for (let X = 0; X < out.width; X++) {
    const lx = Math.floor(X / scale), ly = Math.floor(Y / scale);
    const cell = Math.floor(lx / (cw * rep + gap)), within = lx - cell * (cw * rep + gap);
    const o = (Y * out.width + X) * 4;
    if (within >= cw * rep) { out.data.set([40, 40, 48, 255], o); continue; } // gap between frames
    const src = cells[cell], sx = within % cw, sy = ly % ch;
    const c = colorAt(src, sx, sy);
    const check = ((Math.floor(X / 8) + Math.floor(Y / 8)) & 1) ? 204 : 160;
    const a = c[3] / 255;
    let px: Color = [c[0] * a + check * (1 - a), c[1] * a + check * (1 - a), c[2] * a + check * (1 - a), 255];
    if (gridOn && (X % scale === 0 || Y % scale === 0)) px = [px[0] * 0.75, px[1] * 0.75, px[2] * 0.75, 255];
    // Tile borders in the 3x3 view, so the agent sees where the copies meet.
    if (rep > 1 && ((X % (cw * scale) === 0 && within % cw === 0) || (Y % (ch * scale) === 0)) && (X > 0 || Y > 0)) px = [px[0] * 0.55 + 115, px[1] * 0.55, px[2] * 0.55, 255];
    out.data.set(px.map(Math.round), o);
  }
  const layout = `${animated ? `${cells.length} frames side by side (frame 0 left)` : "the texture"}${rep > 1 ? ", each tiled 3x3 (red lines: tile edges)" : ""}`;
  return { image: out, scale, layout };
}

// --- Quality check. ---

export interface Issue { kind: string; message: string; at?: Point[] }
export interface CheckOptions { maxColors?: number; tileable?: boolean }
const LIMIT = 12;

/**
 * Common pixel art mistakes in one frame: too many colours, colours too close to tell apart, stray single pixels,
 * doubled corners in thin lines, pillow shading, low contrast, half-transparent pixels and, for tiling textures,
 * seams. Positions are frame coordinates (at most a few per kind).
 */
export function check(image: Image, options: CheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const { width: w, height: h } = image;
  const palette = paletteOf(image);
  const maxColors = options.maxColors ?? (w * h <= 256 ? 16 : w * h <= 1024 ? 24 : 32);
  if (palette.length > maxColors) issues.push({ kind: "too_many_colours", message: `${palette.length} colours (aim for ${maxColors} or fewer; reuse ramps instead of new shades, snap_texture_to_palette helps)` });
  const colors = palette.map((p) => parseHex(p.color));
  const close: string[] = [];
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    if (distance(colors[i], colors[j]) < 24 && close.length < LIMIT) close.push(`${palette[i].color}/${palette[j].color}`);
  }
  if (close.length) issues.push({ kind: "near_duplicate_colours", message: `colours too close to read as different shades: ${close.join(", ")}; merge them or spread the ramp` });

  const opaque = (x: number, y: number) => inside(image, x, y) && image.data[at(image, x, y) + 3] > 0;
  const eq = (x: number, y: number, c: Color) => inside(image, x, y) && same(colorAt(image, x, y), c);
  const N8: Point[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const orphans: Point[] = [], doubles: Point[] = [], partial: Point[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!opaque(x, y)) continue;
    const c = colorAt(image, x, y);
    if (c[3] < 255) partial.push([x, y]);
    const sameN = N8.filter(([dx, dy]) => eq(x + dx, y + dy, c));
    // A lone pixel whose colour no neighbour shares, inside a drawn area (noise, not a deliberate highlight on an edge).
    if (!sameN.length && N8.every(([dx, dy]) => opaque(x + dx, y + dy))) orphans.push([x, y]);
    // A corner of a thin line: one horizontal and one vertical same-colour neighbour (an L), the 2x2 block they span
    // not filled, so the line would still connect diagonally without this pixel.
    const ortho = sameN.filter((p) => p[0] === 0 || p[1] === 0);
    if (ortho.length === 2) {
      const [a, b] = ortho;
      if (a[0] !== b[0] && a[1] !== b[1] && !eq(x + a[0] + b[0], y + a[1] + b[1], c)) doubles.push([x, y]);
    }
  }
  if (orphans.length) issues.push({ kind: "stray_pixels", message: `${orphans.length} single pixels no neighbour shares; group colours into clusters of 2+ pixels`, at: orphans.slice(0, LIMIT) });
  if (doubles.length) issues.push({ kind: "doubled_corners", message: `${doubles.length} L-shaped corners in 1 pixel lines make them look jagged; remove the corner pixel (pixel-perfect line)`, at: doubles.slice(0, LIMIT) });
  if (partial.length) issues.push({ kind: "half_transparent", message: `${partial.length} half-transparent pixels; Minecraft draws items and cutout blocks fully opaque or fully clear, so these look different in game`, at: partial.slice(0, LIMIT) });

  // Shading: brightness against distance from the shape's edge (pillow) and against the top-left light direction.
  const samples: { lum: number; edge: number; light: number }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!opaque(x, y)) continue;
    let edge = 0;
    while (edge < Math.max(w, h) && N8.every(([dx, dy]) => opaque(x + dx * (edge + 1), y + dy * (edge + 1)))) edge++;
    samples.push({ lum: luminance(colorAt(image, x, y)), edge, light: -(x / w + y / h) });
  }
  if (samples.length >= 16) {
    const corr = (k: "edge" | "light") => {
      const n = samples.length, ma = samples.reduce((s, p) => s + p.lum, 0) / n, mb = samples.reduce((s, p) => s + p[k], 0) / n;
      let sab = 0, saa = 0, sbb = 0;
      for (const p of samples) (sab += (p.lum - ma) * (p[k] - mb), saa += (p.lum - ma) ** 2, sbb += (p[k] - mb) ** 2);
      return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    };
    const pillow = corr("edge"), light = corr("light");
    if (pillow > 0.55 && light < 0.25) issues.push({ kind: "pillow_shading", message: `brightness follows the outline (${pillow.toFixed(2)}) rather than a light direction (${light.toFixed(2)}): light one side (Minecraft: top left) and shade the opposite side` });
    const lums = samples.map((s) => s.lum);
    const range = Math.max(...lums) - Math.min(...lums);
    if (range < 0.25) issues.push({ kind: "low_contrast", message: `brightness range ${range.toFixed(2)} of 1; the form will read flat, widen the ramp (darker shadows, brighter highlights)` });
  }

  if (options.tileable) {
    // Colour jump across the wrap edge against the average jump between neighbouring columns/rows inside.
    const jump = (ax: number, ay: number, bx: number, by: number) => distance(colorAt(image, ax, ay), colorAt(image, bx, by));
    const avg = (f: (i: number) => number, n: number) => Array.from({ length: n }, (_, i) => f(i)).reduce((s, v) => s + v, 0) / n;
    const inner = avg((i) => avg((y) => jump(i, y, i + 1, y), h), w - 1);
    const seamX = avg((y) => jump(w - 1, y, 0, y), h), seamY = avg((x) => jump(x, h - 1, x, 0), w);
    const seams = [seamX > inner * 1.8 + 8 ? `left/right edge (${seamX.toFixed(0)} against ${inner.toFixed(0)} inside)` : "", seamY > inner * 1.8 + 8 ? `top/bottom edge (${seamY.toFixed(0)} against ${inner.toFixed(0)} inside)` : ""].filter(Boolean);
    if (seams.length) issues.push({ kind: "tiling_seam", message: `visible seam when tiled: ${seams.join("; ")}; check with preview_texture tile: true` });
  }
  return issues;
}
