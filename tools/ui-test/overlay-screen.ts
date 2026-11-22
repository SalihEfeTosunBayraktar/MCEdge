/**
 * KUYRUK 170: overlays on screens of any size. The overlay editor's Screen preview shows the overlay on a chosen window
 * size and GUI scale: the stage becomes the whole screen in canvas pixels (fitted to the area), each widget sits where
 * its anchor puts it (the same rule as the generated code, src/elements/overlayLayout.ts), the 427x240 canvas is a
 * dashed frame, and a widget dragged there still saves its canvas x, y. The overlay's Anchor / Size fields and a
 * widget's own Anchor are saved. en and tr, dark and light; screenshots in design/170/.
 * usage: node tools/ui-test/overlay-screen.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, openSection, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/170");
const project = exampleProject();
addElement(project, "overlay", "screenhud", {
  components: [
    { kind: "label", x: 4, y: 4, text: "TL", color: "#FFFF55", anchor: "top_left" },
    { kind: "label", x: 400, y: 226, text: "BR", color: "#55FF55", anchor: "bottom_right" },
    { kind: "label", x: 200, y: 116, text: "MID", color: "#FFFFFF" },
  ],
});
type W = { x: number; y: number; anchor?: string };
const saved = () => JSON.parse(readFileSync(join(project, "elements", "overlays", "screenhud.json"), "utf8")) as { components: W[]; anchor?: string; scaleMode?: string };
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
/** A widget's top left on the stage, in canvas pixels (stage pixels divided by the stage's scale). */
const at = async (app: App, text: string, perUnit: number) => {
  const stage = await app.rect(".guistage");
  const r = await app.rect(".guistage .gwidget", text);
  return { x: Math.round((r.x - stage.x) / perUnit), y: Math.round((r.y - stage.y) / perUnit) };
};
const stageUnit = async (app: App, screenWidth: number) => (await app.rect(".guistage")).width / screenWidth;
const meta = (app: App) => app.eval<string>(`document.querySelector(".guiscreenmeta").textContent`);
const windowSelect = `.guiscreen select[aria-label="Window"]`;
const scaleSelect = `.guiscreen select[aria-label="GUI scale"]`;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "screenhud", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);
  // The canvas as before: 427x240, widgets at their x, y, no frame.
  const canvas = await stageUnit(app, 427);
  const r0 = await app.rect(".guistage");
  assert(Math.abs(r0.height / canvas - 240) < 1, `canvas 427x240: ${r0.width}x${r0.height}`);
  const mid0 = await at(app, "MID", canvas);
  assert(mid0.x === 200 && mid0.y === 116, `canvas places MID at its x, y: ${JSON.stringify(mid0)}`);
  assert(await app.eval<boolean>(`!document.querySelector(".gdesign")`), "no canvas frame on the canvas itself");
  assert((await meta(app)).includes("Pick a window"), `hint without a window: ${await meta(app)}`);
  await app.shot(`${OUT}/canvas-dark.png`);

  // 1920x1080, GUI scale auto (4): 480x270 canvas pixels; TL at 4,4, BR 53 px right and 30 down, MID 27 right and 15 down.
  await app.setValue(windowSelect, "4");
  await app.waitFor(`document.querySelector(".guistage.onscreen")`);
  const u = await stageUnit(app, 480);
  const r1 = await app.rect(".guistage");
  assert(Math.abs(r1.height / u - 270) < 1, `stage is 480x270 canvas pixels: ${r1.width}x${r1.height}`);
  const tl = await at(app, "TL", u), br = await at(app, "BR", u), mid = await at(app, "MID", u);
  assert(tl.x === 4 && tl.y === 4, `top_left stays at 4,4: ${JSON.stringify(tl)}`);
  assert(br.x === 453 && br.y === 256, `bottom_right keeps its distance to the corner: ${JSON.stringify(br)}`);
  assert(mid.x === 227 && mid.y === 131, `centre follows the screen centre: ${JSON.stringify(mid)}`);
  const frame = await app.rect(".gdesign");
  assert(Math.abs((frame.x - r1.x) / u - 27) < 1 && Math.abs(frame.width / u - 427) < 1, "the dashed frame is the centred 427x240 canvas");
  assert((await meta(app)).includes("GUI scale 4") && (await meta(app)).includes("480 x 270"), `meta: ${await meta(app)}`);
  assert(await app.eval<boolean>(`document.querySelector(${JSON.stringify(scaleSelect)}).options[0].textContent === "Auto (4)"`), "auto option names the scale it picks");
  await app.shot(`${OUT}/1920-auto-dark.png`);

  // GUI scale 2: the screen is 960x540 canvas pixels, BR 533 right of its canvas place.
  await app.setValue(scaleSelect, "2");
  await app.waitFor(`document.querySelector(".guiscreenmeta").textContent.includes("960 x 540")`);
  const u2 = await stageUnit(app, 960);
  const br2 = await at(app, "BR", u2);
  assert(br2.x === 933 && br2.y === 526, `GUI scale 2: BR at 933,526: ${JSON.stringify(br2)}`);
  await app.shot(`${OUT}/1920-gui2-dark.png`);

  // Dragging a widget on the previewed screen changes its canvas x, y.
  const c = await app.center(".guistage .gwidget", "TL");
  await app.drag(c, [c[0] + 20 * u2, c[1] + 10 * u2], 6);
  await waitSaved(app);
  const moved = saved().components[0];
  assert(moved.x === 24 && moved.y === 14, `drag on the preview saves canvas x, y: ${JSON.stringify(moved)}`);

  // A widget's own anchor (widget form) and the overlay's anchor and size (Overlay tab).
  await app.click(".guilist .lrow", "MID");
  const anchorShown = await app.eval<string>(`(() => { const row = [...document.querySelectorAll(".guiform .frow")].find((r) => r.querySelector(":scope > label")?.textContent.trim() === "Anchor"); const s = row.querySelector("select"); return s.options[s.selectedIndex].textContent; })()`);
  assert(anchorShown === "As the overlay", `an unset widget anchor shows the overlay's: ${anchorShown}`);
  await app.setField("Anchor", "8", ".guiform"); // options: as the overlay, then ANCHORS (bottom is 8th)
  await waitSaved(app);
  assert(saved().components[2].anchor === "bottom", `widget anchor saved: ${JSON.stringify(saved().components[2])}`);
  const midB = await at(app, "MID", u2);
  assert(midB.x === 467 && midB.y === 416, `MID anchored bottom: ${JSON.stringify(midB)}`);
  await openSection(app, "Overlay");
  await app.setField("Size", "2", ".guiform"); // gui, fixed, fit
  await waitSaved(app);
  assert(saved().scaleMode === "fit", "scale mode saved");
  await app.setField("Anchor", "2", '.dk-sec[data-section="gui.screen"]'); // top_left, top, top_right
  await waitSaved(app);
  assert(saved().anchor === "top_right", "overlay anchor saved");
  await app.waitFor(`document.querySelector(".guiscreenmeta")?.textContent.includes("427 x 240")`);
  const fitU = await stageUnit(app, 427);
  const fitAt = await at(app, "TL", fitU);
  assert(fitAt.x === 24 && fitAt.y === 14, `fill the screen: the canvas is the screen on 16:9: ${JSON.stringify(fitAt)}`);
  await app.setValue(windowSelect, "6"); // 3440x1440 ultrawide: fill by the height, the canvas wider than 427
  await app.waitFor(`document.querySelector(".guiscreenmeta").textContent.includes("GUI scale")`);
  assert((await meta(app)).includes("x 240"), `fit fills the height on an ultrawide screen: ${await meta(app)}`);
  await app.setTheme("light");
  await app.shot(`${OUT}/3440-fit-light.png`);
}, { project });

// Turkish strings.
await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "screenhud", { double: true });
  await app.waitFor(`document.querySelector(".guiscreen")`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".procpanel .fgroup, .procpanel h3, .procpanel *")].some((e) => e.textContent.trim() === "Ekran önizlemesi")`), "tr: Ekran önizlemesi");
  await app.setValue(`.guiscreen select[aria-label="Pencere"]`, "1");
  await app.waitFor(`document.querySelector(".guiscreenmeta").textContent.includes("Arayüz ölçeği 3")`);
  await app.shot(`${OUT}/1280-tr-dark.png`);
}, { project, language: "tr" });
