/**
 * KUYRUK #87: Ctrl+D duplicates the selection one grid step away (slots get new ids, names a suffix, the copies are
 * selected); Ctrl+C / Ctrl+V copy and paste, in the same GUI (one step away) and into another GUI (same place).
 * Undo removes a duplicate. Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/gui-editor";
const project = exampleProject();
addElement(project, "gui", "source", {
  type: 1, width: 176, height: 166, gridSx: 18, gridSy: 18,
  components: [
    { kind: "slot", x: 7, y: 7, id: 0, output: false, limit: "" },
    { kind: "button", x: 40, y: 7, width: 60, height: 20, text: "Buy", procedure: "", name: "buy" },
  ],
});
addElement(project, "gui", "target", { type: 1, width: 176, height: 166, components: [{ kind: "label", x: 4, y: 4, text: "Other" }] });
type W = { kind: string; x: number; y: number; id?: number; name?: string; text?: string };
const saved = (id: string) => (JSON.parse(readFileSync(join(project, "elements", "guis", `${id}.json`), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const CTRL = 2;
const open = async (app: App, id: string, count: number) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", id, { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === ${count}`);
};
const selected = (app: App) => app.eval<number>(`document.querySelectorAll(".gwidget.sel").length`);

await run(async (app) => {
  await open(app, "source", 2);
  // Select both and duplicate.
  await app.click(".guilist .lrow", "Slot");
  await app.click(".guilist .lrow", "buy");
  await app.eval(`(() => { const r = [...document.querySelectorAll(".guilist .lrow")][0]; r.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); })()`);
  assert(await selected(app) === 2, "two widgets selected");
  await app.key("d", CTRL);
  await waitSaved(app);
  let list = saved("source");
  console.log("after Ctrl+D", JSON.stringify(list.map((w) => [w.kind, w.x, w.y, w.id ?? w.name])));
  assert(list.length === 4, `two copies added: ${list.length}`);
  const slotCopy = list.find((w) => w.kind === "slot" && w.id === 1);
  const buttonCopy = list.find((w) => w.kind === "button" && w.name === "buy_2");
  assert(slotCopy && slotCopy.x === 25 && slotCopy.y === 25, `slot copy one grid step away with a new id: ${JSON.stringify(slotCopy)}`);
  assert(buttonCopy && buttonCopy.x === 58 && buttonCopy.y === 25, `button copy one step away, name buy_2: ${JSON.stringify(buttonCopy)}`);
  assert(await selected(app) === 2 && await app.eval<boolean>(`[...document.querySelectorAll(".guilist .lrow.sel")].some((r) => r.textContent.includes("buy_2"))`), "the copies are selected");
  await app.shot(`${OUT}/duplicate-dark.png`);
  // Undo removes them in one step.
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved("source").length === 2, "Ctrl+Z removes the duplicates");

  // Copy the button, paste in the same GUI: one step away.
  await app.click(".guilist .lrow", "buy");
  await app.key("c", CTRL);
  await app.key("v", CTRL);
  await waitSaved(app);
  list = saved("source");
  assert(list.length === 3 && list.some((w) => w.kind === "button" && w.x === 58 && w.y === 25), `pasted in the same GUI one step away: ${JSON.stringify(list)}`);
  // Again: the next free step.
  await app.key("v", CTRL);
  await waitSaved(app);
  list = saved("source");
  assert(list.some((w) => w.kind === "button" && w.x === 76 && w.y === 43 && w.name === "buy_3"), `second paste one more step: ${JSON.stringify(list.map((w) => [w.x, w.y, w.name]))}`);

  // Into another GUI: same place.
  await app.click(".abtn", "Back to elements");
  await open(app, "target", 1);
  await app.eval(`document.querySelector(".guistage").focus?.()`);
  await app.key("v", CTRL);
  await waitSaved(app);
  const other = saved("target");
  console.log("target", JSON.stringify(other));
  assert(other.length === 2 && other.some((w) => w.kind === "button" && w.text === "Buy" && w.x === 40 && w.y === 7), "pasted into another GUI at the copied place");
  assert(other.find((w) => w.kind === "button")!.name === "buy", "no name clash there: the name is kept");
  await app.shot(`${OUT}/paste-other-gui-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/paste-other-gui-light.png`);
}, { project });
