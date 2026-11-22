/**
 * KUYRUK #64: right-click menus on folders (open, rename, colour, move, delete) and elements (edit, duplicate, rename,
 * usages, move, delete). Folder colours are saved in folders.json and shown on the tile; MCP edit_folder sets them too.
 * Screenshots go to design/context-menus/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = copyProject(exampleProject(), "hello");
writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Box", "Other"], placement: {} }, null, 2));
const OUT = evidence("design/context-menus");
const folders = () => JSON.parse(readFileSync(join(project, "folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string>; colors?: Record<string, string> };
const tileId = (app: App, name: string) => app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === ${JSON.stringify(name)})?.setAttribute("id", "target")`);
const menu = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".menulist.ctx [role=menuitem]")].map((b) => b.textContent)`);
const rightClick = async (app: App, name: string) => {
  await tileId(app, name);
  await app.click("#target", undefined, { button: "right" });
  await app.waitFor(`document.querySelector(".menulist.ctx")`);
};

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 2`);
  // Move is an action on the selection (KUYRUK 175); since Q279 the actions of a selection exist only while something is selected.
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".view .actions .abtn")].find((b) => b.textContent === "Move") === undefined`), "Move needs a selection");

  // Folder menu and colour.
  await rightClick(app, "Box");
  assert((await menu(app)).join("|") === "Open|Rename|Colour|Icon|Move|Delete", `folder menu: ${(await menu(app)).join("|")}`);
  await app.shot(`${OUT}/folder-menu.png`);
  await app.click(".menulist.ctx button", "Colour");
  await app.click(".menulist.ctx button", "Purple");
  await app.sleep(800);
  assert(folders().colors?.Box === "#8932b8", `colour saved: ${JSON.stringify(folders().colors)}`);
  assert(await app.eval<boolean>(`(() => { const s = [...document.querySelectorAll(".foldertile")].find((t) => t.textContent.includes("Box")).querySelector(".slot"); return getComputedStyle(s).color === "rgb(137, 50, 184)"; })()`), "the tile shows the colour");
  await app.shot(`${OUT}/folder-colour.png`);

  // Rename keeps the colour.
  await rightClick(app, "Box");
  await app.click(".menulist.ctx button", "Rename");
  await app.setValue(".foldername", "Kutu");
  await app.key("Enter");
  await app.sleep(800);
  assert(folders().folders.includes("Kutu") && folders().colors?.Kutu === "#8932b8" && !folders().colors?.Box, `rename carries the colour: ${JSON.stringify(folders())}`);

  // Element menu and move.
  const first = await app.eval<string>(`document.querySelector(".tile:not(.foldertile) .tname").textContent`);
  await rightClick(app, first);
  assert((await menu(app)).join("|") === "Edit|Duplicate|Rename|Usages|Lock generated code|Move|New task for the agent...|Delete", `element menu: ${(await menu(app)).join("|")}`);
  await app.shot(`${OUT}/element-menu.png`);
  await app.click(".menulist.ctx button", "Move");
  assert((await menu(app)).join("|") === "Top of the project|Kutu|Other", `move list: ${(await menu(app)).join("|")}`);
  await app.shot(`${OUT}/element-move.png`);
  await app.click(".menulist.ctx button", "Other");
  await app.sleep(800);
  assert(Object.values(folders().placement).includes("Other"), "the element moved into Other");

  // Folder move: Kutu goes inside Other; its colour follows.
  await rightClick(app, "Kutu");
  await app.click(".menulist.ctx button", "Move");
  await app.click(".menulist.ctx button", "Other");
  await app.sleep(800);
  assert(folders().folders.includes("Other/Kutu") && folders().colors?.["Other/Kutu"] === "#8932b8", `folder moved with its colour: ${JSON.stringify(folders())}`);

  // MCP sets and clears a colour.
  const mcp = await connect(project);
  try {
    await mcp.call("edit_folder", { action: "color", path: "Other", color: "#ff8800" });
    assert(folders().colors?.Other === "#ff8800", "MCP sets the colour");
    await app.sleep(2500);
    assert(await app.eval<boolean>(`getComputedStyle([...document.querySelectorAll(".foldertile")].find((t) => t.textContent.includes("Other")).querySelector(".slot")).color === "rgb(255, 136, 0)"`), "the editor shows the MCP colour");
    await app.shot(`${OUT}/mcp-colour.png`);
    await mcp.call("edit_folder", { action: "color", path: "Other", color: "" });
    assert(!folders().colors?.Other, "MCP clears the colour");
  } finally {
    await mcp.close();
  }

  // Delete from the menu: the nested folder's colour goes up with it.
  await app.sleep(2500);
  await rightClick(app, "Other");
  await app.click(".menulist.ctx button", "Delete");
  await app.sleep(800);
  assert(!folders().folders.includes("Other") && folders().folders.includes("Kutu") && folders().colors?.Kutu === "#8932b8", `deleted, children moved up: ${JSON.stringify(folders())}`);
}, { project });
