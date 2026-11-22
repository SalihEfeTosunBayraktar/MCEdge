/**
 * KUYRUK #30: a texture of Resources can be exported, with its animation. Uses a copy of ETREconomy, whose
 * portalconnector texture is animated. The save dialog is the operating system's, so the test checks that the button
 * shows and exports through MCP, which runs the same exportTexture as the button.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, run, evidence } from "./cdp.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const target = join(mkdtempSync(join(tmpdir(), "mcedge-export-")), "sub", "connector");

await run(async (app) => {
  await app.click(".rtab", "Resources");
  await app.waitFor(`document.querySelector(".tile, .texcell, [role=option]")`, 15000);
  const name = "portalconnector";
  await app.eval(`[...document.querySelectorAll("button")].find((b) => (b.title + b.textContent).includes(${JSON.stringify(name)}))?.click()`);
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent === "Export texture...")`, 10000);
  await app.shot(evidence("design/folders/export-texture.png"));

  const mcp = await connect(project);
  try {
    const result = await mcp.call("export_texture", { path: "textures/items/portalconnector.png", target });
    assert(JSON.stringify(result).includes("connector.png.mcmeta"), "the animation goes with it");
    const bad = await mcp.call("export_texture", { path: "../mcedge.json", target }, true);
    assert(JSON.stringify(bad).includes("no project texture"), "paths outside the project are refused");
  } finally {
    await mcp.close();
  }
  assert(existsSync(`${target}.png`) && readFileSync(`${target}.png`).equals(readFileSync(join(project, "textures/items/portalconnector.png"))), "the PNG is exported unchanged");
}, { project });
