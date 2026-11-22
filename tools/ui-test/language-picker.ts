/**
 * Q249: the language picker lists every file of config/ui-strings, and a language that leaves keys out shows English
 * for them. The test reads the folder, so a third language file dropped in (and built) is covered without a change.
 * Screenshots in design/249/ (en/tr, dark/light).
 *   node tools/ui-test/language-picker.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, REPO, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/249");
const dir = join(REPO, "config", "ui-strings");
const table = (code: string) => JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as Record<string, string>;
const codes = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const en = table("en");

for (const lang of codes) {
  const strings = table(lang);
  for (const theme of ["dark", "light"] as const) {
    if (lang !== "en" && lang !== "tr" && theme === "light") continue;
    await run(async (app) => {
      await app.waitFor(`document.querySelector(".welcome")`);
      const shown = (key: string) => strings[key] ?? en[key];
      await app.click(".welcome-link", shown("menu.preferences"));
      await app.waitFor(`document.querySelector(".prefsdialog select")`);
      const options = await app.eval<{ value: string; text: string }[]>(`[...document.querySelector(".prefsdialog select").options].map((o) => ({ value: o.value, text: o.textContent }))`);
      assert(options.length === codes.length, `the picker lists every file (${codes.join(", ")}): ${JSON.stringify(options)}`);
      for (const code of codes) {
        const entry = options.find((o) => o.value === code);
        assert(entry, `${code} is in the picker`);
        assert(entry.text === (table(code)["language.name"] || code), `${code} shows its own name: ${entry.text}`);
      }
      const selected = await app.eval<string>(`document.querySelector(".prefsdialog select").value`);
      assert(selected === lang, `the picker shows the chosen language: ${selected}`);
      // The dialog title follows the language; a key the language lacks falls back to English.
      const title = await app.eval<string>(`document.querySelector(".prefsdialog .fgtoggle").textContent.trim()`);
      assert(title === shown("prefs.language"), `the first section reads "${shown("prefs.language")}": ${title}`);
      await assertFallback(app, strings);
      await app.shot(`${OUT}/picker-${lang}-${theme}.png`);
    }, { language: lang, theme, width: 1280, height: 720 });
  }
}

// Changing the language through the picker switches the interface at once, in a fresh run per target language.
for (const target of codes.filter((c) => c !== "en")) {
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".welcome")`);
    await app.click(".welcome-link", en["menu.preferences"]);
    await app.waitFor(`document.querySelector(".prefsdialog select")`);
    await app.setValue(".prefsdialog select", target);
    const strings = table(target);
    await app.waitFor(`document.querySelector(".prefsdialog .fgtoggle")?.textContent.trim() === ${JSON.stringify(strings["prefs.language"] ?? en["prefs.language"])}`);
    await assertFallback(app, strings);
    await app.shot(`${OUT}/switch-to-${target}.png`);
  }, { language: "en", theme: "dark", width: 1280, height: 720 });
}

/** A section title the language does not translate reads as the English text, never empty or the key. */
async function assertFallback(app: App, strings: Record<string, string>): Promise<void> {
  const titles = await app.eval<string[]>(`[...document.querySelectorAll(".prefsdialog .fgtoggle")].map((b) => b.textContent.trim())`);
  for (const key of ["prefs.language", "prefs.appearance", "prefs.tools", "prefs.updates"]) {
    const expected = strings[key] ?? en[key];
    assert(titles.includes(expected), `${key} reads "${expected}": ${JSON.stringify(titles)}`);
  }
}
