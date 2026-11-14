import { deflateSync, inflateSync } from "node:zlib";

/**
 * Minimal PNG reading and writing for texture conversion: non-interlaced images of any color type and bit
 * depth are read into 8-bit RGBA; images are written as 8-bit RGBA.
 */
export interface Rgba {
  width: number;
  height: number;
  /** width * height * 4 bytes, row by row. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Samples per pixel by color type: gray, -, RGB, palette, gray+alpha, -, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readPng(file: Buffer): Rgba {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Buffer = Buffer.alloc(0), alpha: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") alpha = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (interlace) throw new Error("interlaced PNG files are not supported");
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  // Undo the per-row filters.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= step ? rows[y * stride + i - step] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const c = i >= step && y > 0 ? rows[(y - 1) * stride + i - step] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      rows[y * stride + i] = (line[i] + predictor) & 255;
    }
  }
  const sample = (y: number, index: number): number => {
    if (depth === 8) return rows[y * stride + index];
    if (depth === 16) return rows[y * stride + index * 2];
    const bit = index * depth;
    return (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = (v: number) => (depth >= 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (k: number) => sample(y, x * channels + k);
      if (colorType === 3) {
        const i = s(0);
        data.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], i < alpha.length ? alpha[i] : 255], o);
      } else if (colorType === 0 || colorType === 4) {
        const g = scale(s(0));
        data.set([g, g, g, colorType === 4 ? scale(s(1)) : 255], o);
      } else {
        data.set([scale(s(0)), scale(s(1)), scale(s(2)), colorType === 6 ? scale(s(3)) : 255], o);
      }
    }
  }
  return { width, height, data };
}

export function writePng(image: Rgba): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A texture rearranged from rectangles of another: each rect copies w*h source pixels at (u, v) to (x, y),
 * stepping backwards through the source on a flipped axis. Coordinates are for a source `base` pixels wide; a
 * larger source (an HD texture) scales everything by the same whole factor.
 */
export interface Remap {
  /** Width of the source layout the rects are written for. */
  base: number;
  width: number;
  height: number;
  rects: { x: number; y: number; w: number; h: number; u: number; v: number; flipX?: boolean; flipY?: boolean }[];
}

export function remapTexture(source: Rgba, remap: Remap): Rgba {
  const k = Math.max(1, Math.round(source.width / remap.base));
  const width = remap.width * k, height = remap.height * k;
  const data = new Uint8Array(width * height * 4);
  for (const r of remap.rects) {
    for (let j = 0; j < r.h * k; j++) {
      for (let i = 0; i < r.w * k; i++) {
        const sx = r.flipX ? (r.u + 1) * k - 1 - i : r.u * k + i, sy = r.flipY ? (r.v + 1) * k - 1 - j : r.v * k + j;
        if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
        const from = (sy * source.width + sx) * 4, to = ((r.y * k + j) * width + r.x * k + i) * 4;
        data.set(source.data.subarray(from, from + 4), to);
      }
    }
  }
  return { width, height, data };
}
