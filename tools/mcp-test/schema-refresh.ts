/**
 * KUYRUK #110: a project's schemas/ is brought up to date when it is opened, not by the first unrelated edit. Makes a
 * copy of the example with a stale item schema and project schema, starts the MCP server (which refreshes them), commits,
 * then edits an item over MCP: git sees only the element file. The app does the same on open (git-panel.ts).
 *   node tools/mcp-test/schema-refresh.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { elementJsonSchema, typeRegistry } from "../../src/elements/registry.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const sh = (...args: string[]) => spawnSync("git", args, { cwd: project, encoding: "utf8" }).stdout.trim();
const itemSchema = join(project, "schemas", "elements", "item.schema.json");
writeFileSync(itemSchema, "{ \"stale\": true }\n");
writeFileSync(join(project, "schemas", "project.schema.json"), "{}\n");

let mcp = await connect(project);
await mcp.close();
const current = JSON.stringify(elementJsonSchema(typeRegistry().byId.get("item")!), null, 2) + "\n";
assert(readFileSync(itemSchema, "utf8").replace(/\r\n/g, "\n") === current, "opening the project refreshed the stale item schema");
assert(readFileSync(join(project, "schemas", "project.schema.json"), "utf8").includes("integrations"), "and the project schema");

sh("init", "-q");
sh("-c", "user.email=t@mcedge.dev", "-c", "user.name=t", "add", "-A");
sh("-c", "user.email=t@mcedge.dev", "-c", "user.name=t", "commit", "-q", "-m", "base");
mcp = await connect(project);
try {
  await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
} finally {
  await mcp.close();
}
const changed = sh("status", "--porcelain").split("\n").filter(Boolean);
assert(changed.length === 1 && changed[0].endsWith("elements/items/ruby.json"), `an element edit changes only the element: ${changed}`);
console.log("PASS");
