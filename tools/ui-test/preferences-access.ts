/**
 * Q254: the preferences are reachable from the top bar, with real clicks and keys.
 * 1. A gear button sits in the header next to the theme switch, with and without an open project; a click opens Preferences.
 * 2. File > Preferences... shows Ctrl+, and opens Preferences (Window > Preferences... stays).
 * 3. Ctrl+, opens Preferences anywhere; Help > Keyboard shortcuts lists it.
 * Screenshots in design/254/ (en/tr, dark/light).
 *   node tools/ui-test/preferences-access.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/254");
const CTRL = 2;
const open = `!!document.querySelector("[data-testid=pref-level]")`;
const closePrefs = async (app: App) => {
  await app.key("Escape");
  await app.waitFor(`!document.querySelector("[data-testid=pref-level]")`);
};

let failed = false;
for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    for (const withProject of [true, false]) {
      const app = await launchApp({ project: withProject ? exampleProject() : undefined, theme, language: lang });
      const tag = `${lang}-${theme}-${withProject ? "project" : "welcome"}`;
      try {
        // The language loads after the first paint: wait until the gear carries this language's name.
        await app.waitFor(`document.querySelector("[data-testid=top-preferences]")?.getAttribute("aria-label") === ${JSON.stringify(strings["top.preferences"])}`);
        // 1. The gear: an icon-only button inside the window, right before the theme switch.
        const gear = await app.eval<{ text: string; icon: boolean; title: string; label: string; next: string; inside: boolean }>(`(() => {
          const b = document.querySelector("[data-testid=top-preferences]"); const r = b.getBoundingClientRect();
          return { text: b.textContent.trim(), icon: !!b.querySelector("svg.ico"), title: b.title, label: b.getAttribute("aria-label"),
            next: b.nextElementSibling?.className ?? "", inside: r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })()`);
        assert(gear.text === "" && gear.icon && gear.inside, `${tag}: gear is a visible icon: ${JSON.stringify(gear)}`);
        assert(gear.label === strings["top.preferences"] && gear.title.includes("Ctrl+,"), `${tag}: gear is named: ${JSON.stringify(gear)}`);
        assert(gear.next.includes("themebtn"), `${tag}: gear sits next to the theme switch`);
        await app.shot(`${OUT}/header-${tag}.png`);
        await app.click("[data-testid=top-preferences]");
        await app.waitFor(open);
        if (withProject) await app.shot(`${OUT}/dialog-${lang}-${theme}.png`);
        await closePrefs(app);

        // 2. File > Preferences... with its shortcut.
        await app.click(".menubar .menu", strings["menu.file"]);
        const item = await app.eval<string | null>(`[...document.querySelectorAll(".menulist button")].find((b) => b.textContent.includes(${JSON.stringify(strings["menu.preferences"])}))?.textContent ?? null`);
        assert(item?.includes("Ctrl+,"), `${tag}: File menu lists Preferences with Ctrl+, (${item})`);
        await app.shot(`${OUT}/file-menu-${tag}.png`);
        await app.click(".menulist button", strings["menu.preferences"]);
        await app.waitFor(open);
        await closePrefs(app);

        // 3. Ctrl+, and the shortcut list.
        await app.key(",", CTRL);
        await app.waitFor(open);
        await closePrefs(app);
        await app.click(".menubar .menu", strings["menu.help"]);
        await app.click(".menulist button", strings["menu.shortcuts"]);
        await app.waitFor(`document.body.textContent.includes(${JSON.stringify(strings["keys.preferences"])})`);
        await app.key("Escape");
        console.log(`PASS ${tag}`);
      } catch (e) {
        failed = true;
        console.error(`FAIL ${tag}: ${(e as Error).message}`);
      } finally {
        await app.close();
      }
    }
  }
}
if (failed) process.exit(1);
console.log("PASS preferences-access");
