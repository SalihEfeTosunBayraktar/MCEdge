import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkIssue, type Element, type FieldIssue } from "../elements/model.ts";

/**
 * Q275 (M3): GUI and overlay images drawn at a size that blurs pixel art, and GUI images larger than the GUI. A texture
 * stays sharp drawn 1:1 or at a whole multiple of its size, the same in both directions. The size compared is one
 * frame: a vertical strip with a .mcmeta (or an `animated` image, or a state with `frame`) has square frames, an image
 * button in the old one-file layout holds two states, one above the other.
 */

const TEXTURE_KEYS: Record<string, string[]> = {
  image: ["image"],
  image_button: ["image", "hoverImage", "pressedImage"],
  toggle_button: ["image", "hoverImage", "onImage", "onHoverImage", "pressedImage", "onPressedImage"],
};
type Widget = Record<string, unknown> & { kind?: string };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const size = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.round(Number(v)) : fallback);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Image sizes by file, kept while the file's mtime and size stay the same: validation runs after every edit (Q277). */
const sizes = new Map<string, { mtimeMs: number; bytes: number; size?: { width: number; height: number } }>();

/** Width and height from the PNG header (the first 24 bytes), without decoding the pixels. */
function pngSize(file: string): { width: number; height: number } | undefined {
  const stat = statSync(file);
  const cached = sizes.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.bytes === stat.size) return cached.size;
  let size: { width: number; height: number } | undefined;
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    if (readSync(fd, head, 0, 24, 0) === 24 && head.subarray(0, 8).equals(PNG_SIGNATURE) && head.toString("latin1", 12, 16) === "IHDR") size = { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    closeSync(fd);
  }
  sizes.set(file, { mtimeMs: stat.mtimeMs, bytes: stat.size, size });
  return size;
}

/** One frame of `path`: square frames for a strip that animates, half height for a two-state button sheet. */
function frameOf(projectDir: string, path: string, square: boolean, stacked: boolean): { w: number; h: number } | undefined {
  const file = join(projectDir, path);
  if (!existsSync(file)) return undefined;
  let png;
  try {
    png = pngSize(file);
  } catch {
    return undefined;
  }
  if (!png) return undefined;
  const strip = png.height > png.width && png.height % png.width === 0;
  if (strip && (square || existsSync(`${file}.mcmeta`))) return { w: png.width, h: png.width };
  return { w: png.width, h: stacked ? Math.floor(png.height / 2) : png.height };
}

const sharp = (drawn: { w: number; h: number }, frame: { w: number; h: number }) => {
  const sx = drawn.w / frame.w, sy = drawn.h / frame.h;
  return sx === sy && Number.isInteger(sx) && sx >= 1;
};

export function guiImageIssues(elements: Record<string, Element[]>, projectDir: string): FieldIssue[] {
  const issues: FieldIssue[] = [];
  // Many widgets draw the same few textures: each file is looked at once per validation.
  const frames = new Map<string, ReturnType<typeof frameOf>>();
  const cachedFrame = (path: string, square: boolean, stacked: boolean) => {
    const key = `${path}|${square}|${stacked}`;
    if (!frames.has(key)) frames.set(key, frameOf(projectDir, path, square, stacked));
    return frames.get(key);
  };
  for (const typeId of ["gui", "overlay"]) {
    for (const element of elements[typeId] ?? []) {
      const widgets = Array.isArray(element.components) ? (element.components as Widget[]) : [];
      widgets.forEach((w, i) => {
        if (!w || typeof w !== "object") return;
        const path = `${typeId}/${element.id}.components[${i}]`;
        const textures: { path: string; square: boolean; stacked: boolean }[] = (TEXTURE_KEYS[w.kind ?? ""] ?? [])
          .map((key) => str(w[key]))
          .filter((p, k, all) => p && all.indexOf(p) === k)
          .map((p) => ({ path: p, square: w.kind === "image" && w.animated === true, stacked: w.kind === "image_button" && (!str(w.hoverImage) || str(w.hoverImage) === str(w.image)) && p === str(w.image) }));
        if (w.kind === "state_image" && Array.isArray(w.states)) {
          for (const s of w.states as Widget[]) if (s && str(s.image)) textures.push({ path: str(s.image), square: s.frame !== undefined && s.frame !== null && s.frame !== "", stacked: false });
        }
        for (const t of textures) {
          const frame = cachedFrame(t.path, t.square, t.stacked);
          if (!frame) continue;
          // An image without a size is drawn at its frame size; buttons and state images default to 16 x 16.
          const fallback = w.kind === "image" ? frame : { w: 16, h: 16 };
          const drawn = { w: size(w.width, fallback.w), h: size(w.height, fallback.h) };
          if (!sharp(drawn, frame)) {
            issues.push(checkIssue(path, "guiImageScale", { widget: i, texture: t.path, size: `${frame.w}x${frame.h}`, drawn: `${drawn.w}x${drawn.h}` }));
          }
          if (typeId === "gui" && w.kind === "image") {
            const gw = size(element.width, 176), gh = size(element.height, 166);
            if (drawn.w > gw || drawn.h > gh) issues.push(checkIssue(path, "guiImageTooBig", { widget: i, drawn: `${drawn.w}x${drawn.h}`, gui: `${gw}x${gh}` }));
          }
        }
      });
    }
  }
  return issues;
}
