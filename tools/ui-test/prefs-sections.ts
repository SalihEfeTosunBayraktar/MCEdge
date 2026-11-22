/**
 * Q242: Preferences fits the window and its sections collapse. Language, appearance, tools and updates start open;
 * mod sources, publishing and the AI assistant start closed. A click on a title opens or closes it (real clicks).
 * With every section open on a short window, the dialog stays inside the window and a real mouse wheel scrolls the
 * sections to Updates. Screenshots in design/242/ (en/tr, dark/light).
 *   node tools/ui-test/prefs-sections.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, REPO, run, evidence } from "./cdp.ts";

const OUT = evidence("design/242");
for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    await run(async (app) => {
      await app.waitFor(`document.querySelector(".welcome")`);
      await app.click(".welcome-link", strings["menu.preferences"]);
      await app.waitFor(`document.querySelector(".prefsdialog")`);
      const states = await app.eval<Record<string, boolean>>(`Object.fromEntries([...document.querySelectorAll(".prefsdialog .fgtoggle")].map((b) => [b.textContent.trim(), b.getAttribute("aria-expanded") === "true"]))`);
      const open = (key: string) => states[strings[key]];
      for (const key of ["prefs.language", "prefs.appearance", "prefs.tools", "prefs.updates"]) assert(open(key) === true, `${key} starts open: ${JSON.stringify(states)}`);
      for (const key of ["prefs.modSources", "prefs.publishing", "prefs.ai"]) assert(open(key) === false, `${key} starts closed: ${JSON.stringify(states)}`);
      assert(!(await app.eval<boolean>(`!!document.querySelector("[data-testid=pref-ai-model]")`)), "a closed section hides its rows");
      await app.shot(`${OUT}/closed-${lang}-${theme}.png`);

      // A click on a title closes it, another opens it again.
      await app.click(".prefsdialog .fgtoggle", strings["prefs.appearance"]);
      await app.waitFor(`document.querySelector(".prefsdialog .fgtoggle[aria-expanded=false]")?.textContent.trim() === ${JSON.stringify(strings["prefs.appearance"])}`);
      await app.click(".prefsdialog .fgtoggle", strings["prefs.appearance"]);
      for (const key of ["prefs.modSources", "prefs.publishing", "prefs.ai"]) await app.click(".prefsdialog .fgtoggle", strings[key]);
      await app.waitFor(`document.querySelector("[data-testid=pref-ai-model]")`);

      // Everything open: the dialog stays in the window and the wheel scrolls the sections.
      const fit = await app.eval<{ bottom: number; height: number; scroll: number; client: number }>(`(() => { const d = document.querySelector(".prefsdialog").getBoundingClientRect(); const f = document.querySelector(".prefsdialog .prefsbody > .form"); return { bottom: d.bottom, height: innerHeight, scroll: f.scrollHeight, client: f.clientHeight }; })()`);
      assert(fit.bottom <= fit.height, `the dialog stays in the window: ${JSON.stringify(fit)}`);
      assert(fit.scroll > fit.client, `the sections are taller than the dialog here: ${JSON.stringify(fit)}`);
      const box = await app.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector(".prefsdialog .prefsbody > .form").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      for (let i = 0; i < 12; i++) await app.wheel(box.x, box.y, 240);
      await app.sleep(300);
      const top = await app.eval<number>(`document.querySelector(".prefsdialog .prefsbody > .form").scrollTop`);
      assert(top > 0, `the wheel scrolled the sections: ${top}`);
      const updates = await app.eval<boolean>(`(() => { const b = document.querySelector("[data-testid=pref-auto-update]").getBoundingClientRect(); const f = document.querySelector(".prefsdialog .prefsbody > .form").getBoundingClientRect(); return b.top >= f.top && b.bottom <= f.bottom; })()`);
      assert(updates, "Updates is reachable by scrolling");
      await app.shot(`${OUT}/scrolled-${lang}-${theme}.png`);
    }, { language: lang, theme, width: 1280, height: 720 });
  }
}
