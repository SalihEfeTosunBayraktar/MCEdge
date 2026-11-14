/**
 * KUYRUK 179: Ctrl + mouse wheel zooms the view under the pointer, and never the whole window (the window's zoom is
 * the Text size preference). GUI and overlay editor canvas, texture editor, 3D model preview, procedure blocks and
 * the code editor; over anything else Ctrl + wheel does nothing. Args: theme. Screenshots in design/179/.
 */
import { assert, copyProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
addElement(project, "gui", "zoomgui", { type: 0, width: 176, height: 166, components: [{ kind: "label", x: 10, y: 10, text: "Zoom", color: "" }] });
const CTRL = 2;
const windowZoom = (app: App) => app.mainEval<number>(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()`);
const ctrlWheel = async (app: App, selector: string, deltaY: number) => {
  const [x, y] = await app.center(selector);
  await app.wheel(x, y, deltaY, CTRL);
};
const width = (app: App, selector: string) => app.eval<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width`);
const search = async (app: App, text: string) => app.setValue(`input[placeholder^="Search in this workspace"]`, text);
const open = async (app: App, id: string) => {
  await search(app, id);
  await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.querySelector("code")?.textContent === ${JSON.stringify(id)})`, 15000);
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector("code")?.textContent === ${JSON.stringify(id)}).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  const zoom0 = await windowZoom(app);

  // Over the element list: nothing zooms, not the window either.
  await ctrlWheel(app, ".tile", -100);
  assert(await windowZoom(app) === zoom0, `Ctrl + wheel over the list leaves the window zoom (${await windowZoom(app)})`);

  // GUI editor canvas.
  await open(app, "zoomgui");
  await app.waitFor(`document.querySelector(".guistage .gwidget")`);
  let before = await width(app, ".guistage");
  await ctrlWheel(app, ".guiarea", -100);
  let after = await width(app, ".guistage");
  assert(after > before, `GUI canvas zooms in (${before} -> ${after})`);
  await ctrlWheel(app, ".guiarea", 100);
  assert(await width(app, ".guistage") === before, "and back out");
  assert(await windowZoom(app) === zoom0, "the window zoom stays");
  await ctrlWheel(app, ".guiarea", -100);
  await app.shot(`design/179/gui-${theme}.png`);
  await app.key("w", CTRL);

  // Texture editor.
  await app.click(".rail .rtab", "Resources");
  await app.waitFor(`document.querySelector(".texcell")`, 15000);
  await app.eval(`document.querySelector(".texcell").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".paintarea canvas")`, 15000);
  before = await width(app, ".paintarea canvas");
  await ctrlWheel(app, ".paintarea", -100);
  after = await width(app, ".paintarea canvas");
  assert(after > before && await windowZoom(app) === zoom0, `texture editor zooms in (${before} -> ${after}), window zoom stays`);
  await app.shot(`design/179/texture-${theme}.png`);
  await app.key("w", CTRL);

  // 3D model preview (block form): the camera moves closer, the window stays.
  await app.click(".rail .rtab", "Mod elements");
  await open(app, "donatebox");
  await app.waitFor(`document.querySelector(".mpcanvas canvas")`, 20000);
  await app.sleep(800);
  const shot = () => app.eval<string>(`document.querySelector(".mpcanvas canvas").toDataURL()`);
  const pic0 = await shot();
  await ctrlWheel(app, ".mpcanvas", -300);
  await app.sleep(300);
  assert(await shot() !== pic0 && await windowZoom(app) === zoom0, "the model preview zooms, window zoom stays");
  await app.key("w", CTRL);

  // Procedure blocks.
  await open(app, "donateboxleftclick");
  await app.waitFor(`document.querySelector(".blocklySvg")`, 20000);
  await app.waitFor(`document.querySelector(".blocklyDraggable")`, 20000);
  const scale = () => app.eval<number>(`Math.round(document.querySelector(".blocklyDraggable").getBoundingClientRect().width)`);
  const s0 = await scale();
  await ctrlWheel(app, ".blocklySvg", -100);
  await app.sleep(300);
  assert(await scale() > s0 && await windowZoom(app) === zoom0, `procedure blocks zoom (${s0} -> ${await scale()}), window zoom stays`);
}, { project, theme });
