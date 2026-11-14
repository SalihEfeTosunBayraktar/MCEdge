/**
 * KUYRUK #94: GUI canvas size in sight. Width and height fields in the toolbar resize the canvas as they are typed;
 * dragging the canvas corner resizes it (one undo step per drag); the Screen tab shows the same values; overlays
 * have neither (their canvas stays 427x240). Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/gui-editor";
const project = exampleProject();
addElement(project, "gui", "sizegui", { type: 0, width: 176, height: 166, components: [{ kind: "label", x: 8, y: 6, text: "Shop" }] });
addElement(project, "overlay", "sizehud", { components: [{ kind: "label", x: 4, y: 4, text: "HUD" }] });
const saved = () => JSON.parse(readFileSync(join(project, "elements", "guis", "sizegui.json"), "utf8")) as { width: number; height: number };
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const stage = (app: App) => app.eval<{ w: number; h: number }>(`(() => { const r = document.querySelector(".guistage").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "sizegui", { double: true });
  await app.waitFor(`document.querySelector(".sizectl")`);
  const zoom = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const values = await app.eval<string[]>(`[...document.querySelectorAll(".sizectl input")].map((e) => e.value)`);
  assert(values.join() === "176,166", `toolbar shows the size: ${values}`);

  // Type a width and a height.
  await app.setValue(".sizectl .scrub:nth-child(2) input", "220");
  await app.setValue(".sizectl .scrub:nth-child(3) input", "120");
  await waitSaved(app);
  assert(saved().width === 220 && saved().height === 120, `typed size saved: ${JSON.stringify(saved())}`);
  const s1 = await stage(app);
  assert(s1.w === 220 * zoom && s1.h === 120 * zoom, `canvas redrawn at once: ${JSON.stringify(s1)}`);
  await app.shot(`${OUT}/canvas-size-typed-dark.png`);

  // Drag the corner: +30, +20 GUI pixels.
  const h = await app.rect(".gcanvashandle");
  const c: [number, number] = [h.x + h.width / 2, h.y + h.height / 2];
  await app.drag(c, [c[0] + 30 * zoom, c[1] + 20 * zoom], 12);
  await waitSaved(app);
  assert(saved().width === 250 && saved().height === 140, `corner drag resized: ${JSON.stringify(saved())}`);
  assert((await app.eval<string[]>(`[...document.querySelectorAll(".sizectl input")].map((e) => e.value)`)).join() === "250,140", "the fields follow the drag");
  await app.shot(`${OUT}/canvas-size-dragged-dark.png`);

  // One undo step per drag, then the typed height and width.
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().width === 220 && saved().height === 120, `Ctrl+Z undoes the whole drag: ${JSON.stringify(saved())}`);
  await app.key("z", CTRL);
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().width === 176 && saved().height === 166, `back to the start: ${JSON.stringify(saved())}`);
  await app.key("y", CTRL);
  await waitSaved(app);
  assert(saved().width === 220, `Ctrl+Y redoes: ${JSON.stringify(saved())}`);

  // The Screen tab shows the same width.
  await app.click(".ltab", "Screen");
  await app.sleep(200);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".guiform input")].some((e) => e.value === "220")`), "the Screen tab shows the width");
  await app.click(".ltab", "Widget");

  // Overlays: no size fields, no corner.
  await app.click(".abtn", "Back to elements");
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "sizehud", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget")`);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".sizectl, .gcanvashandle")`)), "an overlay has no size fields or corner");
  await app.click(".abtn", "Back to elements");
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "sizegui", { double: true });
  await app.waitFor(`document.querySelector(".sizectl")`);
  await app.setTheme("light");
  await app.shot(`${OUT}/canvas-size-light.png`);
}, { project });
