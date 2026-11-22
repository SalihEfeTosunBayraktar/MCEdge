/**
 * Q271: the pixel art tools over MCP, on a copy of examples/hello. Draws a gem item only through the tools (ramp,
 * silhouette, dithered gradient shading, selective outline, highlight), animates it, packs and slices an atlas, and
 * checks that check_pixel_art names deliberate mistakes. Previews go to tools/mcp-test/out/pixel-art/ to look at.
 *   node tools/mcp-test/pixel-art.ts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const out = join(import.meta.dirname, "out", "pixel-art");
mkdirSync(out, { recursive: true });
const mcp = await connect(project);
const kinds = (r: { issues?: { kind: string }[] }) => (r.issues ?? []).map((i) => i.kind);
const shot = async (path: string, name: string, extra: Record<string, unknown> = {}) => {
  const info = await mcp.call("preview_texture", { path, ...extra });
  assert(mcp.lastImages.length === 1, `preview ${name} returns one image (${info.shows})`);
  const png = Buffer.from(mcp.lastImages[0], "base64");
  writeFileSync(join(out, `${name}.png`), png);
  return { info, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};
try {
  for (const t of ["pixel_art_guide", "preview_texture", "texture_palette", "color_ramp", "snap_texture_to_palette", "fill_texture", "gradient_texture",
    "outline_texture", "edit_texture_frames", "pack_texture_atlas", "slice_texture_atlas", "check_pixel_art"]) assert(mcp.tools.includes(t), `tool ${t} is listed`);

  // Guidance.
  const guide = await mcp.call("pixel_art_guide");
  assert(guide.workflow.length >= 5 && guide.topics.includes("animation") && guide.topics.includes("minecraft"), `guide: ${guide.topics.join(", ")}`);
  const anim = await mcp.call("pixel_art_guide", { topic: "animation" });
  assert(anim.rules.some((r: string) => r.includes("ticks")), "animation topic talks about ticks");
  const badTopic = await mcp.call("pixel_art_guide", { topic: "nope" }, true);
  assert(String(badTopic).includes("topics:"), "unknown topic lists the topics");

  // A hue-shifted ramp: darkest first, lightness rising, the shadow bluer and the highlight yellower than the base.
  const { colors: ramp } = await mcp.call("color_ramp", { base: "#c0303a", steps: 5, hueShift: 25 });
  const lum = (h: string) => { const n = parseInt(h.slice(1, 7), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
  assert(ramp.length === 5 && ramp.every((c: string, i: number) => i === 0 || lum(c) > lum(ramp[i - 1])), `ramp dark to light: ${ramp.join(" ")}`);
  assert(parseInt(ramp[0].slice(5, 7), 16) > parseInt(ramp[0].slice(1, 3), 16) * 0.35, `shadow leans blue: ${ramp[0]}`);

  // A gem drawn only with the tools, following the guide: ramp, silhouette, facets lit from the top left, highlight, outline.
  const gem = "textures/item/gem.png";
  await mcp.call("create_texture", { path: gem, width: 16, height: 16 });
  const facet = (points: number[][], color: string) => ({ type: "polygon", points, filled: true, color });
  await mcp.call("draw_texture_shapes", { path: gem, shapes: [
    facet([[7, 1], [13, 7], [7, 13], [1, 7]], ramp[2]),
    facet([[7, 1], [7, 7], [1, 7]], ramp[3]),
    facet([[7, 7], [13, 7], [7, 13]], ramp[1]),
    facet([[7, 4], [10, 7], [7, 10], [4, 7]], ramp[2]),
    facet([[7, 4], [7, 7], [4, 7]], ramp[4]),
  ] });
  await mcp.call("write_texture_pixels", { path: gem, pixels: [{ x: 5, y: 4, color: "#fff4e0" }, { x: 4, y: 5, color: "#fff4e0" }] });
  const shadedGem = await mcp.call("texture_palette", { path: gem });
  assert(shadedGem.count === 5, `gem uses four ramp shades and one highlight: ${shadedGem.count} colours`);
  const outlined = await mcp.call("outline_texture", { path: gem, mode: "outer" });
  assert(outlined.pixelsWritten > 20, `selective outline: ${outlined.pixelsWritten} pixels`);
  const pal = await mcp.call("texture_palette", { path: gem });
  assert(pal.count > 5 && pal.count <= 16, `gem palette ${pal.count} colours`);
  const gemCheck = await mcp.call("check_pixel_art", { path: gem });
  console.log("gem check:", JSON.stringify(gemCheck.issues.map((i: { kind: string; message: string }) => i.kind)));
  assert(!kinds(gemCheck).includes("too_many_colours") && !kinds(gemCheck).includes("half_transparent"), "gem keeps a small palette and full alpha");
  const big = await shot(gem, "gem", { scale: 24 });
  assert(big.width === 16 * 24 && big.height === 16 * 24, `preview is 16x24 wide: ${big.width}x${big.height}`);

  // Fill: flood a closed area, then replace a colour everywhere.
  const box = "textures/item/box.png";
  await mcp.call("create_texture", { path: box, width: 8, height: 8, fill: "#202020" });
  await mcp.call("draw_texture_shapes", { path: box, shapes: [{ type: "rect", points: [[1, 1], [6, 6]], color: "#ffffff" }] });
  const flood = await mcp.call("fill_texture", { path: box, x: 3, y: 3, color: "#ff0000" });
  assert(flood.pixelsWritten === 16, `flood fills the 4x4 inside: ${flood.pixelsWritten}`);
  const replaced = await mcp.call("fill_texture", { path: box, x: 0, y: 0, color: "#0000ff", mode: "replace" });
  assert(replaced.pixelsWritten === 28, `replace recolours the 28 border pixels: ${replaced.pixelsWritten}`);

  // Snap to a palette.
  await mcp.call("snap_texture_to_palette", { path: box, palette: ["#000000", "#ffffff"] });
  const snapped = await mcp.call("texture_palette", { path: box });
  assert(snapped.colors.every((c: { color: string }) => ["#000000ff", "#ffffffff"].includes(c.color)), `snapped to 2 colours: ${JSON.stringify(snapped.colors)}`);

  // Animation frames: duplicate, draw on frame 1 only, order kept valid when a frame goes.
  const glow = "textures/item/glow.png";
  await mcp.call("copy_texture", { path: gem, to: glow });
  let f = await mcp.call("edit_texture_frames", { path: glow, action: "duplicate", index: 0 });
  assert(f.frames === 2, `duplicate gives 2 frames: ${JSON.stringify(f)}`);
  await mcp.call("edit_texture_frames", { path: glow, action: "duplicate", index: 1 });
  await mcp.call("set_texture_animation", { path: glow, frametime: 4, frames: [0, 1, 2, 1] });
  await mcp.call("snap_texture_to_palette", { path: glow, palette: [ramp[3], ramp[4], "#fff4e0", ramp[2]], frame: 1 });
  await mcp.call("gradient_texture", { path: glow, colors: ["#fff4e0", ramp[4], ramp[3]], direction: "radial", mask: "opaque", frame: 2 });
  await mcp.call("write_texture_pixels", { path: glow, pixels: [{ x: 0, y: 0, color: "#00ff00" }], frame: 2 });
  const f0 = await mcp.call("read_texture", { path: glow, frame: 0, width: 1, height: 1 });
  const f2 = await mcp.call("read_texture", { path: glow, frame: 2, width: 1, height: 1 });
  assert(f0.rows[0] === "#00000000" && f2.rows[0] === "#00ff00ff", `frame argument draws on frame 2 only: ${f0.rows[0]} / ${f2.rows[0]}`);
  const strip = await shot(glow, "glow-frames");
  assert(strip.info.shows.includes("3 frames"), `strip preview: ${strip.info.shows}`);
  f = await mcp.call("edit_texture_frames", { path: glow, action: "delete", index: 1 });
  assert(f.frames === 2 && JSON.stringify(f.order) === "[0,1]", `delete remaps the order: ${JSON.stringify(f.order)}`);
  f = await mcp.call("edit_texture_frames", { path: glow, action: "move", index: 1, to: 0 });
  assert(JSON.stringify(f.order) === "[1,0]", `move remaps the order: ${JSON.stringify(f.order)}`);
  const meta = JSON.parse(readFileSync(join(project, `${glow}.mcmeta`), "utf8"));
  assert(meta.animation.frametime === 4, "timing kept");
  const delOnly = await mcp.call("edit_texture_frames", { path: box, action: "delete", index: 0 }, true);
  assert(String(delOnly).includes("only frame"), "the only frame cannot be deleted");

  // Atlas: pack, then slice by grid and by rects.
  const sheet = "textures/gui/sheet.png";
  const packed = await mcp.call("pack_texture_atlas", { path: sheet, padding: 1, powerOfTwo: true, textures: [{ name: "gem", path: gem }, { name: "ruby", path: "textures/ruby.png" }, { name: "box", path: box }] });
  assert(packed.width === 64 && packed.height === 16 && packed.rects.gem.width === 16 && packed.rects.box.width === 8, `packed: ${JSON.stringify(packed)}`);
  const again = await mcp.call("pack_texture_atlas", { path: sheet, textures: [{ name: "gem", path: gem }] }, true);
  assert(String(again).includes("overwrite"), "no silent overwrite");
  await shot(sheet, "atlas");
  const cut = await mcp.call("slice_texture_atlas", { path: sheet, folder: "textures/sliced", rects: [{ name: "gem_copy", ...packed.rects.gem }] });
  const a = await mcp.call("read_texture", { path: gem }), b = await mcp.call("read_texture", { path: cut.written[0] });
  assert(JSON.stringify(a.rows) === JSON.stringify(b.rows), "a sliced rect equals the packed texture");
  const grid = await mcp.call("slice_texture_atlas", { path: sheet, folder: "textures/cells", grid: { width: 16, height: 16, prefix: "cell" } });
  assert(grid.written.length >= 2 && grid.written.length < 8 && existsSync(join(project, "textures/cells/cell_0_0.png")), `grid skips empty cells: ${grid.written.join(", ")}`);

  // check_pixel_art names deliberate mistakes.
  const bad = "textures/item/bad.png";
  await mcp.call("create_texture", { path: bad, width: 16, height: 16 });
  await mcp.call("draw_texture_shapes", { path: bad, shapes: [{ type: "ellipse", points: [[1, 1], [14, 14]], filled: true, color: "#808080" }] });
  await mcp.call("gradient_texture", { path: bad, colors: ["#e0e0e0", "#a0a0a0", "#404040"], direction: "radial", dither: false, mask: "opaque" });
  await mcp.call("write_texture_pixels", { path: bad, pixels: [{ x: 7, y: 9, color: "#00ff00" }, { x: 3, y: 7, color: "#80808080" }] });
  const badCheck = await mcp.call("check_pixel_art", { path: bad });
  console.log("bad check:", JSON.stringify(kinds(badCheck)));
  for (const k of ["pillow_shading", "stray_pixels", "half_transparent"]) assert(kinds(badCheck).includes(k), `check finds ${k}`);
  const stray = badCheck.issues.find((i: { kind: string }) => i.kind === "stray_pixels");
  assert(stray.at.some(([x, y]: number[]) => x === 7 && y === 9), "stray pixel position reported");
  const line = "textures/item/line.png";
  await mcp.call("create_texture", { path: line, width: 8, height: 8 });
  await mcp.call("write_texture_pixels", { path: line, pixels: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]].map(([x, y]) => ({ x, y, color: "#000000" })) });
  const lineCheck = await mcp.call("check_pixel_art", { path: line });
  assert(kinds(lineCheck).includes("doubled_corners"), `doubled corners found: ${JSON.stringify(lineCheck.issues)}`);
  const tile = "textures/block/seam.png";
  await mcp.call("create_texture", { path: tile, width: 16, height: 16 });
  await mcp.call("gradient_texture", { path: tile, colors: ["#303030", "#c0c0c0"], direction: "horizontal", dither: false });
  const seam = await mcp.call("check_pixel_art", { path: tile, tileable: true });
  assert(kinds(seam).includes("tiling_seam"), `seam found: ${JSON.stringify(kinds(seam))}`);
  const tiled = await shot(tile, "seam-tiled", { tile: true, scale: 8 });
  assert(tiled.width === 16 * 3 * 8, `tiled preview 3x wide: ${tiled.width}`);
  const ruby = await mcp.call("check_pixel_art", { path: "textures/ruby.png" });
  console.log("ruby.png check:", JSON.stringify(kinds(ruby)));
  console.log(`previews in ${out}`);
} finally {
  await mcp.close();
}
