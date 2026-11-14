/**
 * KUYRUK 182 (and 183): a label's background box and alignment in the GUI editor. Setting Background, its opacity and
 * padding on a label saves them and the canvas draws the box as the game does (the text's width, 8 pixels high, the
 * padding around, the opacity as alpha); an overlay label has the same fields.
 * Args: theme, language. Screenshots in design/182/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
addElement(project, "gui", "stylegui", { type: 0, width: 176, height: 100, components: [{ kind: "label", x: 20, y: 20, text: "Coins: 25", color: "#FFFFFF" }] });
addElement(project, "overlay", "stylehud", { components: [{ kind: "label", x: 20, y: 20, text: "HUD", color: "#FFFFFF" }] });
type W = { background?: string; backgroundOpacity?: number; backgroundPadding?: number };
const saved = (dir: string, id: string) => (JSON.parse(readFileSync(join(project, "elements", dir, `${id}.json`), "utf8")) as { components: W[] }).components[0];
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const style = async (app: App) => {
  // The colour row's text box (the swatch already shows black when empty, so setting it would change nothing).
  const row = `[...document.querySelectorAll(".guiform .frow")].find((r) => r.querySelector(":scope > label")?.textContent.trim() === ${JSON.stringify(S["gui.field.background"])})`;
  await app.eval(`(() => { const e = ${row}.querySelector(".fpair input:not([type=color])"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "#000000"); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.sleep(100);
  await app.setField(S["gui.field.backgroundOpacity"], "60", ".guiform");
  await app.setField(S["gui.field.backgroundPadding"], "2", ".guiform");
  await waitSaved(app);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "stylegui", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-label")`);
  assert(await app.eval<boolean>(`!document.querySelector(".glabelbg")`), "no box without a background");
  await app.click(".guilist .lrow", "Coins");
  await style(app);
  const w = saved("guis", "stylegui");
  assert(w.background === "#000000" && w.backgroundOpacity === 60 && w.backgroundPadding === 2, `background saved: ${JSON.stringify(w)}`);
  const z = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const box = await app.rect(".guistage .glabelbg"), text = await app.rect(".guistage .k-label");
  const color = await app.eval<string>(`getComputedStyle(document.querySelector(".glabelbg")).backgroundColor`);
  assert(/rgba\(0, 0, 0, 0\.6/.test(color), `60% black: ${color}`);
  assert(Math.abs(text.x - box.x - 2 * z) < 1 && Math.abs(box.height - (8 + 4) * z) < 1, `the box is the text's width plus 2 each side and 8 + 4 high: ${JSON.stringify({ box, text, z })}`);
  await app.shot(`design/182/gui-${theme}-${lang}.png`);

  await app.click(".abtn", S["editor.back"]);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "stylehud", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-label")`);
  await app.click(".guilist .lrow", "HUD");
  await style(app);
  assert(saved("overlays", "stylehud").backgroundOpacity === 60 && await app.eval<boolean>(`!!document.querySelector(".glabelbg")`), "an overlay label has the background too");
  await app.shot(`design/182/overlay-${theme}-${lang}.png`);
}, { project, theme, language: lang });
