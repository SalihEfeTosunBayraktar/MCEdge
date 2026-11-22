/**
 * Q276: the text GUI of tools/codegen-test/textshot/layout.ts in the GUI editor, for a side by side with the 26.3 game
 * screenshot (tools/codegen-test/textshot/run.sh). Saves design/276/editor-dark.png and the canvas rectangle in GUI
 * pixels (design/276/editor-stage.json) so tools/codegen-test/textshot/compare.py can cut the GUI out at one scale.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject, REPO, run, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";
import { TEXT_GUI } from "../codegen-test/textshot/layout.ts";

const project = exampleProject();
addElement(project, "gui", "texttest", TEXT_GUI);

await run(async (app) => {
  await app.setTheme("dark");
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "texttest", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-label")`);
  await app.sleep(800);
  const zoom = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const stage = await app.rect(".guistage");
  const dpr = await app.eval<number>("window.devicePixelRatio");
  mkdirSync(join(REPO, evidence("design/276")), { recursive: true });
  writeFileSync(join(REPO, evidence("design/276/editor-stage.json")), JSON.stringify({ zoom, dpr, x: stage.x, y: stage.y, width: stage.width, height: stage.height }));
  await app.shot(evidence("design/276/editor-dark.png"));
}, { project, theme: "dark", language: "en" });
