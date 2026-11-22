/**
 * KUYRUK #98: creative tab order. The creative tab editor lists the tab's items (elements whose Creative tabs name
 * it) in order; dragging a row by its grip moves it, Add section / Add spacer insert after the selection, a section's
 * title and a spacer's slots are edited below the list, and every change saves the whole order. The generated order
 * is checked by tools/codegen-test/tab-order-check.ts, MCP by tools/mcp-test/surface.ts.
 * Screenshots go to design/creative-tab-order/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/creative-tab-order");
type Entry = { kind: string; id?: string; title?: string; slots?: number };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "creative_tabs", "ruby_tab.json"), "utf8")).order ?? []) as Entry[];
const describe = (order: Entry[]) => order.map((e) => e.id ?? e.kind).join(",");
const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".taborder .torow")].map((r) => r.querySelector(".ltxt").textContent)`);
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "Rubies", { double: true });
  await app.waitFor(`document.querySelectorAll(".taborder .torow").length === 4`);
  const before = await rows(app);
  assert(before.some((r) => r.includes("Ruby Pickaxe")) && before.some((r) => r.includes("Block")), `the tab's members are listed: ${before}`);
  await app.shot(`${OUT}/list-dark.png`);

  // Drag the last row to the top by its grip.
  const last = before.length - 1;
  const from = await app.center(`.taborder .torow:nth-child(${last + 1}) .tograb`);
  const top = await app.rect(".taborder .torow:nth-child(1)");
  await app.drag(from, [from[0], top.y + 2], 10);
  await waitSaved(app);
  const dragged = await rows(app);
  assert(dragged[0] === before[last] && dragged.length === 4, `dragged row is first: ${dragged}`);
  assert(saved().length === 4 && saved().every((e) => e.kind === "element"), `the whole order is saved: ${describe(saved())}`);

  // A section after the first row, retitled; a spacer of 2 slots after it.
  await app.click(".taborder .torow:nth-child(1)");
  await app.click(".taborder .mbtn", "Add section");
  await app.waitFor(`document.querySelectorAll(".taborder .torow").length === 5`);
  await app.setField("Title", "Food", ".taborder");
  await app.click(".taborder .mbtn", "Add spacer");
  await app.setField("Empty slots", "2", ".taborder");
  await waitSaved(app);
  const order = saved();
  assert(order[1].kind === "section" && order[1].title === "Food" && order[2].kind === "spacer" && order[2].slots === 2, `section and spacer saved: ${JSON.stringify(order)}`);
  // Alt+Down moves the selected spacer one down.
  await app.click(".taborder .torow.sel");
  await app.key("ArrowDown", 1);
  await waitSaved(app);
  assert(saved()[3].kind === "spacer", `Alt+Down moved the spacer: ${describe(saved())}`);
  await app.shot(`${OUT}/sections-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/sections-light.png`);
}, { project });
