/**
 * KUYRUK #71: the block palette of the procedure editor in Turkish. Screenshots go to design/blocks-tr/.
 */
import { assert, exampleProject, run } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "procedure", "demo");
const OUT = "design/blocks-tr";

await run(async (app) => {
  await app.click(".rtab", "Mod öğeleri");
  await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.includes("demo"))`, 20000);
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.textContent.includes("demo")).setAttribute("id", "target")`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".blocklyToolboxCategory, .blocklyTreeRow")`, 30000);
  const rows = await app.eval<string[]>(`[...document.querySelectorAll(".blocklyToolboxCategory, .blocklyTreeRow")].map((r) => r.textContent.trim())`);
  console.log("categories", rows.join(" | "));
  assert(rows.some((r) => r.includes("Oyuncular")), "Turkish palette");
  await app.click(".blocklyToolboxCategory, .blocklyTreeRow", "Oyuncular");
  await app.sleep(800);
  await app.shot(`${OUT}/palette-players.png`);
  await app.click(".blocklyToolboxCategory, .blocklyTreeRow", "Dünya");
  await app.sleep(800);
  await app.shot(`${OUT}/palette-world.png`);
}, { project, language: "tr" });
