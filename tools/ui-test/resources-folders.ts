/**
 * Q211: folder management in Resources > Textures, on a copy of examples/hello with four extra textures (gem_a..gem_d):
 * nested folders (New subfolder from a folder's menu), rename, colour and icon, a box selection of three tiles moved by
 * drag, Ctrl and Shift selection moved with the toolbar's Move, a folder moved into another, delete keeping the
 * contents (they move up) and delete with the contents (unused files go, a texture an element uses stays). Texture files
 * never move, so an element's texture still resolves after every move. Screenshots go to design/211/ (en dark and
 * light, tr dark).
 * Every folder action goes through the heading's visible button or the toolbar (Q211 reopened); one right click and the
 * F2, double click and Delete key shortcuts are checked too. A second part runs on a copy of the ETR project, whose
 * textures all sit in Minecraft (disk) groups: the groups show a lock and their button offers New folder and Move
 * selected into new folder.
 *   npm run build:app && node tools/ui-test/resources-folders.ts
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/211";
interface Stored { folders: string[]; placement: Record<string, string>; colors?: Record<string, string>; icons?: Record<string, string> }
const stored = (project: string): Stored => existsSync(join(project, "texture-folders.json"))
  ? JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) : { folders: [], placement: {} };
const cell = (path: string) => `.texcell[data-path="${path}"]`;
const group = (key: string) => `.tgroup[data-group="${key}"]`;
const own = (folder: string) => group(`@folder:${folder}`);
const tex = (name: string) => `textures/${name}.png`;
const until = async (app: App, check: () => boolean, message: string) => {
  for (let i = 0; i < 50 && !check(); i++) await app.sleep(100);
  assert(check(), message);
};
const dnd = (app: App, from: string, to: string) => app.eval(`(() => {
  const a = document.querySelector(${JSON.stringify(from)}), b = document.querySelector(${JSON.stringify(to)});
  const dt = new DataTransfer();
  a.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
  b.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  b.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
})()`);
/** A click with Ctrl or Shift held, the way the tile's onClick sees it. */
const modClick = (app: App, selector: string, key: "ctrlKey" | "shiftKey") =>
  app.eval(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click", { bubbles: true, ${key}: true }))`);
const picked = (app: App) => app.eval<string[]>(`[...document.querySelectorAll('.texcell[aria-selected="true"]')].map((c) => c.dataset.path)`);
/** Opens a folder's menu with the heading's own button (not a right click) and picks the entries. */
const menu = async (app: App, folder: string, ...path: string[]) => {
  await app.click(`${own(folder)} .gmore`);
  for (const label of path) await app.click(".menulist button", label);
};
const name = async (app: App, value: string) => {
  await app.waitFor(`document.querySelector(".texfoldername")`);
  await app.setValue(".texfoldername", value);
  await app.key("Enter");
};
/** Drags a box from below the tile `from` to the top left of the tile `to` (empty space under the grid row starts it). */
const box = async (app: App, from: string, to: string) => {
  const a = await app.rect(cell(from)), b = await app.rect(cell(to));
  await app.drag([a.x + a.width - 6, a.y + a.height + 4], [b.x + 6, b.y + 6]);
};

for (const language of ["en", "tr"]) {
  const en = language === "en";
  const project = exampleProject();
  for (const n of ["a", "b", "c", "d"]) copyFileSync(join(project, "textures/ruby.png"), join(project, `textures/gem_${n}.png`));
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`, 60000);
    await app.click(".rtab", en ? "Resources" : "Kaynaklar");
    await app.waitFor(`document.querySelector(${JSON.stringify(cell(tex("gem_d")))})`);

    // Nested folders: New folder, then New subfolder from its menu.
    await app.click(".view .actions .abtn", en ? "New folder" : "Yeni klasör");
    await name(app, "Gems");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Gems"))})`);
    await menu(app, "Gems", en ? "New subfolder" : "Yeni alt klasör");
    await name(app, "Ruby");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Gems/Ruby"))})`);
    assert(stored(project).folders.join() === "Gems,Gems/Ruby", `nested: ${JSON.stringify(stored(project))}`);
    if (!en) {
      // A box over three tiles selects them; the tr screenshot shows the selection and the nested folders.
      await box(app, tex("gem_c"), tex("gem_a"));
      await app.sleep(200);
      assert((await picked(app)).length === 3, `box selected ${await picked(app)}`);
      await app.sleep(200);
      await app.shot(`${OUT}/after-tr-dark.png`);
      return;
    }

    // The visible button, F2, double click, the toolbar's focused-folder buttons and the Delete key (Q211 reopened).
    assert(await app.eval<boolean>(`!!document.querySelector(".foldertip")`) === false, "no hint once a folder exists");
    await app.click(`${own("Gems/Ruby")} .gtitle`);
    for (const label of ["New subfolder", "Rename", "Delete folder"]) assert(await app.eval<boolean>(`[...document.querySelectorAll(".view .actions .abtn")].some((b) => b.textContent.includes(${JSON.stringify(label)}))`), `toolbar shows ${label}`);
    await app.eval(`document.querySelector(${JSON.stringify(`${own("Gems/Ruby")} .gtitle`)}).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
    await name(app, "Ruby2");
    await until(app, () => stored(project).folders.join() === "Gems,Gems/Ruby2", "double click renames");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Gems/Ruby2"))})`);
    await app.click(`${own("Gems/Ruby2")} .gtitle`);
    await app.key("F2");
    await name(app, "Ruby");
    await until(app, () => stored(project).folders.join() === "Gems,Gems/Ruby", "F2 renames");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Gems/Ruby"))})`);
    await app.click(`${own("Gems/Ruby")} .gtitle`, undefined, { button: "right" });
    assert(await app.eval<boolean>(`[...document.querySelectorAll(".menulist button")].some((b) => b.textContent.includes("New subfolder"))`), "right click still opens the menu");
    await app.key("Escape");
    const [hx, hy] = await app.center(`${own("Gems/Ruby")} .gtitle`);
    await app.mouse("mouseMoved", hx, hy);
    await app.shot(`${OUT}/heading-button-en-dark.png`);

    // Rename, colour and icon.
    await menu(app, "Gems/Ruby", "Rename");
    await name(app, "Red");
    await until(app, () => stored(project).folders.join() === "Gems,Gems/Red", "renamed");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Gems/Red"))})`);
    await menu(app, "Gems/Red", "Colour", "Red");
    await until(app, () => stored(project).colors?.["Gems/Red"] === "#b02e26", `colour: ${JSON.stringify(stored(project))}`);
    await menu(app, "Gems/Red", "Icon", "Gem");
    await until(app, () => stored(project).icons?.["Gems/Red"] === "gem", `icon: ${JSON.stringify(stored(project))}`);

    // A box over three tiles; dragging one of them takes all three.
    await box(app, tex("gem_c"), tex("gem_a"));
    await app.sleep(200);
    const three = await picked(app);
    assert(three.join() === [tex("gem_a"), tex("gem_b"), tex("gem_c")].join(), `box selected ${three}`);
    assert((await app.eval<string>(`document.querySelector(".panel, .side, aside")?.textContent ?? document.body.textContent`)).includes("3 textures selected"), "details show the count");
    await app.shot(`${OUT}/selected-en-dark.png`);
    await dnd(app, cell(tex("gem_a")), own("Gems/Red"));
    await until(app, () => ["gem_a", "gem_b", "gem_c"].every((n) => stored(project).placement[tex(n)] === "Gems/Red"), `multi drag: ${JSON.stringify(stored(project))}`);
    await app.waitFor(`document.querySelector(${JSON.stringify(`${own("Gems/Red")} ${cell(tex("gem_b"))}`)})`);
    await app.shot(`${OUT}/after-en-dark.png`);
    await app.setTheme("light");
    await app.sleep(300);
    await app.shot(`${OUT}/after-en-light.png`);
    await app.setTheme("dark");

    // Ctrl and Shift selection, moved with the toolbar's Move. ruby.png is used by an element, so it moves in metadata only.
    await app.click(cell(tex("ruby")));
    await modClick(app, cell(tex("ruby_block")), "ctrlKey");
    assert((await picked(app)).join() === [tex("ruby"), tex("ruby_block")].join(), `ctrl: ${await picked(app)}`);
    await app.click(cell(tex("ruby")));
    await modClick(app, cell(tex("ruby_pickaxe")), "shiftKey");
    assert((await picked(app)).join() === ["ruby", "ruby_apple", "ruby_block", "ruby_pickaxe"].map(tex).join(), `shift range: ${await picked(app)}`);
    await app.click(".texmove .abtn");
    await app.click(".menulist button", "Gems");
    await until(app, () => ["ruby", "ruby_apple", "ruby_block", "ruby_pickaxe"].every((n) => stored(project).placement[tex(n)] === "Gems"), `moved: ${JSON.stringify(stored(project))}`);
    for (const n of ["ruby", "ruby_apple", "ruby_block", "ruby_pickaxe"]) assert(existsSync(join(project, tex(n))), `${n} did not move on disk`);
    const item = JSON.parse(readFileSync(join(project, "elements/items/ruby.json"), "utf8"));
    assert(item.texture === tex("ruby") && existsSync(join(project, item.texture)), "the element's texture still resolves");

    // Delete the nested folder keeping its contents: the three gems move up to Gems.
    await menu(app, "Gems/Red", "Delete");
    await app.waitFor(`document.querySelector('input[name="delmode"]')`);
    await app.shot(`${OUT}/delete-en-dark.png`);
    await app.click(".dialog button", "Delete");
    await until(app, () => !stored(project).folders.includes("Gems/Red") && stored(project).placement[tex("gem_a")] === "Gems", `keep: ${JSON.stringify(stored(project))}`);
    assert(!stored(project).colors && !stored(project).icons, "colour and icon go with the folder");
    assert(["gem_a", "gem_b", "gem_c"].every((n) => existsSync(join(project, tex(n)))), "kept files stay");

    // Delete with the contents: gem_d is unused and goes; ruby_block is used and stays, moved up to the top.
    await app.click(".view .actions .abtn", "New folder");
    await name(app, "Scrap");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Scrap"))})`);
    await dnd(app, cell(tex("gem_d")), own("Scrap"));
    await dnd(app, cell(tex("ruby_block")), own("Scrap"));
    await until(app, () => stored(project).placement[tex("gem_d")] === "Scrap" && stored(project).placement[tex("ruby_block")] === "Scrap", "filled Scrap");
    await app.click(`${own("Scrap")} .gtitle`);
    await app.key("Delete");
    await app.waitFor(`document.querySelector('input[name="delmode"]')`);
    await app.eval(`document.querySelectorAll('input[name="delmode"]')[1].click()`);
    await app.sleep(150);
    const text = await app.eval<string>(`document.querySelector(".dialog").textContent`);
    assert(text.includes("deleted from the project: 1") && text.includes("move up: 1"), `dialog counts: ${text}`);
    await app.shot(`${OUT}/delete-contents-en-dark.png`);
    await app.click(".dialog button", "Delete");
    await until(app, () => !existsSync(join(project, tex("gem_d"))), "unused file deleted");
    await until(app, () => !stored(project).folders.includes("Scrap"), "folder removed");
    assert(existsSync(join(project, tex("ruby_block"))), "the used texture stays");
    assert(!("textures/ruby_block.png" in stored(project).placement), "and is back at the top");
    assert(JSON.parse(readFileSync(join(project, "elements/blocks/ruby_block.json"), "utf8")).texture === tex("ruby_block"), "block reference intact");

    // A folder moved into another from its menu.
    await app.click(".view .actions .abtn", "New folder");
    await name(app, "Archive");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Archive"))})`);
    await menu(app, "Gems", "Move", "Archive");
    await until(app, () => stored(project).folders.includes("Archive/Gems") && stored(project).placement[tex("ruby")] === "Archive/Gems", `folder move: ${JSON.stringify(stored(project))}`);
  }, { project, language, width: 1440, height: 900 });
}

// The ETR project: every texture sits in a disk group, so nothing used to offer a menu there.
{
  const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
  await run(async (app) => {
    await app.click(".rtab", "Resources");
    await app.waitFor(`document.querySelector(".texcell")`, 30000);
    const groups = await app.eval<{ disk: number; locks: number; buttons: number }>(`(() => {
      const disk = [...document.querySelectorAll(".tgroup:not(.own)")];
      return { disk: disk.length, locks: disk.filter((g) => g.querySelector(".glock")).length, buttons: disk.filter((g) => g.querySelector(".gmore")).length };
    })()`);
    assert(groups.disk > 0 && groups.locks === groups.disk && groups.buttons === groups.disk, `disk groups have a lock and a button: ${JSON.stringify(groups)}`);
    // With nothing selected the disk group's menu offers New folder only; with a texture selected, also Move selected into new folder.
    const first = await app.eval<string>(`document.querySelector(".tgroup:not(.own) .texcell").dataset.path`);
    const diskGroup = await app.eval<string>(`document.querySelector(".tgroup:not(.own) .texcell").closest(".tgroup").dataset.group`);
    const diskButton = `.tgroup[data-group="${diskGroup}"] .gmore`;
    await app.click(diskButton);
    assert(await app.eval<string>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent).join("|")`) === "New folder", "disk group menu: New folder");
    await app.shot(`${OUT}/disk-group-menu-en-dark.png`);
    await app.key("Escape");
    await app.click(cell(first));
    await app.click(diskButton);
    assert((await app.eval<string>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent).join("|")`)) === "New folder|Move selected into new folder", "disk group menu with a selection");
    await app.click(".menulist button", "Move selected into new folder");
    await name(app, "Picked");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Picked"))})`);
    await until(app, () => stored(project).placement[first] === "Picked" && stored(project).folders.includes("Picked"), `moved into the new folder: ${JSON.stringify(stored(project))}`);
    assert(existsSync(join(project, first)), "the texture file stayed where it was");
    // Everything else from the visible button: subfolder, rename, move, delete.
    await menu(app, "Picked", "New subfolder");
    await name(app, "Deep");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Picked/Deep"))})`);
    await menu(app, "Picked/Deep", "Rename");
    await name(app, "Deeper");
    await until(app, () => stored(project).folders.includes("Picked/Deeper"), "renamed");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Picked/Deeper"))})`);
    await menu(app, "Picked/Deeper", "Move", "Top");
    await until(app, () => stored(project).folders.includes("Deeper") && !stored(project).folders.includes("Picked/Deeper"), "moved to the top");
    await app.waitFor(`document.querySelector(${JSON.stringify(own("Deeper"))})`);
    await menu(app, "Deeper", "Delete");
    await until(app, () => !stored(project).folders.includes("Deeper"), "an empty folder is deleted at once");
    await app.waitFor(`!document.querySelector(${JSON.stringify(own("Deeper"))})`);
    await menu(app, "Picked", "Delete");
    await app.waitFor(`document.querySelector('input[name="delmode"]')`);
    await app.click(".dialog button", "Delete");
    await until(app, () => !stored(project).folders.includes("Picked") && !(first in stored(project).placement), `kept contents moved up: ${JSON.stringify(stored(project))}`);
    assert(existsSync(join(project, first)), "the texture is still there");
  }, { project, width: 1440, height: 900 });
}
console.log("PASS");
