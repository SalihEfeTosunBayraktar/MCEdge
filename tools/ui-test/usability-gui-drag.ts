/**
 * KUYRUK #81: with several widgets selected, a mouse drag on any selected widget moves the whole selection (the
 * pressed one snaps, the others keep their distance); a drag on an unselected widget selects and moves only it.
 * Screenshots go to design/usability/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
addElement(project, "gui", "shop", { type: 1, width: 176, height: 166 });
const saved = () => JSON.parse(readFileSync(join(project, "elements/guis/shop.json"), "utf8")).components as Record<string, number | string>[];
const settle = async (app: App) => (await app.sleep(600), await app.waitFor(`!document.querySelector(".smsg.saving")`));

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "shop", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  for (const kind of ["Label", "Button", "Slot"]) {
    await app.click(".abtn", "Add widget");
    await app.click(".menulist button", kind);
  }
  await settle(app);
  const before = saved();
  assert(before.length === 3, "three widgets");
  const z = await app.eval<number>(`Number(document.querySelector(".guistage").style.getPropertyValue("--z"))`);

  // Select the label and the button from the list (the slot stays out), then drag the button.
  await app.click(".lrow", "Label");
  await app.eval(`[...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("Button")).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);
  await app.sleep(150);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`) === 2, "two selected");
  const from = await app.center(".gwidget.k-button");
  await app.drag(from, [from[0] + 14 * z, from[1] + 9 * z]);
  await settle(app);
  const after = saved();
  const dx = [0, 1, 2].map((i) => Number(after[i].x) - Number(before[i].x)), dy = [0, 1, 2].map((i) => Number(after[i].y) - Number(before[i].y));
  console.log("dx", dx, "dy", dy);
  assert(dx[0] !== 0 && dx[0] === dx[1] && dy[0] === dy[1] && dy[0] !== 0, `label and button moved together: dx ${dx}, dy ${dy}`);
  assert(dx[2] === 0 && dy[2] === 0, "the unselected slot stayed");
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`) === 2, "the selection is kept after the drag");
  await app.shot(`${OUT}/after-gui-drag-selection.png`);

  // Dragging a widget outside the selection moves only that one and selects it.
  // Its top edge: the button sits over its middle.
  const box = await app.rect(".gwidget.k-slot");
  const slot: [number, number] = [box.x + box.width / 2, box.y + 2 * z];
  await app.drag(slot, [slot[0] - 10 * z, slot[1] + 4 * z]);
  await settle(app);
  const last = saved();
  assert(Number(last[2].x) !== Number(after[2].x) && last[0].x === after[0].x && last[1].x === after[1].x, "only the slot moved");
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`) === 1, "the slot alone is selected");
}, { project });
