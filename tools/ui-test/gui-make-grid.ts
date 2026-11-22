/**
 * KUYRUK #85: Make grid turns the selected widget into an N x M grid in one group: steps default to the widget's
 * size, slots get consecutive ids, images keep their texture, the cells are selected, one undo step removes it.
 * Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
addElement(project, "gui", "gridmaker", {
  type: 0, width: 220, height: 180,
  components: [
    { kind: "slot", x: 7, y: 7, id: 4, output: false, limit: "" },
    { kind: "slot", x: 200, y: 160, id: 6, output: false, limit: "" },
    { kind: "image", x: 10, y: 120, width: 16, height: 16, image: "textures/ruby_apple.png" },
  ],
});
type W = { kind: string; x: number; y: number; id?: number; image?: string; group?: string };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "gridmaker.json"), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const dialogField = (app: App, label: string, value: string) => app.setField(label, value, ".dialog");
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "gridmaker", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);

  // 3 x 9 slots from slot #4: ids 4, 5, 7, 8, ... (6 is taken), 18 px apart.
  await app.click(".guilist .lrow", "#4");
  await app.click(".abtn[aria-label='Make grid']");
  await app.waitFor(`document.querySelector(".dialog")`);
  const steps = await app.eval<string[]>(`[...document.querySelectorAll(".dialog input")].map((e) => e.value)`);
  assert(steps.join() === "3,3,18,18", `defaults: 3 x 3, step = slot size: ${steps}`);
  await dialogField(app, "Columns", "9");
  await app.shot(`${OUT}/make-grid-dialog-dark.png`);
  await app.click(".dialog .abtn.primary");
  await waitSaved(app);
  let list = saved();
  const slots = list.filter((w) => w.kind === "slot" && w.group === "Grid 1");
  console.log("slots", slots.length, slots.slice(0, 4).map((w) => `${w.id}@${w.x},${w.y}`).join(" "));
  assert(slots.length === 27, `27 slots in the group: ${slots.length}`);
  const ids = slots.map((w) => w.id!);
  assert(ids[0] === 4 && ids[1] === 5 && ids[2] === 7 && new Set(ids).size === 27 && !ids.includes(6), `consecutive ids skipping 6: ${ids.slice(0, 5)}`);
  assert(slots.some((w) => w.x === 7 + 8 * 18 && w.y === 7 + 2 * 18), "last cell at 8, 2 steps");
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`) === 27, "the grid is selected");
  await app.shot(`${OUT}/make-grid-slots-dark.png`);

  // 2 x 2 images: step defaults to 16 x 16, texture kept, a second group.
  await app.click(".guilist .lrow", "ruby_apple");
  await app.click(".abtn[aria-label='Make grid']");
  await app.waitFor(`document.querySelector(".dialog")`);
  await dialogField(app, "Rows", "2");
  await dialogField(app, "Columns", "2");
  await dialogField(app, "Step X (px)", "20");
  await app.key("Enter");
  await waitSaved(app);
  list = saved();
  const images = list.filter((w) => w.kind === "image");
  assert(images.length === 4 && images.every((w) => w.image === "textures/ruby_apple.png" && w.group === "Grid 2"), `4 images, same texture, Grid 2: ${JSON.stringify(images)}`);
  assert(images.some((w) => w.x === 30 && w.y === 136), "step X 20, step Y 16");
  // Invalid: one cell.
  await app.click(".abtn[aria-label='Make grid']");
  await dialogField(app, "Rows", "1");
  await dialogField(app, "Columns", "1");
  assert(await app.eval<boolean>(`document.querySelector(".dialog .abtn.primary").disabled`), "1 x 1 cannot be made");
  await app.key("Escape");
  await app.sleep(200);

  // Undo: the images grid in one step.
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().filter((w) => w.kind === "image").length === 1 && !saved().find((w) => w.kind === "image")!.group, "Ctrl+Z removes the image grid and its group");
  await app.setTheme("light");
  await app.shot(`${OUT}/make-grid-slots-light.png`);
}, { project });
