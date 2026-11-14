/**
 * KUYRUK #18: an element deleted on disk while its editor is open is never written back silently.
 * Without unsaved edits the editor closes and says why; with unsaved edits the user picks Restore or Discard.
 * Screenshots go to design/live-coediting/.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const OUT = "design/live-coediting";
const file = (folder: string, id: string) => join(project, "elements", folder, `${id}.json`);
const openTile = async (app: App, name: string, type = "") => {
  await app.click(".rtab", "Mod elements");
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === ${JSON.stringify(name)} && t.querySelector(".ttype").textContent.includes(${JSON.stringify(type)})).id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === ${JSON.stringify(name)}`);
};

await run(async (app) => {
  const mcp = await connect(project);
  try {
    // No unsaved edits: the editor closes and says why.
    await openTile(app, "Ruby Apple");
    await mcp.call("delete_element", { type: "item", id: "ruby_apple" });
    await app.waitFor(`document.querySelector(".dialog")?.textContent.includes("no unsaved changes")`, 10000);
    assert(!(await app.eval<boolean>(`!!document.querySelector(".edname")`)), "editor closed");
    await app.click(".dialog .abtn", "Close");
    await app.sleep(800);
    assert(!existsSync(file("items", "ruby_apple")), "nothing written back");

    // Unsaved edits, Discard: the file stays deleted.
    await openTile(app, "Ruby");
    await app.click(".ltab", "Properties");
    await app.setField("Display name", "Ruby (edited)");
    rmSync(file("items", "ruby"));
    await app.waitFor(`document.querySelector(".dialog")?.textContent.includes("Restore it with your changes")`, 10000);
    await app.sleep(1000);
    assert(!existsSync(file("items", "ruby")), "unsaved edits are not written back while the user decides");
    await app.shot(`${OUT}/deleted-while-open-dark.png`);
    await app.click(".themebtn");
    await app.key("Escape");
    assert(await app.eval<boolean>(`!!document.querySelector(".dialog")`), "an outside click or Escape does not discard the user's changes");
    await app.click(".dialog .abtn", "Discard my changes");
    await app.waitFor(`!document.querySelector(".edname")`);
    await app.sleep(800);
    assert(!existsSync(file("items", "ruby")), "Discard keeps it deleted");

    // Unsaved edits, Restore: the element comes back with the user's changes.
    await openTile(app, "Ruby Pickaxe", "Tool");
    await app.click(".ltab", "Properties");
    await app.setField("Display name", "Ruby Pickaxe (kept)");
    await app.setTheme("light");
    rmSync(file("tools", "ruby_pickaxe"));
    await app.waitFor(`document.querySelector(".dialog")`, 10000);
    await app.shot(`${OUT}/deleted-while-open-light.png`);
    await app.click(".dialog .abtn", "Restore with my changes");
    await app.waitFor(`!document.querySelector(".dialog")`);
    await app.sleep(1000);
    await app.waitFor(`!document.querySelector(".smsg.saving")`);
    assert(existsSync(file("tools", "ruby_pickaxe")) && readFileSync(file("tools", "ruby_pickaxe"), "utf8").includes("Ruby Pickaxe (kept)"), "Restore writes the element back with the user's changes");
  } finally {
    await mcp.close();
  }
}, { project });
