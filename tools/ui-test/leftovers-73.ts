/**
 * KUYRUK #73: Delete texture also removes the .mcmeta; Resources tiles show the first frame of an animated strip;
 * the model preview draws vanilla parents (minecraft:block/cube_all, cube_column) with the checker for textures
 * outside the project, and shows a block's item display field; an unsaved new texture survives an app restart.
 * Screenshots go to design/leftovers-73/.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePng } from "../../src/generator/png.ts";
import { assert, exampleProject, launchApp, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/leftovers-73";
const project = exampleProject();

// An animated strip of two frames (red, blue) with its .mcmeta.
const strip = { width: 16, height: 32, data: new Uint8Array(16 * 32 * 4) };
for (let i = 0; i < 16 * 32; i++) strip.data.set(i < 256 ? [200, 30, 30, 255] : [30, 30, 200, 255], i * 4);
mkdirSync(join(project, "textures", "block"), { recursive: true });
writeFileSync(join(project, "textures/block/glow.png"), writePng(strip));
writeFileSync(join(project, "textures/block/glow.png.mcmeta"), JSON.stringify({ animation: { frametime: 2 } }));
// Models whose parents are vanilla.
mkdirSync(join(project, "models"), { recursive: true });
writeFileSync(join(project, "models/rubycube.json"), JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "hellomcedge:ruby_block" } }));
writeFileSync(join(project, "models/stonecube.json"), JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "minecraft:block/stone" } }));
writeFileSync(join(project, "models/pillar.json"), JSON.stringify({ parent: "block/cube_column", textures: { side: "ruby_block", end: "ruby_apple" } }));
addElement(project, "block", "disp_block", { name: "Display Block", texture: "textures/ruby_block.png", renderType: 2, customModelName: "rubycube", itemDisplay: JSON.stringify({ head: { scale: [1.5, 1.5, 1.5] } }) });

const colours = (app: App) => app.eval<number>(`(() => {
  const c = document.querySelector(".mpcanvas canvas");
  const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height;
  const g = copy.getContext("2d"); g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  return seen.size;
})()`);
const option = (app: App, value: string) => app.eval<{ disabled: boolean } | null>(`(() => { const o = [...document.querySelectorAll(".mpbar select option")].find((o) => o.value === ${JSON.stringify(value)}); return o ? { disabled: o.disabled } : null; })()`);

await run(async (app) => {
  await app.click(".rtab", "Resources");
  // 1. The tile of the animated strip shows only the first frame: a 48px box holding a 96px tall image.
  await app.waitFor(`[...document.querySelectorAll(".texcell")].some((c) => c.textContent.includes("glow"))`);
  await app.sleep(400);
  const tile = await app.eval<{ box: number; image: number }>(`(() => {
    const c = [...document.querySelectorAll(".texcell")].find((c) => c.textContent.includes("glow"));
    const img = c.querySelector("img"); return { box: img.parentElement.getBoundingClientRect().height, image: img.getBoundingClientRect().height };
  })()`);
  console.log("tile", tile);
  assert(tile.box === 48 && tile.image === 96, `first frame of the strip only: ${JSON.stringify(tile)}`);
  await app.shot(`${OUT}/tiles-first-frame.png`);

  // 2. Models: vanilla parents are drawn; a texture outside the project is the checker.
  await app.click(".ltab", "Models");
  await app.click("tr", "rubycube");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("1 ")`, 10000);
  await app.sleep(400);
  const solid = await colours(app);
  assert(solid > 4, `cube_all parent drawn, ${solid} colours`);
  assert(!(await app.eval<string>(`document.querySelector(".modelpreview").textContent`)).includes("is not a project model"), "vanilla parent known");
  const head = await option(app, "head");
  assert(head?.disabled === true, "no head display on a model without it");
  await app.shot(`${OUT}/model-cube-all.png`);
  await app.click("tr", "stonecube");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("1 ")`, 10000);
  await app.sleep(400);
  assert(await colours(app) > 2, "vanilla texture shows the checker");
  await app.shot(`${OUT}/model-cube-all-checker.png`);
  await app.click("tr", "pillar");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("1 ")`, 10000);
  await app.sleep(400);
  assert(await colours(app) > 4, "cube_column parent drawn");
  await app.shot(`${OUT}/model-cube-column.png`);

  // 3. The block form: its item display field adds the head context.
  await app.click(".rtab", "Mod elements");
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Display Block").id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Display Block"`);
  await app.click(".ltab", "Visual");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("1 ")`, 10000);
  await app.eval(`document.querySelector(".modelpreview").scrollIntoView({ block: "center" })`);
  await app.sleep(400);
  assert((await option(app, "head"))?.disabled === false, "item display field enables the head view");
  await app.setValue(".mpbar select", "head");
  await app.sleep(300);
  await app.shot(`${OUT}/block-form-item-display.png`);
  await app.click(".abtn", "Back to elements");

  // 4. Delete texture removes the .mcmeta.
  await app.click(".rtab", "Resources");
  await app.click(".ltab", "Textures");
  await app.click(".texcell", "glow");
  await app.click(".abtn", "Delete");
  await app.waitFor(`![...document.querySelectorAll(".texcell")].some((c) => c.textContent.includes("glow"))`);
  assert(!existsSync(join(project, "textures/block/glow.png")), "PNG deleted");
  assert(!existsSync(join(project, "textures/block/glow.png.mcmeta")), ".mcmeta deleted with it");
}, { project });

// 5. An unsaved new texture survives restarting the app.
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-keep-"));
const first = await launchApp({ project, userData });
try {
  await first.click(".rtab", "Resources");
  await first.click(".abtn", "New texture");
  await first.click(".dialog input");
  await first.type("keepme");
  await first.click(".dialog .abtn.primary");
  await first.waitFor(`document.querySelector(".paintcanvas")`);
  const r = await first.rect(".paintcanvas");
  await first.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);
  await first.mouse("mousePressed", r.x + r.width / 32, r.y + r.height / 32);
  await first.mouse("mouseReleased", r.x + r.width / 32, r.y + r.height / 32);
  await first.waitFor(`document.querySelector(".edname .unsaved")`);
  await first.sleep(2500);
  const stored = JSON.parse(readFileSync(join(userData, "texture-drafts.json"), "utf8"));
  assert(Object.values(stored).some((d) => Object.keys(d as object).some((p) => p.endsWith("keepme.png"))), "draft written to the user data folder");
} finally {
  await first.close();
}
assert(!existsSync(join(project, "textures/item/keepme.png")), "nothing saved to the project");
const second = await launchApp({ project, userData });
try {
  await second.click(".rtab", "Resources");
  await second.waitFor(`[...document.querySelectorAll(".gtitle")].some((g) => g.textContent.includes("Unsaved"))`, 10000);
  await second.shot(`${OUT}/draft-after-restart.png`);
  await second.click(".texcell.draft");
  await second.waitFor(`document.querySelector(".paintcanvas") && document.querySelector(".edname .unsaved")`, 10000);
  const painted = await second.eval<boolean>(`(() => { const c = document.querySelector(".paintcanvas"); const d = c.getContext("2d").getImageData(2, 2, 1, 1).data; return d[3] > 0 && d[0] > 150; })()`);
  assert(painted, "the stroke is back after the restart");
  await second.shot(`${OUT}/draft-restored-editor.png`);
} finally {
  await second.close();
}
console.log("PASS");
