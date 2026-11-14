/**
 * KUYRUK #34: moving several elements at once in the element list, with the real ETREconomy project copied (854
 * elements): Ctrl-click and Shift-click select several tiles, one Move puts them all in a folder, and the single-element
 * actions switch off while several are selected. MCP sees the result in its folder summary. Screenshots go to design/folders/.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, REPO, run, type App } from "./cdp.ts";

const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
const OUT = "design/folders";
const folders = () => JSON.parse(readFileSync(join(project, "folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string> };
const selectedCount = (app: App) => app.eval<number>(`document.querySelectorAll(".tile.sel:not(.foldertile)").length`);
/** A click the way the browser sends it: press with the modifier, focus, click. */
const click = (app: App, index: number, modifier: "ctrlKey" | "shiftKey" | "") => app.eval(`(() => {
  const tile = [...document.querySelectorAll(".tile:not(.foldertile)")][${index}];
  const mods = { ${modifier ? `${modifier}: true` : ""} };
  tile.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, ...mods }));
  tile.focus();
  tile.dispatchEvent(new MouseEvent("click", { bubbles: true, ...mods }));
})()`);
const disabled = (app: App, label: string) => app.eval<boolean>(`[...document.querySelectorAll(".view .actions .abtn")].find((b) => b.textContent.includes(${JSON.stringify(label)})).disabled`);

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  // A type filter shows many elements across folders at once.
  await app.setValue(".findbar .search input", "money_");
  await app.waitFor(`document.querySelectorAll(".tile:not(.foldertile)").length >= 6`);

  await app.click(".view .actions .abtn", "New folder");
  await app.eval(`(() => { const input = document.querySelector(".foldername"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Bulk"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.key("Enter");
  await app.waitFor(`document.querySelectorAll(".tile:not(.foldertile)").length >= 6`);
  await app.sleep(800);
  assert(folders().folders.includes("Bulk"), "folder saved");

  // Plain click, then Ctrl-click two more, then a Shift-click range.
  await click(app, 0, "");
  assert((await selectedCount(app)) === 1, "one selected");
  await click(app, 2, "ctrlKey");
  await click(app, 4, "ctrlKey");
  assert((await selectedCount(app)) === 3, `ctrl-click adds: ${await selectedCount(app)}`);
  await click(app, 2, "ctrlKey");
  assert((await selectedCount(app)) === 2, "ctrl-click again removes");
  await click(app, 0, "");
  await click(app, 3, "shiftKey");
  assert((await selectedCount(app)) === 4, `shift-click selects the range: ${await selectedCount(app)}`);
  const info = await app.eval<string>(`document.querySelector(".selinfo").textContent`);
  assert(info.includes("4 elements"), `selection info: ${info}`);
  for (const label of ["Edit", "Duplicate", "Delete"]) assert(await disabled(app, label), `${label} is off for several elements`);
  const names = await app.eval<string[]>(`[...document.querySelectorAll(".tile.sel:not(.foldertile) code")].map((c) => c.textContent)`);
  await app.shot(`${OUT}/multi-selected.png`);

  // Move lives in the right-click menu; the click keeps the several selected elements.
  await app.click(".tile.sel:not(.foldertile)", undefined, { button: "right" });
  await app.click(".menulist button", "Move");
  await app.click(".menulist button", "Bulk");
  await app.sleep(1000);
  const placed = Object.entries(folders().placement).filter(([, f]) => f === "Bulk").map(([k]) => k.split("/")[1]);
  assert(names.length === 4 && names.every((n) => placed.includes(n)) && placed.length === 4, `all 4 moved: ${names.join(",")} vs ${placed.join(",")}`);

  const mcp = await connect(project);
  try {
    const summary = await mcp.call("list_folders", { path: "Bulk" });
    assert(summary.folders[0].elements === 4, "MCP summary counts the 4");
  } finally {
    await mcp.close();
  }
  await app.shot(`${OUT}/multi-moved.png`);
}, { project });
