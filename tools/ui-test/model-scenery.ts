/**
 * KUYRUK 162: the 3D model preview shows the inventory context in an inventory slot and the item frame context in an
 * item frame, from the front, so size and placement can be judged. On a copy of ETREconomy, Solar Panel
 * Recharger[Opened] (batteryrechargeropened, a JSON model with gui and fixed transforms): Inventory (GUI) draws the
 * slot colours around the model, Item frame draws the frame, unticking the box goes back to the free view, and the
 * placed block view has no scenery. LIGHT=1 also takes the light screenshots. Screenshots go to design/162/.
 */
import { showInApp } from "../../src/live/show.ts";
import { assert, copyProject, run, type App } from "./cdp.ts";

const OUT = "design/162";
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const CANVAS = ".form .mpcanvas canvas";

/** Pixels of the preview canvas in the given colours (within 6 per channel), out of a sample. */
const colourShare = (app: App, colours: string[]) => app.eval<number>(`(() => {
  const c = document.querySelector(${JSON.stringify(CANVAS)});
  const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height;
  const g = copy.getContext("2d"); g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const want = ${JSON.stringify(colours)}.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  let hit = 0, all = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    all++;
    if (want.some((w) => Math.abs(w[0] - d[i]) < 7 && Math.abs(w[1] - d[i + 1]) < 7 && Math.abs(w[2] - d[i + 2]) < 7)) hit++;
  }
  return hit / all;
})()`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.sleep(2000);
  await showInApp(project, "block/batteryrechargeropened", 20000);
  await app.waitFor(`document.querySelector(${JSON.stringify(CANVAS)})`, 15000);
  await app.eval(`document.querySelector(".form .modelpreview").scrollIntoView({ block: "center" })`);
  await app.sleep(1200);
  const slot = ["#c6c6c6", "#8b8b8b"], frame = ["#8a5a3b", "#7a4e33", "#9c7a4f"];
  assert(await colourShare(app, slot) < 0.05, "the placed block view has no slot");

  await app.setValue(".form .mpbar select", "gui");
  await app.waitFor(`document.querySelector(".form .mpcanvas").dataset.context === "gui"`);
  await app.sleep(600);
  const inSlot = await colourShare(app, slot);
  assert(inSlot > 0.3, `inventory view draws the slots: ${inSlot}`);
  await app.shot(`${OUT}/after-gui-dark.png`);

  await app.setValue(".form .mpbar select", "fixed");
  await app.waitFor(`document.querySelector(".form .mpcanvas").dataset.context === "fixed"`);
  await app.sleep(600);
  const inFrame = await colourShare(app, frame);
  assert(inFrame > 0.1, `item frame view draws the frame: ${inFrame}`);
  await app.shot(`${OUT}/after-fixed-dark.png`);
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(600);
    await app.shot(`${OUT}/after-fixed-light.png`);
    await app.setValue(".form .mpbar select", "gui");
    await app.sleep(600);
    await app.shot(`${OUT}/after-gui-light.png`);
    await app.setTheme("dark");
    await app.setValue(".form .mpbar select", "fixed");
    await app.sleep(400);
  }

  // The box turns the scenery off: the free view again.
  await app.click(".form .mpscenery input");
  await app.waitFor(`!document.querySelector(".form .mpcanvas").dataset.context`);
  await app.sleep(400);
  assert(await colourShare(app, frame) < 0.05, "no frame with the box unticked");
}, { project, language: "tr", width: 1440, height: 900 });
