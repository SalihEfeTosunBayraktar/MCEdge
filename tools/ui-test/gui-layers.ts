/**
 * KUYRUK #53: layers in the GUI editor. Adds a layer, renames it, puts a widget on it, locks it (the canvas
 * selects but does not move the widget, KUYRUK #88), hides it (not drawn), reorders layers (the saved widget
 * order follows) and removes a layer (its widgets move down). Screenshots go to design/gui-layers/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "gui", "machine", { type: 1, width: 176, height: 166 });
const OUT = evidence("design/gui-layers");
const guiFile = join(project, "elements", "guis", "machine.json");
const file = () => JSON.parse(readFileSync(guiFile, "utf8")) as { components: Record<string, unknown>[]; layers?: { name: string; hidden?: boolean; locked?: boolean }[] };
const saved = () => file().components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const add = async (app: App, kind: string) => {
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", kind);
};
/** Rows are listed top layer first: layer `i` (0 = bottom) is row n-1-i. */
const rowOf = (i: number) => `(() => { const rows = [...document.querySelectorAll(".layerrow")]; return rows[rows.length - 1 - ${i}]; })()`;
const layerButton = (app: App, i: number, title: string) => app.eval<boolean>(`(() => {
  const b = [...${rowOf(i)}.querySelectorAll("button")].find((x) => x.title.startsWith(${JSON.stringify(title)}));
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);
const rename = (app: App, i: number, name: string) => app.eval(`(() => {
  const e = ${rowOf(i)}.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(name)});
  e.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
const layerRows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".layerrow input")].map((e) => e.value).reverse()`);
const names = () => (file().layers ?? []).map((l) => l.name);
const order = () => saved().map((w) => `${w.kind}@${w.layer}`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "machine", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  assert((await layerRows(app)).length === 1, "a fresh layout shows one default layer");

  // Add a layer and rename both.
  await app.click(".layerlist .mbtn", "Add layer");
  await app.sleep(200);
  assert((await layerRows(app)).length === 2, "Add layer adds a row");
  await rename(app, 0, "Background");
  await rename(app, 1, "Controls");
  await waitSaved(app);
  assert(names().join() === "Background,Controls", `layers saved and renamed: ${names()}`);

  // "Controls" is the active layer (new): a button goes on it. Then the first layer takes a label and a slot.
  await add(app, "Button");
  // A press on the blank part of the row (Q248: the row takes mousedown, its name field takes the focus).
  await app.eval(`${rowOf(0)}.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
  await add(app, "Label");
  await add(app, "Slot");
  await waitSaved(app);
  // Saved sorted by layer: the button was added first but sits after the Background widgets.
  assert(order().join() === "label@Background,slot@Background,button@Controls", `widgets sorted by layer: ${order()}`);
  await app.shot(`${OUT}/layers-added-dark.png`);

  // A widget can change layer from its own form.
  await app.click(".lrow", "Label");
  await app.setValue(".guiform label.frow select", "Controls");
  await waitSaved(app);
  assert(order().join() === "slot@Background,label@Controls,button@Controls", `widget moved to the Controls layer: ${order()}`);
  await app.click(".lrow", "Label");
  await app.setValue(".guiform label.frow select", "Background");
  await waitSaved(app);
  assert(order().join() === "slot@Background,label@Background,button@Controls", `and back (order inside a layer is kept): ${order()}`);

  // Lock Controls: dragging the button on the canvas moves nothing, the list still selects it.
  assert(await layerButton(app, 1, "Lock"), "lock button of Controls");
  await waitSaved(app);
  assert(file().layers![1].locked === true, "layer saved as locked");
  const button = saved().find((w) => w.kind === "button")!;
  assert(await app.eval<boolean>(`document.querySelector(".gwidget.k-button").classList.contains("glocked")`), "locked widget is marked");
  await app.click(".lrow", "Slot");
  const box = await app.rect(".gwidget.k-button");
  const c: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await app.drag(c, [c[0] + 40, c[1] + 25]);
  await waitSaved(app);
  const after = saved().find((w) => w.kind === "button")!;
  assert(after.x === button.x && after.y === button.y, `locked widget did not move: ${button.x},${button.y} -> ${after.x},${after.y}`);
  // KUYRUK 88: a locked widget is still picked on the canvas, only not moved.
  assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.k-button.sel")`), "a click on the locked widget selects it");
  await app.click(".lrow", "Button");
  assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.k-button.sel")`), "the list selects a locked widget");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".gwidget.sel .ghandle")`)), "a locked widget has no resize handle");
  await app.shot(`${OUT}/layer-locked-dark.png`);
  // Unlocked, the same drag moves it.
  assert(await layerButton(app, 1, "Unlock"), "unlock button");
  const box2 = await app.rect(".gwidget.k-button");
  const c2: [number, number] = [box2.x + box2.width / 2, box2.y + box2.height / 2];
  await app.drag(c2, [c2[0] + 40, c2[1] + 25]);
  await waitSaved(app);
  const moved = saved().find((w) => w.kind === "button")!;
  assert(moved.x !== button.x || moved.y !== button.y, "unlocked widget moves again");

  // Hide Background: its widgets are not drawn.
  const drawn = await app.eval<number>(`document.querySelectorAll(".gwidget").length`);
  assert(drawn === 3, `three widgets drawn, got ${drawn}`);
  assert(await layerButton(app, 0, "Hide"), "hide button of Background");
  await app.sleep(200);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget").length`) === 1, "hidden layer's widgets are not drawn");
  await waitSaved(app);
  assert(file().layers![0].hidden === true, "layer saved as hidden");
  await app.shot(`${OUT}/layer-hidden-dark.png`);
  assert(await layerButton(app, 0, "Show"), "show button");
  await app.sleep(200);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget").length`) === 3, "shown again");
  await waitSaved(app);

  // Reorder: Background moves up, so Controls is drawn first and the saved order follows.
  assert(await layerButton(app, 0, "Move up"), "move up button");
  await waitSaved(app);
  assert(names().join() === "Controls,Background", `layer order saved: ${names()}`);
  assert(order().join() === "button@Controls,slot@Background,label@Background", `widgets follow the layer order: ${order()}`);
  assert((await layerRows(app)).join() === "Controls,Background", "list shows the new order (bottom layer first here)");
  await app.shot(`${OUT}/layers-reordered-dark.png`);

  // Remove: Controls (now the bottom layer) goes, its button moves to the remaining layer.
  assert(await layerButton(app, 0, "Remove"), "remove button");
  await waitSaved(app);
  assert(names().join() === "Background", `layer removed: ${names()}`);
  assert(order().join() === "button@Background,slot@Background,label@Background", `widgets moved down: ${order()}`);
  assert(!(await layerButton(app, 0, "Remove")), "the last layer cannot be removed");
  await app.setTheme("light");
  await app.shot(`${OUT}/layer-removed-light.png`);
}, { project });
