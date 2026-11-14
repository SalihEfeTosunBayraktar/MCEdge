/**
 * KUYRUK #77: the procedure editor lists the project's variables. The Variables category starts with ready blocks for
 * each local variable of the procedure and each global and player variable (get, set, change by a number, the
 * variable already chosen), then the generic blocks; a variable block's own dropdown offers the same variables.
 * Screenshots go to design/usability/.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
writeFileSync(join(project, "variables.json"), JSON.stringify({ variables: [
  { name: "coins", type: "number", scope: "player_lifetime", initial: "0" },
  { name: "jackpot", type: "number", scope: "global_session", initial: "0" },
  { name: "motd", type: "string", scope: "global_session", initial: "" },
] }, null, 2));
addElement(project, "procedure", "pay", {
  program: { format: 1, variables: [{ name: "count", type: "number" }, { name: "other", type: "number" }, { name: "label", type: "text" }], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "local_number_set", fields: { var: "count" } }] }] },
});

const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const flyout = `${WS}.getToolbox().getFlyout().getWorkspace()`;
const blocks = (app: App) => app.eval<{ type: string; fields: string }[]>(`${flyout}.getTopBlocks(true).map((b) => ({ type: b.type, fields: b.inputList.flatMap((i) => i.fieldRow).map((f) => f.name ? f.getValue() : "").filter(Boolean).join(",") }))`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "pay", { double: true });
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);

  // The dropdown of a variable block offers the variables (it was empty: no choice source was ever set).
  const options = await app.eval<string[][]>(`(() => { const b = ${WS}.getAllBlocks(false).find((b) => b.type === "local_number_set"); return b.getField("var").getOptions().map((o) => o[1]); })()`);
  assert(options.join() === "count,other", `local dropdown offers the procedure's variables: ${options}`);

  await app.click(".blocklyToolboxCategory", "Variables");
  await app.sleep(400);
  const list = await blocks(app);
  console.log(list.slice(0, 12));
  const has = (type: string, field: string) => list.some((b) => b.type === type && b.fields.split(",").includes(field));
  assert(has("local_number_get", "count") && has("local_number_set", "count") && has("local_number_change", "count"), "ready blocks for the local variable");
  assert(has("player_number_get", "coins") && has("player_number_set", "coins") && has("player_number_change", "coins"), "ready blocks for the player variable");
  assert(has("global_number_get", "jackpot") && has("global_number_set", "jackpot") && has("global_number_change", "jackpot"), "ready blocks for the global variable");
  assert(has("global_text_get", "motd") && has("global_text_set", "motd"), "text global (variables.json string) is listed too");
  assert(list.some((b) => b.type === "local_text_get" && b.fields === ""), "the generic blocks follow");
  const firstGeneric = list.findIndex((b) => b.fields === "");
  assert(list.slice(0, firstGeneric).every((b) => b.fields !== ""), "variable blocks come before the generic ones");
  await app.shot(`${OUT}/after-variables-flyout.png`);

  // A new local variable shows up at once, without leaving the editor.
  await app.setValue(".mapkey", "total");
  await app.click(".procform .mbtn", "Add");
  await app.sleep(500);
  await app.click(".blocklyToolboxCategory", "Variables");
  await app.sleep(400);
  const after = await blocks(app);
  assert(after.some((b) => b.type === "local_number_get" && b.fields.split(",").includes("total")), "the new variable has ready blocks");
  const options2 = await app.eval<string[]>(`${WS}.getAllBlocks(false).find((b) => b.type === "local_number_set").getField("var").getOptions().map((o) => o[1])`);
  assert(options2.join() === "count,other,total", `the block dropdown follows: ${options2}`);

  // Global dropdowns and the procedure dropdown get their lists too.
  const globals = await app.eval<string[]>(`(() => { const b = ${flyout}.getAllBlocks(false).find((b) => b.type === "player_number_set"); return b.getField("var").getOptions().map((o) => o[1]); })()`);
  assert(globals.join() === "coins", `player dropdown: ${globals}`);
  const procs = await app.eval<string[]>(`(() => { const b = ${flyout}.getAllBlocks(false).find((b) => b.type === "global_number_set"); return b.getField("var").getOptions().map((o) => o[1]); })()`);
  assert(procs.join() === "jackpot", `global dropdown: ${procs}`);

  // Drag-free check that a ready block keeps its variable when it is taken out of the flyout.
  const taken = await app.eval<string>(`(() => { const info = ${flyout}.getAllBlocks(false).find((b) => b.type === "global_number_change"); return info.getFieldValue("var"); })()`);
  assert(taken === "jackpot", `ready block carries the variable: ${taken}`);
  await app.shot(`${OUT}/after-variables-flyout-new.png`);
}, { project });
