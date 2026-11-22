/**
 * KUYRUK #103: explicit Z order of GUI images and labels. The Z order field saves `z`; the canvas draws widgets in
 * the generated screen's order (slots, images with z <= 0, buttons, labels with z <= 0, then everything with z > 0,
 * by z and then list order); Ctrl+Z undoes it. The generated Java is checked by tools/codegen-test (ruby_gui) on all
 * five engines. Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
const ruby = "textures/ruby.png";
addElement(project, "gui", "zgui", {
  type: 0, width: 176, height: 166,
  components: [
    { kind: "image", name: "front", x: 20, y: 20, width: 48, height: 48, image: ruby },
    { kind: "image", name: "back", x: 40, y: 40, width: 48, height: 48, image: ruby },
    { kind: "slot", x: 30, y: 30, id: 0 },
    { kind: "button", x: 50, y: 70, width: 60, height: 20, text: "Go", procedure: "" },
    { kind: "label", x: 44, y: 44, text: "Label", color: "" },
  ],
});
type W = { kind: string; name?: string; z?: number };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "zgui.json"), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "zgui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 5`);
  const left = (name: string) => app.eval<number>(`[...document.querySelectorAll(".guistage .gwidget.k-image")].map((e) => e.getBoundingClientRect().left).sort((a, b) => a - b)[${name === "front" ? 0 : 1}]`);
  const stackedNames = async () => {
    const lefts = await app.eval<number[]>(`[...document.querySelectorAll(".guistage .gwidget")].map((e) => e.classList.contains("k-image") ? e.getBoundingClientRect().left : -1)`);
    const front = await left("front");
    return (await app.eval<string[]>(`[...document.querySelectorAll(".guistage .gwidget")].map((e) => [...e.classList].find((c) => c.startsWith("k-")).slice(2))`))
      .map((k, i) => (k === "image" ? (Math.abs(lefts[i] - front) < 1 ? "front" : "back") : k)).join(",");
  };
  assert((await stackedNames()) === "slot,front,back,button,label", `default order: ${await stackedNames()}`);

  await app.click(".guilist .lrow", "front");
  await app.waitFor(`[...document.querySelectorAll(".guiform .frow label")].some((l) => l.textContent.trim() === "Z order")`);
  await app.setField("Z order", "5", ".guiform");
  await waitSaved(app);
  assert(saved()[0].z === 5, `z saved: ${JSON.stringify(saved()[0])}`);
  assert((await stackedNames()) === "slot,back,button,label,front", `z 5 draws on top of everything: ${await stackedNames()}`);

  await app.click(".guilist .lrow", "back");
  await app.setField("Z order", "-3", ".guiform");
  await app.click(".guilist .lrow", "Label");
  await app.setField("Z order", "7", ".guiform");
  await waitSaved(app);
  assert((await stackedNames()) === "slot,back,button,front,label", `a label above the front image: ${await stackedNames()}`);
  await app.click(".abtn", "Preview");
  await app.shot(`${OUT}/z-order-dark.png`);
  await app.click(".abtn", "Preview");

  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved()[4].z === undefined || saved()[4].z === 0, `Ctrl+Z undoes the label's z: ${JSON.stringify(saved()[4])}`);
  assert((await stackedNames()) === "slot,back,button,label,front", `undo restores the order: ${await stackedNames()}`);
  await app.setTheme("light");
  await app.click(".guilist .lrow", "front");
  await app.shot(`${OUT}/z-order-light.png`);
}, { project });
