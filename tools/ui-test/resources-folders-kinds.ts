/**
 * Q211 (reopened): folders on Resources > Sounds, Models and Structures, on a copy of examples/hello with four files of
 * each kind, one of them named by an element. Per tab, with the visible controls only: New folder, New subfolder
 * from the toolbar (the new folder is focused), Rename and Colour from the heading's button, a Ctrl selection of three
 * rows moved with the toolbar's Move, delete keeping the contents, and delete with the contents (the file an element
 * uses stays and the dialog says so). Placements go to texture-folders.json under `resources.<kind>`; the file's
 * Textures part stays as it was. Screenshots go to design/211/ (en dark, light, tr dark).
 *   npm run build:app && node tools/ui-test/resources-folders-kinds.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/211";
type Kind = "sounds" | "models" | "structures";
interface Stored { folders: string[]; placement: Record<string, string>; colors?: Record<string, string>; resources?: Partial<Record<Kind, Stored>> }
const stored = (project: string, kind: Kind): Stored => {
  const file = join(project, "texture-folders.json");
  const whole: Stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { folders: [], placement: {} };
  return whole.resources?.[kind] ?? { folders: [], placement: {} };
};
const until = async (app: App, check: () => boolean, message: string) => {
  for (let i = 0; i < 50 && !check(); i++) await app.sleep(100);
  assert(check(), message);
};
const head = (folder: string) => `h3.folderhead[title="${folder}"]`;
const row = (key: string) => `tr[data-key="${key}"]`;
const name = async (app: App, value: string) => {
  await app.waitFor(`document.querySelector(".texfoldername")`);
  await app.setValue(".texfoldername", value);
  await app.key("Enter");
};
/** The heading's own button, not a right click. */
const kebab = async (app: App, folder: string, ...path: string[]) => {
  await app.click(`${head(folder)} .gmore`);
  for (const label of path) await app.click(".menulist button", label);
};
const toolbar = (app: App, label: string) => app.click(".view .actions .abtn", label);
const modClick = (app: App, selector: string) =>
  app.eval(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);

interface Tab { kind: Kind; label: string; keys: string[]; used: string; file: (key: string) => string }
const TABS: Tab[] = [
  { kind: "sounds", label: "Sounds", keys: ["snd_a", "snd_b", "snd_c", "snd_used"], used: "snd_used", file: (k) => `sounds/${k}.ogg` },
  { kind: "models", label: "Models", keys: ["mdl_a", "mdl_b", "mdl_c", "mdl_used"].map((k) => `models/${k}.json`), used: "models/mdl_used.json", file: (k) => k },
  { kind: "structures", label: "Structures", keys: ["str_a", "str_b", "str_c", "str_used"].map((k) => `structures/${k}.nbt`), used: "structures/str_used.nbt", file: (k) => k },
];

for (const language of ["en", "tr"]) {
  const en = language === "en";
  const project = exampleProject();
  for (const dir of ["sounds", "models", "structures"]) mkdirSync(join(project, dir), { recursive: true });
  for (const n of ["a", "b", "c", "used"]) {
    writeFileSync(join(project, `sounds/snd_${n}.ogg`), "OggS");
    writeFileSync(join(project, `models/mdl_${n}.json`), "{\"elements\": []}");
    writeFileSync(join(project, `structures/str_${n}.nbt`), "nbt");
  }
  // An element names one file of each kind (a sound as <modid>:<name>, a model and a structure by name).
  addElement(project, "block", "noisy", { breakSound: "hellomcedge:snd_used" });
  addElement(project, "armor", "worn", { helmetModelName: "mdl_used" });
  addElement(project, "structure", "tower", { structure: "hellomcedge:str_used" });
  const whole = () => JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) as Stored;
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`, 60000);
    await app.click(".rtab", en ? "Resources" : "Kaynaklar");
    for (const tab of TABS) {
      await app.click(".ltab", en ? tab.label : { sounds: "Sesler", models: "Modeller", structures: "Yapılar" }[tab.kind]);
      await app.waitFor(`document.querySelector(${JSON.stringify(row(tab.keys[0]))})`);
      assert(await app.eval<boolean>(`!!document.querySelector(".foldertip")`), `${tab.kind}: the how-to hint shows while there is no folder`);

      // New folder, then New subfolder from the toolbar: the new folder is focused, so the folder buttons appear.
      await toolbar(app, en ? "New folder" : "Yeni klasör");
      await name(app, "Pack");
      await app.waitFor(`document.querySelector(${JSON.stringify(head("Pack"))})`);
      assert(!(await app.eval<boolean>(`!!document.querySelector(".foldertip")`)), `${tab.kind}: the hint goes once a folder exists`);
      await toolbar(app, en ? "New subfolder" : "Yeni alt klasör");
      await name(app, "Sub");
      await app.waitFor(`document.querySelector(${JSON.stringify(head("Pack/Sub"))})`);
      assert(stored(project, tab.kind).folders.join() === "Pack,Pack/Sub", `${tab.kind} nested: ${JSON.stringify(stored(project, tab.kind))}`);
      if (!en) {
        await app.shot(`${OUT}/${tab.kind}-tr-dark.png`);
        continue;
      }

      // Rename and colour from the heading's button.
      await kebab(app, "Pack/Sub", "Rename");
      await name(app, "Inner");
      await until(app, () => stored(project, tab.kind).folders.join() === "Pack,Pack/Inner", `${tab.kind} renamed: ${JSON.stringify(stored(project, tab.kind))}`);
      await app.waitFor(`document.querySelector(${JSON.stringify(head("Pack/Inner"))})`);
      await kebab(app, "Pack/Inner", "Colour", "Red");
      await until(app, () => stored(project, tab.kind).colors?.["Pack/Inner"] === "#b02e26", `${tab.kind} colour`);

      // Three rows by Ctrl+click, moved with the toolbar's Move.
      const [a, b, c, used] = tab.keys;
      await app.click(row(a));
      await modClick(app, row(b));
      await modClick(app, row(c));
      assert((await app.eval<string>(`document.querySelector(".split aside, .panel, .side")?.textContent ?? document.body.textContent`)).includes(`3 ${tab.kind} selected`), `${tab.kind}: details show the count`);
      await app.shot(`${OUT}/${tab.kind}-selected-en-dark.png`);
      await app.click(".texmove .abtn");
      await app.click(".menulist button", "Pack/Inner");
      await until(app, () => [a, b, c].every((k) => stored(project, tab.kind).placement[k] === "Pack/Inner"), `${tab.kind} moved: ${JSON.stringify(stored(project, tab.kind))}`);
      for (const k of [a, b, c]) assert(existsSync(join(project, tab.file(k))), `${k} did not move on disk`);
      assert(whole().folders !== undefined && !whole().folders.includes("Pack"), "the Textures part of the file is untouched");
      if (tab.kind === "sounds") {
        await app.shot(`${OUT}/${tab.kind}-after-en-dark.png`);
        await app.setTheme("light");
        await app.sleep(300);
        await app.shot(`${OUT}/${tab.kind}-after-en-light.png`);
        await app.setTheme("dark");
      }

      // Delete the subfolder keeping its contents (the dialog's default): the three rows go up to Pack.
      await kebab(app, "Pack/Inner", "Delete");
      await app.waitFor(`document.querySelector('input[name="delmode"]')`);
      await app.click(".dialog button", "Delete");
      await until(app, () => !stored(project, tab.kind).folders.includes("Pack/Inner") && stored(project, tab.kind).placement[a] === "Pack", `${tab.kind} keep: ${JSON.stringify(stored(project, tab.kind))}`);
      assert([a, b, c].every((k) => existsSync(join(project, tab.file(k)))), "kept files stay");

      // Delete with the contents from the toolbar's Delete folder: the unused file goes, the one an element names stays, moved up.
      await toolbar(app, en ? "New folder" : "Yeni klasör");
      await name(app, "Scrap");
      await app.waitFor(`document.querySelector(${JSON.stringify(head("Scrap"))})`);
      await app.click(row(a));
      await modClick(app, row(used));
      await app.click(".texmove .abtn");
      await app.click(".menulist button", "Scrap");
      await until(app, () => stored(project, tab.kind).placement[a] === "Scrap" && stored(project, tab.kind).placement[used] === "Scrap", `${tab.kind} filled Scrap`);
      await app.click(`${head("Scrap")}`);
      await toolbar(app, en ? "Delete folder" : "Klasörü sil");
      await app.waitFor(`document.querySelector('input[name="delmode"]')`);
      await app.eval(`document.querySelectorAll('input[name="delmode"]')[1].click()`);
      await app.sleep(150);
      const text = await app.eval<string>(`document.querySelector(".dialog").textContent`);
      assert(text.includes("deleted from the project: 1") && text.includes("move up: 1"), `${tab.kind} dialog counts: ${text}`);
      if (tab.kind === "sounds") await app.shot(`${OUT}/${tab.kind}-delete-contents-en-dark.png`);
      await app.click(".dialog button", "Delete");
      await until(app, () => !stored(project, tab.kind).folders.includes("Scrap"), `${tab.kind} folder removed`);
      await until(app, () => !existsSync(join(project, tab.file(a))), `${tab.kind}: unused file deleted`);
      assert(existsSync(join(project, tab.file(used))), `${tab.kind}: the file an element names stays`);
      assert(!(used in stored(project, tab.kind).placement) || stored(project, tab.kind).placement[used] !== "Scrap", "and is no longer in Scrap");
      assert(!(await app.eval<boolean>(`!!document.querySelector(${JSON.stringify(head("Scrap"))})`)), "the folder is gone from the list");
    }
  }, { project, language, width: 1440, height: 900 });
}
console.log("PASS");
