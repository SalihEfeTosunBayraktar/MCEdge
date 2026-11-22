/**
 * KUYRUK #90: a widget is renamed in the widget list: double click (or F2 on the selection) opens an inline field,
 * Enter saves the name, Escape keeps the old one, an empty name removes it, Ctrl+Z undoes. Screenshots go to
 * design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/gui-editor");
const project = exampleProject();
addElement(project, "gui", "namegui", {
  type: 1, width: 176, height: 166,
  components: [
    { kind: "button", x: 10, y: 10, width: 60, height: 20, text: "Buy", procedure: "" },
    { kind: "label", x: 10, y: 40, text: "Price" },
  ],
});
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "namegui.json"), "utf8")) as { components: { name?: string }[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const field = `document.querySelector(".guilist .lrename")`;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "namegui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guilist .lrow").length === 2`);

  // Double click, type, Enter.
  await app.click(".guilist .lrow", "Buy", { double: true });
  await app.waitFor(field);
  assert(await app.eval<boolean>(`document.activeElement === ${field}`), "the name field has the focus");
  await app.type("buy_button");
  await app.shot(`${OUT}/rename-editing-dark.png`);
  await app.key("Enter");
  await waitSaved(app);
  assert(saved()[0].name === "buy_button", `name saved: ${saved()[0].name}`);
  assert(await app.eval<boolean>(`!${field} && document.querySelector(".guilist .lrow .gname").textContent === "buy_button"`), "the list shows the name");

  // F2 on the selection, Escape cancels.
  await app.click(".guilist .lrow", "Price");
  await app.key("F2");
  await app.waitFor(field);
  await app.type("ignored");
  await app.key("Escape");
  await waitSaved(app);
  assert(saved()[1].name === undefined, "Escape keeps the old (no) name");
  assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.k-label.sel")`), "Escape in the field does not drop the selection");

  // F2, Enter: name; clearing it removes the key.
  await app.key("F2");
  await app.waitFor(field);
  await app.type("price_label");
  await app.key("Enter");
  await waitSaved(app);
  assert(saved()[1].name === "price_label", `F2 rename saved: ${saved()[1].name}`);
  await app.click(".guilist .lrow", "price_label", { double: true });
  await app.waitFor(field);
  await app.eval(`(() => { const e = ${field}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.key("Enter");
  await waitSaved(app);
  assert(saved()[1].name === undefined, "an empty name removes it");
  // Undo brings the name back.
  await app.key("z", 2);
  await waitSaved(app);
  assert(saved()[1].name === "price_label", `Ctrl+Z restores the name: ${saved()[1].name}`);
  // The form's Name field shows it too.
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".guiform input")].some((e) => e.value === "price_label")`), "the form shows the new name");
  await app.shot(`${OUT}/rename-done-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/rename-done-light.png`);
}, { project });
