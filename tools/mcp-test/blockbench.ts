/**
 * KUYRUK 171: Edit in Blockbench over MCP on a copy of ETREconomy. industrialovenon (a JSON model whose block maps
 * slot 0 to industrial_furnace_on_anim.png): open prepares the work folder (the block's texture shown in slot 0, the
 * PNGs and the .mcmeta at assets/etreco/textures/...); what "Blockbench" saves there comes back: the model with slot 0
 * put back to the model's own texture, a changed PNG to its project file, a new PNG to textures/; the watcher does it
 * without a sync call too. A missing program is a clear error.
 *   node tools/mcp-test/blockbench.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const mcp = await connect(project);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  assert(mcp.tools.includes("edit_in_blockbench"), "edit_in_blockbench is listed");
  const missing = await mcp.call("edit_in_blockbench", { model: "industrialovenon", program: join(project, "no-blockbench.exe") }, true);
  // The usual install places may hold a real Blockbench on another machine; here none is installed.
  assert(String(missing).includes("Blockbench not found") && String(missing).includes("no-blockbench.exe"), `missing program: ${missing}`);

  const open = await mcp.call("edit_in_blockbench", { model: "industrialovenon", block: "industrialovenon", launch: false });
  const work = open.work as string;
  const model = JSON.parse(readFileSync(open.file, "utf8"));
  assert(open.file.replaceAll("\\", "/").endsWith("assets/etreco/models/industrialovenon.json"), `model in the pack layout: ${open.file}`);
  assert(model.textures["0"] === "etreco:blocks/industrial_furnace_on_anim" && model.textures.all === "etreco:blocks/furnice", `block's slot 0 shown: ${JSON.stringify(model.textures)}`);
  const anim = join(work, "assets/etreco/textures/blocks/industrial_furnace_on_anim.png");
  assert(existsSync(anim) && existsSync(`${anim}.mcmeta`) && existsSync(join(work, "assets/etreco/textures/blocks/furnice.png")), "textures and .mcmeta copied");
  assert(open.textures["assets/etreco/textures/blocks/furnice.png"] === "textures/blocks/furnice.png", `work -> project map: ${JSON.stringify(open.textures)}`);

  // "Blockbench" saves the model with one more cube, a repainted texture and a new one.
  model.elements.push({ from: [0, 0, 0], to: [1, 1, 1], faces: { north: { uv: [0, 0, 1, 1], texture: "#all" } } });
  writeFileSync(open.file, JSON.stringify(model));
  const repainted = readFileSync(join(project, "textures/blocks/industrial_furnace_on_anim.png"));
  repainted[repainted.length - 20] ^= 0xff; // after IEND's start: still the same image size, other bytes
  writeFileSync(join(work, "assets/etreco/textures/blocks/furnice.png"), repainted);
  const created = join(work, "assets/etreco/textures/blocks/oven_glow.png");
  mkdirSync(dirname(created), { recursive: true });
  writeFileSync(created, readFileSync(anim));
  const synced = await mcp.call("edit_in_blockbench", { model: "industrialovenon", action: "sync" });
  assert(synced.written.sort().join() === ["models/industrialovenon.json", "textures/blocks/furnice.png", "textures/blocks/oven_glow.png"].join(), `synced: ${JSON.stringify(synced)}`);
  const back = JSON.parse(readFileSync(join(project, "models/industrialovenon.json"), "utf8"));
  assert(back.elements.length === model.elements.length && back.textures["0"] === "etreco:blocks/fruniceoncoal", `model back with its own slot 0: ${JSON.stringify(back.textures)}`);
  assert(readFileSync(join(project, "textures/blocks/furnice.png")).equals(repainted), "repainted texture back in its file");
  assert(existsSync(join(project, "textures/blocks/oven_glow.png")), "new texture in textures/blocks");
  assert((await mcp.call("edit_in_blockbench", { model: "industrialovenon", action: "sync" })).written.length === 0, "nothing again without a change");

  // The watcher copies a save without a sync call.
  model.elements.pop();
  writeFileSync(open.file, JSON.stringify(model));
  let watched = false;
  for (let i = 0; i < 30 && !watched; i++) {
    await sleep(200);
    watched = JSON.parse(readFileSync(join(project, "models/industrialovenon.json"), "utf8")).elements.length === model.elements.length;
  }
  assert(watched, "the watcher brought the save back");
  assert((await mcp.call("edit_in_blockbench", { model: "industrialovenon", action: "stop" })).stopped, "stopped");
  console.log("PASS");
} finally {
  await mcp.close();
}
