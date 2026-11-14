/**
 * KUYRUK 161: a custom model block lists its model's texture slots and maps each one to a project texture. On a copy
 * of ETREconomy, Solar Panel Charger[Closed] (battery_recharger, custom JSON model) hides the cube side textures, shows
 * the model's slots "0" and "all" with the textures the model names, maps "0" to another texture in the form (saved to
 * customModelTextures; the model preview in the form and on the right redraw with it), and MCP model_textures reports and
 * changes the same mapping. LIGHT=1 also takes the light screenshots. Screenshots go to design/161/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { showInApp } from "../../src/live/show.ts";
import { assert, copyProject, run, type App } from "./cdp.ts";

const OUT = "design/161";
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const file = join(project, "elements/blocks/battery_recharger.json");
const stored = () => JSON.parse(readFileSync(file, "utf8")) as { customModelTextures?: Record<string, string> };
const canvas = (app: App, scope: string) => app.eval<string>(`document.querySelector("${scope} .mpcanvas canvas")?.toDataURL() ?? ""`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.sleep(2000);
  await showInApp(project, "block/battery_recharger", 20000);
  await app.waitFor(`document.querySelector(".mtrow[data-slot='0']")`, 15000);

  // The cube's side textures do not apply to a custom model, so they are not offered.
  assert(!await app.eval(`!!document.querySelector("[data-field='textureTop']")`), "side textures hidden for a custom model");
  const slots = await app.eval<string[]>(`[...document.querySelectorAll(".mtrow[data-slot]")].map((r) => r.dataset.slot)`);
  assert(slots.join(",") === "0,all", `slots ${slots}`);
  const modelTexture = await app.eval<string>(`document.querySelector(".mtrow[data-slot='0'] .mtname").textContent`);
  assert(modelTexture.includes("solarcharger_texture_animated"), `slot 0 names ${modelTexture}`);
  await app.waitFor(`document.querySelector(".pvmodel .mpcanvas canvas")`, 10000);
  await app.eval(`document.querySelector("[data-field='customModelTextures']").scrollIntoView({ block: "center" })`);
  await app.sleep(1200);
  const formBefore = await canvas(app, ".form");
  const sideBefore = await canvas(app, ".pvmodel");
  await app.shot(`${OUT}/after-slots-dark.png`);

  // Map slot 0 to the charger's static texture.
  await app.click(".mtrow[data-slot='0'] .texpicked");
  await app.waitFor(`document.querySelector(".texpop input")`);
  await app.type("blocks/rechargertexture");
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".mtrow[data-slot='0'] .texpicker .texpickedname")?.textContent === "rechargertexture"`);
  for (let i = 0; i < 50 && stored().customModelTextures?.["0"] !== "textures/blocks/rechargertexture.png"; i++) await app.sleep(200);
  assert(JSON.stringify(stored().customModelTextures) === JSON.stringify({ 0: "textures/blocks/rechargertexture.png" }), `saved ${JSON.stringify(stored().customModelTextures)}`);
  await app.sleep(1500);
  assert(await canvas(app, ".form") !== formBefore, "form model preview redrawn with the mapped texture");
  assert(await canvas(app, ".pvmodel") !== sideBefore, "side preview redrawn with the mapped texture");
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".pvfaces figcaption")].some((c) => c.textContent === "Model: 0")`), "side preview lists the mapped slot");
  await app.shot(`${OUT}/after-mapped-dark.png`);
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(600);
    await app.shot(`${OUT}/after-mapped-light.png`);
    await app.setTheme("dark");
  }

  // Back to the model's own texture: None removes the mapping.
  await app.click(".mtrow[data-slot='0'] .texpicked");
  await app.waitFor(`document.querySelector(".texpop")`);
  await app.click(".texpop .texcell", "Yok");
  for (let i = 0; i < 50 && stored().customModelTextures?.["0"]; i++) await app.sleep(200);
  assert(JSON.stringify(stored().customModelTextures) === "{}", `cleared ${JSON.stringify(stored().customModelTextures)}`);

  const mcp = await connect(project);
  try {
    type Slots = { kind: string; slots: { slot: string; modelTexture: string; modelFile: string | null; mappedTo: string | null }[] };
    const info = await mcp.call<Slots>("model_textures", { block: "battery_recharger" });
    assert(info.kind === "json" && info.slots.map((s) => s.slot).join(",") === "0,all", `mcp slots ${JSON.stringify(info)}`);
    assert(info.slots[0].modelFile === "textures/blocks/solarcharger_texture_animated.png", `mcp model file ${info.slots[0].modelFile}`);
    const set = await mcp.call<Slots>("model_textures", { block: "battery_recharger", set: { all: "textures/blocks/rechargerpartic.png" } });
    assert(set.slots.find((s) => s.slot === "all")?.mappedTo === "textures/blocks/rechargerpartic.png", "mcp maps a slot");
    assert(stored().customModelTextures?.all === "textures/blocks/rechargerpartic.png", "mcp mapping saved");
    let refused = "";
    try {
      await mcp.call("model_textures", { block: "battery_recharger", set: { nope: "textures/blocks/rechargerpartic.png" } });
    } catch (e) {
      refused = (e as Error).message;
    }
    assert(refused.includes("not a texture slot"), `unknown slot refused: ${refused}`);
    await mcp.call("model_textures", { block: "battery_recharger", set: { all: "" } });
    assert(JSON.stringify(stored().customModelTextures) === "{}", "mcp removes a mapping");
    console.log("model_textures", JSON.stringify(info.slots));
  } finally {
    await mcp.close();
  }
}, { project, language: "tr", width: 1440, height: 900 });
