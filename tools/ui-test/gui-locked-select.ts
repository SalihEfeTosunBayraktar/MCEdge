/**
 * KUYRUK #88: a locked widget (its own lock or a locked layer) is clicked and selected on the canvas, shows its form,
 * but a drag, the arrow keys and the resize handle leave it where it is. A hidden layer stays out of the canvas.
 * Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence, textOf } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
addElement(project, "gui", "lockgui", {
  type: 1, width: 176, height: 166,
  layers: [{ name: "Back", locked: true }, { name: "Front" }, { name: "Ghost", hidden: true }],
  components: [
    { kind: "image", x: 10, y: 10, width: 32, height: 32, image: "textures/ruby.png", layer: "Back" },
    { kind: "button", x: 60, y: 10, width: 60, height: 20, text: "Pinned", procedure: "", editLocked: true, layer: "Front" },
    { kind: "button", x: 60, y: 40, width: 60, height: 20, text: "Free", procedure: "", layer: "Front" },
    { kind: "label", x: 60, y: 70, text: "Hidden", layer: "Ghost" },
  ],
});
type W = { kind: string; x: number; y: number; width?: number; text?: string };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "lockgui.json"), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const selectedKinds = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".gwidget.sel")].map((e) => ${textOf("e")} || e.className.match(/k-(\\w+)/)[1])`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "lockgui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".gwidget")].some((e) => ${textOf("e")}.includes("Hidden"))`)), "the hidden layer is not drawn");

  // Widget lock: click selects, drag does not move, no resize handle, arrows do nothing.
  const before = saved();
  const pinnedBox = await app.rect(".gwidget.k-button", "Pinned");
  const c: [number, number] = [pinnedBox.x + pinnedBox.width / 2, pinnedBox.y + pinnedBox.height / 2];
  await app.drag(c, [c[0] + 45, c[1] + 30]);
  await waitSaved(app);
  assert((await selectedKinds(app)).join() === "Pinned", `a locked widget is selected by a click: ${await selectedKinds(app)}`);
  assert(await app.eval<boolean>(`!!document.querySelector(".guiform input[type=checkbox]:checked")`), "its form shows, Locked in the editor ticked");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".gwidget.sel .ghandle")`)), "no resize handle on a locked widget");
  await app.key("ArrowRight");
  await waitSaved(app);
  const after = saved();
  assert(after[1].x === before[1].x && after[1].y === before[1].y, `locked widget did not move: ${after[1].x},${after[1].y}`);
  await app.shot(`${OUT}/locked-selected-dark.png`);

  // Layer lock: the image on the locked layer is selected too, and stays put.
  const imgBox = await app.rect(".gwidget.k-image");
  const ic: [number, number] = [imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2];
  await app.drag(ic, [ic[0] + 60, ic[1] + 60]);
  await waitSaved(app);
  assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.k-image.sel")`), "a widget on a locked layer is selected by a click");
  assert(saved()[0].x === 10 && saved()[0].y === 10, "the widget on a locked layer did not move");

  // A free widget still drags; Shift+click adds the locked one, and a drag of the pair moves only the free one.
  const freeBox = await app.rect(".gwidget.k-button", "Free");
  const fc: [number, number] = [freeBox.x + freeBox.width / 2, freeBox.y + freeBox.height / 2];
  await app.click(".gwidget.k-button", "Free");
  await app.eval(`(() => { const e = [...document.querySelectorAll(".gwidget")].find((x) => ${textOf("x")}.includes("Pinned")); const r = e.getBoundingClientRect();
    e.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: r.x + 4, clientY: r.y + 4, pointerId: 1 })); })()`);
  await app.sleep(100);
  assert((await selectedKinds(app)).length === 2, `free and locked selected: ${await selectedKinds(app)}`);
  await app.drag(fc, [fc[0] + 30, fc[1] + 60]);
  await waitSaved(app);
  const moved = saved();
  assert(moved[2].x !== 60 || moved[2].y !== 40, `the free widget moved: ${moved[2].x},${moved[2].y}`);
  assert(moved[1].x === 60 && moved[1].y === 10, "the locked one in the selection stayed");
  await app.setTheme("light");
  await app.shot(`${OUT}/locked-selected-light.png`);
}, { project });
