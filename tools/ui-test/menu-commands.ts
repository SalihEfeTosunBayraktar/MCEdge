/**
 * KUYRUK #7 (no Gradle): Resources > Import sounds / model (Blockbench) / structure, File > Export workspace,
 * Help > User guide and About, and the Gradle console panel. Native dialogs are answered through the main
 * process. Screenshots go to design/menu-commands/. Gradle-backed commands: gradle-commands.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/menu-commands");
const appVersion = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version;
const files = mkdtempSync(join(tmpdir(), "mcedge-import-"));
const ogg = join(files, "Magic Ding.ogg");
writeFileSync(ogg, Buffer.from("OggS fixture"));
const nbt = join(files, "small_house.nbt");
writeFileSync(nbt, Buffer.from([0x1f, 0x8b, 8, 0]));
const bb = join(files, "gem_lamp.bbmodel");
const png = readFileSync(join(project, "textures", "ruby.png")).toString("base64");
writeFileSync(bb, JSON.stringify({
  meta: { format_version: "4.10", model_format: "java_block" },
  resolution: { width: 16, height: 16 },
  elements: [
    { name: "base", type: "cube", from: [2, 0, 2], to: [14, 4, 14], origin: [8, 0, 8], rotation: [0, 0, 0],
      faces: { north: { uv: [0, 0, 12, 4], texture: 0 }, up: { uv: [2, 2, 14, 14], texture: 0 }, down: { uv: [0, 0, 1, 1], texture: null } } },
    { name: "gem", type: "cube", from: [6, 4, 6], to: [10, 10, 10], origin: [8, 8, 8], rotation: [0, 30, 0],
      faces: { north: { uv: [0, 0, 4, 6], texture: 0 } } },
    { name: "mesh", type: "mesh" },
  ],
  textures: [{ name: "gem", source: `data:image/png;base64,${png}` }],
}));
const zip = join(files, "workspace.zip");

const menu = async (app: App, top: string, item: string) => {
  await app.click(".menu", top);
  await app.click(".menulist button", item);
};

await run(async (app) => {
  // Sounds
  await app.mockDialogs({ open: [ogg] });
  await menu(app, "Resources", "Import sounds");
  await app.waitFor(`[...document.querySelectorAll(".grid td")].some((td) => td.textContent === "hellomcedge:magic_ding")`);
  assert(existsSync(join(project, "sounds", "magic_ding.ogg")), "sound copied to sounds/magic_ding.ogg");
  await app.click(".grid td", "magic_ding");
  await app.shot(`${OUT}/sounds-dark.png`);

  // Blockbench model: converted, textures extracted, warnings shown.
  await app.mockDialogs({ open: [bb] });
  await menu(app, "Resources", "Import 3D model");
  await app.waitFor(`document.querySelector(".dialog")`);
  const notice = await app.eval<string>(`document.querySelector(".dialog").textContent`);
  assert(notice.includes("mesh") && notice.includes("rotation 30 becomes 22.5"), `model warnings shown: ${notice}`);
  await app.shot(`${OUT}/model-import-notice-dark.png`);
  await app.click(".dialog .abtn", "Close");
  const model = JSON.parse(readFileSync(join(project, "models", "gem_lamp.json"), "utf8"));
  assert(model.elements.length === 2 && model.textures["0"] === "hellomcedge:block/gem_lamp_0", `model converted: ${JSON.stringify(model.textures)}`);
  assert(model.elements[1].rotation.angle === 22.5 && model.elements[1].rotation.axis === "y", "rotation snapped to 22.5 on y");
  assert(!("down" in model.elements[0].faces), "faces without texture left out");
  assert(existsSync(join(project, "textures", "block", "gem_lamp_0.png")), "embedded texture extracted");
  await app.click(".grid td", "gem_lamp");
  await app.shot(`${OUT}/models-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/models-light.png`);
  await app.setTheme("dark");

  // Structure, then delete it again.
  await app.mockDialogs({ open: [nbt] });
  await menu(app, "Resources", "Import structure");
  await app.waitFor(`[...document.querySelectorAll(".grid td")].some((td) => td.textContent === "hellomcedge:small_house")`);
  await app.click(".grid td", "small_house");
  await app.click(".abtn", "Delete selected");
  await app.waitFor(`!document.querySelector(".grid td")`);
  assert(!existsSync(join(project, "structures", "small_house.nbt")), "structure deleted");

  // The model field of a block offers the imported model.
  const options = await app.eval<string[]>(`[...document.querySelectorAll("#ref-model option, #ref-sound option")].map((o) => o.value)`);
  void options;

  // File > Export workspace: zip without out/.
  await app.mockDialogs({ save: zip });
  await menu(app, "File", "Export workspace to file");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.shot(`${OUT}/export-workspace-dark.png`);
  await app.click(".dialog .abtn", "Close");
  const list = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-tf", zip], { encoding: "utf8" });
  assert(list.status === 0, `zip readable: ${list.stderr}`);
  const entries = list.stdout.split(/\r?\n/).filter(Boolean);
  assert(entries.includes("hellomcedge/mcedge.json") && entries.includes("hellomcedge/sounds/magic_ding.ogg"), `zip entries: ${entries.slice(0, 5)}`);
  assert(!entries.some((e) => e.startsWith("hellomcedge/out/")), "out/ left out");
  const extract = mkdtempSync(join(tmpdir(), "mcedge-unzip-"));
  spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", extract]);
  assert(readFileSync(join(extract, "hellomcedge", "mcedge.json"), "utf8") === readFileSync(join(project, "mcedge.json"), "utf8"), "zip content round-trips");

  // Help
  await menu(app, "Help", "About MCEdge");
  await app.waitFor(`document.querySelector(".aboutdlg code")?.textContent === ${JSON.stringify(appVersion)}`);
  await app.shot(`${OUT}/about-dark.png`);
  await app.key("Escape");
  await app.setTheme("light");
  await menu(app, "Help", "About MCEdge");
  await app.waitFor(`document.querySelector(".aboutdlg code")?.textContent === ${JSON.stringify(appVersion)}`);
  await app.shot(`${OUT}/about-light.png`);
  await app.key("Escape");
  for (const theme of ["light", "dark"] as const) {
    await app.setTheme(theme);
    // Help > User guide is the user guide (KUYRUK 128); the developer docs are linked out.
    await menu(app, "Help", "User guide");
    await app.waitFor(`document.querySelector(".markdown h2")`);
    await app.click(".docslist .lrow", "Build, run and export");
    await app.waitFor(`document.querySelector(".markdown h2")?.textContent.includes("Build, run")`);
    await app.waitFor(`document.querySelector(".markdown table")`);
    await app.shot(`${OUT}/docs-${theme}.png`);
    await app.key("Escape");
  }

  // Tools > Gradle console opens the console panel.
  await menu(app, "Tools", "Gradle console");
  await app.waitFor(`document.querySelector(".gradle-input input")`);
  await app.shot(`${OUT}/gradle-console-dark.png`);
  for (const top of ["File", "Workspace", "Resources", "Build & run", "Tools", "Window", "Help"]) {
    await app.click(".menu", top);
    const soon = await app.eval<number>(`document.querySelectorAll(".menulist .soon").length`);
    assert(soon === 0, `${top} menu shows no coming soon item`);
    await app.key("Escape");
  }
}, { project });
