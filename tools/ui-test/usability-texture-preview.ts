/**
 * KUYRUK #75: the texture editor shows the texture being drawn at real size (1x, 2x), in an inventory slot and tiled
 * 3 x 3, and the preview follows each stroke. Screenshots go to design/usability/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/usability");
const project = exampleProject();

/** RGBA of one pixel of a preview canvas (canvas pixels, not screen pixels). */
const previewPixel = (app: App, index: number, x: number, y: number) =>
  app.eval<number[]>(`Array.from([...document.querySelectorAll(".paintform .pvview")][${index}].getContext("2d").getImageData(${x}, ${y}, 1, 1).data)`);

await run(async (app) => {
  await app.click(".rtab", "Resources");
  await app.waitFor(`document.querySelector(".texcell")`);
  await app.click(".abtn", "New texture");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.click(".dialog input");
  await app.type("seams");
  await app.setValue(".dialog select", "block");
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".paintcanvas")`);

  const sizes = await app.eval<{ w: number; h: number }[]>(`[...document.querySelectorAll(".paintform .pvview")].map((c) => ({ w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) }))`);
  console.log("preview sizes", sizes);
  assert(sizes.length === 4, `four previews (1x, 2x, slot, tiled): ${sizes.length}`);
  assert(sizes[0].w === 16 && sizes[1].w === 32, `1x and 2x at real size: ${JSON.stringify(sizes.slice(0, 2))}`);
  assert(sizes[2].w === 32, "the slot icon is 32 px (16 px at 2x)");
  // The tiled picture is 144 px (3 x 3 tiles at 3x) and shrinks to the width of the narrower inspector (Q278: 300 px panel).
  assert(sizes[3].w >= 128 && sizes[3].w <= 144 && sizes[3].w === sizes[3].h, `3 x 3 tiles of 16 px, at most 144 px: ${JSON.stringify(sizes[3])}`);

  // Paint pixel (0, 0) red: the 1x preview, the slot and all nine tiles show it at once.
  await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);
  const r = await app.rect(".paintcanvas");
  const step = r.width / 16;
  await app.mouse("mouseMoved", r.x + step * 0.5, r.y + step * 0.5, 0);
  await app.mouse("mousePressed", r.x + step * 0.5, r.y + step * 0.5);
  await app.mouse("mouseReleased", r.x + step * 0.5, r.y + step * 0.5);
  await app.sleep(300);
  const red = (d: number[]) => d[0] === 0xb0 && d[1] === 0x2e && d[2] === 0x26 && d[3] === 255;
  assert(red(await previewPixel(app, 0, 0, 0)), "1x preview shows the stroke");
  assert(red(await previewPixel(app, 2, 0, 0)), "slot preview shows the stroke");
  const tiled = [[0, 0], [16, 0], [32, 16], [16, 32], [32, 32]];
  for (const [x, y] of tiled) assert(red(await previewPixel(app, 3, x, y)), `tile pixel ${x},${y} shows the stroke`);
  assert(!red(await previewPixel(app, 3, 1, 0)), "only the painted pixel is red");
  await app.shot(`${OUT}/after-texture-preview.png`);

  // A 32 px texture: the tiles shrink to fit and the previews follow the new size.
  await app.eval(`(() => { const s = [...document.querySelectorAll(".paintform select")].find((s) => [...s.options].some((o) => o.value === "32")); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "32"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await app.sleep(400);
  const after = await app.eval<{ w: number }[]>(`[...document.querySelectorAll(".paintform .pvview")].map((c) => ({ w: Math.round(c.getBoundingClientRect().width) }))`);
  assert(after[0].w === 32 && after[1].w === 64 && after[3].w === 96, `32 px texture previews: ${JSON.stringify(after)}`);
}, { project });
