/**
 * KUYRUK #91: right-click menu in the GUI editor, on a widget (it becomes the selection) and on the empty canvas
 * (paste). Runs every command once: duplicate, copy, paste, rename, group, ungroup, lock/unlock, move to layer,
 * bring forward / send back inside the layer, align, make grid, delete. Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence, textOf } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
addElement(project, "gui", "menugui", {
  type: 0, width: 176, height: 166, snapOnGrid: false, gridSx: 18, gridSy: 18,
  layers: [{ name: "Back" }, { name: "Front" }],
  components: [
    { kind: "button", x: 10, y: 10, width: 40, height: 20, text: "One", procedure: "", layer: "Back" },
    { kind: "button", x: 60, y: 10, width: 40, height: 20, text: "Two", procedure: "", layer: "Back" },
    { kind: "label", x: 10, y: 120, text: "Three", layer: "Front" },
  ],
});
type W = { kind: string; x: number; y: number; text?: string; name?: string; group?: string; layer?: string; editLocked?: boolean };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "menugui.json"), "utf8")) as { components: W[] }).components;
const texts = () => saved().map((w) => w.text).join();
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const rightClick = async (app: App, text?: string) => {
  if (text) await app.click(".gwidget", text, { button: "right" });
  else {
    const r = await app.rect(".guistage");
    await app.mouse("mouseMoved", r.x + r.width - 6, r.y + r.height / 2, 0);
    await app.eval(`document.querySelector(".guistage").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${r.x + r.width - 6}, clientY: ${r.y + r.height / 2} }))`);
  }
  await app.waitFor(`document.querySelector(".menulist.ctx")`);
};
const items = (app: App) => app.eval<{ label: string; enabled: boolean }[]>(`[...document.querySelectorAll(".menulist.ctx button")].map((b) => ({ label: b.textContent.slice(0, b.textContent.length - (b.querySelector(".kbd")?.textContent.length ?? 0)).trim(), enabled: !b.disabled }))`);
const choose = async (app: App, label: string) => {
  const ok = await app.eval<boolean>(`(() => { const b = [...document.querySelectorAll(".menulist.ctx button")].find((x) => x.textContent.startsWith(${JSON.stringify(label)})); if (!b || b.disabled) return false; b.click(); return true; })()`);
  assert(ok, `menu item ${label} is there and enabled`);
  await app.sleep(150);
};
const selectedTexts = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".gwidget.sel")].map((e) => ${textOf("e")}).sort()`);
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "menugui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);

  // Right click on a widget selects it and lists every command.
  await rightClick(app, "One");
  assert((await selectedTexts(app)).join() === "One", "right click selects the widget");
  const labels = (await items(app)).map((i) => i.label);
  console.log("menu", labels.join(" | "));
  for (const l of ["Duplicate", "Copy", "Paste", "Rename", "Group", "Ungroup", "Lock in the editor", "Move to layer ›", "Bring forward (in the layer)",
    "Send back (in the layer)", "Align ›", "Make grid", "Delete"]) assert(labels.includes(l), `menu has ${l}`);
  await app.shot(`${OUT}/context-menu-widget-dark.png`);

  // Bring forward inside the layer: One goes after Two (still before the Front layer).
  await choose(app, "Bring forward");
  await waitSaved(app);
  assert(texts() === "Two,One,Three", `brought forward: ${texts()}`);
  await rightClick(app, "One");
  assert(!(await items(app)).find((i) => i.label.startsWith("Bring forward"))!.enabled, "no further forward: the next widget is on another layer");
  await choose(app, "Send back");
  await waitSaved(app);
  assert(texts() === "One,Two,Three", `sent back: ${texts()}`);

  // Duplicate, then Delete the copy.
  await rightClick(app, "Two");
  await choose(app, "Duplicate");
  await waitSaved(app);
  assert(saved().filter((w) => w.text === "Two").length === 2, "duplicated from the menu");
  await rightClick(app, "Two");
  await choose(app, "Delete");
  await waitSaved(app);
  assert(saved().filter((w) => w.text === "Two").length === 1, "deleted from the menu");

  // Copy, then paste from the empty canvas menu.
  await rightClick(app, "Three");
  await choose(app, "Copy");
  await rightClick(app);
  assert((await selectedTexts(app)).length === 0, "the canvas menu clears the selection");
  assert(!(await items(app)).find((i) => i.label === "Duplicate")!.enabled, "canvas menu: Duplicate needs a selection");
  await app.shot(`${OUT}/context-menu-canvas-dark.png`);
  await choose(app, "Paste");
  await waitSaved(app);
  assert(saved().filter((w) => w.text === "Three").length === 2, "pasted from the canvas menu");
  await app.key("z", CTRL);
  await waitSaved(app);

  // Rename from the menu opens the list field.
  await rightClick(app, "One");
  await choose(app, "Rename");
  await app.waitFor(`document.querySelector(".guilist .lrename")`);
  await app.type("first");
  await app.key("Enter");
  await waitSaved(app);
  assert(saved()[0].name === "first", `renamed from the menu: ${saved()[0].name}`);

  // Group One and Two (Shift+right click keeps both), then ungroup.
  await app.click(".gwidget", "One");
  await app.eval(`(() => { const e = [...document.querySelectorAll(".gwidget")].find((x) => ${textOf("x")} === "Two"); const r = e.getBoundingClientRect();
    e.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: r.x + 3, clientY: r.y + 3, pointerId: 1 })); })()`);
  await rightClick(app, "Two");
  assert((await selectedTexts(app)).join() === "One,Two", "right click on a selected widget keeps the selection");
  await choose(app, "Group");
  await waitSaved(app);
  assert(saved().filter((w) => w.group === "Group 1").length === 2, "grouped from the menu");
  await rightClick(app, "One");
  await choose(app, "Ungroup");
  await waitSaved(app);
  assert(!saved().some((w) => w.group), "ungrouped from the menu");

  // Lock, then Unlock.
  await rightClick(app, "Three");
  await choose(app, "Lock in the editor");
  await waitSaved(app);
  assert(saved().find((w) => w.text === "Three")!.editLocked === true, "locked from the menu");
  await rightClick(app, "Three");
  assert(!(await items(app)).find((i) => i.label === "Delete")!.enabled, "a locked widget cannot be deleted from the menu");
  await choose(app, "Unlock");
  await waitSaved(app);
  assert(!saved().find((w) => w.text === "Three")!.editLocked, "unlocked from the menu");

  // Move to layer (a second page of the menu).
  await rightClick(app, "Three");
  await choose(app, "Move to layer");
  await app.waitFor(`[...document.querySelectorAll(".menulist.ctx button")].some((b) => b.textContent.includes("Back") && !b.textContent.includes("‹"))`);
  await app.shot(`${OUT}/context-menu-layer-dark.png`);
  await app.eval(`[...document.querySelectorAll(".menulist.ctx button")].find((b) => b.textContent.trim() === "Back").click()`);
  await waitSaved(app);
  assert(saved().find((w) => w.text === "Three")!.layer === "Back", `moved to Back: ${JSON.stringify(saved())}`);

  // Align page: centre on the screen.
  await rightClick(app, "Three");
  await choose(app, "Align");
  await choose(app, "Centre horizontally on the screen");
  await waitSaved(app);
  const three = saved().find((w) => w.text === "Three")!;
  assert(three.x === Math.round((176 - 5 * 6) / 2), `centred from the menu: ${three.x}`);

  // Make grid from the menu opens the dialog.
  await rightClick(app, "Three");
  await choose(app, "Make grid");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.key("Escape");
  await app.setTheme("light");
  await rightClick(app, "One");
  await app.shot(`${OUT}/context-menu-widget-light.png`);
}, { project });
