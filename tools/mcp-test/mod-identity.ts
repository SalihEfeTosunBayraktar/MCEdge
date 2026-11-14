/**
 * KUYRUK 121: changing the mod id and package over MCP. change_mod_identity reports with dryRun and then rewrites ids
 * and translation keys; update_mod with a new id goes through the same rewrite instead of only editing mcedge.json.
 *   node tools/mcp-test/mod-identity.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const read = (path: string) => JSON.parse(readFileSync(join(project, path), "utf8"));
const mcp = await connect(project);
try {
  assert(mcp.tools.includes("change_mod_identity"), "change_mod_identity is listed");
  const dry = await mcp.call("change_mod_identity", { modId: "rubymod", package: "dev.ruby.mod", dryRun: true });
  assert(dry.applied === false && dry.keysRenamed === 4 && read("mcedge.json").mod.id === "hellomcedge", `dry run only reports: ${JSON.stringify(dry)}`);
  const bad = await mcp.call("change_mod_identity", { modId: "Bad Id" }, true);
  assert(String(bad).includes("not a valid mod id"), `invalid id refused: ${bad}`);
  const done = await mcp.call("change_mod_identity", { modId: "rubymod", package: "dev.ruby.mod" });
  assert(done.applied && read("mcedge.json").mod.id === "rubymod" && "item.rubymod.ruby" in read("localization/tr_tr.json"), `applied: ${JSON.stringify(done)}`);
  // update_mod with a new id renames the keys too.
  const updated = await mcp.call("update_mod", { id: "gemmod", version: "0.3.0" });
  assert(updated.mod.id === "gemmod" && updated.mod.version === "0.3.0" && "item.gemmod.ruby" in read("localization/tr_tr.json"), `update_mod rewrites: ${JSON.stringify(updated.mod)}`);
  console.log("PASS");
} finally {
  await mcp.close();
}
