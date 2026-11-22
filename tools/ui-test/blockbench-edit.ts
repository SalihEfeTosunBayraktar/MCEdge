/**
 * KUYRUK 171: Edit in Blockbench from a block's model field and from Resources > Models. On a copy of ETREconomy,
 * Industrial Oven (industrialovenon, a JSON model whose block maps slot 0 to its own texture): without Blockbench the
 * button says it was not found and where to set it; Window > Preferences > External programs takes the program
 * (here where.exe stands in for Blockbench: it exits at once) and says it is found; then the button opens the model
 * (the note counts its textures) and a "Blockbench" save in the work folder (the model with one more cube, a
 * repainted texture) comes back into the project, with slot 0 still the model's own. Resources > Models offers the
 * same action on the selected JSON model. BEFORE=1 only takes the before screenshot. Screenshots go to design/171/.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showInApp } from "../../src/live/show.ts";
import { assert, copyProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/171");
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const STAND_IN = "C:\\Windows\\System32\\where.exe";
const projectModel = () => JSON.parse(readFileSync(join(project, "models/industrialovenon.json"), "utf8"));
const NOTE = ".form .bbnote";

const openBlock = async (app: App) => {
  await showInApp(project, "block/industrialovenon", 20000);
  await app.waitFor(`document.querySelector(".form .bbedit")`, 15000);
  await app.eval(`document.querySelector(".form .bbedit").scrollIntoView({ block: "center" })`);
  await app.sleep(800);
};
const preferences = async (app: App) => {
  await app.eval(`document.querySelectorAll(".menubar .menus .menu")[5].click()`);
  await app.eval(`[...document.querySelectorAll(".menulist [role=menuitem]")].find((b) => /Preferences|Tercihler/.test(b.textContent)).click()`);
  await app.waitFor(`document.querySelector(".prefsdialog .bbpath")`);
};

for (const language of ["en", "tr"]) {
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile, .edhead")`, 60000);
    if (process.env.BEFORE) {
      await showInApp(project, "block/industrialovenon", 20000);
      await app.waitFor(`document.querySelector(".form .modelpreview")`, 15000);
      await app.eval(`document.querySelector(".form .modelpreview").scrollIntoView({ block: "center" })`);
      await app.sleep(1000);
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    await openBlock(app);
    // No Blockbench on this machine: a clear note.
    await app.click(".form .bbedit");
    await app.waitFor(`document.querySelector("${NOTE}.ferr")`);
    const missing = await app.eval<string>(`document.querySelector("${NOTE}").textContent`);
    assert(/Blockbench/.test(missing) && /Preferences|Tercihler/.test(missing), `says where to set it: ${missing}`);
    await app.shot(`${OUT}/missing-${language}-dark.png`);

    // The program in Preferences.
    await preferences(app);
    await app.setValue(".prefsdialog .bbpath", STAND_IN);
    await app.waitFor(`document.querySelector(".prefsdialog .bbfound")?.textContent.includes("where.exe")`);
    await app.shot(`${OUT}/preferences-${language}-dark.png`);
    await app.key("Escape");
    await app.waitFor(`!document.querySelector(".prefsdialog")`);

    // Opened: the note counts the textures; the work model shows the block's slot 0.
    await app.click(".form .bbedit");
    await app.waitFor(`document.querySelector("${NOTE}.hint")`);
    const file = await app.eval<string>(`document.querySelector("${NOTE}").title`);
    const work = JSON.parse(readFileSync(file, "utf8"));
    assert(work.textures["0"] === "etreco:blocks/industrial_furnace_on_anim", `work copy shows the block's texture: ${JSON.stringify(work.textures)}`);
    await app.sleep(400);
    await app.shot(`${OUT}/after-${language}-dark.png`);
    await app.setTheme("light");
    await app.sleep(500);
    await app.shot(`${OUT}/after-${language}-light.png`);
    await app.setTheme("dark");

    if (language !== "en") return;
    // A "Blockbench" save comes back.
    const cubes = projectModel().elements.length;
    const ownSlot0 = projectModel().textures["0"] as string;
    work.elements.push({ from: [0, 14, 0], to: [16, 16, 16], faces: { up: { uv: [0, 0, 16, 16], texture: "#all" } } });
    writeFileSync(file, JSON.stringify(work));
    // The model's own texture in slot 0 must survive the round trip; another slot's texture is repainted in the work folder
    // (names come from the project, which changes: slot "particle" and any other PNG as the paint).
    const repainted = (projectModel().textures.particle as string).replace(/^[a-z_]+:/, "");
    const repaintedFile = join(project, "textures", `${repainted}.png`);
    const painted = readFileSync(join(project, "textures", "blocks", readdirSync(join(project, "textures", "blocks")).find((f) => f.endsWith(".png") && join(project, "textures", "blocks", f) !== repaintedFile)!));
    writeFileSync(join(file, "..", "..", "..", "etreco", "textures", `${repainted}.png`), painted);
    let back = false;
    for (let i = 0; i < 40 && !back; i++) {
      await app.sleep(250);
      back = projectModel().elements.length === cubes + 1 && readFileSync(repaintedFile).equals(painted);
    }
    assert(back, "the save is back in the project");
    assert(projectModel().textures["0"] === ownSlot0, `slot 0 is the model's own again: ${JSON.stringify(projectModel().textures)}`);
    await app.sleep(1500);
    await app.shot(`${OUT}/synced-en-dark.png`);

    // Resources > Models has the same action for the selected JSON model.
    await app.click(".rtab", "Resources");
    await app.click(".ltab", "Models");
    await app.click("tr", "industrialovenon");
    await app.waitFor(`[...document.querySelectorAll(".actions .abtn")].some((b) => b.textContent.includes("Edit in Blockbench") && !b.disabled)`);
    await app.click(".actions .abtn", "Edit in Blockbench");
    await app.waitFor(`document.querySelector(".bbnote.hint")`);
    await app.sleep(600);
    await app.shot(`${OUT}/resources-en-dark.png`);
  }, { project, language, width: 1440, height: 900 });
}
