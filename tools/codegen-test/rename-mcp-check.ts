// rename_element through a real stdio MCP connection on a throwaway project.
// usage: node tools/codegen-test/rename-mcp-check.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildRefsProject, fingerprint } from "./refs-fixture.ts";

const root = join(import.meta.dirname, "../..");
const dir = join(mkdtempSync(join(tmpdir(), "mcedge-refs-mcp-")), "p");
buildRefsProject(dir);
const client = new Client({ name: "mcedge-refs-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "mcp", dir], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join("\n");
  return { error: !!r.isError, text, json: r.isError ? undefined : JSON.parse(text) };
};
try {
  assert.ok((await client.listTools()).tools.some((t) => t.name === "rename_element"), "rename_element is not offered");
  const before = fingerprint(dir);
  const preview = (await call("rename_element", { type: "item", id: "gem_item", newId: "jewel", dryRun: true })).json;
  assert.equal(preview.dryRun, true);
  assert.equal(fingerprint(dir), before, "dryRun wrote files");
  assert.ok(preview.referencesChanged === 6 && preview.renamedKeys === 2 && preview.tagsChanged && preview.datapackFiles.length === 0 && preview.warnings.length === 1, "the datapack id is also a recipe id, so it is reported, not changed");
  const clash = await call("rename_element", { type: "item", id: "gem_item", newId: "ruby_block" });
  assert.ok(clash.error && /already used/.test(clash.text));
  assert.equal(fingerprint(dir), before, "a refused rename wrote files");

  const done = (await call("rename_element", { type: "item", id: "gem_item", newId: "jewel" })).json;
  assert.equal(done.to, "jewel");
  assert.ok(existsSync(join(dir, "elements/items/jewel.json")) && !existsSync(join(dir, "elements/items/gem_item.json")));
  const after = (await call("find_references", { type: "item", id: "jewel" })).json;
  assert.equal(after.folder, "Econ");
  assert.equal(after.usedBy.total, preview.referencesChanged, "same places before and after");
  assert.ok((await call("find_references", { type: "item", id: "gem_item" })).error, "the old id is gone");
  console.log("rename-mcp-check OK");
} finally {
  await client.close();
  rmSync(join(dir, ".."), { recursive: true, force: true });
}
