/**
 * KUYRUK #89: grid size and offset in the GUI editor toolbar. Typing a value redraws the grid at once and saves
 * gridSx/gridSy/gridOx/gridOy; dragging a field's letter changes the value; a moved widget snaps to the new grid;
 * Ctrl+Z undoes a grid change (a whole drag is one step). Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
addElement(project, "gui", "gridgui", {
  type: 1, width: 176, height: 166, snapOnGrid: true, gridSx: 18, gridSy: 18, gridOx: 0, gridOy: 0,
  components: [{ kind: "slot", x: 18, y: 18, id: 0, output: false, limit: "" }],
});
type G = { gridSx: number; gridSy: number; gridOx: number; gridOy: number; components: { x: number; y: number }[] };
const saved = () => JSON.parse(readFileSync(join(project, "elements", "guis", "gridgui.json"), "utf8")) as G;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const input = (n: number) => `.gridctl .scrub:nth-child(${n + 1}) input`;
const gridStyle = (app: App) => app.eval<string>(`(() => { const g = document.querySelector(".ggrid"); return g ? g.style.backgroundSize + " @ " + g.style.backgroundPosition : "none"; })()`);
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "gridgui", { double: true });
  await app.waitFor(`document.querySelector(".gridctl")`);
  const zoom = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  assert((await gridStyle(app)).startsWith(`${18 * zoom}px ${18 * zoom}px`), `grid drawn at 18: ${await gridStyle(app)}`);

  // Type sizes and offsets: live redraw and saved.
  await app.setValue(input(1), "8");
  await app.setValue(input(2), "10");
  await app.setValue(input(3), "3");
  await app.setValue(input(4), "5");
  assert(await gridStyle(app) === `${8 * zoom}px ${10 * zoom}px @ ${3 * zoom}px ${5 * zoom}px`, `grid redrawn live: ${await gridStyle(app)}`);
  await waitSaved(app);
  let g = saved();
  assert(g.gridSx === 8 && g.gridSy === 10 && g.gridOx === 3 && g.gridOy === 5, `grid saved: ${JSON.stringify(g)}`);
  await app.shot(`${OUT}/grid-toolbar-dark.png`);

  // A dragged widget snaps to the new grid: x = 3 + 8k, y = 5 + 10k.
  const box = await app.rect(".gwidget.k-slot");
  const c: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await app.drag(c, [c[0] + 37 * zoom, c[1] + 23 * zoom]);
  await waitSaved(app);
  const w = saved().components[0];
  assert((w.x - 3) % 8 === 0 && (w.y - 5) % 10 === 0, `widget snapped to the new grid: ${w.x},${w.y}`);

  // Drag the W letter 40 px to the right: +10.
  const label = await app.rect(".gridctl .scrub:nth-child(2) .scrublabel");
  const l: [number, number] = [label.x + label.width / 2, label.y + label.height / 2];
  await app.drag(l, [l[0] + 40, l[1]], 10);
  await waitSaved(app);
  g = saved();
  assert(g.gridSx === 18, `dragging the letter changed the width by 10: ${g.gridSx}`);
  assert(await app.eval<string>(`document.querySelector(${JSON.stringify(input(1))}).value`) === "18", "the field shows it");
  // Width never goes below 1.
  await app.drag(l, [l[0] - 200, l[1]], 10);
  await waitSaved(app);
  assert(saved().gridSx === 1, `width clamped at 1: ${saved().gridSx}`);

  // Undo: the clamp drag, then the +10 drag, each one step.
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().gridSx === 18, `Ctrl+Z undoes the whole drag: ${saved().gridSx}`);
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().gridSx === 8, `Ctrl+Z again: ${saved().gridSx}`);
  await app.key("y", CTRL);
  await waitSaved(app);
  assert(saved().gridSx === 18, `Ctrl+Y redoes: ${saved().gridSx}`);

  // Snap off: the grid hides, but shows while a grid field has the focus.
  await app.click(".abtn", "Snap to grid");
  await app.sleep(200);
  assert(await gridStyle(app) === "none", "no grid lines without snapping");
  await app.eval(`document.querySelector(${JSON.stringify(input(3))}).focus()`);
  await app.sleep(200);
  assert(await gridStyle(app) !== "none", "grid lines show while a grid field is focused");
  await app.setTheme("light");
  await app.shot(`${OUT}/grid-toolbar-light.png`);
}, { project });
