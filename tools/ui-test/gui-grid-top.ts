/**
 * KUYRUK 181: the GUI editor's grid is drawn over widgets and images, so its lines stay visible on an opaque image,
 * and it does not take the mouse (a click on the image still selects it). Measured on the stage's pixels: a column of
 * a solid white image under a grid line is darker than the column next to it. Args: theme. Screenshots in design/181/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPng, writePng } from "../../src/generator/png.ts";
import { assert, exampleProject, run } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const project = exampleProject();
mkdirSync(join(project, "textures", "gui"), { recursive: true });
writeFileSync(join(project, "textures", "gui", "white.png"), writePng({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(255) } as never));
addElement(project, "gui", "topgrid", {
  type: 0, width: 176, height: 166, snapOnGrid: true, gridSx: 18, gridSy: 18, gridOx: 0, gridOy: 0,
  components: [{ kind: "image", x: 18, y: 18, width: 72, height: 72, image: "textures/gui/white.png" }],
});

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "topgrid", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-image img, .guistage .gwidget.k-image canvas")`);
  await app.waitFor(`document.querySelector(".ggrid")`);
  await app.sleep(300);
  const file = `design/181/grid-${theme}.png`;
  await app.shot(file);
  const stage = await app.rect(".guistage");
  const z = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const png = readPng(readFileSync(file));
  const at = (x: number, y: number) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return png.data[i] + png.data[i + 1] + png.data[i + 2]; };
  // The grid line at x = 36 (a cell edge) inside the image, and a column 4 canvas pixels right of it.
  const y = stage.y + 45 * z;
  const line = at(stage.x + 36 * z, y), plain = at(stage.x + 40 * z, y);
  assert(plain > 700 && line < plain - 40, `grid line visible over the white image: line ${line}, beside it ${plain}`);
  // The grid does not take the click.
  await app.click(".guistage .gwidget.k-image");
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-image.sel")`);
}, { project, theme });
