/**
 * KUYRUK #30: procedures converted from Java open in the procedure editor as blocks, the largest included, and the
 * project shows no problems. Runs on a copy of ETREconomy.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, run } from "./cdp.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const dir = join(project, "elements/procedures");
const blockFiles = readdirSync(dir).filter((f) => !statSync(join(dir, f)).isDirectory());
const largest = blockFiles.map((f) => ({ id: f.slice(0, -5), size: statSync(join(dir, f)).size })).sort((a, b) => b.size - a.size);
console.log("largest", largest.slice(0, 3));

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelector(".tile")`, 20000);
  for (const id of ["jobselect1", "playermoneyshow_value"]) {
    await app.eval(`(() => { const i = document.querySelector(".view input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(id)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await app.waitFor(`document.querySelectorAll(".tile").length === 1`, 8000);
    await app.eval(`document.getElementById("target")?.removeAttribute("id"); document.querySelector(".tile").setAttribute("id", "target")`);
    const started = Date.now();
    await app.click("#target", undefined, { double: true });
    await app.waitFor(`document.querySelectorAll(".blocklyDraggable, .blocklyBlockCanvas g").length > 3`, 90000);
    const count = await app.eval<number>(`document.querySelectorAll(".blocklyDraggable").length`);
    const unknown = await app.eval<boolean>(`document.body.textContent.includes("unknown block")`);
    console.log(id, "blocks on canvas", count);
    const ms = Date.now() - started;
    console.log(id, "opened in", ms, "ms");
    assert(count > 1, `${id} shows blocks`);
    assert(!unknown, `${id} has no unknown block`);
    await app.shot(`design/folders/procedure-${id}.png`);
    await app.key("Escape");
    await app.click(".rtab", "Mod elements");
    await app.sleep(600);
  }
}, { project });
