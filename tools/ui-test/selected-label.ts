/**
 * KUYRUK #67: the "Selected:" label follows the real selection. Select an element, open a folder (the element is no
 * longer shown): the label says nothing is selected. Screenshots go to design/selected-label/.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = copyProject(exampleProject(), "hello");
writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Box"], placement: {} }, null, 2));
const OUT = evidence("design/selected-label");
const label = (app: App) => app.eval<string>(`document.querySelector(".selinfo").textContent`);

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 1`);
  assert((await label(app)).includes("nothing"), `starts empty: ${await label(app)}`);
  const name = await app.eval<string>(`document.querySelectorAll(".tile:not(.foldertile) .tname")[0].textContent`);
  await app.click(".tile:not(.foldertile)");
  assert((await label(app)).includes(name), `shows the selected element: ${await label(app)}`);
  await app.shot(`${OUT}/selected.png`);
  await app.click(".foldertile", "Box", { double: true });
  await app.waitFor(`document.querySelector(".crumb").textContent.includes("Box")`);
  assert((await label(app)).includes("nothing"), `nothing is selected inside the folder: ${await label(app)}`);
  // Since Q279 the actions of a selection (Edit, Duplicate, Move, Delete) are offered only while something is selected.
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".view .abtn")].some((b) => b.textContent.trim() === "Edit")`)), "Edit is not offered with nothing selected");
  await app.shot(`${OUT}/in-folder.png`);
}, { project });
