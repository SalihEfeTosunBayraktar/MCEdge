// Bulk folder work through a real stdio MCP connection on a 900-element project: edit_folder creates parents and answers
// briefly, list_folders summarises, move_to_folder takes a pattern. usage: node tools/codegen-test/folders-mcp-check.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildBigProject } from "./big-fixture.ts";

const root = join(import.meta.dirname, "../..");
const base = mkdtempSync(join(tmpdir(), "mcedge-folders-"));
const dir = join(base, "p");
buildBigProject(dir);
const client = new Client({ name: "mcedge-folders-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "mcp", dir], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join("\n");
  return { error: !!r.isError, text, json: r.isError ? undefined : JSON.parse(text) };
};
const state = () => JSON.parse(readFileSync(join(dir, "folders.json"), "utf8")) as { folders: string[]; placement: Record<string, string> };
try {
  // list_folders: a summary by default, the full placement on request.
  const summary = await call("list_folders");
  assert.ok(summary.text.length < 1500, `summary is ${summary.text.length} characters`);
  assert.deepEqual(summary.json.folders.map((f: { path: string; elements: number; total: number }) => [f.path, f.elements, f.total]), [["Logic", 100, 200], ["Logic/Jobs", 100, 100], ["Shop", 50, 50]]);
  assert.equal(summary.json.unfiled, 900 - 250);
  const full = await call("list_folders", { full: true });
  assert.equal(Object.keys(full.json.placement).length, 250);
  assert.ok(full.text.length > 10 * summary.text.length, "the full placement is the large answer");
  const part = (await call("list_folders", { path: "Logic" })).json;
  assert.deepEqual(part.folders.map((f: { path: string }) => f.path), ["Logic", "Logic/Jobs"]);
  assert.ok(!("unfiled" in part));
  assert.equal(Object.keys((await call("list_folders", { path: "Logic/Jobs", full: true })).json.placement).length, 100);
  assert.match((await call("list_folders", { path: "Nowhere" })).text, /no folder/);

  // edit_folder: parents are created and the answer is short.
  const made = await call("edit_folder", { action: "create", path: "Economy/Shops/Old" });
  assert.deepEqual(made.json, { action: "create", created: ["Economy", "Economy/Shops", "Economy/Shops/Old"], folders: 6 });
  assert.deepEqual((await call("edit_folder", { action: "create", path: "Economy/Banks" })).json.created, ["Economy/Banks"], "only the missing parents");
  assert.match((await call("edit_folder", { action: "create", path: "Economy/Banks" })).text, /exists/);
  assert.ok((await call("edit_folder", { action: "create", path: "Bad//Path" })).error);
  assert.ok(!state().folders.includes("Bad"), "a bad path creates nothing");
  const renamed = (await call("edit_folder", { action: "rename", path: "Economy/Banks", name: "Vaults" })).json;
  assert.deepEqual([renamed.renamedTo, "placement" in renamed], ["Economy/Vaults", false]);

  // move_to_folder: by pattern, by type, by query, from a folder; dryRun and refusals.
  const dry = (await call("move_to_folder", { folder: "Economy/Shops", pattern: "item_0*", dryRun: true })).json;
  assert.deepEqual([dry.dryRun, dry.moved, dry.alreadyThere], [true, 100, 0]);
  assert.equal(Object.keys(state().placement).length, 250, "dryRun moved nothing");
  const byPattern = (await call("move_to_folder", { folder: "Economy/Shops", pattern: "item_0*" })).json;
  assert.deepEqual([byPattern.moved, byPattern.alreadyThere, byPattern.sample.length, byPattern.more], [100, 0, 10, 90]);
  assert.equal(state().placement["item/item_050"], "Economy/Shops");
  assert.equal(state().placement["item/item_100"], "Shop", "outside the pattern, left alone");
  const again = (await call("move_to_folder", { folder: "Economy/Shops", pattern: "item_0*" })).json;
  assert.deepEqual([again.moved, again.alreadyThere], [0, 100]);
  assert.equal((await call("move_to_folder", { folder: "Economy/Shops/Old", type: "block" })).json.moved, 100, "a whole type");
  assert.equal((await call("move_to_folder", { folder: "Economy/Vaults", type: "procedure", query: "proc_59" })).json.moved, 10, "type and query together");
  assert.equal((await call("move_to_folder", { folder: "", from: "Logic" })).json.moved, 197, "from a folder to the top (3 of the 200 left for Vaults above)");
  assert.equal(Object.values(state().placement).filter((f) => f.startsWith("Logic")).length, 0);
  assert.equal((await call("move_to_folder", { folder: "Shop", pattern: "PROC_5?0" })).json.moved, 10, "the pattern ignores case");
  const listed = await call("move_to_folder", { folder: "Shop", elements: [{ type: "block", id: "block_001" }, { type: "item", id: "item_100" }] });
  assert.deepEqual([listed.json.moved, listed.json.alreadyThere], [1, 1], "explicit elements still work");
  assert.match((await call("move_to_folder", { folder: "Shop" })).text, /give elements or a selector/);
  assert.match((await call("move_to_folder", { folder: "Shop", pattern: "x", elements: [{ type: "item", id: "item_001" }] })).text, /not both/);
  assert.match((await call("move_to_folder", { folder: "Nowhere", pattern: "*" })).text, /no folder/);
  assert.match((await call("move_to_folder", { folder: "Shop", from: "Nowhere" })).text, /no folder/);
  assert.match((await call("move_to_folder", { folder: "Shop", elements: [{ type: "item", id: "ghost" }] })).text, /no item/);
  assert.match((await call("move_to_folder", { folder: "Shop", type: "nonsense" })).text, /unknown element type/);
  console.log("folders-mcp-check OK");
} finally {
  await client.close();
  rmSync(base, { recursive: true, force: true });
}
