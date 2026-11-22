/**
 * Region and colour edits of the texture editor and the MCP texture tools (KUYRUK 133): copy, paste and clear a
 * rectangle, resize the canvas without scaling (the picture keeps its pixels, anchored to a side or the centre), shift
 * the hue and take out colour. Pure: images are RGBA rows, 4 bytes per pixel; edits return a new image.
 */

export interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the old picture sits on a resized canvas. */
export type Anchor = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
export const ANCHORS: Anchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

const make = (width: number, height: number): Image => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

/** The rectangle `r` clipped to the image; w or h 0 when nothing of it is inside. */
export function clip(image: { width: number; height: number }, r: Rect): Rect {
  const x = Math.max(0, Math.min(image.width, Math.round(r.x))), y = Math.max(0, Math.min(image.height, Math.round(r.y)));
  const x2 = Math.max(x, Math.min(image.width, Math.round(r.x + r.w))), y2 = Math.max(y, Math.min(image.height, Math.round(r.y + r.h)));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** A copy of the pixels in `r` (clipped to the image). */
export function copyRegion(image: Image, r: Rect): Image {
  const c = clip(image, r);
  const out = make(c.w, c.h);
  for (let y = 0; y < c.h; y++) out.data.set(image.data.subarray(((c.y + y) * image.width + c.x) * 4, ((c.y + y) * image.width + c.x + c.w) * 4), y * c.w * 4);
  return out;
}

/** The image with `r` made transparent. */
export function clearRegion(image: Image, r: Rect): Image {
  const out = { ...image, data: new Uint8ClampedArray(image.data) };
  const c = clip(image, r);
  for (let y = c.y; y < c.y + c.h; y++) out.data.fill(0, (y * image.width + c.x) * 4, (y * image.width + c.x + c.w) * 4);
  return out;
}

/**
 * The image with `piece` drawn at x, y (parts outside are cut off). With `replace` its pixels replace what is there,
 * transparent ones included (a moved selection); otherwise transparent pixels of the piece leave the image showing.
 */
export function pasteRegion(image: Image, piece: Image, x: number, y: number, replace = true): Image {
  const out = { ...image, data: new Uint8ClampedArray(image.data) };
  for (let py = 0; py < piece.height; py++) for (let px = 0; px < piece.width; px++) {
    const tx = x + px, ty = y + py;
    if (tx < 0 || ty < 0 || tx >= image.width || ty >= image.height) continue;
    const s = (py * piece.width + px) * 4;
    if (!replace && piece.data[s + 3] === 0) continue;
    out.data.set(piece.data.subarray(s, s + 4), (ty * image.width + tx) * 4);
  }
  return out;
}

/** The canvas at a new size; the picture keeps its pixels and sits at `anchor`, new space is transparent. */
export function resizeCanvas(image: Image, width: number, height: number, anchor: Anchor = "top-left"): Image {
  const [h, v] = anchorParts(anchor);
  const x = h === "left" ? 0 : h === "right" ? width - image.width : Math.floor((width - image.width) / 2);
  const y = v === "top" ? 0 : v === "bottom" ? height - image.height : Math.floor((height - image.height) / 2);
  return pasteRegion(make(width, height), image, x, y);
}

/** Smallest rectangle holding every visible pixel of all `images` (one size, e.g. the frames of a strip); undefined when all are empty. */
export function contentBounds(images: Image[]): Rect | undefined {
  let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
  for (const image of images) {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
    }
  }
  return x2 < 0 ? undefined : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/**
 * Q274: the box "trim to the drawing" cuts every frame to: the content bounds of all frames, so frames stay aligned.
 * `square` (frames of an animated strip, which must stay square) grows it to a square around the drawing, kept inside
 * the canvas. Undefined when the images are empty.
 */
export function trimBox(images: Image[], square = false): Rect | undefined {
  const b = contentBounds(images);
  if (!b || !square) return b;
  const { width, height } = images[0];
  const side = Math.min(Math.max(b.w, b.h), width, height);
  const place = (start: number, size: number, limit: number) => Math.max(0, Math.min(limit - side, start - Math.floor((side - size) / 2)));
  return { x: place(b.x, b.w, width), y: place(b.y, b.h, height), w: side, h: side };
}

function anchorParts(anchor: Anchor): ["left" | "center" | "right", "top" | "center" | "bottom"] {
  const h = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
  const v = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "center";
  return [h, v];
}

/** Shifts the hue of every pixel (in `r`, else the whole image) by `degrees`; brightness and saturation stay. */
export function shiftHue(image: Image, degrees: number, r?: Rect): Image {
  return eachPixel(image, r, (red, green, blue) => {
    const [hue, s, l] = toHsl(red, green, blue);
    return fromHsl((((hue + degrees) % 360) + 360) % 360, s, l);
  });
}

/** Takes out `amount` (0 to 1) of the colour of every pixel (in `r`, else the whole image), towards its grey. */
export function desaturate(image: Image, amount = 1, r?: Rect): Image {
  const a = Math.max(0, Math.min(1, amount));
  return eachPixel(image, r, (red, green, blue) => {
    const grey = 0.299 * red + 0.587 * green + 0.114 * blue;
    return [red + (grey - red) * a, green + (grey - green) * a, blue + (grey - blue) * a];
  });
}

function eachPixel(image: Image, r: Rect | undefined, fn: (r: number, g: number, b: number) => [number, number, number]): Image {
  const out = { ...image, data: new Uint8ClampedArray(image.data) };
  const c = r ? clip(image, r) : { x: 0, y: 0, w: image.width, h: image.height };
  for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) {
    const i = (y * image.width + x) * 4;
    if (out.data[i + 3] === 0) continue;
    const [nr, ng, nb] = fn(out.data[i], out.data[i + 1], out.data[i + 2]);
    out.data[i] = Math.round(nr);
    out.data[i + 1] = Math.round(ng);
    out.data[i + 2] = Math.round(nb);
  }
  return out;
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = (t: number) => {
    t = ((t % 1) + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return v * 255;
  };
  return [channel(h / 360 + 1 / 3), channel(h / 360), channel(h / 360 - 1 / 3)];
}
