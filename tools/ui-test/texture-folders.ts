/**
 * KUYRUK 177: the user's own folders in Resources > Textures, on a copy of examples/hello (four textures directly
 * under textures/): New folder makes Gems (shown empty, as a drop target); a texture dragged onto it and another moved
 * with the toolbar's Move go in; a texture dragged onto the disk group comes out again; the heading's menu renames
 * the folder (placements follow) and deletes it (textures go back to their disk group). Files never move. BEFORE=1
 * only takes the before screenshot. Screenshots go to design/177/ (en and tr dark, en light).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/177";
const placement = (project: string) => existsSync(join(project, "texture-folders.json"))
  ? (JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string> }) : { folders: [], placement: {} };
const cell = (path: string) => `.texcell[data-path="${path}"]`;
const group = (key: string) => `.tgroup[data-group="${key}"]`;
const dnd = (app: App, from: string, to: string, drop = true) => app.eval(`(() => {
  const a = document.querySelector(${JSON.stringify(from)}), b = document.querySelector(${JSON.stringify(to)});
  const dt = new DataTransfer();
  a.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
  b.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  b.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  if (${drop}) b.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
})()`);
const until = async (app: App, check: () => boolean, message: string) => {
  for (let i = 0; i < 40 && !check(); i++) await app.sleep(100);
  assert(check(), message);
};

for (const language of ["en", "tr"]) {
  const project = exampleProject();
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`, 60000);
    await app.click(".rtab", language === "en" ? "Resources" : "Kaynaklar");
    await app.waitFor(`document.querySelector(".texcell")`);
    if (process.env.BEFORE) {
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    // New folder.
    await app.click(".view .actions .abtn", language === "en" ? "New folder" : "Yeni klasör");
    await app.waitFor(`document.querySelector(".texfoldername")`);
    await app.setValue(".texfoldername", "Gems");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(${JSON.stringify(group("@folder:Gems"))})`);
    assert(placement(project).folders.join() === "Gems", `saved: ${JSON.stringify(placement(project))}`);
    // Drag in, and Move from the toolbar.
    await dnd(app, cell("textures/ruby.png"), group("@folder:Gems"));
    await until(app, () => placement(project).placement["textures/ruby.png"] === "Gems", "dragged in");
    await app.click(cell("textures/ruby_apple.png"));
    await app.click(".texmove .abtn");
    await app.click(".menulist button", "Gems");
    await until(app, () => placement(project).placement["textures/ruby_apple.png"] === "Gems", "moved with the toolbar");
    await app.waitFor(`document.querySelector(${JSON.stringify(`${group("@folder:Gems")} ${cell("textures/ruby_apple.png")}`)})`);
    await dnd(app, cell("textures/ruby_block.png"), group("@folder:Gems"), false);
    await app.sleep(200);
    await app.shot(`${OUT}/after-${language}-dark.png`);
    if (language === "tr") return;
    await app.setTheme("light");
    await app.sleep(300);
    await dnd(app, cell("textures/ruby_block.png"), group("@folder:Gems"), false);
    await app.sleep(200);
    await app.shot(`${OUT}/after-en-light.png`);
    await app.setTheme("dark");
    // Out again onto the disk group.
    await dnd(app, cell("textures/ruby.png"), group(""));
    await until(app, () => !("textures/ruby.png" in placement(project).placement), "dragged out");
    // Rename and delete from the heading.
    await app.click(`${group("@folder:Gems")} .gtitle`, undefined, { button: "right" });
    await app.click(".menulist button", "Rename");
    await app.waitFor(`document.querySelector(".texfoldername")`);
    await app.setValue(".texfoldername", "Red gems");
    await app.key("Enter");
    await until(app, () => placement(project).placement["textures/ruby_apple.png"] === "Red gems", "placement follows the rename");
    await app.waitFor(`document.querySelector(${JSON.stringify(group("@folder:Red gems"))})`);
    await app.shot(`${OUT}/renamed-en-dark.png`);
    await app.click(`${group("@folder:Red gems")} .gtitle`, undefined, { button: "right" });
    await app.click(".menulist button", "Delete");
    await until(app, () => placement(project).folders.length === 0, "folder deleted");
    await app.waitFor(`document.querySelector(${JSON.stringify(`${group("")} ${cell("textures/ruby_apple.png")}`)})`);
    assert(existsSync(join(project, "textures/ruby_apple.png")), "files never move");
  }, { project, language, width: 1440, height: 900 });
}
