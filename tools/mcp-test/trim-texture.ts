/**
 * Q274: trim_texture_canvas on a copy of examples/hello. A still texture shrinks to its drawing with the pixels
 * unchanged; an animated strip is cut with one square box for all frames, so they stay aligned; a texture without
 * visible pixels is refused.
 *   node tools/mcp-test/trim-texture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { readPng, writePng } from "../../src/generator/png.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const put = (img: { width: number; data: Uint8Array }, x: number, y: number, rgba: number[]) => img.data.set(rgba, (y * img.width + x) * 4);
const at = (img: { width: number; data: Uint8Array }, x: number, y: number) => JSON.stringify(Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)));

// Still 16x16: a 3x5 drawing at (4, 6), its corners marked, one half transparent pixel.
const still = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
for (let y = 6; y < 11; y++) for (let x = 4; x < 7; x++) put(still, x, y, [90, 60, 30, 255]);
put(still, 4, 6, [255, 0, 0, 255]);
put(still, 6, 10, [0, 0, 255, 120]);
writeFileSync(join(project, "textures", "trim_still.png"), writePng(still));
// Animated 16x32 (2 frames): a 2x2 dot at (2, 2) in frame 0 and at (6, 3) in frame 1.
const strip = { width: 16, height: 32, data: new Uint8Array(16 * 32 * 4) };
for (const [fx, fy, f] of [[2, 2, 0], [6, 3, 1]]) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) put(strip, fx + x, f * 16 + fy + y, [f ? 0 : 255, 200, 0, 255]);
writeFileSync(join(project, "textures", "trim_anim.png"), writePng(strip));
writeFileSync(join(project, "textures", "trim_anim.png.mcmeta"), JSON.stringify({ animation: { frametime: 4 } }));
writeFileSync(join(project, "textures", "trim_empty.png"), writePng({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) }));

const mcp = await connect(project);
const load = (name: string) => readPng(readFileSync(join(project, "textures", name)));
try {
  assert(mcp.tools.includes("trim_texture_canvas"), "tool trim_texture_canvas is listed");
  const r1 = await mcp.call("trim_texture_canvas", { path: "textures/trim_still.png" });
  assert(r1.width === 3 && r1.height === 5 && JSON.stringify(r1.removed) === JSON.stringify({ left: 4, top: 6, right: 9, bottom: 5 }), `still: 3x5, margins reported (${JSON.stringify(r1)})`);
  const s = load("trim_still.png");
  assert(s.width === 3 && s.height === 5, `still saved at 3x5 (${s.width}x${s.height})`);
  assert(at(s, 0, 0) === "[255,0,0,255]" && at(s, 2, 4) === "[0,0,255,120]" && at(s, 1, 2) === "[90,60,30,255]", "still: the drawing's pixels are unchanged, not scaled");
  const again = await mcp.call("trim_texture_canvas", { path: "textures/trim_still.png" });
  assert(again.width === 3 && JSON.stringify(again.removed) === JSON.stringify({ left: 0, top: 0, right: 0, bottom: 0 }), "trimming again changes nothing");

  const r2 = await mcp.call("trim_texture_canvas", { path: "textures/trim_anim.png" });
  // Union of the dots: x 2..7, y 2..4 (6x3), grown to a 6x6 square around it: x 2, y 1.
  assert(r2.frames === 2 && r2.width === 6 && r2.height === 12, `animated: 2 square 6x6 frames (${JSON.stringify(r2)})`);
  const a = load("trim_anim.png");
  assert(at(a, 0, 1) === "[255,200,0,255]" && at(a, 1, 2) === "[255,200,0,255]", "frame 0: its dot at (0, 1)");
  assert(at(a, 4, 6 + 2) === "[0,200,0,255]" && at(a, 5, 6 + 3) === "[0,200,0,255]", "frame 1: its dot at (4, 2), same offset as before");
  assert(at(a, 0, 0) === "[0,0,0,0]" && at(a, 4, 6 + 1) === "[0,0,0,0]", "the rest stays empty");

  const empty = await mcp.call("trim_texture_canvas", { path: "textures/trim_empty.png" }).catch((e: Error) => e.message);
  assert(JSON.stringify(empty).includes("no visible pixels"), `an empty texture is refused (${JSON.stringify(empty)})`);
  assert(load("trim_empty.png").width === 8, "the empty texture is left as it was");
  console.log("PASS trim-texture");
} finally {
  await mcp.close();
}
