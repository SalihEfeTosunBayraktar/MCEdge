/**
 * KUYRUK #65 (fix 2): the empty space right of an element form shows a live preview like MCreator: the main
 * texture large, in inventory slots with the name as a tooltip, and the other texture fields (block faces). It
 * follows the draft and hides on narrow windows. Screenshots go to design/usability/.
 */
import { assert, exampleProject, launchApp, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
addElement(project, "block", "pillar", { name: "Ruby Pillar", texture: "textures/ruby_block.png", textureTop: "textures/ruby_apple.png" });

const big = (app: App) => app.eval<string>(`document.querySelector(".formpreview .pvbig img")?.getAttribute("src") ?? ""`);
const open = async (app: App, name: string) => {
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === ${JSON.stringify(name)}).id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === ${JSON.stringify(name)}`);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await open(app, "Ruby");
  await app.waitFor(`document.querySelector(".formpreview .pvbig img")`);
  const box = await app.eval<{ form: number; preview: number; view: number; tip: string }>(`({
    form: document.querySelector(".formcols > .form").getBoundingClientRect().right,
    preview: document.querySelector(".formpreview").getBoundingClientRect().left,
    view: document.querySelector(".formscroll").getBoundingClientRect().right,
    tip: document.querySelector(".pvtip").textContent })`);
  assert(box.preview > box.form && box.preview < box.view, `preview right of the form: ${JSON.stringify(box)}`);
  assert(box.tip === "Ruby", `tooltip shows the name: ${box.tip}`);
  const before = await big(app);
  await app.shot(`${OUT}/after-item-form.png`);

  // Picking another texture updates the preview at once.
  await app.click(".texpicked");
  await app.click(".texpop .texcell", "ruby_apple");
  await app.waitFor(`document.querySelector(".formpreview .pvbig img")?.getAttribute("src") !== ${JSON.stringify(before)}`);
  await app.click(".abtn", "Back to elements");

  // A block with two texture fields lists both under Textures.
  await open(app, "Ruby Pillar");
  await app.waitFor(`document.querySelectorAll(".pvfaces figure").length >= 2`);
  const faces = await app.eval<string[]>(`[...document.querySelectorAll(".pvfaces figcaption")].map((f) => f.textContent)`);
  console.log("faces", faces);
  await app.shot(`${OUT}/after-block-form.png`);
  await app.click(".abtn", "Back to elements");
}, { project });

// A narrow window keeps the whole width for the form.
const narrow = await launchApp({ project, width: 1100 });
try {
  await narrow.waitFor(`document.querySelector(".tile")`);
  await open(narrow, "Ruby");
  await narrow.sleep(400);
  assert(await narrow.eval<boolean>(`getComputedStyle(document.querySelector(".formpreview")).display === "none"`), "hidden at 1100 px");
} finally {
  await narrow.close();
}
console.log("PASS narrow");
