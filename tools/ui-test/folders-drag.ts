/**
 * KUYRUK 175: folders move by drag and drop in the element list, and with the toolbar's Move. On a copy of
 * examples/hello with the folders Ores, Tools and Tools/Old: Tools dragged onto Ores goes inside (with Old), a folder
 * dropped on itself stays, Tools dragged onto the Back tile goes up again, Old dragged onto the project breadcrumb goes
 * to the top, and Move on the toolbar (with a folder selected) moves Old into Ores. BEFORE=1 only takes the before
 * screenshot. Screenshots go to design/175/ (en and tr dark, en light).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/175";
const project = exampleProject();
writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Ores", "Tools", "Tools/Old"], placement: { "item/ruby": "Ores" } }, null, 2));
const folders = () => (JSON.parse(readFileSync(join(project, "folders.json"), "utf8")) as { folders: string[] }).folders.sort().join();

/** Synthetic HTML drag and drop (the test window cannot run a native drag): one DataTransfer from dragstart to drop. */
const dnd = (app: App, from: string, to: string, drop = true) => app.eval(`(() => {
  const a = document.querySelector(${JSON.stringify(from)}), b = document.querySelector(${JSON.stringify(to)});
  const dt = new DataTransfer();
  a.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
  b.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
  b.dispatchEvent(over);
  if (${drop}) {
    b.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    a.dispatchEvent(new DragEvent("dragend", { dataTransfer: dt, bubbles: true }));
  }
  return over.defaultPrevented;
})()`) as Promise<boolean>;
const tile = (name: string) => `.foldertile[data-folder="${name}"]`;
const changed = async (app: App, want: string) => {
  for (let i = 0; i < 40 && folders() !== want; i++) await app.sleep(100);
  assert(folders() === want, `folders: ${folders()} (want ${want})`);
};

for (const language of ["en", "tr"]) {
  await run(async (app) => {
    await app.waitFor(`[...document.querySelectorAll(".foldertile .tname")].some((t) => t.textContent === "Tools")`, 60000);
    if (process.env.BEFORE) {
      await app.click(".foldertile", "Tools");
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    if (language === "tr") {
      await app.click(tile("Tools"));
      await dnd(app, tile("Tools"), tile("Ores"), false);
      await app.sleep(200);
      await app.shot(`${OUT}/dragging-tr-dark.png`);
      return;
    }
    // Onto another folder: inside, with its subfolder.
    assert(await dnd(app, tile("Tools"), tile("Ores")), "Ores takes the drop");
    await changed(app, "Ores,Ores/Tools,Ores/Tools/Old");
    // Into itself: refused while dragging and on drop.
    await app.click(tile("Ores"), undefined, { double: true });
    await app.waitFor(`document.querySelector(${JSON.stringify(tile("Ores/Tools"))})`);
    assert(!(await dnd(app, tile("Ores/Tools"), tile("Ores/Tools"))), "a folder does not take itself");
    await app.sleep(300);
    assert(folders() === "Ores,Ores/Tools,Ores/Tools/Old", "nothing moved");
    // Onto Back: up to the parent of the open folder.
    await dnd(app, tile("Ores/Tools"), ".foldertile:not([data-folder])");
    await changed(app, "Ores,Tools,Tools/Old");
    // Onto the breadcrumb: the project's top.
    await app.click(".crumb .linkbtn");
    await app.click(tile("Tools"), undefined, { double: true });
    await app.waitFor(`document.querySelector(${JSON.stringify(tile("Tools/Old"))})`);
    await app.click(tile("Tools/Old"));
    await dnd(app, tile("Tools/Old"), ".crumbdrop[data-path='']", false);
    await app.sleep(200);
    await app.shot(`${OUT}/dragging-crumb-en-dark.png`);
    await dnd(app, tile("Tools/Old"), ".crumbdrop[data-path='']");
    await changed(app, "Old,Ores,Tools");
    // Toolbar Move with the folder selected.
    await app.click(".crumb .linkbtn");
    await app.waitFor(`document.querySelector(${JSON.stringify(tile("Old"))})`);
    assert(await app.eval<boolean>(`document.querySelector(".movebtn .abtn").disabled`), "Move needs a selection");
    await app.click(tile("Old"));
    await app.click(".movebtn .abtn");
    await app.waitFor(`document.querySelector(".menulist")`);
    const offered = await app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent)`);
    assert(offered.join() === "Ores,Tools", `Move offers the other folders, not the top it is in: ${offered}`);
    await app.shot(`${OUT}/toolbar-move-en-dark.png`);
    await app.click(".menulist button", "Ores");
    await changed(app, "Ores,Ores/Old,Tools");
    await app.click(tile("Tools"));
    await dnd(app, tile("Tools"), tile("Ores"), false);
    await app.sleep(200);
    await app.shot(`${OUT}/dragging-en-dark.png`);
    await app.setTheme("light");
    await app.sleep(300);
    await dnd(app, tile("Tools"), tile("Ores"), false);
    await app.sleep(200);
    await app.shot(`${OUT}/dragging-en-light.png`);
  }, { project: language === "en" ? project : (writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Ores", "Tools", "Tools/Old"], placement: {} })), project), language, width: 1440, height: 900 });
}
