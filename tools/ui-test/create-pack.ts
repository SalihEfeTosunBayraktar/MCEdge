/**
 * KUYRUK 134: Tools > Create pack. On a copy of examples/hello: the dialog previews a material pack (Jade, gem look),
 * Create makes its 21 elements and 14 textures; MCP create_pack makes a wood pack, and a second run keeps what exists;
 * the project validates and builds on neoforge-1.21.5 with Gradle (BUILD=0 skips the build). Screenshots go to
 * design/134/ (LIGHT=1 runs it in the light theme).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, REPO, run } from "./cdp.ts";

const OUT = "design/134";
const project = exampleProject();
const theme = process.env.LIGHT ? "light" : "dark";

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  if (theme === "light") await app.setTheme("light");
  await app.click(".menu", "Tools");
  await app.click(".menulist button", "Create pack...");
  await app.waitFor(`document.querySelector("[data-testid=create-pack]")`);
  assert(await app.eval<boolean>(`document.activeElement?.name === "name"`), "the name field takes the focus");
  await app.type("Jade");
  await app.setValue("[data-testid=create-pack] select[name=kind]", "material");
  await app.setValue("[data-testid=create-pack] select[name=look]", "gem");
  await app.setValue("[data-testid=create-pack] input[name=color]", "#3fbf6f");
  await app.waitFor(`document.querySelectorAll(".packlist li").length === 21 && document.querySelectorAll(".packtextures img").length === 14`);
  await app.shot(`${OUT}/after-dialog-${theme}.png`);
  await app.click("[data-testid=create-pack] .abtn.primary");
  await app.waitFor(`!document.querySelector("[data-testid=create-pack]")`, 10000);
  for (const [folder, file] of [["items", "jade"], ["blocks", "jade_ore"], ["blocks", "jade_block"], ["tools", "jade_pickaxe"], ["armors", "jade_armor"], ["recipes", "jade_from_smelting"]]) {
    assert(existsSync(join(project, "elements", folder, `${file}.json`)), `${folder}/${file} made`);
  }
  assert(readdirSync(join(project, "textures", "item")).filter((n) => n.startsWith("jade")).length === 10, "item textures");
  await app.waitFor(`[...document.querySelectorAll(".tile .tname")].some((n) => n.textContent === "Jade Ore")`, 10000);
  await app.shot(`${OUT}/after-elements-${theme}.png`);

  const mcp = await connect(project);
  try {
    const preview = await mcp.call<{ elements: { id: string; exists: boolean }[] }>("create_pack", { kind: "wood", name: "Maple", color: "#b5651d", preview: true });
    assert(preview.elements.length === 15 && preview.elements.every((e) => !e.exists), "mcp wood preview");
    const made = await mcp.call<{ created: string[] }>("create_pack", { kind: "wood", name: "Maple", color: "#b5651d" });
    assert(made.created.length === 15, `mcp wood pack ${made.created.length}`);
    const again = await mcp.call<{ created: string[]; kept: string[] }>("create_pack", { kind: "ore", name: "Jade", color: "#ff0000", look: "gem" });
    assert(again.created.length === 0 && again.kept.length === 9, `existing elements and textures kept: ${JSON.stringify(again)}`);
  } finally {
    await mcp.close();
  }
}, { project });

const issues = validateProject(loadProject(project), project);
assert(issues.length === 0, `the packs validate: ${JSON.stringify(issues)}`);
if (process.env.BUILD !== "0" && !process.exitCode) {
  const build = spawnSync("node", ["src/cli.ts", "build", project, "--target", "neoforge-1.21.5"], { cwd: REPO, encoding: "utf8" });
  console.log(build.stdout.split("\n").filter((l) => /OK ->|failed|targets built/.test(l)).join("\n"));
  assert(build.status === 0 && /1\/1 targets built/.test(build.stdout), "the packs build on neoforge-1.21.5");
}
if (!process.exitCode) console.log("PASS build");
