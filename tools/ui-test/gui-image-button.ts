/**
 * KUYRUK #61: image buttons take a normal and a hover texture as two fields. The GUI editor shows both fields and
 * the hover texture under the mouse; a new textured button starts with both; an old one-file button still loads;
 * MCP write_gui_layout carries hoverImage; the generator writes two sprites (1.21.5 / 26.3) or one stacked texture
 * (1.16.5) for the new layout and keeps the halves of the old one. Screenshots go to design/gui-editor/.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { readPng } from "../../src/generator/png.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "procedure", "on_press");
addElement(project, "gui", "shop", {
  type: 0, width: 176, height: 166,
  components: [
    { kind: "image_button", x: 20, y: 20, width: 16, height: 8, image: "textures/ruby.png", procedure: "on_press" },
    { kind: "image_button", x: 60, y: 20, width: 32, height: 32, image: "textures/ruby.png", hoverImage: "textures/ruby_apple.png", procedure: "on_press" },
  ],
});
const OUT = evidence("design/gui-editor");
const saved = () => JSON.parse(readFileSync(join(project, "elements", "guis", "shop.json"), "utf8")).components as Record<string, unknown>[];

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "shop", { double: true });
  await app.waitFor(`document.querySelectorAll(".gwidget.k-image_button").length === 2`);
  assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.k-image_button .gimgbtn")`), "two-file button drawn with its two textures");

  // Select the two-file button: the form has both texture fields.
  const rows = await app.eval<string[]>(`[...document.querySelectorAll(".lrow")].map((r) => r.textContent)`);
  const index = rows.findIndex((r) => r.includes("ruby.png")) + 1;
  await app.eval(`[...document.querySelectorAll(".lrow")].filter((r) => r.textContent.includes("ruby.png"))[1].click()`);
  await app.waitFor(`[...document.querySelectorAll(".efrow label")].some((l) => l.textContent === "Hover texture")`);
  assert(index > 0, "layer list shows the buttons");
  const fields = await app.eval<string[]>(`[...document.querySelectorAll(".efrow label")].map((l) => l.textContent)`);
  assert(fields.includes("Normal texture") && fields.includes("Hover texture"), `fields ${fields}`);
  await app.shot(`${OUT}/image-button-fields-dark.png`);

  // Under the mouse the hover texture shows.
  const [hx, hy] = await app.center(".gwidget.k-image_button .gimgbtn");
  await app.mouse("mouseMoved", hx, hy, 0);
  await app.sleep(200);
  assert(await app.eval<boolean>(`getComputedStyle(document.querySelector(".gimgbtn .ghover")).display === "block"`), "hover texture under the mouse");
  await app.shot(`${OUT}/image-button-hover-dark.png`);

  // A new textured button starts with a normal and a hover texture.
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", "Textured button");
  await app.sleep(600);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  const added = saved().at(-1)!;
  assert(added.kind === "image_button" && typeof added.hoverImage === "string" && added.hoverImage !== "", `new button has a hover texture: ${JSON.stringify(added)}`);
  assert(saved()[0].hoverImage === undefined, "the old one-file button is kept as it was");
}, { project });

// MCP carries hoverImage and checks it.
const mcp = await connect(project);
try {
  const layout = await mcp.call("read_gui_layout", { id: "shop" });
  assert(layout.widgets[1].hoverImage === "textures/ruby_apple.png", "read_gui_layout returns hoverImage");
  const bad = await mcp.call("write_gui_layout", { id: "shop", widgets: [{ kind: "image_button", x: 0, y: 0, image: "textures/ruby.png", hoverImage: "textures/nope.png" }] }, true);
  assert(String(bad).includes("hoverImage"), `missing hover texture refused: ${bad}`);
  await mcp.call("write_gui_layout", { id: "shop", widgets: layout.widgets.slice(0, 2) });
} finally {
  await mcp.close();
}

// Generator: two sprites on modern engines, one stacked texture on 1.16.5, halves for the old layout.
const find = (dir: string, name: RegExp): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? find(join(dir, d.name), name) : name.test(d.name) ? [join(dir, d.name)] : []);
for (const engine of listEngines()) {
  const out = mkdtempSync(join(tmpdir(), "mcedge-imgbtn-"));
  generateTarget(loadProject(project), project, engine, out);
  /** A generated PNG by name, the GUI sprite (gui/sprites/) or the plain screen texture. */
  const png = (name: string, sprite: boolean) => {
    const file = find(out, new RegExp(`^${name}\\.png$`)).find((f) => /[\\/]sprites[\\/]/.test(f) === sprite);
    assert(file, `${engine.id}: ${sprite ? "sprite" : "texture"} ${name}.png generated`);
    return readPng(readFileSync(file));
  };
  if (engine.minecraft === "1.16.5") {
    const stacked = png("shop_1", false);
    assert(stacked.width === 16 && stacked.height === 32, `${engine.id}: stacked normal+hover texture 16x32, got ${stacked.width}x${stacked.height}`);
  } else {
    const normal = png("shop_1", true), hover = png("shop_1_highlighted", true), oldTop = png("shop_0", true);
    assert(normal.height === 16 && hover.height === 16, `${engine.id}: whole files as sprites`);
    assert(!Buffer.from(normal.data).equals(Buffer.from(hover.data)), `${engine.id}: hover sprite is the hover texture`);
    assert(oldTop.height === 8, `${engine.id}: old layout still split into halves`);
  }
  console.log(`${engine.id}: image button textures ok`);
}
