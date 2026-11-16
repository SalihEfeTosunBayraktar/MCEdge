/**
 * Q211: managing nested texture folders over MCP, on a copy of examples/hello with two extra textures: colour and icon,
 * move_folder, many textures moved at once, remove keeping the contents, and remove with deleteContents (a dry run
 * first; the unused file goes, the one an element uses stays and moves up). Element references never change.
 *   node tools/mcp-test/texture-folders-manage.ts
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
for (const n of ["a", "b"]) copyFileSync(join(project, "textures/ruby.png"), join(project, `textures/gem_${n}.png`));
const stored = () => JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string>; colors?: Record<string, string>; icons?: Record<string, string> };
const mcp = await connect(project);
try {
  await mcp.call("texture_folders", { action: "create", path: "Gems/Red" });
  await mcp.call("texture_folders", { action: "color", path: "Gems/Red", color: "#B02E26" });
  await mcp.call("texture_folders", { action: "icon", path: "Gems/Red", icon: "gem" });
  const bad = await mcp.call("texture_folders", { action: "icon", path: "Gems/Red", icon: "nope" }, true);
  assert(String(bad).includes("bad icon"), `bad icon refused: ${bad}`);
  const nothing = await mcp.call("texture_folders", { action: "color", path: "Nope", color: "#b02e26" }, true);
  assert(String(nothing).includes('no folder "Nope"'), `unknown folder refused: ${nothing}`);
  assert(stored().colors?.["Gems/Red"] === "#b02e26" && stored().icons?.["Gems/Red"] === "gem", `decor: ${JSON.stringify(stored())}`);
  // Many textures at once, one of them used by an element.
  const moved = await mcp.call("texture_folders", { action: "move", textures: ["textures/gem_a.png", "textures/gem_b.png", "textures/ruby.png"], folder: "Gems/Red" });
  assert(moved.moved === 3, `moved: ${JSON.stringify(moved)}`);
  const listed = await mcp.call("texture_folders");
  assert(JSON.stringify(listed.folders) === JSON.stringify([{ path: "Gems", textures: 0, total: 3 }, { path: "Gems/Red", textures: 3, total: 3, color: "#b02e26", icon: "gem" }]), `list: ${JSON.stringify(listed)}`);
  // A folder into another, decor and placements follow.
  await mcp.call("texture_folders", { action: "create", path: "Archive" });
  await mcp.call("texture_folders", { action: "move_folder", path: "Gems", folder: "Archive" });
  assert(stored().placement["textures/gem_a.png"] === "Archive/Gems/Red" && stored().colors?.["Archive/Gems/Red"] === "#b02e26", `move_folder: ${JSON.stringify(stored())}`);
  // Remove keeping the contents: they go up to the parent.
  await mcp.call("texture_folders", { action: "remove", path: "Archive/Gems/Red" });
  assert(stored().placement["textures/gem_a.png"] === "Archive/Gems" && !stored().colors, `keep: ${JSON.stringify(stored())}`);
  await mcp.call("texture_folders", { action: "move", textures: ["textures/gem_a.png", "textures/gem_b.png", "textures/ruby.png"], folder: "Archive" });
  // Remove with the contents: a dry run first.
  const dry = await mcp.call("texture_folders", { action: "remove", path: "Archive", deleteContents: true, dryRun: true });
  assert(dry.wouldDelete.length === 2 && dry.kept.join() === "textures/ruby.png" && existsSync(join(project, "textures/gem_a.png")), `dry run: ${JSON.stringify(dry)}`);
  const done = await mcp.call("texture_folders", { action: "remove", path: "Archive", deleteContents: true });
  assert(done.deleted.length === 2 && done.kept.join() === "textures/ruby.png", `remove: ${JSON.stringify(done)}`);
  assert(!existsSync(join(project, "textures/gem_a.png")) && !existsSync(join(project, "textures/gem_b.png")), "unused files deleted");
  assert(existsSync(join(project, "textures/ruby.png")), "the used texture stays");
  assert(!stored().folders.length && !("textures/ruby.png" in stored().placement), `all gone: ${JSON.stringify(stored())}`);
  const item = JSON.parse(readFileSync(join(project, "elements/items/ruby.json"), "utf8"));
  assert(item.texture === "textures/ruby.png", "the element still points at its texture");
  console.log("PASS");
} finally {
  await mcp.close();
}
