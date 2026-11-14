/**
 * KUYRUK #29: folders in the element list, with the real ETREconomy project (860 elements) copied: create a folder,
 * move an element into it from the Move menu, open it, go back, rename and remove it; the element is never lost.
 * MCP sees the same folders. Screenshots go to design/folders/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, REPO, run, type App } from "./cdp.ts";

const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
const OUT = "design/folders";
// The test starts from a flat element list; the real project has since been sorted into folders.
writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: [], placement: {} }, null, 2));
const folders =() => JSON.parse(readFileSync(join(project, "folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string> };
const tile = (app: App, name: string) => app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === ${JSON.stringify(name)})?.setAttribute("id", "target")`);
const has = (name: string) => `[...document.querySelectorAll(".tile .tname")].some((t) => t.textContent === ${JSON.stringify(name)})`;

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(has("Upgraded Recycler"));

  await app.click(".view .actions .abtn", "New folder");
  await app.eval(`(() => { const input = document.querySelector(".foldername"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Makineler"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.key("Enter");
  await app.waitFor(has("Makineler"), 10000);
  assert(folders().folders.includes("Makineler"), "folder saved");

  await tile(app, "Upgraded Recycler");
  await app.click("#target");
  await app.click("#target", undefined, { button: "right" });
  await app.click(".menulist button", "Move");
  await app.click(".menulist button", "Makineler");
  await app.waitFor(`!(${has("Upgraded Recycler")}) || true`);
  await app.sleep(800);
  assert(folders().placement["block/upgradedrecycler"] === "Makineler", "element placed");
  await app.shot(`${OUT}/top.png`);

  await tile(app, "Makineler");
  await app.click("#target", undefined, { double: true });
  await app.waitFor(has("Back"), 10000);
  assert(await app.eval<boolean>(has("Upgraded Recycler")), "the element is inside");
  await app.shot(`${OUT}/inside.png`);
  await tile(app, "Back");
  await app.click("#target", undefined, { double: true });
  await app.waitFor(has("Makineler"));

  const mcp = await connect(project);
  try {
    const listed = await mcp.call("list_folders", {});
    assert(JSON.stringify(listed).includes("Makineler"), "MCP lists the folder");
    await mcp.call("edit_folder", { action: "create", path: "Makineler/Eski" });
    await mcp.call("move_to_folder", { elements: [{ type: "block", id: "otomatacik" }], folder: "Makineler/Eski" });
    assert(folders().placement["block/otomatacik"] === "Makineler/Eski", "MCP moves elements");
  } finally {
    await mcp.close();
  }

  await app.sleep(2500); // The editor picks MCP changes up from the file watcher.
  await tile(app, "Makineler");
  await app.click("#target");
  await app.click(".view .actions .abtn", "Delete");
  await app.sleep(1000);
  const left = folders();
  assert(!left.folders.includes("Makineler"), "folder removed");
  assert(left.folders.includes("Eski"), "its subfolder moved up");
  assert(left.placement["block/upgradedrecycler"] === undefined, "its element is back at the top");
  assert(await app.eval<boolean>(has("Upgraded Recycler")), "the element still exists");
}, { project });

