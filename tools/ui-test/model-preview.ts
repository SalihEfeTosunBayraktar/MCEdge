/**
 * KUYRUK #58: the 3D preview of a JSON block model in Resources > Models and in the block form's model field.
 * A model with a rotated cube, two project textures and display transforms is drawn (the WebGL canvas holds
 * texture colours), the view switches to a display context, and MCP inspect_model reports the same model.
 * Screenshots go to design/model-preview/.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
const OUT = evidence("design/model-preview");
mkdirSync(join(project, "models"), { recursive: true });
const lamp = JSON.parse(readFileSync(join(REPO, "tools/codegen-test/project/models/ruby_lamp.json"), "utf8"));
lamp.textures = { 0: "ruby_block", 1: "hellomcedge:ruby", particle: "ruby_block" };
writeFileSync(join(project, "models", "ruby_lamp.json"), JSON.stringify(lamp, null, 2));
// A child model whose parent is the lamp: only textures, the cubes come from the parent.
writeFileSync(join(project, "models", "apple_lamp.json"), JSON.stringify({ parent: "hellomcedge:custom/ruby_lamp", textures: { 1: "ruby_apple" } }));
copyFileSync(join(project, "textures", "ruby.png"), join(project, "models", "unused.png"));
addElement(project, "block", "ruby_lamp", { name: "Ruby Lamp", texture: "textures/ruby_block.png", renderType: 2, customModelName: "ruby_lamp" });

/** Distinct opaque colours on the preview canvas (WebGL, preserveDrawingBuffer). */
const colours = (app: App) => app.eval<number>(`(() => {
  const c = document.querySelector(".mpcanvas canvas");
  const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height;
  const g = copy.getContext("2d"); g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  return seen.size;
})()`);

await run(async (app) => {
  await app.click(".rtab", "Resources");
  await app.click(".ltab", "Models");
  await app.click("tr", "ruby_lamp");
  await app.waitFor(`document.querySelector(".mpcanvas canvas") && document.querySelector(".mpmeta")?.textContent.startsWith("3 ")`, 10000);
  await app.sleep(400);
  const drawn = await colours(app);
  assert(drawn > 8, `model drawn with textures, ${drawn} colours`);
  await app.shot(`${OUT}/resources-dark.png`);
  await app.setValue(".mpbar select", "gui");
  await app.sleep(300);
  await app.shot(`${OUT}/resources-gui-dark.png`);
  await app.setValue(".mpbar select", "ground");
  await app.sleep(300);
  await app.setTheme("light");
  await app.shot(`${OUT}/resources-ground-light.png`);
  await app.setTheme("dark");

  // Parent chain: the child has no cubes of its own and still draws the lamp.
  await app.click("tr", "apple_lamp");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("3 ")`, 10000);

  // Orbit by dragging changes the picture.
  const before = await app.eval<string>(`document.querySelector(".mpcanvas canvas").toDataURL()`);
  const r = await app.rect(".mpcanvas");
  await app.drag([r.x + r.width / 2, r.y + r.height / 2], [r.x + r.width / 2 + 80, r.y + r.height / 2 + 20], 8);
  await app.sleep(200);
  assert(before !== await app.eval<string>(`document.querySelector(".mpcanvas canvas").toDataURL()`), "drag turns the model");

  // Block form: the model field shows the same preview.
  await app.click(".rtab", "Mod elements");
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby Lamp").id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Lamp"`);
  await app.click(".ltab", "Visual");
  await app.waitFor(`document.querySelector(".mpmeta")?.textContent.startsWith("3 ")`, 10000);
  await app.eval(`document.querySelector(".modelpreview").scrollIntoView({ block: "center" })`);
  await app.sleep(400);
  assert(await colours(app) > 8, "block form preview drawn");
  await app.shot(`${OUT}/block-form-dark.png`);

  const mcp = await connect(project);
  try {
    const info = await mcp.call<{
      chain: string[]; elements: number; rotatedElements: number; textures: { variable: string; projectFile: string | null }[]; display: string[];
    }>("inspect_model", { name: "apple_lamp" });
    assert(info.chain.join(",") === "apple_lamp,ruby_lamp", `chain ${info.chain}`);
    assert(info.elements === 3 && info.rotatedElements === 1, `elements ${info.elements}/${info.rotatedElements}`);
    assert(info.textures.find((t) => t.variable === "1")?.projectFile === "textures/ruby_apple.png", "child texture wins");
    assert(info.textures.find((t) => t.variable === "0")?.projectFile === "textures/ruby_block.png", "parent texture kept");
    assert(info.display.includes("gui"), "display contexts");
    console.log("inspect_model", JSON.stringify(info));
  } finally {
    await mcp.close();
  }
}, { project });
