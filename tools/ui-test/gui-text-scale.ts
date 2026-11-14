/**
 * KUYRUK #93: text size of GUI labels and buttons. The Text size field (label, button; overlay labels too) is saved
 * as textScale and the canvas draws the text at that size (a label's box grows with it); Ctrl+Z undoes it.
 * The generated Java is checked by tools/codegen-test/build.sh on all five engines. Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/gui-editor";
const project = exampleProject();
addElement(project, "gui", "textgui", {
  type: 0, width: 176, height: 166,
  components: [
    { kind: "label", x: 10, y: 10, text: "Title", color: "" },
    { kind: "button", x: 10, y: 60, width: 80, height: 30, text: "Buy", procedure: "" },
  ],
});
addElement(project, "overlay", "texthud", { components: [{ kind: "label", x: 4, y: 4, text: "HUD", color: "" }] });
type W = { kind: string; textScale?: number };
const saved = (dir: string, id: string) => (JSON.parse(readFileSync(join(project, "elements", dir, `${id}.json`), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const fontPx = (app: App, kind: string) => app.eval<number>(`parseFloat(getComputedStyle(document.querySelector(".gwidget.k-${kind} .gtext")).fontSize)`);
const width = (app: App, kind: string) => app.eval<number>(`document.querySelector(".gwidget.k-${kind}").getBoundingClientRect().width`);
const CTRL = 2;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "textgui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 2`);
  const label1 = await fontPx(app, "label"), w1 = await width(app, "label"), button1 = await fontPx(app, "button");

  await app.click(".guilist .lrow", "Title");
  await app.setField("Text size", "2", ".guiform");
  await waitSaved(app);
  assert(saved("guis", "textgui")[0].textScale === 2, `label textScale saved: ${JSON.stringify(saved("guis", "textgui")[0])}`);
  assert(Math.abs(await fontPx(app, "label") - label1 * 2) < 0.5, `label text drawn twice as big: ${label1} -> ${await fontPx(app, "label")}`);
  assert(Math.abs(await width(app, "label") - w1 * 2) < 2, `label box twice as wide: ${w1} -> ${await width(app, "label")}`);

  await app.click(".guilist .lrow", "Buy");
  await app.setField("Text size", "0.5", ".guiform");
  await waitSaved(app);
  assert(saved("guis", "textgui")[1].textScale === 0.5, "button textScale saved");
  assert(Math.abs(await fontPx(app, "button") - button1 / 2) < 0.5, `button text half size: ${await fontPx(app, "button")}`);
  await app.click(".guilist .lrow", "Title");
  await app.shot(`${OUT}/text-scale-dark.png`);

  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved("guis", "textgui")[1].textScale === undefined, "Ctrl+Z undoes the button text size");

  // The toolbar's A- / size / A+ (reopened #93): shown for a label or button, steps the whole selection.
  const toolbarSize = () => app.eval<string>(`document.querySelector(".procpanel .textctl .textctlval")?.textContent ?? ""`);
  const textButton = (title: string) => `.procpanel .textctl button[title=${JSON.stringify(title)}]`;
  await app.click(".guilist .lrow", "Title");
  await app.waitFor(`document.querySelector(".procpanel .textctl:not(.off)")`);
  assert((await toolbarSize()) === "2x", `toolbar shows the label's size: ${await toolbarSize()}`);
  await app.click(textButton("Bigger text"));
  await app.click(textButton("Bigger text"));
  await waitSaved(app);
  assert(saved("guis", "textgui")[0].textScale === 2.5 && (await toolbarSize()) === "2.5x", "A+ steps the label by a quarter");
  // Ctrl+click adds the button to the selection; A- sets both to the first one's size minus a step.
  await app.eval(`[...document.querySelectorAll(".guilist .lrow")].find((r) => r.textContent.includes("Buy")).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget.sel").length === 2`);
  await app.sleep(1100); // quick steps within a second merge into one undo step; this one stands alone
  await app.click(textButton("Smaller text"));
  await waitSaved(app);
  const both = saved("guis", "textgui");
  assert(both[0].textScale === 2.25 && both[1].textScale === 2.25, `A- sets the whole selection: ${JSON.stringify(both)}`);
  await app.shot(`${OUT}/text-scale-toolbar-dark.png`);
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved("guis", "textgui")[1].textScale === undefined && saved("guis", "textgui")[0].textScale === 2.5, "Ctrl+Z undoes the toolbar step in one go");

  // Overlay labels have it too.
  await app.click(".abtn", "Back to elements");
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "texthud", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget")`);
  await app.click(".guilist .lrow", "HUD");
  await app.setField("Text size", "3", ".guiform");
  await waitSaved(app);
  assert(saved("overlays", "texthud")[0].textScale === 3, "overlay label textScale saved");
  await app.setTheme("light");
  await app.shot(`${OUT}/text-scale-overlay-light.png`);
}, { project });
