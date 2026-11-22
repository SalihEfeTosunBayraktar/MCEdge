/**
 * KUYRUK #52: a texture field opens a grid of texture previews with a search, not a list of paths
 * (user, 2026-11-07: "böyle yerlerde textureların gözükmesi daha mantıklı addansa").
 */
import { resolve } from "node:path";
import { assert, copyProject, REPO, run, evidence } from "./cdp.ts";

const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
const filterSelect = `document.querySelector(".fsel select")`;

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 3`, 20000);
  await app.eval(`(() => { const s = ${filterSelect}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "item"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await app.sleep(500);
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); document.querySelector(".tile").setAttribute("id", "target")`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`!!document.querySelector(".texpicked")`, 20000);
  await app.click(".texpicked");
  await app.waitFor(`document.querySelectorAll(".texpop .texcell").length > 5`, 10000);
  await app.waitFor(`document.querySelectorAll(".texpop .texcell img").length > 3`, 10000);
  const cells = await app.eval<number>(`document.querySelectorAll(".texpop .texcell").length`);
  const previews = await app.eval<number>(`document.querySelectorAll(".texpop .texcell img").length`);
  console.log("cells", cells, "previews loaded", previews);
  await app.shot(evidence("design/textures/picker.png"));
  await app.eval(`(() => { const i = document.querySelector(".texpop input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "money"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.sleep(300);
  const filtered = await app.eval<number>(`document.querySelectorAll(".texpop .texcell").length`);
  console.log("cells for money", filtered);
  assert(filtered > 0 && filtered < cells, "the search narrows the grid");
  await app.eval(`document.querySelectorAll(".texpop .texcell")[0].click()`);
  await app.sleep(300);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".texpop")`)), "picking closes the grid");
  const name = await app.eval<string>(`document.querySelector(".texpickedname").textContent`);
  console.log("picked", name);
  assert(name.includes("money"), "the picked texture shows on the field");
}, { project });
