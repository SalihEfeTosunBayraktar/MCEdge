/**
 * Bubble elements (Q216): a bubble is designed like a small overlay, in bubble pixels. The bubble is `width` x `height`
 * pixels, its bottom middle sits above the player's head (or name tag), and 32 pixels are 0.6 blocks at scale 1. Its
 * parts are a background (the built-in speech bubble, or a project image stretched or drawn as a 9-slice), an icon
 * (centred above the tail, or at a free position) and a caption above the bubble.
 *
 * Pure values shared by the generator (src/generator/bubbles.ts writes them into assets/<modid>/bubbles.json, which one
 * Java renderer draws) and the editor's live preview, so both place every part the same way.
 */

import { timingOf, type Timing } from "./transitions.ts";

/** Blocks per bubble pixel at scale 1: the 32 pixel built-in bubble is 0.6 blocks high, as before Q216. */
export const BUBBLE_PIXEL_BLOCKS = 0.6 / 32;
/** Bubble pixels per font pixel of a caption at caption scale 1: name-tag sized text (0.025 blocks) at scale 1. */
export const CAPTION_PIXELS = 0.025 / BUBBLE_PIXEL_BLOCKS;
/**
 * Lift of a bubble's bottom over the player's height, in blocks, shared by the game renderer and the editor preview. A
 * name tag is drawn from NAME_TAG_ATTACH over the height down, its dim box reaching NAME_TAG_PAD (one font pixel) above
 * that, so with a tag the bubble's bottom sits on the top of the tag box (Q217 had 0.47 for the built-in bubble, whose
 * 32 pixel image has an empty strip under its tail; a framed bubble that fills its height then overlapped the tag, Q223).
 */
export const NAME_TAG_ATTACH = 0.5;
export const NAME_TAG_PAD = 0.025;
export const OVER_NAME = NAME_TAG_ATTACH + NAME_TAG_PAD;
/** Lift without a name tag: just over the head. */
export const OVER_HEAD = 0.05;
/** Placeholder in a bubble's caption replaced by the caption a procedure passes. */
export const CAPTION_PLACEHOLDER = "{text}";
/** Id of the bubble the old icon blocks show; a bubble element with this id replaces the built-in one. */
export const DEFAULT_BUBBLE = "default";

/** The look of the built-in bubble (the Q206 speech bubble): every field a bubble element has, at its built-in value. */
export const BUILT_IN_BUBBLE: Readonly<Record<string, unknown>> = {
  background: "", backgroundMode: "plain", sliceBorder: 4,
  icon: "", iconSize: 20, layout: "center", iconX: 6, iconY: 3,
  caption: "", captionColor: "#ffffff", captionShadow: false, captionScale: 1,
  width: 32, height: 32, padding: 3, tail: 6, scale: 1, offset: 0,
  appear: [], appearTicks: 5, appearEasing: "back", disappear: [], disappearTicks: 5, disappearEasing: "back", duration: 0, sound: "",
};

type Values = object;
const get = (o: Values, key: string): unknown => (o as Record<string, unknown>)[key] ?? BUILT_IN_BUBBLE[key];
/** A whole number from a value, else the built-in one, kept within min..max. */
function whole(o: Values, key: string, min: number, max: number): number {
  const n = Math.round(Number(get(o, key)));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : Number(BUILT_IN_BUBBLE[key])));
}
function decimal(o: Values, key: string, min: number, max: number): number {
  const n = Number(get(o, key));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : Number(BUILT_IN_BUBBLE[key])));
}

export interface BubbleLayout {
  width: number;
  height: number;
  iconX: number;
  iconY: number;
  iconSize: number;
  /** Border of a 9-slice background in pixels (of the image and of the bubble), 0: the image is stretched. */
  slice: number;
  captionScale: number;
  scale: number;
  offset: number;
  /** Show / hide timing (Q228): appear and disappear transitions and the active time (`duration`). */
  timing: Timing;
}

/**
 * Where a bubble's parts go. "center" puts the icon in the middle of the bubble across, and in the middle of the space
 * between `padding` at the top and `tail` + `padding` at the bottom; "free" uses iconX, iconY.
 */
export function bubbleLayout(bubble: Values): BubbleLayout {
  const width = whole(bubble, "width", 8, 256), height = whole(bubble, "height", 8, 256);
  const iconSize = whole(bubble, "iconSize", 0, 256);
  const padding = whole(bubble, "padding", 0, 64), tail = whole(bubble, "tail", 0, 64);
  const free = get(bubble, "layout") === "free";
  return {
    width, height, iconSize,
    iconX: free ? whole(bubble, "iconX", -256, 256) : Math.round((width - iconSize) / 2),
    iconY: free ? whole(bubble, "iconY", -256, 256) : padding + Math.round((height - tail - 2 * padding - iconSize) / 2),
    slice: get(bubble, "backgroundMode") === "nine_slice" ? whole(bubble, "sliceBorder", 1, 64) : 0,
    captionScale: decimal(bubble, "captionScale", 0.25, 4),
    scale: decimal(bubble, "scale", 0.1, 8),
    offset: decimal(bubble, "offset", -2, 4),
    timing: timingOf(bubble, "duration"),
  };
}

/**
 * The caption shown: a bubble's own caption with {text} replaced by the one a procedure passes; without {text}, a
 * passed caption replaces the bubble's own.
 */
export function bubbleCaption(own: string, passed: string): string {
  if (own.includes(CAPTION_PLACEHOLDER)) return own.replaceAll(CAPTION_PLACEHOLDER, passed);
  return passed || own;
}

/** "#rrggbb" as a number, white when not a colour. */
export const bubbleColor = (value: unknown): number => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? parseInt(value.slice(1), 16) : 0xffffff);

/** The built-in speech bubble background: 32x32 RGBA, a white body with rounded corners, a dark outline and a tail. */
export function speechBubble(): { width: number; height: number; data: Uint8Array } {
  const size = 32, bodyBottom = 25;
  const data = new Uint8Array(size * size * 4);
  const inBody = (x: number, y: number) => {
    if (x < 1 || x > size - 2 || y < 0 || y > bodyBottom) return false;
    const cx = Math.min(Math.max(x, 4), size - 5), cy = Math.min(Math.max(y, 3), bodyBottom - 3);
    return (x - cx) ** 2 + (y - cy) ** 2 <= 9.5;
  };
  // Tail: a triangle under the body's middle, 7 pixels wide narrowing to 1.
  const inTail = (x: number, y: number) => y > bodyBottom && y <= bodyBottom + 4 && Math.abs(x - 15.5) <= 3.5 - (y - bodyBottom);
  const inside = (x: number, y: number) => inBody(x, y) || inTail(x, y);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy) && !(dy === -1 && inTail(x, y) && inBody(x, y - 1)) && !(dy === 1 && inBody(x, y) && inTail(x, y + 1)));
      data.set(edge ? [48, 48, 48, 255] : [250, 250, 250, 235], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}
