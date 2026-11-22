/**
 * KUYRUK #5 and #59: creates a texture from Resources, paints it with every tool, undoes/redoes, resizes, then edits
 * an existing texture and checks the element tile using it refreshes. Nothing is written until Save; Save as writes
 * another file and refuses to replace one silently; leaving with unsaved strokes asks, and switching views keeps a
 * draft. Screenshots go to design/texture-editor/.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/texture-editor");

/** Pixel [r, g, b, a, width] of a project texture, decoded in the page. */
const pixel = (app: App, path: string, x: number, y: number) =>
  app.eval<number[]>(`(async () => {
    const url = await window.mcedge.readTexture(${JSON.stringify(project)}, ${JSON.stringify(path)});
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return [...g.getImageData(${x}, ${y}, 1, 1).data, img.naturalWidth];
  })()`);

/** Page coordinates of the centre of texture pixel (x, y) on the editor canvas. */
async function cell(app: App, x: number, y: number): Promise<[number, number]> {
  const r = await app.rect(".paintcanvas");
  const texWidth = await app.eval<number>(`window.__texWidth ?? 16`);
  const step = r.width / texWidth;
  return [r.x + (x + 0.5) * step, r.y + (y + 0.5) * step];
}

const unsaved = (app: App) => app.eval<boolean>(`!!document.querySelector(".edname .unsaved")`);
/** Ctrl+S and wait until the editor is clean again. */
async function save(app: App) {
  await app.key("s", 2);
  await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
}
const click = async (app: App, x: number, y: number) => {
  const [px, py] = await cell(app, x, y);
  await app.mouse("mousePressed", px, py);
  await app.mouse("mouseReleased", px, py);
};

await run(async (app) => {
  await app.click(".rtab", "Resources");
  await app.waitFor(`document.querySelector(".texcell")`);
  await app.click(".abtn", "New texture");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.click(".dialog input");
  await app.type("test_gem");
  await app.setValue(".dialog select", "item");
  await app.shot(`${OUT}/create-dialog-dark.png`);
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".paintcanvas")`);
  const path = "textures/item/test_gem.png";
  assert(!existsSync(join(project, path)), "a new texture is not written before Save");
  assert(await unsaved(app), "a new texture shows as unsaved");

  // Pencil stroke across row 2 in red (palette), fill the rest of the top-left area blue, erase one pixel.
  await app.eval(`window.__texWidth = 16`);
  await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);
  await app.drag(await cell(app, 1, 2), await cell(app, 14, 2));
  await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#3c44aa").click()`);
  await app.click(".abtn", "Fill");
  const [fx, fy] = await cell(app, 5, 8);
  await app.mouse("mouseMoved", fx, fy, 0);
  await app.mouse("mousePressed", fx, fy);
  await app.mouse("mouseReleased", fx, fy);
  await app.click(".abtn", "Eraser");
  await click(app, 7, 2);
  await app.sleep(700);
  assert(!existsSync(join(project, path)), "painting does not write the PNG");
  await app.shot(`${OUT}/unsaved-dark.png`);
  await save(app);
  assert(existsSync(join(project, path)), "Save creates the PNG");
  let p = await pixel(app, path, 3, 2);
  assert(p[0] === 0xb0 && p[1] === 0x2e && p[2] === 0x26 && p[3] === 255, `pencil pixel red, got ${p}`);
  p = await pixel(app, path, 5, 8);
  assert(p[0] === 0x3c && p[2] === 0xaa && p[3] === 255, `filled pixel blue, got ${p}`);
  p = await pixel(app, path, 7, 2);
  assert(p[3] === 0, `erased pixel transparent, got ${p}`);

  // Picker takes the red back; undo removes the erase, redo brings it back.
  await app.click(".abtn", "Pick colour");
  await click(app, 2, 2);
  const hex = await app.eval<string>(`document.querySelector(".paintform input.mono").value`);
  assert(hex === "#b02e26", `picker took the colour, got ${hex}`);
  assert(await app.eval<boolean>(`document.querySelector(".ptools .abtn.pressed").textContent.includes("Eraser")`), "picker returns to the previous tool");
  await app.key("z", 2);
  await save(app);
  p = await pixel(app, path, 7, 2);
  assert(p[3] === 255, `undo restored the erased pixel, got ${p}`);
  await app.key("y", 2);
  await save(app);
  p = await pixel(app, path, 7, 2);
  assert(p[3] === 0, `redo erased it again, got ${p}`);

  // Translucent pencil.
  await app.click(".abtn", "Pencil");
  await app.setValue(".paintform input[type=range]", "128");
  await click(app, 12, 12);
  await save(app);
  p = await pixel(app, path, 12, 12);
  assert(p[3] === 128, `translucent pixel alpha 128, got ${p}`);

  await app.click(".abtn", "Zoom in");
  await app.click(".abtn", "Zoom out");
  await app.shot(`${OUT}/editor-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/editor-light.png`);
  await app.click(".abtn", "Grid");
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".abtn.pressed")].some((b) => b.textContent.includes("Grid"))`)), "grid toggles off");
  await app.click(".abtn", "Grid");
  await app.setTheme("dark");

  // Resize to 32x32, then Save as a new file in textures/block: the 16x16 original stays as it was.
  await app.setValue(".paintform select", "32");
  await app.click(".abtn", "Save as");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.setValue(".dialog input", "test_gem_big");
  await app.setValue(".dialog select", "block");
  await app.shot(`${OUT}/save-as-dark.png`);
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`!document.querySelector(".dialog") && !document.querySelector(".edname .unsaved")`);
  const big = "textures/block/test_gem_big.png";
  p = await pixel(app, big, 6, 5);
  assert(p[4] === 32 && p[0] === 0xb0, `save as wrote the 32x32 copy, got ${p}`);
  assert((await pixel(app, path, 0, 0))[4] === 16, "the original stays 16x16");
  assert(await app.eval<boolean>(`document.querySelector(".edname").textContent.startsWith("test_gem_big.png")`), "the editor now edits the copy");

  // Save as onto an existing name needs Replace ticked.
  await app.click(".abtn", "Save as");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.setValue(".dialog input", "test_gem");
  await app.setValue(".dialog select", "item");
  await app.waitFor(`document.querySelector(".dialog .ferr")`);
  assert(await app.eval<boolean>(`document.querySelector(".dialog .abtn.primary").disabled`), "an existing name cannot be saved over without Replace");
  await app.shot(`${OUT}/save-as-taken-dark.png`);
  await app.key("Escape");

  // Back with unsaved strokes asks; Don't save leaves the file as it was.
  const bigBefore = readFileSync(join(project, big));
  await click(app, 0, 0);
  await app.click(".abtn", "Back to resources");
  await app.waitFor(`document.querySelector(".dialog[role=alertdialog]")`);
  await app.shot(`${OUT}/close-unsaved-dark.png`);
  await app.click(".dialog .abtn", "Don't save");
  await app.waitFor(`[...document.querySelectorAll(".texcell")].some((c) => c.title === ${JSON.stringify(big)})`);
  assert(readFileSync(join(project, big)).equals(bigBefore), "Don't save left the PNG unchanged");

  // Switching views with unsaved strokes keeps a draft, nothing is written; reopening restores it.
  await app.click(".texcell", "ruby.png", { double: true });
  await app.waitFor(`document.querySelector(".paintcanvas")`);
  await app.eval(`window.__texWidth = document.querySelector(".fmeta").textContent.match(/(\\d+) ×/)[1] * 1`);
  const rubyBefore = readFileSync(join(project, "textures", "ruby.png"));
  await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#80c71f").click()`);
  await app.drag(await cell(app, 0, 0), await cell(app, 0, 15));
  await app.click(".rtab", "Mod elements");
  await app.sleep(500);
  assert(readFileSync(join(project, "textures", "ruby.png")).equals(rubyBefore), "leaving does not write the PNG");
  await app.click(".tile", "Ruby");
  await app.waitFor(`document.querySelector(".tile img")`);
  const before = await app.eval<string>(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").querySelector("img").src`);
  await app.click(".rtab", "Resources");
  await app.click(".texcell", "ruby.png", { double: true });
  await app.waitFor(`document.querySelector(".livechip")?.textContent === "Unsaved changes restored"`);
  await app.shot(`${OUT}/draft-restored-dark.png`);
  await save(app);
  await app.click(".abtn", "Back to resources");
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").querySelector("img").src !== ${JSON.stringify(before)}`, 5000);
  const header = readFileSync(join(project, "textures", "ruby.png")).subarray(1, 4).toString();
  assert(header === "PNG", "ruby.png still a PNG");
  assert(!readFileSync(join(project, "textures", "ruby.png")).equals(rubyBefore), "Save wrote the restored strokes");

  // Menu entries open the dialog too.
  await app.click(".menu", "Resources");
  await app.click(".menulist button", "New texture");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.key("Escape");
}, { project });
