/**
 * KUYRUK 122: Preferences is a dialog (Window > Preferences and the welcome screen), not a rail section; every section
 * shows its name at the left of its find bar, uncut and with the search at the same x; the wide rail fits its names.
 * Runs on a copy of examples/hello. Args: language (en|tr), theme, suffix ("before" only takes the screenshots).
 * Screenshots go to design/122/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const suffix = process.argv[4] ?? "after";
const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const OUT = evidence(`design/122`);
const shot = (app: App, name: string) => app.shot(`${OUT}/${name}-${lang}-${theme}-${suffix}.png`);
const menu = async (app: App, index: number, item: string) => {
  await app.eval(`document.querySelectorAll(".menubar .menus .menu")[${index}].click()`);
  await app.click(".menulist [role=menuitem]", item);
};
const focusInside = (app: App) => app.eval<boolean>(`!!document.querySelector(".prefsdialog")?.contains(document.activeElement)`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 1`);
  const titles = await app.eval<string[]>(`[...document.querySelectorAll(".rail .rtab")].map((b) => b.title)`);
  if (suffix === "before") {
    await app.click(".rtoggle");
    await app.click(".rtab", strings["section.localization"]);
    await app.sleep(500);
    await shot(app, "section-rail-wide");
    await app.click(".rtab", strings["section.preferences"]);
    await shot(app, "preferences");
    await menu(app, 0, strings["menu.closeProject"]);
    await app.waitFor(`document.querySelector(".welcome")`);
    await shot(app, "welcome");
    return;
  }

  // 1. Preferences left the rail.
  assert(!titles.includes(strings["section.preferences"]), `no Preferences in the rail: ${titles.join(", ")}`);

  // 2. Every section names itself, uncut, with the search at the same x.
  const xs = new Set<number>();
  for (const [i, title] of titles.entries()) {
    await app.eval(`document.querySelectorAll(".rail .rtab")[${i}].click()`);
    await app.sleep(300);
    const m = await app.eval<{ name: string; cut: boolean; x: number } | null>(`(() => {
      const n = document.querySelector(".content .findbar .fsection");
      if (!n) return null;
      return { name: n.textContent, cut: n.scrollWidth > n.clientWidth, x: Math.round(document.querySelector(".content .findbar .search").getBoundingClientRect().x) };
    })()`);
    assert(m && m.name === title && !m.cut, `${title}: name shown and not cut: ${JSON.stringify(m)}`);
    xs.add(m.x);
  }
  assert(xs.size === 1, `the search starts at the same x in every section: ${[...xs].join(", ")}`);

  // 3. The wide rail fits every name.
  await app.click(".rtoggle");
  await app.click(".rtab", strings["section.settings"]);
  await app.sleep(300);
  const cut = await app.eval<string[]>(`[...document.querySelectorAll(".rail .rtab")].filter((b) => b.scrollWidth > b.clientWidth || b.querySelector(".rlabel").getBoundingClientRect().right > b.getBoundingClientRect().right).map((b) => b.title)`);
  assert(cut.length === 0, `wide rail names fit: ${cut.join(", ")}`);
  await shot(app, "section-rail-wide");
  await app.click(".rtoggle");

  // 4. Window > Preferences: a dialog that takes focus, applies at once and closes on Escape.
  await menu(app, 5, strings["menu.preferences"]);
  await app.waitFor(`document.querySelector(".prefsdialog")`);
  assert(await focusInside(app), "the dialog takes focus");
  await shot(app, "preferences");
  const other = theme === "dark" ? "light" : "dark";
  await app.setField(strings["prefs.theme"], other, ".prefsdialog");
  await app.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(other)}`);
  await app.setField(strings["prefs.theme"], theme, ".prefsdialog");
  await app.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".prefsdialog")`);

  // 5. The welcome screen opens the same dialog.
  await menu(app, 0, strings["menu.closeProject"]);
  await app.waitFor(`document.querySelector(".welcome")`);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".welcome select")`)), "the welcome screen has no preference form of its own");
  await shot(app, "welcome");
  await app.click(".welcome-link", strings["menu.preferences"]);
  await app.waitFor(`document.querySelector(".prefsdialog")`);
  assert(await focusInside(app), "the dialog takes focus on the welcome screen");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".prefsdialog")`);
  console.log(`${lang}: ${titles.length} sections named, search at x=${[...xs][0]}, rail fits, preferences dialog from Window and welcome`);
}, { project: exampleProject(), language: lang });
