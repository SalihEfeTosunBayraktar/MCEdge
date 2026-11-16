/**
 * Q231: a click outside the New element popup closes it, on the type list and on the name step; clicks inside keep
 * it open; the New button still opens and closes it. Real mouse clicks (CDP input events), not element.click().
 * Args: language (en|tr), theme. Screenshots go to design/231/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const open = (app: App) => app.eval<boolean>(`!!document.querySelector(".addpop")`);
const clickNew = (app: App) => app.click(".abtn", s["action.new"]);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 0`, 60_000);

  await clickNew(app);
  await app.waitFor(`!!document.querySelector(".addpop")`);
  await app.shot(`design/231/open-${lang}-${theme}.png`);
  await app.click(".addpop .popsearch input");
  await app.click(".addpop .pophead");
  assert(await open(app), "clicks inside the popup keep it open");
  await app.click(".wsname");
  assert(!(await open(app)), "a click outside closes the type list");
  await app.shot(`design/231/closed-${lang}-${theme}.png`);

  await clickNew(app);
  assert(await open(app), "New opens it again");
  await clickNew(app);
  assert(!(await open(app)), "New closes it");

  await clickNew(app);
  await app.click(".addpop .ptype:not([disabled])");
  await app.waitFor(`!!document.querySelector(".addpop .popform")`);
  await app.click(".addpop .popform input");
  assert(await open(app), "a click in the name step keeps it open");
  await app.click(".wsname"); // the first tiles sit under the popup
  assert(!(await open(app)), "a click outside closes the name step");
  console.log("PASS new-popup-outside");
}, { project: exampleProject(), language: lang, theme });
