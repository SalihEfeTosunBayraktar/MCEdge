/**
 * KUYRUK #83, #84: in the GUI editor's narrow side panel the texture grid opens over the window (a portal on
 * document.body, fully inside the window, wide enough to see the textures) and a cell click picks the texture; the
 * side panel grip resizes the panel and the width is remembered after a restart. Screenshots go to design/gui-editor/.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/gui-editor";
const project = exampleProject();
addElement(project, "gui", "panelgui", {
  type: 1, width: 176, height: 166,
  components: [{ kind: "image", x: 20, y: 20, width: 16, height: 16, image: "textures/ruby.png" }],
});
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "panelgui.json"), "utf8")) as { components: { image?: string }[] }).components;
const panelWidth = (app: App) => app.eval<number>(`Math.round(document.querySelector(".procpanel").getBoundingClientRect().width)`);
const open = async (app: App) => {
  // After a restart the editor tab comes back by itself (KUYRUK 130).
  await app.waitFor(`document.querySelector(".tile, .guistage .gwidget")`);
  if (!(await app.eval<boolean>(`!!document.querySelector(".guistage .gwidget")`))) await app.click(".tile", "panelgui", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget")`);
};

let failed = false;
// Own user data folder, kept between the two runs (localStorage holds the width).
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
let app = await launchApp({ project, userData, width: 1280, height: 800 });
try {
  await open(app);
  assert(await panelWidth(app) === 372, `default panel width: ${await panelWidth(app)}`);
  // The grip takes no room: the panel's tabs start at its top edge.
  const tabsGap = await app.eval<number>(`Math.round(document.querySelector(".procpanel .pagetabs").getBoundingClientRect().top - document.querySelector(".procpanel").getBoundingClientRect().top)`);
  assert(tabsGap >= 0 && tabsGap < 8, `panel tabs at the top of the panel: ${tabsGap}`);
  await app.click(".lrow", "Image");
  await app.waitFor(`document.querySelector(".guiform .texpicked")`);
  await app.click(".guiform .texpicked");
  await app.waitFor(`document.querySelectorAll(".texpop .texcell img").length >= 4`);
  const pop = await app.eval<{ parent: string; left: number; top: number; right: number; bottom: number; width: number; cells: number; visible: number }>(`(() => {
    const p = document.querySelector(".texpop"), r = p.getBoundingClientRect();
    const cells = [...p.querySelectorAll(".texcell")];
    const visible = cells.filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.left >= r.left && b.right <= r.right && b.bottom <= r.bottom; }).length;
    return { parent: p.parentElement.tagName, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, cells: cells.length, visible };
  })()`);
  console.log("texture grid", JSON.stringify(pop));
  await app.shot(`${OUT}/panel-texture-grid-dark.png`);
  assert(pop.parent === "BODY", "the grid is rendered on the body, not inside the panel");
  assert(pop.left >= 0 && pop.top >= 0 && pop.right <= 1280 && pop.bottom <= 800, "the grid is inside the window");
  assert(pop.width > 372, `the grid is wider than the side panel: ${pop.width}`);
  assert(pop.visible === pop.cells, `every texture cell is visible: ${pop.visible}/${pop.cells}`);
  // Search, then pick by a real mouse click on a cell.
  await app.setValue(".texpop input", "apple");
  await app.sleep(200);
  const left = await app.eval<string[]>(`[...document.querySelectorAll(".texpop .texcell")].map((c) => c.textContent.trim())`);
  assert(left.length < pop.cells && left.includes("ruby_apple"), `search narrows the grid: ${left}`);
  await app.click(".texpop .texcell", "ruby_apple");
  await app.sleep(600);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".texpop")`)), "picking closes the grid");
  assert(saved()[0].image === "textures/ruby_apple.png", `picked texture saved: ${saved()[0].image}`);

  // Panel grip: drag 200 px to the left, the panel grows.
  const grip = await app.rect(".procpanel .panelgrip");
  const from: [number, number] = [grip.x + grip.width / 2, 300];
  await app.drag(from, [from[0] - 200, 300], 10);
  await app.sleep(200);
  const wide = await panelWidth(app);
  console.log("panel after drag", wide);
  assert(wide >= 560 && wide <= 580, `panel resized by the grip: ${wide}`);
  await app.shot(`${OUT}/panel-resized-dark.png`);
  // Narrower than the minimum is clamped to 280.
  const grip2 = await app.rect(".procpanel .panelgrip");
  await app.drag([grip2.x + grip2.width / 2, 300], [grip2.x + 600, 300], 10);
  assert(await panelWidth(app) === 280, `minimum width 280: ${await panelWidth(app)}`);
  const grip3 = await app.rect(".procpanel .panelgrip");
  await app.drag([grip3.x + grip3.width / 2, 300], [grip3.x - 170, 300], 10);
  const kept = await panelWidth(app);
  assert(kept >= 440 && kept <= 460, `resized again: ${kept}`);
  // Quit the way the user does (close() kills the process, before Chromium writes localStorage to disk).
  await app.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").app.quit()`).catch(() => {});
  await app.sleep(3000);
  await app.close();

  app = await launchApp({ userData, width: 1280, height: 800 });
  await app.waitFor(`document.querySelector(".grid tbody tr")`);
  await app.click(".grid tbody tr", undefined, { double: true });
  await app.waitFor(`document.querySelector(".rail")`);
  await open(app);
  const restored = await panelWidth(app);
  console.log("panel after restart", restored);
  assert(restored === kept, `width remembered after restart: ${restored} (was ${kept})`);
  await app.setTheme("light");
  await app.shot(`${OUT}/panel-restored-light.png`);
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error);
  failed = true;
  await app.shot("tools/ui-test/last-failure.png").catch(() => {});
} finally {
  await app.close();
}
if (failed) process.exitCode = 1;
