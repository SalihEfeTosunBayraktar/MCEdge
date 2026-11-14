/**
 * KUYRUK #86: groups in the GUI editor. Ctrl+G groups the selection, the widget list shows a collapsible named group
 * row (rename, hide, lock), a click on a member selects the group (Alt+click one widget), the group drags, aligns,
 * locks, hides and duplicates as one, Ctrl+Shift+G ungroups, Ctrl+Z undoes. The MCP tools carry `group`, and the
 * generated Java does not change with it. Screenshots go to design/gui-editor/.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";
import { registerGuiTools } from "../../src/mcp/gui.ts";

const OUT = "design/gui-editor";
const project = exampleProject();
addElement(project, "gui", "groupgui", {
  type: 0, width: 176, height: 166, snapOnGrid: false,
  components: [
    { kind: "button", x: 10, y: 10, width: 40, height: 20, text: "A", procedure: "" },
    { kind: "button", x: 60, y: 30, width: 40, height: 20, text: "B", procedure: "" },
    { kind: "label", x: 100, y: 100, text: "Note" },
  ],
});
type W = { kind: string; x: number; y: number; text?: string; group?: string; editLocked?: boolean; editHidden?: boolean };
const file = join(project, "elements", "guis", "groupgui.json");
const saved = () => (JSON.parse(readFileSync(file, "utf8")) as { components: W[] }).components;
const by = (text: string) => saved().find((w) => w.text === text)!;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const CTRL = 2, SHIFT = 8;
const selectedTexts = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".gwidget.sel")].map((e) => e.textContent.trim()).sort()`);
const widget = (text: string) => `[...document.querySelectorAll(".gwidget")].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
const centre = async (app: App, text: string): Promise<[number, number]> => {
  const r = await app.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = ${widget(text)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  return [r.x + r.w / 2, r.y + r.h / 2];
};
/** Pointer down/up on a widget with modifier keys (the CDP click helper has none). */
const pressWith = (app: App, text: string, keys: { altKey?: boolean; shiftKey?: boolean }) => app.eval(`(() => { const e = ${widget(text)}; const r = e.getBoundingClientRect();
  const o = { bubbles: true, button: 0, clientX: r.x + 3, clientY: r.y + 3, pointerId: 1, ...${JSON.stringify(keys)} };
  e.dispatchEvent(new PointerEvent("pointerdown", o)); e.dispatchEvent(new PointerEvent("pointerup", o)); })()`);
const header = (name: string) => `document.querySelector('.guilist .ggroup[data-group="${name}"]')`;
const headerButton = (app: App, name: string, title: string) => app.eval(`[...${header(name)}.querySelectorAll("button")].find((b) => b.title.startsWith(${JSON.stringify(title)})).click()`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "groupgui", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget").length === 3`);

  // Group A and B.
  await app.click(".guilist .lrow", "A");
  await app.eval(`[...document.querySelectorAll(".guilist .lrow")].find((r) => r.textContent.includes("Button B")).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
  await app.key("g", CTRL);
  await waitSaved(app);
  assert(by("A").group === "Group 1" && by("B").group === "Group 1" && !by("Note").group, `grouped: ${JSON.stringify(saved())}`);
  assert(await app.eval<boolean>(`!!${header("Group 1")} && ${header("Group 1")}.textContent.includes("2 widgets")`), "the list shows the group row");
  assert(await app.eval<number>(`document.querySelectorAll(".guilist .lrow.ingroup").length`) === 2, "members listed under it");
  await app.shot(`${OUT}/groups-list-dark.png`);

  // A click on a member selects the group; Alt+click selects one.
  await app.key("Escape");
  await app.click(".gwidget", "A");
  assert((await selectedTexts(app)).join() === "A,B", `click selects the group: ${await selectedTexts(app)}`);
  await app.key("Escape");
  await pressWith(app, "B", { altKey: true });
  await app.sleep(100);
  assert((await selectedTexts(app)).join() === "B", `Alt+click selects one: ${await selectedTexts(app)}`);

  // Dragging a member moves the group.
  await app.key("Escape");
  const zoom = await app.eval<number>(`Number(getComputedStyle(document.querySelector(".guistage")).getPropertyValue("--z"))`);
  const a = await centre(app, "A");
  await app.drag(a, [a[0] + 10 * zoom, a[1] + 5 * zoom]);
  await waitSaved(app);
  assert(by("A").x === 20 && by("A").y === 15 && by("B").x === 70 && by("B").y === 35, `group dragged as one: ${JSON.stringify([by("A"), by("B")])}`);

  // Align: the group to the right edge of the screen as one block (B keeps its place right of A).
  await app.click(".gwidget", "A");
  await app.click(".alignbtn[data-align='right'] .abtn");
  await waitSaved(app);
  assert(by("B").x === 176 - 40 && by("A").x === 176 - 40 - 50, `group aligned as a block: A ${by("A").x}, B ${by("B").x}`);
  // Group plus label: the label lines up on the group's left edge.
  await app.eval(`[...document.querySelectorAll(".guilist .lrow")].find((r) => r.textContent.includes("Note")).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
  await app.click(".alignbtn[data-align='left'] .abtn");
  await waitSaved(app);
  assert(by("Note").x === by("A").x && by("A").x === 86, `label aligned on the group: ${by("Note").x}`);

  // Lock the group from its row: selectable, not moved.
  await headerButton(app, "Group 1", "Lock");
  await waitSaved(app);
  assert(by("A").editLocked === true && by("B").editLocked === true, "the group is locked");
  await app.key("Escape");
  const before = [by("A").x, by("B").x].join();
  const b = await centre(app, "B");
  await app.drag(b, [b[0] - 30 * zoom, b[1] + 20 * zoom]);
  await waitSaved(app);
  assert([by("A").x, by("B").x].join() === before, "a locked group does not move");
  assert((await selectedTexts(app)).join() === "A,B", "but it is selected");
  await headerButton(app, "Group 1", "Unlock");
  await waitSaved(app);
  assert(!by("A").editLocked && !by("B").editLocked, "unlocked");

  // Hide the group: not drawn; show it again.
  await headerButton(app, "Group 1", "Hide the group");
  await waitSaved(app);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget").length`) === 1 && by("A").editHidden === true, "a hidden group is not drawn");
  await app.shot(`${OUT}/groups-hidden-dark.png`);
  await headerButton(app, "Group 1", "Show the group");
  await waitSaved(app);
  assert(await app.eval<number>(`document.querySelectorAll(".gwidget").length`) === 3, "shown again");

  // Duplicate the group: a second group.
  await app.eval(`${header("Group 1")}.click()`);
  assert((await selectedTexts(app)).join() === "A,B", "the group row selects the group");
  await app.key("d", CTRL);
  await waitSaved(app);
  const copies = saved().filter((w) => w.group === "Group 2");
  assert(copies.length === 2 && saved().filter((w) => w.group === "Group 1").length === 2, `duplicate makes Group 2: ${JSON.stringify(saved().map((w) => w.group))}`);
  // Ungroup the copies, then undo.
  await app.key("g", CTRL | SHIFT);
  await waitSaved(app);
  assert(!saved().some((w) => w.group === "Group 2") && saved().length === 5, "Ctrl+Shift+G ungroups");
  await app.key("z", CTRL);
  await waitSaved(app);
  assert(saved().filter((w) => w.group === "Group 2").length === 2, "Ctrl+Z groups them again");

  // Rename a group by double click on its row; collapse it.
  await app.eval(`${header("Group 2")}.querySelector(".ltxt").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`${header("Group 2")}.querySelector("input")`);
  await app.eval(`(() => { const e = ${header("Group 2")}.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "Shop row"); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.key("Enter");
  await waitSaved(app);
  assert(saved().filter((w) => w.group === "Shop row").length === 2, "group renamed");
  const rows = await app.eval<number>(`document.querySelectorAll(".guilist .lrow").length`);
  await headerButton(app, "Group 1", "Hide the widgets");
  assert(await app.eval<number>(`document.querySelectorAll(".guilist .lrow").length`) === rows - 2, "collapsing hides the member rows");
  await app.shot(`${OUT}/groups-list-renamed-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/groups-list-light.png`);
}, { project });

// MCP: write_gui_layout keeps `group` (and editHidden), read_gui_layout returns it.
const tools: Record<string, (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
registerGuiTools({ registerTool: (name: string, _def: unknown, fn: never) => (tools[name] = fn) } as never, project, async (fn) => {
  try {
    return await fn();
  } catch (error) {
    return { content: [{ type: "text", text: String(error) }], isError: true };
  }
});
const wrote = await tools.write_gui_layout({ type: "gui", id: "groupgui", widgets: [
  { kind: "slot", x: 7, y: 7, id: 0, group: "Row" }, { kind: "slot", x: 25, y: 7, id: 1, group: "Row", editHidden: true },
] });
assert(!wrote.isError, `write_gui_layout accepts group: ${wrote.content[0].text}`);
const read = JSON.parse((await tools.read_gui_layout({ type: "gui", id: "groupgui" })).content[0].text) as { widgets: W[] };
assert(read.widgets.every((w) => w.group === "Row") && read.widgets[1].editHidden === true, "read_gui_layout returns group");
console.log("MCP group round trip PASS");

// Generator: the same layout with and without group keys gives the same Java.
const build = (dir: string) => {
  const r = spawnSync(process.execPath, [join(REPO, "src", "cli.ts"), "build", dir, "--target", "fabric-1.21.5", "--no-gradle"], { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed: ${r.stderr}`);
};
const screens = (dir: string) => {
  const found: string[] = [];
  const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : /Groupgui.*\.java$/.test(e.name) && found.push(readFileSync(join(d, e.name), "utf8"))));
  walk(join(dir, "out"));
  return found.sort().join("\n");
};
const grouped = exampleProject();
addElement(grouped, "gui", "groupgui", { type: 0, width: 176, height: 166, components: [
  { kind: "button", x: 10, y: 10, width: 40, height: 20, text: "A", procedure: "", group: "G", editHidden: true },
  { kind: "label", x: 60, y: 30, text: "B", group: "G", editLocked: true },
] });
const plain = exampleProject();
addElement(plain, "gui", "groupgui", { type: 0, width: 176, height: 166, components: [
  { kind: "button", x: 10, y: 10, width: 40, height: 20, text: "A", procedure: "" },
  { kind: "label", x: 60, y: 30, text: "B" },
] });
build(grouped);
build(plain);
const g = screens(grouped), p = screens(plain);
assert(g.length > 0, "the build wrote the GUI's Java");
assert(g === p, "group, editHidden and editLocked do not change the generated Java");
console.log("generator ignores group PASS");
