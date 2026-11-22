/**
 * Q244: first-run setup and Simple / Advanced mode, with real clicks.
 * 1. First start (no level saved): the setup shows over the welcome screen, Start waits for an answer; the language
 *    picked there switches the dialog at once. "I am new to modding" saves level new + Simple mode.
 * 2. Simple mode on the example project: no Variables or Git in the rail, no Gradle items in the menus, no Gradle or
 *    Scenarios tab, the block editor without its advanced pages, New element without the rare types. Window > Simple
 *    mode is checked.
 * 3. Window > Simple mode switches to Advanced: everything is back.
 * 4. A restart on the same user data does not show the setup again.
 * 5. Skip on a fresh start: level some, Advanced, the setup does not come back.
 * Screenshots in design/244/ (en/tr, dark/light).
 *   node tools/ui-test/experience.ts
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, copyProject, launchApp, REPO, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/244");
const EXPERIENCE = JSON.parse(readFileSync(join(REPO, "config", "experience.json"), "utf8")) as { simple: { elementTypes: string[] } };
const saved = (userData: string) => (JSON.parse(readFileSync(join(userData, "app-state.json"), "utf8")) as { preferences: { level?: string; mode?: string; language: string } }).preferences;
const railSections = (app: App) => app.eval<number>(`document.querySelectorAll(".rail .rtab").length`);
const menuLabels = async (app: App, menu: string) => {
  await app.click(".menubar .menu", menu);
  const labels = await app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim())`);
  await app.key("Escape");
  return labels;
};
const pageTabs = (app: App) => app.eval<number>(`document.querySelectorAll(".pagetabs [role=tab]").length`);

for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    const project = copyProject(join(REPO, "examples", "hello"), "hello");
    const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
    let app = await launchApp({ project, theme, language: "en", level: null, userData });
    try {
      // 1. The setup on the first start.
      await app.waitFor(`document.querySelector("[data-testid=setup]")`);
      assert(await app.eval<boolean>(`document.querySelector(".dialog button[type=submit]").disabled`), "Start waits for an answer");
      if (lang !== "en") {
        await app.setValue("[data-testid=setup-language]", lang);
        await app.waitFor(`document.querySelector(".dialog .ptitle").textContent === ${JSON.stringify(strings["setup.title"])}`);
      }
      await app.click(".setup-level", strings["setup.level.new"]);
      await app.shot(`${OUT}/setup-${lang}-${theme}.png`);
      await app.click(".dialog button[type=submit]");
      await app.waitFor(`!document.querySelector("[data-testid=setup]")`);
      const prefs = saved(userData);
      assert(prefs.level === "new" && prefs.mode === "simple" && prefs.language === lang, `saved: ${JSON.stringify(prefs)}`);

      // 2. Simple mode on a project.
      await app.click(".grid tbody tr", "UI test", { double: true });
      await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
      assert((await railSections(app)) === 5, `rail without Variables and Git: ${await railSections(app)}`);
      const build = await menuLabels(app, strings["menu.buildRun"]);
      for (const key of ["menu.runGradleTask", "menu.clearCaches", "menu.debugClient"]) assert(!build.includes(strings[key]), `Build hides ${key}: ${build}`);
      assert(build.includes(strings["top.run"]) && build.includes(strings["menu.exportJar"]), `Build keeps Run and Export: ${build}`);
      const windowMenu = await menuLabels(app, strings["menu.window"]);
      assert(windowMenu.some((l) => l.includes(strings["menu.simpleMode"])), `Window has Simple mode: ${windowMenu}`);
      assert(await app.eval<boolean>(`!document.querySelector("[data-testid=top-run-another]")`), "no Run another client button");
      await app.click(".menubar .menu", strings["menu.window"]);
      await app.click(".menulist button", strings["panel.build"]);
      await app.waitFor(`document.querySelector(".bottom-panel")`);
      const tabs = await app.eval<string[]>(`[...document.querySelectorAll(".panel-tabs .ptab")].map((b) => b.textContent.trim())`);
      assert(!tabs.some((l) => l.startsWith(strings["panel.gradle"])) && !tabs.some((l) => l.startsWith(strings["panel.scenarios"])), `panel tabs: ${tabs}`);
      await app.key("n", 2);
      await app.waitFor(`document.querySelector(".addpop")`);
      const shownTypes = await app.eval<string[]>(`[...document.querySelectorAll(".addpop .ptype")].map((b) => b.dataset.type)`);
      for (const id of EXPERIENCE.simple.elementTypes) assert(!shownTypes.includes(id), `New element hides ${id}`);
      assert(shownTypes.includes("block") && shownTypes.includes("item"), "New element keeps block and item");
      await app.key("Escape");
      await app.click(".tiles .tile", "Ruby", { double: true });
      await app.waitFor(`document.querySelector(".pagetabs")`);
      const simplePages = await pageTabs(app);
      await app.shot(`${OUT}/simple-block-${lang}-${theme}.png`);

      // 3. Window > Simple mode: Advanced brings everything back.
      await app.click(".menubar .menu", strings["menu.window"]);
      await app.click(".menulist button", strings["menu.simpleMode"]);
      await app.waitFor(`document.documentElement.dataset.mode === "advanced"`);
      await app.waitFor(`document.querySelectorAll(".rail .rtab").length === 7`);
      assert(saved(userData).mode === "advanced", "the switch is saved");
      // The open block editor stays open and gets its advanced pages back.
      await app.waitFor(`document.querySelectorAll(".pagetabs [role=tab]").length > ${simplePages}`);
      const allPages = await pageTabs(app);
      assert(allPages > simplePages && allPages === 12, `block pages: simple ${simplePages}, advanced ${allPages}`);
      await app.shot(`${OUT}/advanced-block-${lang}-${theme}.png`);
    } catch (error) {
      await app.shot("tools/ui-test/last-failure.png").catch(() => {});
      await app.close();
      throw error;
    }
    await app.close();

    // 4. A restart does not ask again.
    app = await launchApp({ project, theme, language: lang, userData });
    try {
      // launchApp opened the project from the recent list: the setup was not in the way.
      await app.sleep(500);
      assert(await app.eval<boolean>(`!document.querySelector("[data-testid=setup]")`), "no setup after it was answered");
    } finally {
      await app.close();
    }
    console.log(`PASS setup and modes ${lang} ${theme}`);
  }

  // 5. Skip: Advanced, not asked again.
  const skipData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
  await run(async (app) => {
    await app.waitFor(`document.querySelector("[data-testid=setup]")`);
    await app.click(".dialog .abtn", strings["setup.skip"]);
    await app.waitFor(`!document.querySelector("[data-testid=setup]")`);
    const prefs = saved(skipData);
    assert(prefs.level === "some" && prefs.mode === "advanced", `skip saved: ${JSON.stringify(prefs)}`);
  }, { language: lang, level: null, userData: skipData });
}
