/**
 * KUYRUK 173: the CurseForge API key is an app preference. Preferences (from the welcome screen) has a Mod sources
 * group with a password field; typing a key saves it in this computer's app-state.json, clearing it removes it, and
 * nothing is written into a project. Args: language, theme. Screenshots in design/173/.
 * usage: node tools/ui-test/prefs-curseforge.ts [en|tr] [dark|light]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, REPO, run } from "./cdp.ts";

const lang = process.argv[2] ?? "en";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;

await run(async (app) => {
  const saved = () => (JSON.parse(readFileSync(join(app.userData, "app-state.json"), "utf8")) as { preferences?: { curseforgeKey?: string } }).preferences?.curseforgeKey;
  await app.waitFor(`document.querySelector(".welcome")`);
  await app.click(".welcome-link", strings["menu.preferences"]);
  await app.waitFor(`document.querySelector(".prefsdialog")`);
  const group = await app.eval<boolean>(`[...document.querySelectorAll(".prefsdialog *")].some((e) => e.children.length === 0 && e.textContent.trim().toLowerCase() === ${JSON.stringify(strings["prefs.modSources"].toLowerCase())})`);
  assert(group, "Preferences has a Mod sources group");
  const type = await app.eval<string>(`[...document.querySelectorAll(".prefsdialog .frow")].find((r) => r.querySelector("label")?.textContent.trim() === ${JSON.stringify(strings["prefs.curseforgeKey"])}).querySelector("input").type`);
  assert(type === "password", "the key field hides what is typed");
  await app.setField(strings["prefs.curseforgeKey"], "  my-cf-key  ", ".prefsdialog");
  await app.sleep(300);
  assert(saved() === "my-cf-key", `the key is saved in the app's preferences, trimmed: ${saved()}`);
  await app.shot(`design/173/preferences-${lang}-${theme}.png`);
  await app.setField(strings["prefs.curseforgeKey"], "", ".prefsdialog");
  await app.sleep(300);
  assert(saved() === undefined, "clearing the field removes the key");
}, { language: lang, theme });
