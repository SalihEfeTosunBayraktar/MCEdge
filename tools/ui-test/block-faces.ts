/**
 * KUYRUK 187: a block's face textures sit on a 3D cube. Each face shows its name and texture; a click on a face opens
 * the texture grid of the field that draws it (a slab's side opens the front texture); dragging turns the cube without
 * picking; the fields stay as rows beside the cube for the keyboard; a custom model block keeps only its main texture
 * row (no cube). Screenshots (dark and light, en and tr) go to design/187/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/187";
const project = exampleProject();
addElement(project, "block", "cube_demo", { name: "Ruby Cube", texture: "textures/ruby_block.png", textureTop: "textures/ruby_apple.png" });
addElement(project, "block", "slab_demo", { name: "Ruby Slab", blockBase: "Slab", texture: "textures/ruby_block.png" });
addElement(project, "block", "model_demo", { name: "Ruby Model", renderType: 2, customModelName: "missing_model", texture: "textures/ruby_block.png" });
const stored = (id: string) => JSON.parse(readFileSync(join(project, "elements/blocks", `${id}.json`), "utf8")) as Record<string, unknown>;
const saved = async (app: App, id: string, key: string, value: string) => {
  for (let i = 0; i < 50 && stored(id)[key] !== value; i++) await app.sleep(200);
  assert(stored(id)[key] === value, `${id}.${key} saved as ${value}: ${String(stored(id)[key])}`);
};
const open = async (app: App, name: string) => {
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === ${JSON.stringify(name)}).id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === ${JSON.stringify(name)}`);
};
/** Page position of a face's centre: its label sits there (labels let clicks through to the canvas). */
const face = (app: App, name: string) => app.center(`.cubelabel[data-face="${name}"]`);
const label = (app: App, name: string) => app.eval<string>(`document.querySelector('.cubelabel[data-face="${name}"]').textContent`);
const opacity = (app: App, name: string) => app.eval<number>(`Number(document.querySelector('.cubelabel[data-face="${name}"]').style.opacity)`);
const canvas = (app: App) => app.eval<string>(`document.querySelector(".cubecanvas canvas").toDataURL()`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await open(app, "Ruby Cube");
  await app.waitFor(`document.querySelector(".cubecanvas canvas")`);
  await app.eval(`document.querySelector(".cuberow").scrollIntoView({ block: "center" })`);
  await app.sleep(800);

  // One cube row holds the six face fields; their own rows are gone from the form.
  const rows = await app.eval<string[]>(`[...document.querySelectorAll(".cuberow .cubefields .frow[data-field]")].map((r) => r.dataset.field)`);
  assert(rows.join(",") === "texture,textureTop,textureLeft,textureFront,textureRight,textureBack", `face rows ${rows}`);
  assert(await app.eval<number>(`document.querySelectorAll(".form .frow[data-field^='texture']").length`) === 6, "no loose face rows");
  // The default view shows the top, the front and the right face with their names and textures.
  assert((await label(app, "up")) === "Topruby_apple", `top label ${await label(app, "up")}`);
  assert((await label(app, "north")) === "Frontruby_block", `front label (main texture) ${await label(app, "north")}`);
  for (const f of ["up", "north", "west"]) assert(await opacity(app, f) > 0.5, `${f} named`);
  for (const f of ["down", "south", "east"]) assert(await opacity(app, f) === 0, `${f} hidden behind`);
  await app.shot(`${OUT}/after-cube-dark.png`);

  // Hovering a face outlines it and marks its field.
  const [fx, fy] = await face(app, "north");
  await app.mouse("mouseMoved", fx, fy, 0);
  await app.waitFor(`document.querySelector('.cubefields .frow.on')?.dataset.field === "textureFront"`);
  assert(await app.eval<boolean>(`document.querySelector('.cubelabel[data-face="north"]').classList.contains("on")`), "hovered face label marked");

  // A click on the front face opens the front texture's grid; picking draws it on the cube.
  const before = await canvas(app);
  await app.mouse("mousePressed", fx, fy, 1);
  await app.mouse("mouseReleased", fx, fy, 0);
  await app.waitFor(`document.querySelector(".texpop input")`);
  await app.type("ruby_apple");
  await app.key("Enter");
  await saved(app, "cube_demo", "textureFront", "textures/ruby_apple.png");
  await app.waitFor(`document.querySelector('.cubelabel[data-face="north"]').textContent === "Frontruby_apple"`);
  await app.sleep(600);
  assert(await canvas(app) !== before, "front face redrawn");

  // Dragging turns the cube and picks nothing: the back face comes into view.
  await app.drag([fx, fy], [fx + 150, fy], 12);
  await app.sleep(300);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".texpop")`)), "a drag opens no grid");
  assert(await opacity(app, "south") > 0.5 || await opacity(app, "east") > 0.5, "turned to the back");
  await app.click(".cubereset");
  await app.sleep(300);
  assert(await opacity(app, "north") > 0.5, "reset view shows the front again");

  // Keyboard: the back texture's button is in the tab order with its name; Enter opens the grid, Escape closes it.
  await app.eval(`document.querySelector('.cubefields .frow[data-field="textureBack"] .texpicked').focus()`);
  const aria = await app.eval<string>(`document.activeElement.getAttribute("aria-label")`);
  assert(aria === "Back texture: None", `button name ${aria}`);
  assert(await app.eval<boolean>(`document.querySelector('.cubelabel[data-face="south"]').classList.contains("on")`), "focused field marks its face");
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".texpop")`);
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".texpop")`);

  if (process.env.LIGHT !== "0") {
    await app.setTheme("light");
    await app.sleep(600);
    await app.shot(`${OUT}/after-cube-light.png`);
    await app.setTheme("dark");
  }
  await app.click(".abtn", "Back to elements");

  // A slab draws its sides with the front texture: a click on a side opens that field; its other side fields say so.
  await open(app, "Ruby Slab");
  await app.waitFor(`document.querySelector(".cubecanvas canvas")`);
  await app.eval(`document.querySelector(".cuberow").scrollIntoView({ block: "center" })`);
  await app.sleep(800);
  const unused = await app.eval<string[]>(`[...document.querySelectorAll(".cubefields .frow")].filter((r) => r.textContent.includes("Not drawn by this block's shape.")).map((r) => r.dataset.field)`);
  assert(unused.join(",") === "textureLeft,textureRight,textureBack", `unused on a slab ${unused}`);
  const [sx, sy] = await face(app, "west");
  await app.mouse("mouseMoved", sx, sy, 0);
  await app.waitFor(`document.querySelector('.cubefields .frow.on')?.dataset.field === "textureFront"`);
  assert(await app.eval<number>(`document.querySelectorAll(".cubelabel.on").length`) === 4, "every side is outlined");
  await app.mouse("mousePressed", sx, sy, 1);
  await app.mouse("mouseReleased", sx, sy, 0);
  await app.waitFor(`document.querySelector(".texpop input")`);
  await app.type("ruby_apple");
  await app.key("Enter");
  await saved(app, "slab_demo", "textureFront", "textures/ruby_apple.png");
  assert(stored("slab_demo").textureRight === "", "the right texture stays empty");
  await app.shot(`${OUT}/after-slab-dark.png`);
  await app.click(".abtn", "Back to elements");

  // A custom model has no cube faces: the main texture stays a plain row.
  await open(app, "Ruby Model");
  await app.waitFor(`document.querySelector('.frow[data-field="texture"]')`);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".cuberow")`)), "no cube for a custom model");
  await app.click(".abtn", "Back to elements");
}, { project, width: 1440, height: 900 });

// Turkish names on the faces and the rows.
await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await open(app, "Ruby Cube");
  await app.waitFor(`document.querySelector(".cubecanvas canvas")`);
  await app.eval(`document.querySelector(".cuberow").scrollIntoView({ block: "center" })`);
  await app.sleep(800);
  assert((await label(app, "up")).startsWith("Üst"), `tr top ${await label(app, "up")}`);
  assert((await app.eval<string>(`document.querySelector(".cuberow > label").textContent`)) === "Blok yüzleri", "tr row label");
  await app.shot(`${OUT}/after-cube-tr-dark.png`);
}, { project, language: "tr", width: 1440, height: 900 });
