/**
 * Q273: an image's opacity and colour filter in the GUI editor. The fields save to the widget and the canvas draws
 * the picture as the generator bakes it: visible pixels faded and tinted, empty pixels empty. Args: theme, language.
 * Screenshots in design/273/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";
import { writePng } from "../../src/generator/png.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
// 4x4: transparent corners, white edges, grey middle.
const W = [255, 255, 255, 255], G = [128, 128, 128, 255], E = [0, 0, 0, 0];
writeFileSync(join(project, "textures", "frame.png"), writePng({ width: 4, height: 4, data: Uint8Array.from([E, W, W, E, W, G, G, W, W, G, G, W, E, W, W, E].flat()) }));
addElement(project, "gui", "tintgui", { type: 0, width: 176, height: 100, components: [{ kind: "image", name: "pic", x: 20, y: 20, width: 64, height: 64, image: "textures/frame.png" }] });
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "tintgui.json"), "utf8")) as { components: Record<string, unknown>[] }).components[0];
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
/** RGBA of the canvas picture's pixel (x, y) of the 4x4 texture, read from what the editor draws. */
const pixel = (app: App, x: number, y: number) => app.eval<number[]>(`(async () => {
  const el = document.querySelector(".guistage .k-image img, .guistage .k-image canvas");
  if (el.tagName === "IMG") await el.decode();
  const c = document.createElement("canvas"); c.width = 4; c.height = 4;
  const g = c.getContext("2d"); g.drawImage(el, 0, 0, 4, 4);
  return [...g.getImageData(${x}, ${y}, 1, 1).data];
})()`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "tintgui", { double: true });
  await app.waitFor(`document.querySelector(".guistage .k-image img")`);
  assert(JSON.stringify(await pixel(app, 1, 0)) === "[255,255,255,255]", "before: the white edge is white");
  await app.click(".guilist .lrow", "pic");
  await app.setField(S["gui.field.opacity"], "50", ".guiform");
  await waitSaved(app);
  await app.setField(S["gui.field.tint"], "#ff0000", ".guiform");
  await waitSaved(app);
  const w = saved();
  assert(w.opacity === 50 && String(w.tint).toLowerCase() === "#ff0000", `saved: ${JSON.stringify(w)}`);
  await app.sleep(300);
  const edge = await pixel(app, 1, 0), middle = await pixel(app, 1, 1), corner = await pixel(app, 0, 0);
  assert(edge[0] > 240 && edge[1] < 15 && edge[2] < 15 && Math.abs(edge[3] - 128) <= 2, `edge: half transparent red (${edge})`);
  assert(Math.abs(middle[0] - 128) <= 3 && middle[1] < 15 && Math.abs(middle[3] - 128) <= 2, `middle: dark red, shading kept (${middle})`);
  assert(corner[3] === 0, `corner: still empty (${corner})`);
  await app.shot(evidence(`design/273/tinted-${theme}-${lang}.png`));
}, { project, theme, language: lang });
