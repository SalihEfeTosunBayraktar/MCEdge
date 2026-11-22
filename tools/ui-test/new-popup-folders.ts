/**
 * Q233: the New element popup groups the element types in folders. Pointing at a folder (real mouse moves) shows its
 * types on the right after a short pause; sweeping quickly across folders does not switch; a click on a shown type
 * opens the name step; search lists matches from every folder; shortcut letters still pick types of closed folders.
 * Args: language (en|tr), theme. Screenshots go to design/233/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const shot = (app: App, name: string) => app.shot(evidence(`design/233/${name}-${lang}-${theme}.png`));
const openFolder = (app: App) => app.eval<string>(`document.querySelector(".pfolder.open").dataset.group`);
const visible = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".addpop .ptype:not([hidden])")].map((b) => b.dataset.type)`);
const pointAt = async (app: App, group: string) => {
  const [x, y] = await app.center(`.pfolder[data-group="${group}"]`);
  await app.mouse("mouseMoved", x, y, 0);
};
const newPopup = async (app: App) => {
  await app.click(".abtn", s["action.new"]);
  await app.waitFor(`!!document.querySelector(".addpop .pfolder")`);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 0`, 60_000);
  await newPopup(app);

  const folders = await app.eval<{ group: string; count: number }[]>(`[...document.querySelectorAll(".pfolder")].map((b) => ({ group: b.dataset.group, count: +b.querySelector(".pfcount").textContent }))`);
  const total = await app.eval<number>(`document.querySelectorAll(".addpop .ptype").length`);
  assert(folders.length >= 6 && folders.reduce((n, f) => n + f.count, 0) === total, `every type is in one folder (${JSON.stringify(folders)}, ${total} types)`);
  assert(await openFolder(app) === "blocks", "the first folder is open");
  assert((await visible(app)).length === folders[0].count, "only the open folder's types show");
  await shot(app, "blocks");

  // Pointing at a folder previews it after the pause.
  await pointAt(app, "interface");
  await app.sleep(300);
  assert(await openFolder(app) === "interface", "pointing at a folder opens it");
  const ui = await visible(app);
  assert(ui.includes("radial_menu") && ui.includes("bubble"), `the folder shows its types (${ui.join(", ")})`);
  await shot(app, "interface");

  // A quick sweep over other folders does not switch it.
  await pointAt(app, "world");
  await app.sleep(30);
  await pointAt(app, "entities");
  await app.sleep(30);
  const [tx, ty] = await app.center(".addpop .ptype:not([hidden])");
  await app.mouse("mouseMoved", tx, ty, 0);
  await app.sleep(300);
  assert(await openFolder(app) === "interface", "a quick sweep across folders keeps the open one");

  await pointAt(app, "logic");
  await app.sleep(300);
  await app.click('.addpop .ptype[data-type="procedure"]');
  await app.waitFor(`!!document.querySelector(".addpop .popform")`);
  assert((await app.eval<string>(`document.querySelector(".addpop .ptitle-inline").textContent`)).length > 0, "a type of the pointed folder opens the name step");
  await app.key("Escape");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".addpop")`);

  // Search lists matches from every folder in one list.
  await newPopup(app);
  const radialName = await app.eval<string>(`document.querySelector('.addpop .ptype[data-type="radial_menu"] .pname').textContent`);
  await app.setValue(".addpop .popsearch input", radialName.slice(0, 4));
  assert(!(await app.eval<boolean>(`!!document.querySelector(".pfolder")`)), "search hides the folders");
  assert((await visible(app)).includes("radial_menu"), "search finds a type of a closed folder");
  await shot(app, "search");
  await app.setValue(".addpop .popsearch input", "");

  // Shortcut letters reach types of closed folders.
  const letter = await app.eval<string>(`document.querySelector('.addpop .ptype[data-type="procedure"] kbd').textContent`);
  await app.eval(`document.querySelector(".popfolders").focus()`);
  await app.key(letter.toLocaleLowerCase(lang));
  await app.waitFor(`!!document.querySelector(".addpop .popform")`);
  console.log("PASS new-popup-folders");
}, { project: exampleProject(), language: lang, theme });
