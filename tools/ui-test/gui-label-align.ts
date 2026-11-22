/**
 * KUYRUK 183: a label's alignment in the GUI editor. Centre puts the middle of the text on x, Right its right edge,
 * as the generated screen draws it; the text box follows a longer text around the same point; dragging the label
 * still moves its x by the distance dragged. Args: theme, language. Screenshots in design/183/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
addElement(project, "gui", "aligngui", { type: 0, width: 176, height: 100, components: [{ kind: "label", x: 88, y: 20, text: "Coins: 25", color: "#404040" }] });
type W = { x: number; align?: string; text?: string };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "aligngui.json"), "utf8")) as { components: W[] }).components[0];
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "aligngui", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-label")`);
  const z = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const stage = await app.rect(".guistage");
  const label = () => app.rect(".guistage .k-label");
  assert(Math.abs((await label()).x - stage.x - 88 * z) < 1, "left: the text starts at x");
  await app.click(".guilist .lrow", "Coins");
  await app.setField(S["gui.field.align"], "1", ".guiform"); // left, center, right
  await waitSaved(app);
  assert(saved().align === "center", `alignment saved: ${JSON.stringify(saved())}`);
  let r = await label();
  assert(Math.abs(r.x + r.width / 2 - stage.x - 88 * z) <= z, `centre: the middle of the text is on x (${r.x + r.width / 2 - stage.x} vs ${88 * z})`);
  await app.setField(S["gui.field.text"], "Coins: 25000", ".guiform");
  await waitSaved(app);
  r = await label();
  assert(Math.abs(r.x + r.width / 2 - stage.x - 88 * z) <= z, "a longer text stays centred on x");
  await app.shot(evidence(`design/183/center-${theme}-${lang}.png`));
  await app.setField(S["gui.field.align"], "2", ".guiform");
  await waitSaved(app);
  r = await label();
  assert(saved().align === "right" && Math.abs(r.x + r.width - stage.x - 88 * z) < 1, "right: the text ends at x");
  // Dragging moves x by the distance, whatever the alignment.
  const c = await app.center(".guistage .k-label");
  await app.drag(c, [c[0] + 10 * z, c[1]], 5);
  await waitSaved(app);
  assert(saved().x === 98, `dragged 10 to the right: x ${saved().x}`);
  await app.shot(evidence(`design/183/right-${theme}-${lang}.png`));
}, { project, theme, language: lang });
