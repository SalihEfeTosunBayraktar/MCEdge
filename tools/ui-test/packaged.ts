/**
 * KUYRUK #12: the packaged app (MCEDGE_APP_EXE=release/win-unpacked/MCEdge.exe) starts, reads its element types and
 * engines from resources/core, opens a project and shows its elements. usage: MCEDGE_APP_EXE=... node tools/ui-test/packaged.ts
 */
import { resolve } from "node:path";
import { assert, copyProject, REPO, run, evidence } from "./cdp.ts";

if (!process.env.MCEDGE_APP_EXE) throw new Error("set MCEDGE_APP_EXE to the packaged MCEdge.exe");
const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 5`, 30000);
  const tiles = await app.eval<number>(`document.querySelectorAll(".tile").length`);
  console.log("tiles", tiles);
  assert(tiles > 5, "the packaged app lists the project's elements");
  await app.shot(evidence("design/packaged/elements.png"));
}, { project });
