/**
 * KUYRUK 167: an image button whose hover texture is the same file as its normal one is drawn as the one-file layout.
 * On a copy of ETREconomy's recycler GUI, the coin button (imagebutton_coin_get.png, 16x32, as normal and hover texture)
 * shows its upper coin, and its lower coin under the mouse, in edit and preview mode; the stored widget is not changed.
 * Screenshots go to design/167/ (dark, and light with LIGHT=1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { showInApp } from "../../src/live/show.ts";
import { assert, copyProject, run, evidence } from "./cdp.ts";

const OUT = evidence("design/167");
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const file = join(project, "elements/guis/recyclergui.json");
const COIN = "textures/screens/atlas/imagebutton_coin_get.png";
const components = () => JSON.parse(readFileSync(file, "utf8")).components as Record<string, unknown>[];
const coinAt = components().findIndex((w) => w.kind === "image_button" && w.image === COIN && w.hoverImage === COIN);
assert(coinAt >= 0, "the recycler GUI has the coin button with the same normal and hover file");
const coin = `.guistage .gwidget[data-index="${coinAt}"]`;
const before = JSON.stringify(components()[coinAt]);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.sleep(2000);
  await showInApp(project, "gui/recyclergui", 20000);
  await app.waitFor(`document.querySelector(${JSON.stringify(coin)})`, 15000);
  await app.sleep(1000);
  const shift = () => app.eval<string>(`getComputedStyle(document.querySelector(${JSON.stringify(`${coin} .gsheet img`)})).transform`);
  assert(await app.eval<boolean>(`!!document.querySelector(${JSON.stringify(`${coin} .gsheet`)})`), "coin button drawn as the one-file layout");
  assert(await shift() === "none", "upper half (normal state)");
  await app.mouse("mouseMoved", 5, 5, 0);
  await app.shot(`${OUT}/after-dark.png`);
  const [x, y] = await app.center(coin);
  await app.mouse("mouseMoved", x, y, 0);
  await app.sleep(250);
  assert(await shift() !== "none", "lower half (hover state) under the mouse");
  await app.shot(`${OUT}/after-hover-dark.png`);

  await app.key("p");
  await app.waitFor(`document.querySelector(".guistage.preview")`);
  await app.mouse("mouseMoved", 5, 5, 0);
  await app.sleep(250);
  assert(await shift() === "none", "preview: upper half");
  await app.mouse("mouseMoved", x, y, 0);
  await app.sleep(250);
  assert(await shift() !== "none", "preview: lower half under the mouse");
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(500);
    await app.shot(`${OUT}/after-hover-light.png`);
    await app.setTheme("dark");
  }
  assert(JSON.stringify(components()[coinAt]) === before, "the stored widget is unchanged");
}, { project, language: "tr", width: 1440, height: 900 });
