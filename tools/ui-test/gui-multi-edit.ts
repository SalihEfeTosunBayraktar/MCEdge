/**
 * KUYRUK 180: several selected widgets (a group or a Ctrl+click selection) are edited together. The panel shows
 * "N widgets" with the layer, the editor lock and every field they all have (not name or position); a field whose
 * values differ is empty with a note; a change sets every selected widget in one undo step.
 * Args: theme, language. Screenshots in design/180/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
addElement(project, "gui", "multigui", {
  type: 0, width: 176, height: 166,
  components: [
    { kind: "button", x: 10, y: 10, width: 60, height: 20, text: "Buy", procedure: "", group: "Shop" },
    { kind: "button", x: 10, y: 40, width: 80, height: 20, text: "Sell", procedure: "", group: "Shop" },
    { kind: "image", x: 100, y: 10, width: 16, height: 16, image: "textures/ruby.png" },
  ],
});
type W = { width?: number; height?: number; text?: string; editLocked?: boolean };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "multigui.json"), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const labels = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".multiform .frow > label, .multiform .frow > .flabel")].map((l) => l.textContent.replace("*", "").trim())`);
const help = (app: App, label: string) => app.eval<string>(`(() => { const r = [...document.querySelectorAll(".multiform .frow")].find((r) => r.querySelector(":scope > label")?.textContent.trim() === ${JSON.stringify(label)}); return r?.textContent ?? ""; })()`);
const ctrlClick = (app: App, text: string) => app.eval(`[...document.querySelectorAll(".guilist .lrow")].find((r) => r.textContent.includes(${JSON.stringify(text)})).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "multigui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);

  // A click on a grouped button selects the group: both buttons.
  await app.click(".guistage .gwidget.k-button");
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget.sel").length === 2`);
  await app.waitFor(`document.querySelector(".multiform")`);
  const title = await app.eval<string>(`document.querySelector(".multiform").closest(".fgroup, fieldset, section")?.querySelector("legend, .fgtitle, h3")?.textContent ?? ""`);
  const shown = await labels(app);
  const width = S["gui.field.width"], height = S["gui.field.height"], text = S["gui.field.text"], name = S["gui.field.name"];
  assert(shown.includes(width) && shown.includes(text) && !shown.includes(name) && !shown.includes(S["gui.field.x"]), `shared fields of two buttons, no name or position: ${shown.join(", ")} (${title})`);
  assert((await help(app, width)).includes(S["gui.multi.mixed"].replace("{count}", "2")), "the differing width is marked");
  await app.setField(width, "100", ".multiform");
  await waitSaved(app);
  assert(saved()[0].width === 100 && saved()[1].width === 100 && saved()[2].width === 16, `width set on both buttons: ${JSON.stringify(saved())}`);
  await app.shot(`design/180/group-${theme}-${lang}.png`);
  await app.key("z", 2);
  await waitSaved(app);
  assert(saved()[0].width === 60 && saved()[1].width === 80, "one Ctrl+Z undoes it for both");

  // Ctrl+click adds the image: only what a button and an image share (size, condition), set together.
  await ctrlClick(app, "ruby");
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget.sel").length === 3`);
  const both = await labels(app);
  assert(both.includes(height) && !both.includes(text), `button and image share size, not text: ${both.join(", ")}`);
  await app.setField(height, "24", ".multiform");
  await waitSaved(app);
  assert(saved().every((w) => w.height === 24), `height on all three: ${JSON.stringify(saved())}`);
  // The editor lock for all of them.
  await app.eval(`document.querySelector(".multiform .check input").click()`);
  await waitSaved(app);
  assert(saved().every((w) => w.editLocked === true), "the editor lock for all three");
  await app.shot(`design/180/mixed-${theme}-${lang}.png`);
}, { project, theme, language: lang });
