/**
 * KUYRUK #80: the GUI editor toolbar wraps instead of cutting its last items (the size and zoom note), in English and
 * Turkish at 1280 px, and the X, Y column of the widget list stays on one line for 3-digit values. Screenshots go to
 * design/usability/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "gui", "shop", {
  type: 1, width: 256, height: 220, layers: [{ name: "Background" }, { name: "Foreground items" }],
  components: [
    { kind: "label", x: 120, y: 100, text: "A rather long label text that needs room", layer: "Foreground items" },
    { kind: "button", x: 148, y: 188, width: 60, height: 20, text: "Buy", procedure: "" },
    { kind: "image", x: 200, y: 112, width: 16, height: 16, image: "textures/ruby_pickaxe.png", layer: "Foreground items" },
  ],
});

const measure = (app: App) => app.eval<{ cut: string[]; rows: number; xy: number[] }>(`(() => {
  const bar = document.querySelector(".actions");
  const box = bar.getBoundingClientRect(), edge = box.right;
  const cut = [...bar.children].filter((c) => c.getBoundingClientRect().width > 0 && (c.getBoundingClientRect().right > edge + 1 || c.getBoundingClientRect().bottom > box.bottom)).map((c) => c.textContent.trim() || c.className);
  const tops = new Set([...bar.children].filter((c) => c.getBoundingClientRect().width > 0).map((c) => Math.round(c.getBoundingClientRect().top)));
  return { cut, rows: tops.size, xy: [...document.querySelectorAll(".gxy")].map((g) => Math.round(g.getBoundingClientRect().height)) };
})()`);

for (const language of ["en", "tr"] as const) {
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`);
    await app.click(".tile", "shop", { double: true });
    await app.waitFor(`document.querySelector(".guistage") && document.querySelectorAll(".gxy").length === 3`);
    await app.sleep(300);
    const m = await measure(app);
    console.log(language, JSON.stringify(m));
    await app.shot(`${OUT}/after-gui-toolbar-${language}.png`);
    assert(m.cut.length === 0, `${language}: no toolbar item is cut off: ${m.cut}`);
    assert(m.xy.every((h) => h <= 20), `${language}: X, Y on one line: ${m.xy}`);
  }, { project, language, width: 1100 });
}
