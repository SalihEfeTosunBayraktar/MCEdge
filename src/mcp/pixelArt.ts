import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writePng, type Rgba } from "../generator/png.ts";
import { ROOT } from "../paths.ts";
import type { Rect } from "../textures/edit.ts";
import {
  check, crop, editFrames, fill, frameCount, frameRect, gradient, isEmpty, outline, pack, paletteOf, parseHex, preview, ramp,
  snapToPalette, toHex, type Color, type FrameAction, type GradientDirection,
} from "../textures/pixelArt.ts";
import { FRAME, onFrame, textureStore } from "./textures.ts";

/**
 * Pixel art tools for agents (Q271): a guide to read before drawing, a preview the agent can look at, palettes and
 * hue-shifted ramps, fills, dithered gradients and outlines, frame editing of animation strips, atlases and a check
 * that names common mistakes with their positions. They work on the project PNGs the texture tools use.
 */
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
const json = (value: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const PATH = z.string().regex(/^textures\/[a-z0-9_./-]+\.png$/).describe("Project path, e.g. textures/item/ruby.png");
const COLOR = z.string().describe("#rrggbb, #rrggbbaa or \"transparent\"");
const RECT = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) })
  .transform((r): Rect => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
const NAME = z.string().regex(/^[a-z0-9_]+$/);

type Guide = { intro: string; topics: Record<string, string[]> };
/** Like the server's guard, for answers that may carry an image: a thrown error becomes an error result. */
async function guard(fn: () => Promise<Result> | Result): Promise<Result> {
  try {
    return await fn();
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

let guide: Guide | undefined;
const loadGuide = () => (guide ??= JSON.parse(readFileSync(join(ROOT, "config", "pixel-art-guide.json"), "utf8")) as Guide);

export function registerPixelArtTools(server: McpServer, root: string): void {
  const { file, load, save } = textureStore(root);
  /** The area a tool works on: rect inside the frame (or the whole frame / texture). */
  const area = (image: Rgba, rect?: Rect): Rect => {
    const r = rect ?? { x: 0, y: 0, w: image.width, h: image.height };
    if (r.x + r.w > image.width || r.y + r.h > image.height) throw new Error(`rect outside ${image.width}x${image.height}`);
    return r;
  };

  server.registerTool(
    "pixel_art_guide",
    {
      description: "How to draw good pixel art with these tools: read it before drawing a texture. Without a topic it gives the workflow and the list of "
        + "topics (palette, shading, lines, clusters, outlines, anti_aliasing, dithering, minecraft, animation, atlas).",
      inputSchema: { topic: z.string().optional() },
    },
    ({ topic }) => guard(() => {
      const g = loadGuide();
      if (!topic) return json({ intro: g.intro, workflow: g.topics.workflow, topics: Object.keys(g.topics) });
      const rules = g.topics[topic];
      if (!rules) throw new Error(`no topic "${topic}"; topics: ${Object.keys(g.topics).join(", ")}`);
      return json({ topic, rules });
    }),
  );

  server.registerTool(
    "preview_texture",
    {
      description: "Look at a texture as a picture: enlarged without blurring on a checkerboard (transparency), with a pixel grid when large enough. "
        + "tile shows it 3x3 to check seams of block textures; an animated strip shows its frames side by side. Use it after every drawing step.",
      inputSchema: {
        path: PATH,
        scale: z.number().int().min(1).max(32).optional().describe("Screen pixels per texture pixel; default fits about 512 pixels"),
        grid: z.boolean().optional(), tile: z.boolean().default(false), frames: z.boolean().default(true).describe("Animated: frames side by side"),
      },
    },
    ({ path, scale, grid, tile, frames }) => guard(() => {
      const image = load(path);
      const shot = preview(image, { scale, grid, tile, frames });
      const png = writePng({ width: shot.image.width, height: shot.image.height, data: shot.image.data as Uint8Array });
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ path, width: image.width, height: image.height, scale: shot.scale, shows: shot.layout }) },
        ],
      };
    }),
  );

  server.registerTool(
    "texture_palette",
    { description: "The colours a texture (or a rect of it) uses, most used first, with pixel counts.", inputSchema: { path: PATH, rect: RECT.optional() } },
    ({ path, rect }) => guard(() => {
      const image = load(path);
      const colors = paletteOf(image, area(image, rect));
      return json({ path, count: colors.length, colors });
    }),
  );

  server.registerTool(
    "color_ramp",
    {
      description: "A shading ramp from one base colour, darkest first: shadows hue-shift towards blue, highlights towards yellow (hueShift degrees), "
        + "lightness spreads by contrast (0 to 1). Use one ramp of 4-6 colours per material. Draws nothing.",
      inputSchema: { base: COLOR, steps: z.number().int().min(2).max(12).default(5), hueShift: z.number().min(0).max(60).default(20), contrast: z.number().min(0.1).max(1).default(0.6) },
    },
    ({ base, steps, hueShift, contrast }) => guard(() => json({ base, colors: ramp(parseHex(base), steps, hueShift, contrast).map(toHex) })),
  );

  server.registerTool(
    "snap_texture_to_palette",
    {
      description: "Every drawn pixel takes its nearest colour of a palette (alpha kept): palette colours, and/or all colours of another texture "
        + "(fromTexture, e.g. to recolour a variant with a new ramp). dither mixes the two nearest colours in an ordered pattern.",
      inputSchema: { path: PATH, palette: z.array(COLOR).optional(), fromTexture: PATH.optional(), dither: z.boolean().default(false), rect: RECT.optional(), frame: FRAME },
    },
    ({ path, palette, fromTexture, dither, rect, frame }) => guard(() => {
      const colors: Color[] = [...(palette ?? []).map(parseHex), ...(fromTexture ? paletteOf(load(fromTexture)).map((p) => parseHex(p.color)) : [])].filter((c) => c[3] > 0);
      const image = load(path);
      const changed = onFrame(image, frame, (target) => snapToPalette(target, colors, dither, area(target, rect)));
      save(path, image);
      return json({ path, palette: colors.length, pixelsChanged: changed, colorsNow: paletteOf(image).length });
    }),
  );

  server.registerTool(
    "fill_texture",
    {
      description: "Paint bucket: flood fill from x,y over the touching pixels of the same colour (diagonal: corners touch too), or mode replace: "
        + "every pixel of that colour in the texture (or rect) takes the new colour.",
      inputSchema: { path: PATH, x: z.number().int().min(0), y: z.number().int().min(0), color: COLOR, mode: z.enum(["flood", "replace"]).default("flood"), diagonal: z.boolean().default(false), rect: RECT.optional(), frame: FRAME },
    },
    ({ path, x, y, color, mode, diagonal, rect, frame }) => guard(() => {
      const image = load(path);
      const count = onFrame(image, frame, (target) => fill(target, x, y, parseHex(color), mode === "flood", diagonal, area(target, rect)));
      save(path, image);
      return json({ path, pixelsWritten: count });
    }),
  );

  server.registerTool(
    "gradient_texture",
    {
      description: "Fill a rect (default the whole texture or frame) with a gradient through colour stops, first to last: horizontal, vertical, "
        + "diagonal (top left to bottom right), diagonal_up or radial (centre out). Use ramp colours as stops; dither blends neighbouring stops "
        + "with an ordered pattern instead of bands. mask opaque shades only already drawn pixels (keeps the silhouette).",
      inputSchema: {
        path: PATH, colors: z.array(COLOR).min(2), direction: z.enum(["horizontal", "vertical", "diagonal", "diagonal_up", "radial"]).default("vertical"),
        dither: z.boolean().default(false), mask: z.enum(["all", "opaque"]).default("all"), rect: RECT.optional(), frame: FRAME,
      },
    },
    ({ path, colors, direction, dither, mask, rect, frame }) => guard(() => {
      const image = load(path);
      const count = onFrame(image, frame, (target) => gradient(target, area(target, rect), colors.map(parseHex), direction as GradientDirection, dither, mask));
      save(path, image);
      return json({ path, pixelsWritten: count });
    }),
  );

  server.registerTool(
    "outline_texture",
    {
      description: "Outline the drawn shape: outer paints the clear pixels around it, inner repaints its edge pixels. Without a colour it is a "
        + "selective outline: each outline pixel takes a darker, hue-shifted shade of the colour it borders. diagonal also outlines corners.",
      inputSchema: { path: PATH, mode: z.enum(["outer", "inner"]).default("outer"), color: COLOR.optional(), diagonal: z.boolean().default(false), rect: RECT.optional(), frame: FRAME },
    },
    ({ path, mode, color, diagonal, rect, frame }) => guard(() => {
      const image = load(path);
      const count = onFrame(image, frame, (target) => outline(target, mode, color ? parseHex(color) : undefined, diagonal, area(target, rect)));
      save(path, image);
      return json({ path, pixelsWritten: count });
    }),
  );

  server.registerTool(
    "edit_texture_frames",
    {
      description: "Frames of an animated texture (a vertical strip of square frames, 0 on top): add a clear frame before index (index = count adds "
        + "at the end), duplicate a frame (the copy goes right after it, ready to change), delete one, or move one to another place. A still square "
        + "texture counts as one frame. The .mcmeta's frame order is updated; set_texture_animation sets timing and playback.",
      inputSchema: { path: PATH, action: z.enum(["add", "duplicate", "delete", "move"]), index: z.number().int().min(0), to: z.number().int().min(0).optional() },
    },
    ({ path, action, index, to }) => guard(() => {
      if (action === "move" && to === undefined) throw new Error("move needs \"to\"");
      const image = load(path);
      const { image: strip, remap } = editFrames(image, { action, index, to } as FrameAction);
      save(path, { width: strip.width, height: strip.height, data: strip.data as Uint8Array });
      const meta = `${file(path)}.mcmeta`;
      let order: unknown;
      if (existsSync(meta)) {
        const raw = JSON.parse(readFileSync(meta, "utf8")) as { animation?: { frames?: (number | { index: number; time?: number })[] } };
        const list = raw.animation?.frames;
        if (list) {
          raw.animation!.frames = list.flatMap((f) => {
            const i = remap[typeof f === "number" ? f : f.index];
            return i === undefined ? [] : [typeof f === "number" ? i : { ...f, index: i }];
          });
          order = raw.animation!.frames;
          writeFileSync(meta, JSON.stringify(raw, null, 2) + "\n");
        }
      }
      return json({ path, frames: frameCount(strip), ...(order ? { order } : {}), animated: existsSync(meta) });
    }),
  );

  server.registerTool(
    "pack_texture_atlas",
    {
      description: "Pack project textures into one sheet (a sprite sheet or GUI atlas) and return each one's rectangle by name. padding leaves clear "
        + "pixels between pieces; powerOfTwo rounds the sheet size up. Refuses to overwrite unless overwrite is true.",
      inputSchema: {
        path: PATH.describe("The sheet to write"), textures: z.array(z.object({ name: NAME, path: PATH })).min(1),
        padding: z.number().int().min(0).max(16).default(0), powerOfTwo: z.boolean().default(false), overwrite: z.boolean().default(false),
      },
    },
    ({ path, textures, padding, powerOfTwo, overwrite }) => guard(() => {
      if (existsSync(file(path)) && !overwrite) throw new Error(`${path} exists; pass overwrite: true to replace it`);
      if (new Set(textures.map((t) => t.name)).size !== textures.length) throw new Error("names must be unique");
      const { sheet, rects } = pack(textures.map((t) => ({ name: t.name, image: load(t.path) })), padding, powerOfTwo);
      save(path, { width: sheet.width, height: sheet.height, data: sheet.data as Uint8Array });
      const map = Object.fromEntries(Object.entries(rects).map(([name, r]) => [name, { x: r.x, y: r.y, width: r.w, height: r.h }]));
      return json({ path, width: sheet.width, height: sheet.height, rects: map });
    }),
  );

  server.registerTool(
    "slice_texture_atlas",
    {
      description: "Cut a sheet into separate textures in folder (e.g. textures/item): by a grid of cell width x height (named <prefix>_<row>_<column>, "
        + "empty cells skipped) or by named rects. Refuses to overwrite existing textures unless overwrite is true.",
      inputSchema: {
        path: PATH, folder: z.string().regex(/^textures(\/[a-z0-9_.-]+)*$/),
        grid: z.object({ width: z.number().int().min(1), height: z.number().int().min(1), prefix: NAME }).optional(),
        rects: z.array(z.object({ name: NAME, x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) })).optional(),
        overwrite: z.boolean().default(false),
      },
    },
    ({ path, folder, grid, rects, overwrite }) => guard(() => {
      if (!grid === !rects) throw new Error("give grid or rects");
      const sheet = load(path);
      const pieces: { name: string; r: Rect }[] = rects
        ? rects.map((r) => ({ name: r.name, r: { x: r.x, y: r.y, w: r.width, h: r.height } }))
        : Array.from({ length: Math.floor(sheet.height / grid!.height) }, (_, row) => Array.from({ length: Math.floor(sheet.width / grid!.width) },
          (_, col) => ({ name: `${grid!.prefix}_${row}_${col}`, r: { x: col * grid!.width, y: row * grid!.height, w: grid!.width, h: grid!.height } }))).flat();
      const out = pieces.map((p) => ({ ...p, image: crop(sheet, area(sheet, p.r)), path: `${folder}/${p.name}.png` }))
        .filter((p) => rects || !isEmpty(p.image));
      const taken = out.filter((p) => existsSync(file(p.path)));
      if (taken.length && !overwrite) throw new Error(`exist already: ${taken.map((p) => p.path).join(", ")}; pass overwrite: true`);
      for (const p of out) save(p.path, { width: p.image.width, height: p.image.height, data: p.image.data as Uint8Array });
      return json({ from: path, written: out.map((p) => p.path) });
    }),
  );

  server.registerTool(
    "check_pixel_art",
    {
      description: "Review a texture for common pixel art mistakes, with positions: too many colours, colours too close to tell apart, stray single "
        + "pixels, doubled corners in 1 pixel lines, pillow shading, low contrast, half-transparent pixels, and with tileable seams of a block texture. "
        + "Animated textures are checked frame by frame. Run it before calling a texture done; pixel_art_guide explains the fixes.",
      inputSchema: { path: PATH, maxColors: z.number().int().min(2).optional(), tileable: z.boolean().default(false) },
    },
    ({ path, maxColors, tileable }) => guard(() => {
      const image = load(path);
      let frames = 1;
      try { frames = existsSync(`${file(path)}.mcmeta`) ? frameCount(image) : 1; } catch { frames = 1; }
      const results = Array.from({ length: frames }, (_, i) => ({ frame: i, issues: check(frames > 1 ? crop(image, frameRect(image, i)) : image, { maxColors, tileable }) }));
      const issues = frames > 1 ? results.filter((r) => r.issues.length) : results[0].issues;
      const clean = results.every((r) => !r.issues.length);
      return json({ path, colors: paletteOf(image).length, clean, ...(frames > 1 ? { frames, byFrame: issues } : { issues }) });
    }),
  );
}
