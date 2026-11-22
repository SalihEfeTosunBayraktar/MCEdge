import { exportTexture } from "../resources/exportTexture.ts";
import { PLAYBACK_MODES, playbackModeOf, withPlaybackMode, type PlaybackMode } from "../resources/textureAnimation.ts";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeFields, valuesOfType } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { readPng, writePng, type Rgba } from "../generator/png.ts";
import { loadProject } from "../ir/storage.ts";
import { ANCHORS, clearRegion, copyRegion, desaturate, pasteRegion, resizeCanvas, shiftHue, trimBox, type Image } from "../textures/edit.ts";
import { flip, mirror, shape } from "../textures/shapes.ts";
import { crop, frameRect } from "../textures/pixelArt.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const PATH = z.string().regex(/^textures\/[a-z0-9_./-]+\.png$/).describe("Project path, e.g. textures/item/ruby.png");
const COLOR = z.string().describe("#rrggbb, #rrggbbaa or \"transparent\"");
const MAX_SIZE = 512;

/** "#rrggbb" / "#rrggbbaa" / "transparent" -> RGBA bytes. */
function parseColor(color: string): [number, number, number, number] {
  if (color === "transparent") return [0, 0, 0, 0];
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!m) throw new Error(`bad colour "${color}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
/** Animation of a PNG with a .mcmeta beside it: frame count, frame time, interpolate, order; or the .mcmeta problem. */
function animationOf(png: string, image: Rgba): Record<string, unknown> {
  try {
    const a = (JSON.parse(readFileSync(`${png}.mcmeta`, "utf8")) as { animation?: Record<string, unknown> }).animation;
    if (!a) return { note: ".mcmeta without an animation section" };
    const raw = JSON.parse(readFileSync(`${png}.mcmeta`, "utf8")) as Record<string, unknown>;
    return { frames: Math.floor(image.height / image.width), frametime: a.frametime ?? 1, interpolate: a.interpolate === true, ...(a.frames ? { order: a.frames } : {}), mode: playbackModeOf(raw) };
  } catch (e) {
    return { note: `.mcmeta unreadable: ${(e as Error).message}` };
  }
}
const hex = (d: Uint8Array, i: number) => `#${[...d.subarray(i, i + 4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Project PNGs by their project path ("textures/..."), kept inside the project. */
export function textureStore(root: string) {
  const file = (path: string) => {
    const f = resolve(root, path);
    if (relative(root, f).startsWith("..")) throw new Error("path outside project");
    return f;
  };
  const load = (path: string): Rgba => {
    if (!existsSync(file(path))) throw new Error(`no texture ${path}`);
    return readPng(readFileSync(file(path)));
  };
  const save = (path: string, image: Rgba) => {
    mkdirSync(dirname(file(path)), { recursive: true });
    writeFileSync(file(path), writePng(image));
  };
  return { file, load, save };
}

// Q271: drawing tools work on one frame of an animation strip; coordinates are then relative to that frame.
export const FRAME = z.number().int().min(0).optional().describe("Animated texture: draw on this frame only (0 = top); x, y are then inside the frame");
/** Runs `edit` on frame `frame` of the strip (or the whole image) and puts the frame back. */
export function onFrame<T>(image: Rgba, frame: number | undefined, edit: (target: Rgba) => T): T {
  if (frame === undefined) return edit(image);
  const r = frameRect(image, frame);
  const part = crop(image, r);
  const result = edit({ width: part.width, height: part.height, data: part.data as Uint8Array });
  image.data.set(part.data, r.y * image.width * 4);
  return result;
}

/**
 * The texture editor for agents: list, create, read and write pixels, fill areas, resize (nearest neighbour) and
 * delete project PNGs. Colours read back as #rrggbbaa.
 */
export function registerTextureTools(server: McpServer, root: string, guard: Guard): void {
  const { file, load, save } = textureStore(root);
  const set = (image: Rgba, x: number, y: number, c: number[]) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error(`pixel ${x},${y} outside ${image.width}x${image.height}`);
    image.data.set(c[3] === 0 ? [0, 0, 0, 0] : c, (y * image.width + x) * 4);
  };

  server.registerTool("list_textures", { description: "Project PNG textures with their size." }, () => guard(() => {
    const out: { path: string; width: number; height: number }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".png")) {
          const img = readPng(readFileSync(p));
          const animation = existsSync(`${p}.mcmeta`) ? animationOf(p, img) : undefined;
          out.push({ path: relative(root, p).replaceAll("\\", "/"), width: img.width, height: img.height, ...(animation ? { animation } : {}) });
        }
      }
    };
    if (existsSync(join(root, "textures"))) walk(join(root, "textures"));
    return json(out);
  }));
  server.registerTool(
    "create_texture",
    {
      description: "Create a new PNG (Resources > Create texture), transparent or filled with one colour. Refuses to overwrite.",
      inputSchema: { path: PATH, width: z.number().int().min(1).max(MAX_SIZE).default(16), height: z.number().int().min(1).max(MAX_SIZE).default(16), fill: COLOR.optional() },
    },
    ({ path, width, height, fill }) => guard(() => {
      if (existsSync(file(path))) throw new Error(`${path} exists`);
      const image: Rgba = { width, height, data: new Uint8Array(width * height * 4) };
      if (fill) for (let i = 0; i < width * height; i++) image.data.set(parseColor(fill), i * 4);
      save(path, image);
      return json({ path, width, height });
    }),
  );
  server.registerTool(
    "read_texture",
    {
      description: "Pixels of a texture (or a rectangle of it) as rows of #rrggbbaa colours, top row first. To see it as a picture use preview_texture.",
      inputSchema: { path: PATH, x: z.number().int().min(0).default(0), y: z.number().int().min(0).default(0), width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(), frame: FRAME },
    },
    ({ path, x, y, width, height, frame }) => guard(() => {
      const strip = load(path);
      const image = frame === undefined ? strip : crop(strip, frameRect(strip, frame));
      const w = Math.min(width ?? image.width, image.width - x), h = Math.min(height ?? image.height, image.height - y);
      const rows = Array.from({ length: Math.max(0, h) }, (_, r) => Array.from({ length: Math.max(0, w) }, (_, c) => hex(image.data, ((y + r) * image.width + x + c) * 4)).join(" "));
      return json({ path, width: image.width, height: image.height, ...(frame === undefined ? {} : { frame }), x, y, rows });
    }),
  );
  server.registerTool(
    "write_texture_pixels",
    {
      description: "Paint a texture: single pixels, filled rectangles, and/or whole rows (each row a list of colours starting at x,y). Applied in that order.",
      inputSchema: {
        path: PATH,
        pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), color: COLOR })).optional(),
        rects: z.array(z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1), color: COLOR })).optional(),
        rows: z.object({ x: z.number().int().default(0), y: z.number().int().default(0), colors: z.array(z.array(COLOR)) }).optional(),
        frame: FRAME,
      },
    },
    ({ path, pixels, rects, rows, frame }) => guard(() => {
      const strip = load(path);
      let count = 0;
      onFrame(strip, frame, (image) => {
        for (const p of pixels ?? []) (set(image, p.x, p.y, parseColor(p.color)), count++);
        for (const r of rects ?? []) {
          const c = parseColor(r.color);
          for (let yy = r.y; yy < r.y + r.height; yy++) for (let xx = r.x; xx < r.x + r.width; xx++) (set(image, xx, yy, c), count++);
        }
        rows?.colors.forEach((row, r) => row.forEach((color, c) => (set(image, rows.x + c, rows.y + r, parseColor(color)), count++)));
      });
      save(path, strip);
      return json({ path, pixelsWritten: count });
    }),
  );
  server.registerTool(
    "draw_texture_shapes",
    {
      description: "Draw shapes like the texture editor's shape tools: line (through all points), rect and ellipse (box of the first and last point), "
        + "polygon (closed through the points); outline or filled. mirror repeats everything across the vertical (x) and/or horizontal (y) centre line, "
        + "like the editor's mirrored drawing. Applied in order.",
      inputSchema: {
        path: PATH,
        shapes: z.array(z.object({
          type: z.enum(["line", "rect", "ellipse", "polygon"]),
          points: z.array(z.tuple([z.number().int(), z.number().int()])).min(1).describe("[[x, y], ...]"),
          filled: z.boolean().default(false),
          color: COLOR,
        })).min(1),
        mirror: z.object({ x: z.boolean().default(false), y: z.boolean().default(false) }).optional(),
        frame: FRAME,
      },
    },
    ({ path, shapes, mirror: mode, frame }) => guard(() => {
      const strip = load(path);
      let count = 0;
      onFrame(strip, frame, (image) => {
        for (const s of shapes) {
          const c = parseColor(s.color);
          for (const [x, y] of mirror(shape(s.type, s.points, s.filled), image.width, image.height, mode ?? {})) {
            if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
            set(image, x, y, c);
            count++;
          }
        }
      });
      save(path, strip);
      return json({ path, pixelsWritten: count });
    }),
  );
  server.registerTool(
    "flip_texture",
    { description: "Mirror a whole texture left-right (horizontal) or top-bottom (vertical), like the editor's Flip buttons.", inputSchema: { path: PATH, axis: z.enum(["horizontal", "vertical"]) } },
    ({ path, axis }) => guard(() => {
      const image = load(path);
      save(path, { width: image.width, height: image.height, data: flip(image.data, image.width, image.height, axis) });
      return json({ path, flipped: axis });
    }),
  );
  // KUYRUK 133: the texture editor's selection, canvas and colour tools.
  // Rectangles as write_texture_pixels takes them.
  const RECT = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) })
    .transform((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  const asRgba = (image: Image): Rgba => ({ width: image.width, height: image.height, data: new Uint8Array(image.data) });
  server.registerTool(
    "edit_texture_region",
    {
      description: "Like the texture editor's selection: copy, move or clear a rectangle of a texture (x, y from the top left). copy pastes the rectangle's pixels "
        + "at to (also into another texture with toPath; transparent pixels let the target show), move lifts them off and puts them at to (the old place becomes "
        + "transparent), clear makes the rectangle transparent. Parts outside the target are cut off.",
      inputSchema: {
        path: PATH, action: z.enum(["copy", "move", "clear"]), rect: RECT,
        to: z.object({ x: z.number().int(), y: z.number().int() }).optional().describe("copy, move: where the rectangle's top left goes"),
        toPath: PATH.optional().describe("copy: paste into this texture instead"),
      },
    },
    ({ path, action, rect, to, toPath }) => guard(() => {
      const image = load(path);
      if (action === "clear") return (save(path, asRgba(clearRegion(image, rect))), json({ path, cleared: rect }));
      if (!to) throw new Error(`${action} needs "to"`);
      const piece = copyRegion(image, rect);
      if (action === "move") return (save(path, asRgba(pasteRegion(clearRegion(image, rect), piece, to.x, to.y))), json({ path, moved: rect, to }));
      const target = toPath ?? path;
      save(target, asRgba(pasteRegion(toPath ? load(toPath) : image, piece, to.x, to.y, false)));
      return json({ path: target, copied: rect, from: path, to });
    }),
  );
  server.registerTool(
    "resize_texture_canvas",
    {
      description: "Change a texture's canvas size without scaling, like the texture editor's Resize canvas: the picture keeps its pixels at anchor, new space is "
        + "transparent and space outside is cut off. Use resize_texture to scale instead.",
      inputSchema: { path: PATH, width: z.number().int().min(1).max(MAX_SIZE), height: z.number().int().min(1).max(MAX_SIZE), anchor: z.enum(ANCHORS as [string, ...string[]]).default("center") },
    },
    ({ path, width, height, anchor }) => guard(() => {
      save(path, asRgba(resizeCanvas(load(path), width, height, anchor as (typeof ANCHORS)[number])));
      return json({ path, width, height, anchor });
    }),
  );
  server.registerTool(
    "trim_texture_canvas",
    {
      description: "Q274: cut the empty (fully transparent) margins around the drawing away, like the texture editor's Trim to drawing: the canvas shrinks to "
        + "the drawing and its pixels are not scaled or moved relative to each other. An animated texture (with a .mcmeta) is trimmed with one box for every "
        + "frame, grown to a square so its frames stay square and aligned. Returns the new size and the removed margins.",
      inputSchema: { path: PATH },
    },
    ({ path }) => guard(() => {
      const image = load(path);
      const animated = existsSync(`${file(path)}.mcmeta`) && image.height > image.width && image.height % image.width === 0;
      const frames = animated
        ? Array.from({ length: image.height / image.width }, (_, i) => copyRegion(image, { x: 0, y: i * image.width, w: image.width, h: image.width }))
        : [image];
      const box = trimBox(frames, animated);
      if (!box) throw new Error(`${path} has no visible pixels to keep`);
      const { width, height } = frames[0];
      const removed = { left: box.x, top: box.y, right: width - box.x - box.w, bottom: height - box.y - box.h };
      if (box.w !== width || box.h !== height) {
        const cut = frames.map((f) => copyRegion(f, box));
        const out: Rgba = { width: box.w, height: box.h * cut.length, data: new Uint8Array(box.w * box.h * cut.length * 4) };
        cut.forEach((f, i) => out.data.set(f.data, i * box.w * box.h * 4));
        save(path, out);
      }
      return json({ path, width: box.w, height: box.h * frames.length, frames: frames.length, removed });
    }),
  );
  server.registerTool(
    "adjust_texture",
    {
      description: "Adjust a texture's colours like the texture editor's Adjust colours: hue shifts every colour by degrees (-180 to 180), desaturate takes out "
        + "that much of the colour towards grey (0 to 1). Only rect when given; transparent pixels stay.",
      inputSchema: { path: PATH, hue: z.number().min(-180).max(180).optional(), desaturate: z.number().min(0).max(1).optional(), rect: RECT.optional() },
    },
    ({ path, hue, desaturate: amount, rect }) => guard(() => {
      if (hue === undefined && amount === undefined) throw new Error("give hue and/or desaturate");
      let image: Image = load(path);
      if (hue) image = shiftHue(image, hue, rect);
      if (amount) image = desaturate(image, amount, rect);
      save(path, asRgba(image));
      return json({ path, hue: hue ?? 0, desaturate: amount ?? 0, rect: rect ?? "whole texture" });
    }),
  );
  server.registerTool(
    "resize_texture",
    { description: "Scale a texture to a new size (nearest neighbour, like the editor's Size).", inputSchema: { path: PATH, width: z.number().int().min(1).max(MAX_SIZE), height: z.number().int().min(1).max(MAX_SIZE) } },
    ({ path, width, height }) => guard(() => {
      const src = load(path);
      const out: Rgba = { width, height, data: new Uint8Array(width * height * 4) };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (Math.floor((y * src.height) / height) * src.width + Math.floor((x * src.width) / width)) * 4;
        out.data.set(src.data.subarray(i, i + 4), (y * width + x) * 4);
      }
      save(path, out);
      return json({ path, width, height });
    }),
  );
  server.registerTool(
    "set_texture_animation",
    {
      description: "Make a texture animated, change its animation or make it still, like the texture editor's Animation panel. An animated texture is "
        + "a vertical strip of square frames (top first) with \"<png>.mcmeta\"; frametime is in ticks (20 per second), interpolate blends frames, "
        + "frames optionally sets a play order (frame indexes). mode (Q229): loop (default, as Minecraft), hold_last (play once, stay on the last "
        + "frame), hold_first (play once, then show the first frame) or ping_pong (forwards, then backwards); it is kept in the .mcmeta's own "
        + "\"mcedge\" section and the generated mod gets the vanilla frame list that plays it. Blocks and items start a once mode when the player "
        + "enters a world (and after a resource reload); GUI images when their animationStart says. still: true deletes the .mcmeta. Build a strip with create_texture "
        + "(height = width x frames) or edit_texture_frames, and draw each frame with the frame argument of write_texture_pixels / draw_texture_shapes / fill_texture.",
      inputSchema: {
        path: PATH,
        frametime: z.number().int().min(1).optional(), interpolate: z.boolean().optional(),
        frames: z.array(z.number().int().min(0)).optional(), mode: z.enum(PLAYBACK_MODES as [PlaybackMode, ...PlaybackMode[]]).optional(), still: z.boolean().optional(),
      },
    },
    ({ path, frametime, interpolate, frames, mode, still }) => guard(() => {
      const image = load(path);
      const meta = `${file(path)}.mcmeta`;
      if (still) {
        if (existsSync(meta)) rmSync(meta);
        return json({ path, animation: null });
      }
      if (image.height % image.width !== 0) throw new Error(`${path} is ${image.width}x${image.height}: an animated texture is a strip of square frames`);
      const count = image.height / image.width;
      if (frames?.some((f) => f >= count)) throw new Error(`frames must be indexes below ${count}`);
      const raw = existsSync(meta) ? (JSON.parse(readFileSync(meta, "utf8")) as Record<string, unknown>) : {};
      const section = { ...((raw.animation as Record<string, unknown>) ?? {}) };
      if (frametime !== undefined) section.frametime = frametime;
      section.frametime ??= 1;
      if (interpolate !== undefined) interpolate ? (section.interpolate = true) : delete section.interpolate;
      if (frames) section.frames = frames;
      const out = mode ? withPlaybackMode({ ...raw, animation: section }, mode) : { ...raw, animation: section };
      writeFileSync(meta, JSON.stringify(out, null, 2) + "\n");
      return json({ path, animation: animationOf(file(path), image) });
    }),
  );
  server.registerTool(
    "import_texture",
    {
      description: "Copy a PNG from this computer into the project as a texture, with its animation: \"<file>.mcmeta\" beside it is copied too. "
        + "Refuses to replace an existing texture unless overwrite is true.",
      inputSchema: { file: z.string().describe("Absolute path of the PNG"), to: PATH, overwrite: z.boolean().default(false) },
    },
    ({ file: source, to, overwrite }) => guard(() => {
      if (!isAbsolute(source) || !source.toLowerCase().endsWith(".png")) throw new Error("file must be an absolute path to a .png");
      if (existsSync(file(to)) && !overwrite) throw new Error(`${to} exists; pass overwrite: true to replace it`);
      const image = readPng(readFileSync(source));
      mkdirSync(dirname(file(to)), { recursive: true });
      writeFileSync(file(to), readFileSync(source));
      if (existsSync(`${source}.mcmeta`)) writeFileSync(`${file(to)}.mcmeta`, readFileSync(`${source}.mcmeta`));
      else if (existsSync(`${file(to)}.mcmeta`)) rmSync(`${file(to)}.mcmeta`);
      return json({ path: to, width: image.width, height: image.height, animation: existsSync(`${file(to)}.mcmeta`) ? animationOf(file(to), image) : null });
    }),
  );
  server.registerTool(
    "copy_texture",
    {
      description: "Save as for textures: copy a project PNG (and its animation .mcmeta) to another name or folder, e.g. to edit a copy. "
        + "Refuses to replace an existing texture unless overwrite is true.",
      inputSchema: { path: PATH, to: PATH, overwrite: z.boolean().default(false) },
    },
    ({ path, to, overwrite }) => guard(() => {
      if (!existsSync(file(path))) throw new Error(`no texture ${path}`);
      if (path === to) throw new Error("path and to are the same file");
      if (existsSync(file(to)) && !overwrite) throw new Error(`${to} exists; pass overwrite: true to replace it`);
      mkdirSync(dirname(file(to)), { recursive: true });
      writeFileSync(file(to), readFileSync(file(path)));
      const meta = existsSync(`${file(path)}.mcmeta`);
      if (meta) writeFileSync(`${file(to)}.mcmeta`, readFileSync(`${file(path)}.mcmeta`));
      return json({ path: to, from: path, animation: meta });
    }),
  );
  server.registerTool(
    "export_texture",
    {
      description: "Copy a project texture to a file outside the project, with its animation (.mcmeta) when it has one.",
      inputSchema: { path: z.string().describe("Project texture, textures/....png"), target: z.string().describe("Absolute path of the file to write") },
    },
    ({ path, target }) => guard(() => json({ written: exportTexture(root, path, target) })),
  );
  server.registerTool(
    "delete_texture",
    { description: "Delete a texture; refused while an element or the mod logo uses it.", inputSchema: { path: PATH } },
    ({ path }) => guard(() => {
      const project = loadProject(root);
      const { byId } = typeRegistry();
      const users = Object.entries(project.elements).flatMap(([typeId, list]) => {
        const t = byId.get(typeId);
        return t ? list.filter((e) => valuesOfType(typeFields(t), e, "texture").includes(path)).map((e) => `${typeId}/${e.id}`) : [];
      });
      if (project.mod.logo === path) users.push("mod logo");
      if (users.length) throw new Error(`${path} is used by ${users.join(", ")}`);
      rmSync(file(path));
      // Its animation goes with it.
      if (existsSync(`${file(path)}.mcmeta`)) rmSync(`${file(path)}.mcmeta`);
      return json({ deleted: path });
    }),
  );
}
