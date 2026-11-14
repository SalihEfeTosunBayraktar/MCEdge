/**
 * KUYRUK 160: the GUI editor canvas draws animated and hover-state textures the way the generated screen does. First
 * the rule (image strips by .mcmeta or the widget's animated / frameTime / frameCount, toggle frames, image button
 * sprites); then, on a copy of ETREconomy's recycler GUI (the user's example) with an animated toggle button and an
 * image button with an animated hover texture added: the booster strip (16 x 144, .mcmeta) is one 16 x 16 frame and
 * plays, the old one-file lock button shows its lower half under the mouse, the toggle and the hover sprite play, in
 * edit and preview mode. LIGHT=1 also takes the light screenshots. Screenshots go to design/160/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { widgetSchedule } from "../../app/renderer/src/gui/widgetAnimation.ts";
import { showInApp } from "../../src/live/show.ts";
import { assert, copyProject, run, type App } from "./cdp.ts";

const OUT = "design/160";

// ---- the rule, as src/generator/types/gui.ts plays it
const mcmeta = JSON.stringify({ animation: { frametime: 4, interpolate: true } });
const booster = widgetSchedule("image", 16, 144, mcmeta)!;
assert(booster.frameHeight === 16 && booster.frames.length === 9 && booster.frames[0].time === 4 && !booster.interpolate, `image strip ${JSON.stringify(booster)}`);
assert(widgetSchedule("image", 16, 144, undefined) === undefined, "a strip without .mcmeta or animated is a still image");
const flagged = widgetSchedule("image", 16, 64, undefined, { animated: true, frameTime: 3, frameCount: 2 })!;
assert(flagged.frames.length === 2 && flagged.frames[1].time === 3, `animated flag, frameTime, frameCount ${JSON.stringify(flagged)}`);
assert(widgetSchedule("image", 16, 64, JSON.stringify({ animation: { height: 32 } }))!.frameCount === 2, ".mcmeta height");
assert(widgetSchedule("toggle", 16, 128, mcmeta)!.frames.length === 8, "toggle frames are square");
assert(widgetSchedule("toggle", 16, 128, undefined) === undefined, "a toggle texture without .mcmeta is still");
assert(widgetSchedule("sprite", 8, 40, mcmeta)!.interpolate, "an image button sprite plays like any .mcmeta texture");

// ---- the canvas
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const file = join(project, "elements/guis/recyclergui.json");
const gui = JSON.parse(readFileSync(file, "utf8"));
gui.components.push(
  { kind: "toggle_button", x: 120, y: 20, width: 16, height: 16, image: "textures/screens/fire_animation.png", onImage: "textures/screens/booster_animated.png", procedure: "", name: "test_toggle" },
  { kind: "image_button", x: 140, y: 40, width: 16, height: 16, image: "textures/screens/atlas/imagebutton_coin_get.png", hoverImage: "textures/screens/discount_animated.png", procedure: "", name: "test_hover" },
);
writeFileSync(file, JSON.stringify(gui, null, 2));
const index = (pred: (w: Record<string, unknown>) => boolean) => (gui.components as Record<string, unknown>[]).findIndex(pred);
const boosterAt = index((w) => w.image === "textures/screens/booster_animated.png" && w.kind === "image");
const lockAt = index((w) => w.kind === "image_button" && w.image === "textures/screens/atlas/imagebutton_unlockbutton.png");
const widget = (i: number) => `.guistage .gwidget[data-index="${i}"]`;

const pictures = async (app: App, selector: string, count = 12, ms = 150) => {
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) (seen.add(await app.eval<string>(`document.querySelector(${JSON.stringify(selector)})?.toDataURL() ?? ""`)), await app.sleep(ms));
  seen.delete("");
  return seen.size;
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.sleep(2000);
  await showInApp(project, "gui/recyclergui", 20000);
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length >= ${gui.components.length}`, 15000);
  await app.sleep(1500);
  assert(await app.eval<boolean>(`document.querySelector(${JSON.stringify(widget(boosterAt))}).classList.contains("k-image")`), "booster widget found");

  // The booster strip: one frame, playing.
  const box = await app.rect(widget(boosterAt));
  assert(Math.abs(box.height - box.width) < 1, `booster drawn one frame high: ${box.width} x ${box.height}`);
  assert(await pictures(app, `${widget(boosterAt)} canvas[data-animated]`) >= 3, "booster frames play");
  await app.shot(`${OUT}/after-dark.png`);

  // The toggle's off texture and the image button's hover sprite play too.
  assert(await pictures(app, `.gwidget.k-toggle_button .gnormal canvas[data-animated]`) >= 3, "toggle texture plays");

  // Old one-file button: the lower half under the mouse.
  const [lx, ly] = await app.center(widget(lockAt));
  const shift = () => app.eval<string>(`getComputedStyle(document.querySelector(${JSON.stringify(`${widget(lockAt)} .gsheet img`)})).transform`);
  assert(await shift() === "none", "lock button shows its upper half");
  await app.mouse("mouseMoved", lx, ly, 0);
  await app.sleep(250);
  assert(await shift() !== "none", "lock button shows its lower half under the mouse");
  await app.shot(`${OUT}/after-hover-sheet-dark.png`);

  // Two-file button: the animated hover sprite under the mouse.
  const hover = gui.components.length - 1;
  assert(await app.eval<boolean>(`!!document.querySelector(${JSON.stringify(`${widget(hover)} .gimgbtn canvas.ghover`)})`), "hover sprite drawn as an animated canvas");
  const [hx, hy] = await app.center(widget(hover));
  await app.mouse("mouseMoved", hx, hy, 0);
  await app.sleep(250);
  assert(await app.eval<boolean>(`getComputedStyle(document.querySelector(${JSON.stringify(`${widget(hover)} .ghover`)})).display === "block"`), "hover sprite under the mouse");
  assert(await pictures(app, `${widget(hover)} canvas.ghover`) >= 3, "hover sprite plays");

  // Preview mode draws the same.
  await app.key("p");
  await app.waitFor(`document.querySelector(".guistage.preview")`);
  await app.mouse("mouseMoved", lx, ly, 0);
  await app.sleep(250);
  assert(await shift() !== "none", "preview: lower half under the mouse");
  assert(await pictures(app, `${widget(boosterAt)} canvas[data-animated]`) >= 3, "preview: booster plays");
  await app.mouse("mouseMoved", 5, 5, 0);
  await app.sleep(250);
  await app.shot(`${OUT}/after-preview-dark.png`);
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(600);
    await app.shot(`${OUT}/after-preview-light.png`);
    await app.setTheme("dark");
  }
}, { project, language: "tr", width: 1440, height: 900 });
