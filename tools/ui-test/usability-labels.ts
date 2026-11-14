/**
 * KUYRUK #65 (fix 6): clearer empty states and labels. A GUI without widgets says so on the canvas with quick add
 * buttons; a label whose text comes from a procedure shows a short (text) with the procedure in its tooltip
 * instead of drawing "Label"; the procedure field's Open and New wrap under the list in the narrow GUI panel;
 * the textured button's normal texture help no longer describes the old one-file layout; procedure side panel
 * labels wrap instead of being cut ("Skip missing-depen"). Screenshots go to design/usability/.
 */
import { assert, exampleProject, run } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
addElement(project, "gui", "empty_screen", { type: 0, width: 176, height: 166 });
addElement(project, "procedure", "coin_text");
addElement(project, "gui", "wallet", { type: 0, width: 176, height: 166, components: [{ kind: "label", x: 10, y: 10, text: "", textProcedure: "coin_text", color: "" }] });

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "empty_screen", { double: true });
  await app.waitFor(`document.querySelector(".guiempty")`);
  await app.shot(`${OUT}/after-gui-empty.png`);
  await app.click(".guiempty .mbtn", "Textured button");
  await app.waitFor(`!document.querySelector(".guiempty") && document.querySelector(".gwidget.k-image_button")`);
  const help = await app.eval<string>(`[...document.querySelectorAll(".guiform .frow")].find((r) => r.textContent.includes("Normal texture")).textContent`);
  assert(!help.includes("above the hover state"), `normal texture help is current: ${help}`);
  // In the narrow side panel the procedure list keeps its width; Open and New go under it.
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", "Button");
  const widths = await app.eval<{ select: number; row: number }>(`(() => { const r = [...document.querySelectorAll(".guiform .frow")].find((r) => r.textContent.includes("On click")); return { select: r.querySelector(".procpicked").getBoundingClientRect().width, row: r.querySelector(".fpair").getBoundingClientRect().width }; })()`);
  assert(widths.select >= widths.row - 2, `procedure list takes the full row: ${JSON.stringify(widths)}`);
  await app.shot(`${OUT}/after-gui-procedure-field.png`);
  await app.click(".abtn", "Back to elements");

  await app.click(".tile", "wallet", { double: true });
  await app.waitFor(`document.querySelector(".gwidget.k-label")`);
  const label = await app.eval<{ text: string; title: string }>(`(() => { const l = document.querySelector(".gwidget.k-label"); return { text: l.textContent, title: l.title }; })()`);
  assert(label.text === "(text)" && label.title === "Text from the procedure coin_text", `label marks procedure text: ${JSON.stringify(label)}`);
  await app.shot(`${OUT}/after-gui-label-procedure.png`);
  await app.click(".abtn", "Back to elements");

  await app.click(".tile", "coin_text", { double: true });
  await app.waitFor(`document.querySelector(".procform")`);
  const cut = await app.eval<string[]>(`[...document.querySelectorAll(".procform .frow > label")].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent)`);
  assert(cut.length === 0, `no cut labels: ${cut}`);
  await app.shot(`${OUT}/after-procedure-labels.png`);
}, { project });
