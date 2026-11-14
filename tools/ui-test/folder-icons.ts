/**
 * KUYRUK 178: 16 folder colours (Minecraft's dye colours) and folder icons drawn in the folder's colour. On a copy of
 * examples/hello with the folders Ores, Tools and Food: the Colour page lists 16 colours plus none, the Icon page 13
 * icons (Folder first) tinted with the folder's colour; picking Lime and Gem saves both in folders.json and the tile
 * draws the gem in lime; the icon follows a rename and a move; MCP edit_folder sets and clears an icon and refuses an
 * unknown one. BEFORE=1 only takes the before screenshot. Screenshots go to design/178/ (en and tr dark, en light).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/178";
type Folders = { folders: string[]; colors?: Record<string, string>; icons?: Record<string, string> };
const tile = (path: string) => `.foldertile[data-folder="${path}"]`;
const until = async (app: App, check: () => boolean, message: string) => {
  for (let i = 0; i < 40 && !check(); i++) await app.sleep(100);
  assert(check(), message);
};

for (const language of ["en", "tr"]) {
  const project = exampleProject();
  const read = () => JSON.parse(readFileSync(join(project, "folders.json"), "utf8")) as Folders;
  writeFileSync(join(project, "folders.json"), JSON.stringify({
    folders: ["Ores", "Tools", "Food"], placement: {},
    ...(language === "tr" ? { colors: { Ores: "#3ab3da", Tools: "#f9801d", Food: "#f38baa" }, icons: { Ores: "gem", Tools: "hammer", Food: "heart" } } : {}),
  }, null, 2));
  await run(async (app) => {
    await app.waitFor(`[...document.querySelectorAll(".foldertile .tname")].some((t) => t.textContent === "Ores")`, 60000);
    if (process.env.BEFORE) {
      await app.click(".foldertile", "Ores", { button: "right" });
      await app.click(".menulist.ctx button", language === "en" ? "Colour" : "Renk");
      await app.sleep(200);
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    if (language === "tr") {
      await app.click(tile("Ores"), undefined, { button: "right" });
      await app.click(".menulist.ctx button", "Simge");
      await app.sleep(200);
      await app.shot(`${OUT}/after-tr-dark.png`);
      return;
    }
    await app.click(tile("Ores"), undefined, { button: "right" });
    await app.click(".menulist.ctx button", "Colour");
    const colours = await app.eval<number>(`document.querySelectorAll(".menulist.ctx .mswatch").length`);
    assert(colours === 17, `16 colours and none: ${colours}`);
    await app.shot(`${OUT}/colours-en-dark.png`);
    await app.click(".menulist.ctx button", "Lime");
    await until(app, () => read().colors?.Ores === "#80c71f", "Lime saved");

    await app.click(tile("Ores"), undefined, { button: "right" });
    await app.click(".menulist.ctx button", "Icon");
    const icons = await app.eval<string[]>(`[...document.querySelectorAll(".menulist.ctx .micon")].map((i) => getComputedStyle(i).color)`);
    assert(icons.length === 13 && icons.every((c) => c === "rgb(128, 199, 31)"), `13 icons in the folder's colour: ${icons}`);
    await app.shot(`${OUT}/icons-en-dark.png`);
    await app.click(".menulist.ctx button", "Gem");
    await until(app, () => read().icons?.Ores === "gem", "Gem saved");
    await app.waitFor(`document.querySelector(${JSON.stringify(`${tile("Ores")} .slot`)}).dataset.icon === "gem"`);
    assert(await app.eval<boolean>(`getComputedStyle(document.querySelector(${JSON.stringify(`${tile("Ores")} .slot`)})).color === "rgb(128, 199, 31)"`), "the gem is drawn in lime");

    // MCP: set, refuse, clear.
    const mcp = await connect(project);
    try {
      await mcp.call("edit_folder", { action: "icon", path: "Tools", icon: "hammer" });
      await mcp.call("edit_folder", { action: "color", path: "Tools", color: "#f9801d" });
      const bad = await mcp.call("edit_folder", { action: "icon", path: "Tools", icon: "dragon" }, true);
      assert(String(bad).includes("bad icon"), `unknown icon refused: ${bad}`);
      await mcp.call("edit_folder", { action: "icon", path: "Food", icon: "heart" });
      await mcp.call("edit_folder", { action: "icon", path: "Food", icon: "" });
    } finally {
      await mcp.close();
    }
    await until(app, () => read().icons?.Tools === "hammer" && !read().icons?.Food, `MCP icons: ${JSON.stringify(read().icons)}`);
    await app.waitFor(`document.querySelector(${JSON.stringify(`${tile("Tools")} .slot`)})?.dataset.icon === "hammer"`);

    // The icon follows the folder when it is moved.
    await app.click(tile("Ores"), undefined, { button: "right" });
    await app.click(".menulist.ctx button", "Move");
    await app.click(".menulist.ctx button", "Tools");
    await until(app, () => read().icons?.["Tools/Ores"] === "gem" && read().colors?.["Tools/Ores"] === "#80c71f", `icon and colour follow the move: ${JSON.stringify(read())}`);
    await app.click(tile("Tools"), undefined, { double: true });
    await app.waitFor(`document.querySelector(${JSON.stringify(`${tile("Tools/Ores")} .slot`)})?.dataset.icon === "gem"`);
    await app.click(".crumb .linkbtn");
    await app.sleep(300);
    await app.shot(`${OUT}/after-en-dark.png`);
    await app.setTheme("light");
    await app.sleep(300);
    await app.shot(`${OUT}/after-en-light.png`);
  }, { project, language, width: 1440, height: 900 });
}
