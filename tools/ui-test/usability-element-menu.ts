/**
 * KUYRUK #79: in the GUI and procedure editors the element's Duplicate and Delete sit in an Element menu, so the only
 * red button in the toolbar is the editor's own Remove widget (GUI). Duplicate and Delete still work from the menu.
 * Screenshots go to design/usability/.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
addElement(project, "gui", "machine", { type: 1, width: 176, height: 166 });
addElement(project, "procedure", "on_press");

const danger = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".actions .abtn.danger")].map((b) => b.textContent)`);
const labels = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".actions .abtn")].map((b) => b.textContent)`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.eval(`window.confirm = () => true`);
  await app.click(".tile", "machine", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  let l = await labels(app);
  assert(!l.includes("Delete") && !l.includes("Duplicate") && l.includes("Element"), `GUI toolbar has an Element menu: ${l}`);
  assert((await danger(app)).join() === "Remove selected", `only Remove selected (the widget) is red: ${await danger(app)}`);
  await app.click(".abtn", "Element");
  await app.waitFor(`document.querySelector(".elementmenu .menulist")`);
  await app.shot(`${OUT}/after-element-menu-gui.png`);
  await app.click(".elementmenu .menulist button", "Duplicate");
  await app.waitFor(`document.querySelector(".edname")?.textContent.includes("machine") && document.querySelector(".edname").textContent !== "machine" && document.querySelector(".guistage")`);
  const copy = await app.eval<string>(`document.querySelector(".edname").textContent`);
  console.log("duplicate opened", copy);
  await app.click(".abtn", "Element");
  await app.click(".elementmenu .menulist button", "Delete");
  // Closing the copy returns to the element it was made from.
  await app.waitFor(`document.querySelector(".edname")?.textContent === "machine"`);
  await app.sleep(500);
  assert(existsSync(join(project, "elements/guis/machine.json")), "the original GUI is still there");
  assert(!existsSync(join(project, "elements/guis/machine_copy.json")), "Delete removed the copy");
  await app.click(".abtn", "Back to elements");
  await app.waitFor(`document.querySelector(".tile")`);

  await app.click(".tile", "on_press", { double: true });
  await app.waitFor(`document.querySelector(".blocklyhost")`);
  l = await labels(app);
  assert(!l.includes("Delete") && !l.includes("Duplicate") && l.includes("Element"), `procedure toolbar has an Element menu: ${l}`);
  assert((await danger(app)).length === 0, "no red button beside the procedure toolbar's own");
  await app.click(".abtn", "Element");
  await app.waitFor(`document.querySelector(".elementmenu .menulist")`);
  await app.shot(`${OUT}/after-element-menu-procedure.png`);
  await app.click(".elementmenu .menulist button", "Delete");
  await app.waitFor(`document.querySelector(".tile") && !document.querySelector(".blocklyhost")`);
  await app.sleep(500);
  assert(!existsSync(join(project, "elements/procedures/on_press.json")), "Delete removed the procedure");
}, { project });
