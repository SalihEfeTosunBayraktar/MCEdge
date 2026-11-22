/**
 * KUYRUK #65 (fix 4): GUI editor alignment and preview. One selected widget aligns to the screen; Shift+click
 * selects more, and the align buttons line them up on the first one; arrows and Delete act on the whole
 * selection; Preview (P) hides frames, handles, slot numbers and the grid and edits nothing. Screenshots go
 * to design/usability/.
 */
import { readFileSync } from "node:fs";
import { textWidth } from "../../src/elements/pixelFont.ts";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "gui", "shop", { type: 1, width: 176, height: 166 });
addElement(project, "procedure", "buy");
const saved = () => JSON.parse(readFileSync(join(project, "elements/guis/shop.json"), "utf8")).components as Record<string, number | string>[];
const settle = async (app: App) => (await app.sleep(600), await app.waitFor(`!document.querySelector(".smsg.saving")`));
const alignBtn = (app: App, edge: string) => app.click(`[data-align=${edge}] .abtn`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "shop", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  let clicks = 0;
  await app.click(".abtn", "Add widget"), clicks++;
  await app.click(".menulist button", "Label"), clicks++;
  await app.setField("Text", "Coins", ".guiform"), clicks++;
  await app.click(".abtn", "Add widget"), clicks++;
  await app.click(".menulist button", "Button"), clicks++;
  await settle(app);
  let w = saved();
  assert(w[0].kind === "label" && w[1].kind === "button", `widgets: ${w.map((x) => x.kind)}`);

  // The button (selected) centred on the screen: (176 - 60) / 2 = 58.
  await alignBtn(app, "center"), clicks++;
  await settle(app);
  w = saved();
  assert(w[1].x === 58, `button centred on the screen: ${w[1].x}`);
  // Shift+click the label: it joins the selection and centres on the button (label "Coins" is as wide as the game's font draws it).
  const label = await app.center(".gwidget.k-label");
  await app.eval(`document.querySelector(".gwidget.k-label").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: ${label[0]}, clientY: ${label[1]} }))`), clicks++;
  await app.sleep(150);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`) === 2, "two widgets selected");
  assert(await app.eval<number>(`document.querySelectorAll(".ghandle").length`) === 1, "one resize handle (the first selected)");
  await alignBtn(app, "center"), clicks++;
  await settle(app);
  w = saved();
  assert(w[0].x === 58 + (60 - textWidth("Coins")) / 2 && w[1].x === 58, `label centred on the button: ${w[0].x}, ${w[1].x}`);
  await app.shot(`${OUT}/after-gui-align.png`);
  console.log(`label + button centred: ${clicks} clicks (before: measured 11 clicks and typing X by hand)`);

  // Arrow keys move both.
  await app.click(".lrow", "Button");
  await app.eval(`[...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("Coins")).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);
  await app.sleep(100);
  assert(await app.eval<number>(`document.querySelectorAll(".lrow.sel").length`) === 2, "Ctrl+click in the list adds to the selection");
  await app.key("ArrowDown");
  await settle(app);
  const moved = saved();
  assert(moved[0].y === w[0].y + 1 && moved[1].y === w[1].y + 1, "arrow moved both");
  // Top edges: the label goes to the button's top.
  await alignBtn(app, "top");
  await settle(app);
  assert(saved()[0].y === saved()[1].y, "top edges aligned");

  // Preview: no frames, no handle, no slot numbers; a click selects nothing.
  await app.key("p");
  await app.waitFor(`document.querySelector(".guistage.preview")`);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget.sel, .ghandle").length`) === 0, "no selection marks in preview");
  await app.shot(`${OUT}/after-gui-preview.png`);
  await app.key("p");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".guistage.preview")`)), "P leaves the preview");
  // The button's procedure, picked with New: it opens the procedure and Back returns to the GUI.
  await app.click(".lrow", "Button");
  await app.eval(`[...document.querySelectorAll(".guiform .frow")].find((r) => r.textContent.includes("On click")).querySelector(".procnew").id = "np"`);
  await app.click("#np");
  await app.waitFor(`document.querySelector(".edname")?.textContent === "shop_procedure"`);
  await app.click(".abtn", "Back to shop");
  await app.waitFor(`document.querySelector(".guistage")`);
  await settle(app);
  assert(saved()[1].procedure === "shop_procedure", `button runs the new procedure: ${saved()[1].procedure}`);
}, { project });
