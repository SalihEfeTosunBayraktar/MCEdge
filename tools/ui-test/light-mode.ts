/**
 * Q250: light mode for weak computers, with real clicks.
 * 1. First start: the setup reads the machine (RAM, cores) and offers "Light mode"; it is ticked only when the machine is
 *    small (the real machine decides); ticking it and Start save previews off, 3D off and the low memory mode.
 * 2. With light mode on, the block editor has no preview and no cube; its six face fields stay.
 * 3. Preferences > Performance: Show 3D views on brings the cube back, Show previews on the preview; everything back
 *    at its default is not stored. 3D off on its own replaces the cube by a note and keeps the preview. The saved low
 *    memory mode is what the backend reads (src/performance.ts: jdtls 768 MB, Gradle 2048 MB).
 * 4. The thresholds that suggest light mode and the limits (config/performance.json).
 * Screenshots in design/250/ (en/tr, dark/light).
 *   node tools/ui-test/light-mode.ts
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryLimits, readPerformancePrefs, suggestLight } from "../../src/performance.ts";
import { assert, exampleProject, launchApp, REPO, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/250");
const saved = (userData: string) => (JSON.parse(readFileSync(join(userData, "app-state.json"), "utf8")) as { preferences: Record<string, any> }).preferences;
const open = async (app: App, name: string) => {
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === ${JSON.stringify(name)}).id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === ${JSON.stringify(name)}`);
};
const preferences = async (app: App, strings: Record<string, string>) => {
  await app.click(".menubar .menu", strings["menu.window"]);
  await app.click(".menulist button", strings["menu.preferences"]);
  await app.waitFor(`document.querySelector("[data-testid=pref-previews]")`);
  await app.eval(`document.querySelector("[data-testid=pref-previews]").scrollIntoView({ block: "center" })`);
};

// 4. The suggestion thresholds and the limits.
assert(suggestLight({ ramGb: 8, cores: 8 }) && suggestLight({ ramGb: 16, cores: 4 }) && !suggestLight({ ramGb: 16, cores: 8 }), "light mode is suggested for 8 GB or 4 cores, not above");
assert(JSON.stringify(memoryLimits(undefined)) === '{"mode":"normal","jdtlsMb":1024}', `normal limits ${JSON.stringify(memoryLimits(undefined))}`);
assert(memoryLimits({ lowMemory: true }).gradleMb === 2048 && memoryLimits({ lowMemory: true }).jdtlsMb === 768, "low limits");

let failed = false;
for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    const project = exampleProject();
    addElement(project, "block", "cube_demo", { name: "Ruby Cube", texture: "textures/ruby_block.png", textureTop: "textures/ruby_apple.png" });
    const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
    const app = await launchApp({ project, theme, language: lang, level: null, userData });
    try {
      // 1. The setup.
      await app.waitFor(`document.querySelector("[data-testid=setup-light]")`);
      const machine = await app.eval<{ ramGb: number; cores: number; suggestLight: boolean }>(`window.mcedge.systemInfo()`);
      const row = await app.eval<string>(`document.querySelector("[data-testid=setup-light-row]").textContent`);
      assert(row.includes(`${machine.ramGb} GB`) && row.includes(`${machine.cores}`), `the setup names the machine: ${row}`);
      const ticked = () => app.eval<boolean>(`document.querySelector("[data-testid=setup-light]").checked`);
      assert((await ticked()) === machine.suggestLight, `ticked follows the suggestion (${machine.suggestLight})`);
      if (await ticked()) await app.click("[data-testid=setup-light]");
      assert(!(await ticked()), "unticked");
      await app.click("[data-testid=setup-light]");
      assert(await ticked(), "ticked by a click");
      await app.click(".setup-level", strings["setup.level.java"]);
      await app.shot(`${OUT}/setup-${lang}-${theme}.png`);
      await app.click(".dialog button[type=submit]");
      await app.waitFor(`!document.querySelector("[data-testid=setup]")`);
      const prefs = saved(userData);
      assert(JSON.stringify(prefs.performance) === JSON.stringify({ previews: false, render3d: false, lowMemory: true }), `light saved: ${JSON.stringify(prefs.performance)}`);

      // 2. With light mode on, the block editor has no preview and no cube.
      await app.click(".grid tbody tr", "UI test", { double: true });
      await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
      await open(app, "Ruby Cube");
      await app.waitFor(`document.querySelector(".cuberow")`);
      assert(await app.eval<boolean>(`!document.querySelector(".formpreview") && !document.querySelector(".cubecanvas")`), "light: no preview, no cube");
      assert((await app.eval<number>(`document.querySelectorAll(".cuberow .cubefields .frow[data-field]").length`)) === 6, "light: the six face fields stay");
      await app.eval(`document.querySelector(".cuberow").scrollIntoView({ block: "center" })`);
      await app.shot(`${OUT}/editor-light-${lang}-${theme}.png`);

      // 3. Preferences > Performance.
      await preferences(app, strings);
      assert(!(await app.eval<boolean>(`document.querySelector("[data-testid=pref-previews]").checked || document.querySelector("[data-testid=pref-render3d]").checked`)), "Preferences show both off");
      assert(await app.eval<boolean>(`document.querySelector("[data-testid=pref-low-memory]").checked`), "low memory shows on");
      assert((await app.eval<string>(`document.querySelector("[data-testid=pref-machine]").textContent`)).includes(`${machine.ramGb} GB`), "Preferences name the machine");
      await app.shot(`${OUT}/prefs-${lang}-${theme}.png`);
      await app.click("[data-testid=pref-render3d]");
      await app.waitFor(`document.querySelector(".cubecanvas canvas")`);
      assert(await app.eval<boolean>(`!document.querySelector(".formpreview")`), "3D back, the preview still off");
      await app.click("[data-testid=pref-previews]");
      await app.waitFor(`document.querySelector(".formpreview")`);
      await app.click("[data-testid=pref-low-memory]");
      await app.waitFor(`true`);
      assert(saved(userData).performance === undefined, `all defaults are not stored: ${JSON.stringify(saved(userData).performance)}`);
      await app.key("Escape");
      await app.eval(`document.querySelector(".cuberow").scrollIntoView({ block: "center" })`);
      await app.shot(`${OUT}/editor-full-${lang}-${theme}.png`);

      // 3D off on its own: the cube becomes a note, the preview stays; the low memory mode reaches the backend.
      await preferences(app, strings);
      await app.click("[data-testid=pref-render3d]");
      await app.click("[data-testid=pref-low-memory]");
      await app.key("Escape");
      await app.waitFor(`!document.querySelector(".cubecanvas") && document.querySelector("[data-testid=light-note]")`);
      assert(await app.eval<boolean>(`!!document.querySelector(".formpreview")`), "the preview stays when only 3D is off");
      assert((await app.eval<string>(`document.querySelector("[data-testid=light-note]").textContent`)) === strings["perf.render3dOff"], "the 3D note shows");
      process.env.MCEDGE_USER_DATA = userData;
      assert(memoryLimits(readPerformancePrefs()).mode === "low" && memoryLimits(readPerformancePrefs()).gradleMb === 2048, "the backend reads the low memory mode from the saved preferences");
    } catch (error) {
      failed = true;
      console.error(`FAIL ${lang} ${theme}`, error);
      await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    } finally {
      delete process.env.MCEDGE_USER_DATA;
      await app.close();
    }
  }
}
if (failed) process.exitCode = 1;
else console.log("PASS");
