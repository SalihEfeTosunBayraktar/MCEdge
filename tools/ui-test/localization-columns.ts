/**
 * KUYRUK #70: the localization view has no language tabs above the table; each language is a column with its flag in
 * the header, and column edges can be dragged: the width is remembered when the view is shown again.
 * Screenshots go to design/localization-columns/.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/localization-columns";
const widthOf = (app: App, index: number) => app.eval<number>(`document.querySelectorAll(".grid th")[${index}].getBoundingClientRect().width`);

await run(async (app) => {
  await app.click(".rtab", "Localization");
  await app.waitFor(`document.querySelectorAll(".grid th").length >= 3`);
  assert(await app.eval<boolean>(`!document.querySelector(".langtabs")`), "no language tabs");
  const heads = await app.eval<string[]>(`[...document.querySelectorAll(".grid th")].map((th) => th.textContent + (th.querySelector("svg") ? "+icon" : ""))`);
  assert(heads.filter((h) => /_/.test(h) && h.includes("+icon")).length >= 2, `a flag in each language header: ${JSON.stringify(heads)}`);
  await app.shot(`${OUT}/table.png`);

  const before = await widthOf(app, 1);
  const grip = await app.rect(".grid th:nth-child(2) .colgrip");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await app.drag([x, y], [x + 120, y]);
  const after = await widthOf(app, 1);
  assert(after > before + 80, `the column grew: ${before} -> ${after}`);
  await app.shot(`${OUT}/resized.png`);

  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelector(".tiles")`);
  await app.click(".rtab", "Localization");
  await app.waitFor(`document.querySelectorAll(".grid th").length >= 3`);
  const kept = await widthOf(app, 1);
  assert(Math.abs(kept - after) < 3, `the width is remembered: ${after} vs ${kept}`);
}, { project: exampleProject() });
