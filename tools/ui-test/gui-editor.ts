/**
 * KUYRUK #6: lays out a GUI with every widget kind (add, move, resize, snap, properties, delete, undo) and an
 * overlay, checks the saved gui_layout JSON and that the generator turns it into screen code.
 * Screenshots go to design/gui-editor/.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateTarget } from "../../src/generator/generate.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { assert, exampleProject, run, type App, openSection, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "gui", "machine", { type: 1, width: 176, height: 166 });
addElement(project, "overlay", "mana_hud");
addElement(project, "procedure", "on_press");
const OUT = evidence("design/gui-editor");
const guiFile = join(project, "elements", "guis", "machine.json");
const saved = () => JSON.parse(readFileSync(guiFile, "utf8")).components as Record<string, unknown>[];
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const add = async (app: App, kind: string) => {
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", kind);
};
const stageOrigin = async (app: App) => {
  const r = await app.rect(".guistage");
  const z = await app.eval<number>(`Number(document.querySelector(".guistage").style.getPropertyValue("--z"))`);
  return { x: r.x, y: r.y, z };
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "machine", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  assert(await app.eval<number>(`document.querySelectorAll(".gslot.inv").length`) === 36, "player inventory preview has 36 slots");

  for (const kind of ["Label", "Button", "Text field", "Checkbox", "Image", "Slot"]) await add(app, kind);
  await waitSaved(app);
  let widgets = saved();
  assert(widgets.map((w) => w.kind).join() === "label,button,text_field,checkbox,image,slot", `kinds saved: ${widgets.map((w) => w.kind)}`);

  // Move the slot (selected, last added) to (8, 20) by dragging.
  const o = await stageOrigin(app);
  const slot = await app.rect(".gwidget.k-slot");
  const from: [number, number] = [slot.x + slot.width / 2, slot.y + slot.height / 2];
  const sx = widgets[5].x as number, sy = widgets[5].y as number;
  await app.drag(from, [from[0] + (8 - sx) * o.z, from[1] + (20 - sy) * o.z]);
  await waitSaved(app);
  widgets = saved();
  assert(widgets[5].x === 8 && widgets[5].y === 20, `slot moved to 8,20, got ${widgets[5].x},${widgets[5].y}`);

  // Resize the button by its corner handle to 80x24.
  await app.click(".lrow", "Button");
  const handle = await app.center(".gwidget.sel .ghandle");
  await app.drag(handle, [handle[0] + 20 * o.z, handle[1] + 4 * o.z]);
  await waitSaved(app);
  widgets = saved();
  assert(widgets[1].width === 80 && widgets[1].height === 24, `button resized to 80x24, got ${widgets[1].width}x${widgets[1].height}`);

  // Properties: button text and procedure, label text and colour.
  await app.setField("Text", "Craft", ".guiform");
  await app.setField("On click", "on_press", ".guiform");
  await app.click(".lrow", "Label");
  await app.setField("Text", "Ruby machine", ".guiform");
  await app.setField("Colour", "#b02e26", ".guiform");
  await app.click(".lrow", "Slot");
  await app.setField("Slot index", "1", ".guiform");
  await waitSaved(app);
  widgets = saved();
  assert(widgets[1].text === "Craft" && widgets[1].procedure === "on_press", `button props saved: ${JSON.stringify(widgets[1])}`);
  assert(widgets[0].text === "Ruby machine" && widgets[0].color === "#b02e26", `label props saved: ${JSON.stringify(widgets[0])}`);
  assert(widgets[5].id === 1, `slot id saved: ${JSON.stringify(widgets[5])}`);

  // Snap on: a drag lands on the 18 px grid with offset 11/15 (gui defaults).
  await app.click(".abtn", "Snap to grid");
  await waitSaved(app);
  const slot2 = await app.rect(".gwidget.k-slot");
  await app.drag([slot2.x + 9 * o.z, slot2.y + 9 * o.z], [slot2.x + 9 * o.z + 30 * o.z, slot2.y + 9 * o.z + 5 * o.z]);
  await waitSaved(app);
  widgets = saved();
  const s = widgets[5] as { x: number; y: number };
  assert((s.x - 11) % 18 === 0 && (s.y - 15) % 18 === 0, `snapped slot on grid, got ${s.x},${s.y}`);

  // Delete removes, Ctrl+Z brings it back, arrow keys nudge.
  await app.click(".lrow", "Checkbox");
  await app.key("Delete");
  await waitSaved(app);
  assert(saved().length === 5, "Delete removed the checkbox");
  await app.key("z", 2);
  await waitSaved(app);
  assert(saved().some((w) => w.kind === "checkbox"), "Ctrl+Z restored it");
  await app.click(".lrow", "Text field");
  const before = saved().find((w) => w.kind === "text_field")!;
  await app.key("ArrowRight");
  await app.key("ArrowDown");
  await waitSaved(app);
  const after = saved().find((w) => w.kind === "text_field")!;
  assert(after.x === (before.x as number) + 1 && after.y === (before.y as number) + 1, "arrow keys nudge by one pixel");

  // A tidy machine layout for the screenshots, set through the properties form.
  const place = async (row: string, values: Record<string, string>) => {
    await app.click(".lrow", row);
    for (const [label, value] of Object.entries(values)) await app.setField(label, value, ".guiform");
  };
  await place("Label", { X: "8", Y: "6" });
  await place("Slot", { X: "29", Y: "29" });
  await place("Image", { X: "56", Y: "30" });
  await place("Button", { X: "86", Y: "26", Width: "80", Height: "20" });
  await place("Text field", { X: "8", Y: "56", Width: "100" });
  await place("Checkbox", { Text: "Auto", X: "116", Y: "56" });
  await waitSaved(app);
  await app.click(".lrow", "Button");
  await app.shot(`${OUT}/gui-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/gui-light.png`);
  await openSection(app, "Screen");
  await app.shot(`${OUT}/gui-screen-tab-light.png`);
  await app.setTheme("dark");

  // Overlay: labels and images only, on the 427x240 canvas.
  await app.click(".abtn", "Back to elements");
  await app.click(".tile", "mana_hud", { double: true });
  await app.waitFor(`document.querySelector(".guistage.overlay")`);
  await app.click(".abtn", "Add widget");
  const kinds = await app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent)`);
  assert(kinds.join() === "Label,Image,State image", `overlay offers label, image and state image (KUYRUK 186), got ${kinds}`);
  await app.click(".menulist button", "Label");
  await app.setField("Text", "Mana: 20", ".guiform");
  await add(app, "Image");
  await waitSaved(app);
  await app.click(".lrow", "Label");
  await app.shot(`${OUT}/overlay-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/overlay-light.png`);
  const overlay = JSON.parse(readFileSync(join(project, "elements", "overlays", "mana_hud.json"), "utf8")).components;
  assert(overlay[0].kind === "label" && overlay[0].text === "Mana: 20" && overlay[1].kind === "image", "overlay saved");
}, { project });

// The generator accepts what the editor saved: the screen class carries the widgets.
const engine = listEngines().find((e) => e.id.startsWith("fabric")) ?? listEngines()[0];
const out = mkdtempSync(join(tmpdir(), "mcedge-gui-gen-"));
generateTarget(loadProject(project), project, engine, out);
const find = (dir: string, name: RegExp): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? find(join(dir, d.name), name) : name.test(d.name) ? [join(dir, d.name)] : []);
const screen = find(out, /MachineScreen\.java$/)[0];
assert(screen, `generated MachineScreen.java on ${engine.id}`);
const java = readFileSync(screen, "utf8");
assert(java.includes("0xFFB02E26"), "label colour in the generated screen");
const menu = readFileSync(find(out, /MachineMenu\.java$/)[0], "utf8");
assert(menu.includes("new net.minecraft.world.inventory.Slot(container, 1,") || menu.includes("Slot(container, 1,"), "slot 1 in the generated menu");
console.log(`generated ${engine.id}: ${screen}`);
