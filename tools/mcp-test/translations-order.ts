/**
 * KUYRUK #107: set_translations keeps a language file's key order and appends new keys at the end, so a small edit is
 * a small diff. Writes an unsorted lang file into a copy of the example, changes one key, removes one and adds one
 * over MCP, and checks the file line by line.
 *   node tools/mcp-test/translations-order.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const file = join(project, "localization", "de_de.json");
const before = { "item.hellomcedge.ruby": "Rubin", "block.hellomcedge.ruby_block": "Rubinblock", "zz.last": "Z", "aa.first": "A", "item.hellomcedge.ruby_apple": "Rubinapfel" };
writeFileSync(file, JSON.stringify(before, null, 2) + "\n");
const mcp = await connect(project);
try {
  await mcp.call("set_translations", { language: "de_de", entries: { "zz.last": "Zett", "aa.first": null, "new.key": "Neu", "another.new": "Noch" } });
} finally {
  await mcp.close();
}
const after = readFileSync(file, "utf8");
const keys = Object.keys(JSON.parse(after));
assert(keys.join() === ["item.hellomcedge.ruby", "block.hellomcedge.ruby_block", "zz.last", "item.hellomcedge.ruby_apple", "new.key", "another.new"].join(),
  `existing order kept, removed key gone, new keys appended in the given order: ${keys}`);
const oldLines = (JSON.stringify(before, null, 2) + "\n").split("\n"), newLines = after.split("\n");
// Lines not in the old file: the changed value, the old last line (now with a comma) and the two new keys.
const changed = newLines.filter((l) => !oldLines.includes(l)).length;
assert(changed === 4, `only the edited lines are new (${changed}):\n${after}`);
console.log("PASS");
