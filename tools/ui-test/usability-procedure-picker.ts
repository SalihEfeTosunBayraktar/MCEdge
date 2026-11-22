/**
 * KUYRUK #74: a procedure field is a searchable list (name and id) instead of a plain select of every procedure.
 * Typing narrows it, the best match is first, Enter picks it, Escape closes, "No procedure" clears the field, and
 * New and Open stay beside it. Run on a project with 300 procedures. Screenshots go to design/usability/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "item", "gem", { name: "Ruby Gem" });
for (let i = 0; i < 300; i++) addElement(project, "procedure", `proc_${String(i).padStart(3, "0")}`);
addElement(project, "procedure", "give_coins", { title: "Give coins" });
addElement(project, "procedure", "coins_to_give");
addElement(project, "procedure", "coins");

const saved = () => JSON.parse(readFileSync(join(project, "elements/items/gem.json"), "utf8")).onRightClickedInAir as string;
const row = `[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air"))`;
const names = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".proclist .procrow .procname")].map((n) => n.textContent)`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "Ruby Gem", { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Gem"`);
  await app.click(".pagetabs .ltab", "Triggers");
  assert(await app.eval<boolean>(`!${row}.querySelector("select") && !!${row}.querySelector(".procpicker")`), "the field is a picker, not a select");
  assert(await app.eval<boolean>(`!!${row}.querySelector(".procopen") && !!${row}.querySelector(".procnew")`), "Open and New are still there");

  await app.eval(`${row}.querySelector(".procpicked").id = "pp"`);
  await app.click("#pp");
  await app.waitFor(`document.querySelector(".proclist")`);
  let list = await names(app);
  assert(list[0] === "No procedure" && list.length <= 121, `No procedure first, long list capped: ${list.length}`);
  assert(await app.eval<boolean>(`document.activeElement === document.querySelector(".proclistpop input")`), "the search has focus");
  await app.shot(`${OUT}/after-procedure-picker-open.png`);

  // Type-ahead matches anywhere in the name or id, best match first.
  await app.type("coins");
  await app.sleep(200);
  list = await names(app);
  console.log("coins ->", list);
  assert(list.length === 3 && list[0] === "coins", `exact match first of three: ${list}`);
  assert(list[1] === "Give coins" || list[1] === "coins_to_give", `prefix before the rest: ${list}`);
  await app.type(" give");
  await app.sleep(200);
  assert((await names(app)).length === 2, `words narrow it: ${await names(app)}`);
  await app.shot(`${OUT}/after-procedure-picker-search.png`);

  // Enter picks the first match.
  await app.key("Enter");
  await app.waitFor(`!document.querySelector(".proclistpop")`);
  await app.sleep(700);
  const first = saved();
  assert(first === "give_coins" || first === "coins_to_give", `Enter picked the best match: ${first}`);
  assert(await app.eval<string>(`${row}.querySelector(".procpicked").title`) === first, "the field shows the choice");

  // Arrow keys and Escape.
  await app.click("#pp");
  await app.type("proc_01");
  await app.key("ArrowDown");
  await app.key("Enter");
  await app.sleep(700);
  assert(saved() === "proc_011", `ArrowDown moved to the second match: ${saved()}`);
  await app.click("#pp");
  await app.key("Escape");
  assert(await app.eval<boolean>(`!document.querySelector(".proclistpop")`), "Escape closes");
  assert(saved() === "proc_011", "Escape changed nothing");

  // No procedure clears it.
  await app.click("#pp");
  await app.click(".procrow", "No procedure");
  await app.sleep(700);
  assert(saved() === "", `cleared: ${JSON.stringify(saved())}`);
  console.log("bind a procedure: 1 click to open, type, Enter (before: 2 clicks in a list of 630, type-ahead on the first letters)");
}, { project });
