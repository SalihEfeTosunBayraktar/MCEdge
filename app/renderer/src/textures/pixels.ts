/** RGBA pixel buffer of a texture being painted; pure helpers, no DOM except PNG decode/encode. */
export interface Pixels {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

/** [r, g, b, a], each 0-255. */
export type Rgba = [number, number, number, number];

export const blank = (width: number, height: number): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

export const clone = (p: Pixels): Pixels => ({ width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) });

export function getPixel(p: Pixels, x: number, y: number): Rgba {
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
}

/** Sets one pixel; returns whether it changed. Fully transparent pixels are stored as 0,0,0,0. */
export function setPixel(p: Pixels, x: number, y: number, c: Rgba): boolean {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false;
  const value: Rgba = c[3] === 0 ? [0, 0, 0, 0] : c;
  const i = (y * p.width + x) * 4;
  if (p.data[i] === value[0] && p.data[i + 1] === value[1] && p.data[i + 2] === value[2] && p.data[i + 3] === value[3]) return false;
  p.data.set(value, i);
  return true;
}

/** Points of a straight pixel line; shared with the MCP draw tools. */
export { line } from "../../../../src/textures/shapes.ts";

const same = (p: Pixels, i: number, c: Rgba) => p.data[i] === c[0] && p.data[i + 1] === c[1] && p.data[i + 2] === c[2] && p.data[i + 3] === c[3];

/** Fills the 4-connected area of the colour at (x, y); returns whether anything changed. */
export function floodFill(p: Pixels, x: number, y: number, c: Rgba): boolean {
  const target = getPixel(p, x, y);
  const value: Rgba = c[3] === 0 ? [0, 0, 0, 0] : c;
  if (target.every((v, i) => v === value[i])) return false;
  const stack = [y * p.width + x];
  while (stack.length) {
    const n = stack.pop()!;
    if (!same(p, n * 4, target)) continue;
    p.data.set(value, n * 4);
    const px = n % p.width, py = (n - px) / p.width;
    if (px > 0) stack.push(n - 1);
    if (px < p.width - 1) stack.push(n + 1);
    if (py > 0) stack.push(n - p.width);
    if (py < p.height - 1) stack.push(n + p.width);
  }
  return true;
}

/** Nearest-neighbour scale to a new size (16x16 to 32x32 doubles every pixel). */
export function resize(p: Pixels, width: number, height: number): Pixels {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x * p.width) / width), sy = Math.floor((y * p.height) / height);
      out.data.set(p.data.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}

export const toHex = (c: Rgba) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function fromHex(hex: string, alpha = 255): Rgba | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export async function decodePng(dataUrl: string): Promise<Pixels> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const g = canvas.getContext("2d")!;
  g.drawImage(image, 0, 0);
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data) };
}

/** PNG of the pixels as base64 (no data: prefix). */
export async function encodePng(p: Pixels): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
