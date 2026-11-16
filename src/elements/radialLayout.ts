/**
 * Radial menus (Q227): a wheel of slices on tabs, opened by a key and chosen by the mouse's direction from the middle.
 * Slices are numbered clockwise from the top. A slice's shape is one white image of the top slice (RADIAL_IMAGE pixels
 * square, the whole wheel's box) turned to each slice and tinted with the slice, hover or disabled colour; icons sit on
 * the ring's middle line, the hovered slice's label (or the menu's title) in the hole.
 *
 * Pure values shared by the generator (src/generator/radial.ts draws the images and writes assets/<modid>/radial_menus.json,
 * which one Java screen draws) and the editor's live preview, so both place every part the same way.
 */

import { timingOf, type Timing, type Transition } from "./transitions.ts";

/** Pixels of a slice image (square, the wheel's box). */
export const RADIAL_IMAGE = 256;
/** Ticks a runtime image bubble shows when its block or slice passes a duration below 0. */
export const RUNTIME_IMAGE_TICKS = 100;

/** The opening transition of a menu without one set (Q228; the old default animation was pop over 4 ticks). */
export const RADIAL_APPEAR: Transition = { effects: ["scale"], ticks: 4, easing: "back" };
/** A wheel closes at once: the menu has no disappear transition. */
const RADIAL_DISAPPEAR: Transition = { effects: [], ticks: 4, easing: "linear" };

/** Every menu-level field at its default value (type.json). */
export const BUILT_IN_RADIAL: Readonly<Record<string, unknown>> = {
  openKey: "R", openMode: "hold", keyName: "", size: 160, hole: 35, gap: 3,
  sliceColor: "#1e1e1e", sliceOpacity: 80, hoverColor: "#3d7eff", disabledColor: "#555555", sliceImageSize: 28, backgroundPadding: 8,
  title: "", textColor: "#ffffff", appear: ["scale"], appearTicks: 4, appearEasing: "back",
};

type Values = object;
const get = (o: Values, key: string): unknown => (o as Record<string, unknown>)[key] ?? BUILT_IN_RADIAL[key];
function whole(o: Values, key: string, min: number, max: number): number {
  const n = Math.round(Number(get(o, key)));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : Number(BUILT_IN_RADIAL[key])));
}

/** "#rrggbb" as a number, `fallback` when not a colour. */
export const radialColor = (value: unknown, fallback: number): number => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? parseInt(value.slice(1), 16) : fallback);

export interface RadialLayout {
  /** Wheel diameter in GUI pixels. */
  size: number;
  /** Hole radius as a part of the wheel's radius, 0..0.8. */
  hole: number;
  /** Image pixels between two slices. */
  gap: number;
  /** ARGB colours of a slice: normal, under the mouse, disabled (all at the slice opacity). */
  slice: number;
  hover: number;
  disabled: number;
  text: number;
  /** The opening transition (Q228): only `appear` is used, the wheel closes at once. */
  timing: Timing;
  /** Icon size in GUI pixels: most of the ring's width. */
  iconSize: number;
  sliceImageSize: number;
  padding: number;
}

export function radialLayout(menu: Values): RadialLayout {
  const size = whole(menu, "size", 80, 320);
  const hole = whole(menu, "hole", 0, 80) / 100;
  const alpha = Math.round((whole(menu, "sliceOpacity", 0, 100) * 255) / 100) * 0x1000000;
  const ringWidth = (size / 2) * (1 - hole);
  return {
    size, hole, gap: whole(menu, "gap", 0, 16),
    slice: alpha + radialColor(get(menu, "sliceColor"), 0x1e1e1e), hover: alpha + radialColor(get(menu, "hoverColor"), 0x3d7eff),
    disabled: alpha + radialColor(get(menu, "disabledColor"), 0x555555), text: radialColor(get(menu, "textColor"), 0xffffff),
    timing: timingOf(menu, "", { appear: RADIAL_APPEAR, disappear: RADIAL_DISAPPEAR }),
    iconSize: Math.max(8, Math.min(32, Math.round(ringWidth * 0.6))),
    sliceImageSize: whole(menu, "sliceImageSize", 4, 128), padding: whole(menu, "backgroundPadding", 0, 64),
  };
}

/** Angle of the middle of slice i of n, radians clockwise from the top. */
export const sliceAngle = (i: number, n: number) => (2 * Math.PI * i) / n;

/** The slice in direction dx, dy (y down) from the wheel's middle: -1 within `dead` of the middle or without slices. */
export function sliceAt(dx: number, dy: number, n: number, dead: number): number {
  if (n < 1 || Math.hypot(dx, dy) < dead) return -1;
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor((angle + Math.PI / n) / ((2 * Math.PI) / n)) % n;
}

/** Distance from the middle within which no slice is under the mouse: half the hole, so a slice is picked by direction. */
export const deadZone = (size: number, hole: number) => (size / 2) * hole * 0.5;

/** Middle of slice i of n's icon, from the wheel's middle: on the middle line of the ring. */
export function sliceCenter(i: number, n: number, size: number, hole: number): { x: number; y: number } {
  const r = ((size / 2) * (1 + hole)) / 2;
  const a = sliceAngle(i, n);
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/** How much of image pixel (px, py) the top slice of n covers, 0..1, from 4x4 samples. */
function coverage(px: number, py: number, n: number, hole: number, gap: number): number {
  const outer = RADIAL_IMAGE / 2 - 1, inner = outer * hole, step = (2 * Math.PI) / n;
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const dx = px + (sx + 0.5) / 4 - RADIAL_IMAGE / 2, dy = py + (sy + 0.5) / 4 - RADIAL_IMAGE / 2;
      const r = Math.hypot(dx, dy);
      if (r > outer || r < inner || sliceAt(dx, dy, n, 0) !== 0) continue;
      // Pixels to the slice's nearest edge: the separator between slices.
      const local = (Math.atan2(dx, -dy) + 2 * Math.PI + step / 2) % step;
      if (n > 1 && Math.min(local, step - local) * r < gap / 2) continue;
      hits++;
    }
  }
  return hits / 16;
}

/** The top slice of n as a white RGBA image (rows), the shape every slice of a wheel of n is drawn with. */
export function sectorImage(n: number, hole: number, gap: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(RADIAL_IMAGE * RADIAL_IMAGE * 4);
  for (let y = 0; y < RADIAL_IMAGE; y++) {
    for (let x = 0; x < RADIAL_IMAGE; x++) {
      const c = coverage(x, y, n, hole, gap);
      if (!c) continue;
      const o = (y * RADIAL_IMAGE + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * c);
    }
  }
  return { width: RADIAL_IMAGE, height: RADIAL_IMAGE, data };
}
