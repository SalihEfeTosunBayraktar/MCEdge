/**
 * KUYRUK 177: folders of Resources > Textures over MCP, on a copy of examples/hello: create (with parents), move
 * textures in and out, rename (placements follow), remove (textures go up), list counts; texture files never move.
 *   node tools/mcp-test/texture-folders.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const stored = () => JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string> };
const mcp = await connect(project);
try {
  const empty = await mcp.call("texture_folders");
  assert(empty.folders.length === 0 && empty.unfiled === 4, `nothing filed yet: ${JSON.stringify(empty)}`);
  await mcp.call("texture_folders", { action: "create", path: "Gems/Ruby" });
  assert(stored().folders.join() === "Gems,Gems/Ruby", `parents made: ${stored().folders}`);
  await mcp.call("texture_folders", { action: "move", textures: ["textures/ruby.png", "textures/ruby_block.png"], folder: "Gems/Ruby" });
  await mcp.call("texture_folders", { action: "move", textures: ["textures/ruby_apple.png"], folder: "Gems" });
  const bad = await mcp.call("texture_folders", { action: "move", textures: ["textures/nope.png"], folder: "Gems" }, true);
  assert(String(bad).includes("no project texture"), `unknown texture refused: ${bad}`);
  const listed = await mcp.call("texture_folders");
  assert(JSON.stringify(listed.folders) === JSON.stringify([{ path: "Gems", textures: 1, total: 3 }, { path: "Gems/Ruby", textures: 2, total: 2 }]) && listed.unfiled === 1,
    `counts: ${JSON.stringify(listed)}`);
  await mcp.call("texture_folders", { action: "rename", path: "Gems/Ruby", name: "Red" });
  assert(stored().placement["textures/ruby.png"] === "Gems/Red", `placement follows the rename: ${JSON.stringify(stored())}`);
  await mcp.call("texture_folders", { action: "remove", path: "Gems/Red" });
  assert(stored().placement["textures/ruby.png"] === "Gems" && !stored().folders.includes("Gems/Red"), `textures go up: ${JSON.stringify(stored())}`);
  await mcp.call("texture_folders", { action: "move", textures: ["textures/ruby.png"], folder: "" });
  assert(!("textures/ruby.png" in stored().placement), "taken out of every folder");
  assert(existsSync(join(project, "textures/ruby.png")), "the file stays where it was");
  console.log("PASS");
} finally {
  await mcp.close();
}
