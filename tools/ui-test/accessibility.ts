/**
 * Q247: visual accessibility settings, switched on in Preferences with real clicks.
 * 1. Text size: 150% scales the whole window (zoom factor, and the viewport in CSS pixels shrinks by the same factor).
 * 2. High contrast, dark and light: text, border and state tokens are 7:1 or better on the background, and a focused
 *    control shows a thick ring that is 3:1 or better.
 * 3. Colour-blind-safe: --ok is blue and --danger orange; states carry a glyph, a line style or a stripe pattern too.
 * 4. Reduced motion: transitions and animations are off; "follow the system" follows the emulated OS setting.
 * Screenshots in design/247/ (en/tr, each setting). The sample panel at the top right shows the states on purpose.
 *   node tools/ui-test/accessibility.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, REPO, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/247");
const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** A token's resolved colour as [r, g, b]. */
const token = (app: App, name: string) => app.eval<number[]>(`(() => { const e = document.createElement("i"); e.style.color = "var(${name})"; document.body.append(e);
  const c = getComputedStyle(e).color.match(/[\\d.]+/g).slice(0, 3).map(Number); e.remove(); return c; })()`);
const pseudo = (app: App, selector: string) => app.eval<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}), "::before").content`);
const style = (app: App, selector: string, prop: string) => app.eval<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}))[${JSON.stringify(prop)}]`);

for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  const project = copyProject(join(REPO, "examples", "hello"), "hello");
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".status .led")`, 30000);
    const flags = () => (JSON.parse(readFileSync(join(app.userData, "app-state.json"), "utf8")) as { preferences: Record<string, unknown> }).preferences;
    const zoom = () => app.mainEval<number>(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()`);

    // The sample panel: every state the audit covers, built from the app's own classes.
    await app.eval(`(() => { const p = document.createElement("div"); p.id = "probe";
      p.style.cssText = "position:fixed;right:8px;top:8px;width:270px;z-index:99999;padding:8px;background:var(--surface);border:2px solid var(--line);font-size:12px;color:var(--fg)";
      p.innerHTML = \`
        <div style="display:flex;gap:8px;align-items:center"><i class="led ok"></i>${strings["build.ok"]} <i class="led running"></i> <i class="led failed"></i>${strings["build.failed"]} <i class="led stopped"></i> <i class="liveled"></i></div>
        <div style="display:flex;gap:6px;margin:6px 0"><span class="sidebadge client">${strings["java.side.client"]}</span><span class="sidebadge server">${strings["java.side.server"]}</span><span class="sidebadge common">${strings["java.side.common"]}</span></div>
        <div class="javastatus ready">${strings["build.ok"]}</div><div class="javastatus failed">${strings["build.failed"]}</div>
        <p class="error-text">${strings["problems.severity.error"]}</p><p class="warn-text">${strings["problems.severity.warning"]}</p>
        <div><span class="gstate s-A">${strings["git.state.added"]}</span> <span class="gstate s-D">${strings["git.state.deleted"]}</span> <span class="gstate s-M">${strings["git.state.modified"]}</span></div>
        <pre class="gitdiff" style="margin-top:6px"><span class="dadd">+ ruby_ore</span>\\n<span class="ddel">- coal_ore</span>\\n<span class="dhunk">@@ -1 +1 @@</span></pre>\`;
      document.body.append(p); })()`);

    // Open Preferences (Window menu) and scroll the Accessibility group into view.
    await app.click(".menubar .menu", strings["menu.window"]);
    await app.click(".menulist button", strings["menu.preferences"]);
    await app.waitFor(`document.querySelector(".prefsdialog")`);
    const show = () => app.eval(`document.querySelector("[data-testid=pref-motion]").scrollIntoView({ block: "center" })`);
    const check = async (testid: string, on: boolean) => {
      await show();
      if ((await app.eval<boolean>(`document.querySelector("[data-testid=${testid}]").checked`)) !== on) await app.click(`[data-testid=${testid}]`);
      await app.waitFor(`document.querySelector("[data-testid=${testid}]").checked === ${on}`);
    };
    const theme = async (name: "dark" | "light") => {
      await app.setField(strings["prefs.theme"], name === "dark" ? "dark" : "light", ".prefsdialog");
      await app.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(name)}`);
    };

    // 0. Defaults: nothing changed, motion follows the system.
    const root = await app.eval<Record<string, string>>(`({ ...document.documentElement.dataset })`);
    assert(root.contrast === "normal" && root.palette === "default", `defaults: ${JSON.stringify(root)}`);
    assert((await app.eval<string>(`document.querySelector("[data-testid=pref-motion]").value`)) === "system", "reduced motion defaults to following the system");

    // 1. Text size: the window zoom scales everything; more steps than before.
    const steps = await app.eval<number>(`[...document.querySelectorAll(".prefsdialog select")].find((s) => [...s.options].some((o) => o.value === "1.3")).options.length`);
    assert(Number(steps) >= 6, `text sizes offered: ${steps}`);
    const widthBefore = await app.eval<number>(`innerWidth`);
    await app.setField(strings["prefs.textSize"], "1.5", ".prefsdialog");
    await app.waitFor(`innerWidth < ${widthBefore}`);
    const z = await zoom();
    const widthAfter = await app.eval<number>(`innerWidth`);
    assert(Math.abs(z - 1.5) < 0.001 && Math.abs(widthBefore / widthAfter - 1.5) < 0.05, `zoom ${z}, viewport ${widthBefore} -> ${widthAfter} CSS px`);
    await show();
    await app.shot(`${OUT}/size-${lang}.png`);
    await app.setField(strings["prefs.textSize"], "1", ".prefsdialog");
    await app.waitFor(`innerWidth === ${widthBefore}`);

    // 2. High contrast on both themes.
    await check("pref-high-contrast", true);
    assert(flags().highContrast === true, "high contrast is saved");
    for (const name of ["dark", "light"] as const) {
      await theme(name);
      await show();
      const bg = await token(app, "--bg");
      const surfaces = [bg, await token(app, "--plank"), await token(app, "--surface")];
      for (const t of ["--fg", "--fg-2", "--fg-3", "--accent", "--danger", "--ok", "--warn", "--line"]) {
        const c = await token(app, t);
        for (const s of surfaces) assert(ratio(c, s) >= 7, `${name} high contrast: ${t} on a surface is ${ratio(c, s).toFixed(2)}:1`);
      }
      assert(ratio(await token(app, "--accent-fg"), await token(app, "--accent")) >= 7, `${name}: text on the accent`);
      // The focus ring after a Tab: thick and visible against the background.
      await app.key("Tab");
      const ring = await app.eval<{ width: string; style: string; color: number[] }>(`(() => { const s = getComputedStyle(document.activeElement);
        return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor.match(/[\\d.]+/g).slice(0, 3).map(Number) }; })()`);
      assert(parseFloat(ring.width) >= 3 && ring.style === "solid" && ratio(ring.color, bg) >= 7, `${name} focus ring: ${JSON.stringify(ring)}, ${ratio(ring.color, bg).toFixed(2)}:1`);
      await show();
      await app.shot(`${OUT}/contrast-${lang}-${name}.png`);
    }

    // 3. Colour-blind-safe palette, with and without high contrast; the signals do not rely on colour.
    await check("pref-color-blind", true);
    assert(flags().colorBlind === true, "the colour-blind palette is saved");
    for (const hc of [true, false]) {
      await check("pref-high-contrast", hc);
      for (const name of ["dark", "light"] as const) {
        await theme(name);
        const [okR, okG, okB] = await token(app, "--ok");
        const [dR, dG, dB] = await token(app, "--danger");
        assert(okB > okR && okB > okG, `${name} hc=${hc}: --ok is blue, got ${[okR, okG, okB]}`);
        assert(dR > dG && dG > dB, `${name} hc=${hc}: --danger is orange, got ${[dR, dG, dB]}`);
        const bg = await token(app, "--bg");
        for (const t of ["--ok", "--danger", "--warn"]) assert(ratio(await token(app, t), bg) >= (hc ? 7 : 4.5), `${name} hc=${hc}: ${t} is ${ratio(await token(app, t), bg).toFixed(2)}:1`);
        await show();
        if (!hc) await app.shot(`${OUT}/colorblind-${lang}-${name}.png`);
      }
    }
    // The signals: glyphs, line styles and patterns exist whatever the palette.
    const g = {
      ok: await pseudo(app, "#probe .led.ok"), failed: await pseudo(app, "#probe .led.failed"), running: await pseudo(app, "#probe .led.running"), stopped: await pseudo(app, "#probe .led.stopped"),
      jOk: await pseudo(app, "#probe .javastatus.ready"), jFail: await pseudo(app, "#probe .javastatus.failed"),
      err: await pseudo(app, "#probe .error-text"), warn: await pseudo(app, "#probe .warn-text"),
      add: await pseudo(app, "#probe .gstate.s-A"), del: await pseudo(app, "#probe .gstate.s-D"), mod: await pseudo(app, "#probe .gstate.s-M"),
    };
    for (const [k, v] of Object.entries(g)) assert(v && v !== "none" && v !== "normal" && v !== '""', `glyph ${k}: ${v}`);
    assert(new Set([g.ok, g.failed, g.running, g.stopped]).size === 4, `the four LED states have four glyphs: ${JSON.stringify(g)}`);
    assert(g.add !== g.del && g.del !== g.mod && g.err !== g.warn, "git states and error/warning glyphs differ");
    const lines = [await style(app, "#probe .sidebadge.client", "borderTopStyle"), await style(app, "#probe .sidebadge.server", "borderTopStyle"), await style(app, "#probe .sidebadge.common", "borderTopStyle")];
    assert(new Set(lines).size === 3, `side badges differ by line style: ${lines}`);
    assert((await style(app, "#probe .ddel", "backgroundImage")).includes("repeating-linear-gradient"), "deleted diff lines have a stripe pattern");
    assert((await style(app, "#probe .dadd", "boxShadow")) !== "none", "added diff lines have a bar");
    // The real status bar LED and the sides legend/badges use the same classes.
    const realLed = await pseudo(app, ".status .led");
    assert(realLed && realLed !== "none", `the status bar LED has a glyph: ${realLed}`);
    await check("pref-color-blind", false);
    await check("pref-high-contrast", false);
    await theme("dark");

    // 4. Reduced motion.
    await show();
    assert((await style(app, "#probe .liveled", "animationName")) === "livepulse", "the live LED pulses by default");
    await app.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await app.waitFor(`document.documentElement.dataset.motion === "reduce"`);
    await app.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await app.waitFor(`document.documentElement.dataset.motion === "full"`);
    await app.setValue("[data-testid=pref-motion]", "on");
    await app.waitFor(`document.documentElement.dataset.motion === "reduce"`);
    assert(flags().reducedMotion === "on", "reduced motion is saved");
    assert((await style(app, "#probe .liveled", "animationName")) === "none", "the live LED does not animate with reduced motion");
    assert((await app.eval<string>(`getComputedStyle(document.querySelector(".ptab, .rtab, .abtn")).transitionDuration`)) === "0s", "transitions are off");
    await app.shot(`${OUT}/motion-${lang}.png`);
    await app.setValue("[data-testid=pref-motion]", "off");
    await app.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await app.sleep(200);
    assert((await app.eval<string>(`document.documentElement.dataset.motion`)) === "full", "Off keeps motion even when the system asks for less");
    assert((await style(app, "#probe .liveled", "animationName")) === "livepulse", "Off lets the live LED pulse");
    await app.cdp("Emulation.setEmulatedMedia", { features: [] });
  }, { language: lang, project, width: 1280, height: 900 });
}
console.log("PASS accessibility");
