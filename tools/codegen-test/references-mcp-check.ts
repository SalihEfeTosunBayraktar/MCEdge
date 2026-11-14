// find_references and unused_elements through a real stdio MCP connection on a throwaway project.
// usage: node tools/codegen-test/references-mcp-check.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildRefsProject } from "./refs-fixture.ts";

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
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const name of ["find_references", "unused_elements"]) assert.ok(tools.includes(name), `${name} is not offered`);

  const refs = (await call("find_references", { type: "procedure", id: "p_helper" })).json;
  assert.equal(refs.unused, false);
  assert.ok(refs.usedBy.total === 4 && refs.usedBy.shown.some((g: { element: string; form: string }) => g.element === "gui/shop" && g.form === "procedure_field"));
  assert.equal(refs.uses.total, 0, "a self call is not listed as a use");
  assert.equal((await call("find_references", { type: "procedure", id: "p_unused" })).json.unused, true);
  assert.equal((await call("find_references", { type: "procedure", id: "p_main" })).json.unused, false, "the global trigger runs it");
  const bad = await call("find_references", { type: "procedure", id: "ghost" });
  assert.ok(bad.error && /no procedure/.test(bad.text));

  const unused = (await call("unused_elements")).json;
  assert.deepEqual(unused.unused.map((u: { id: string }) => u.id).sort(), ["p_chain_a", "p_unused"]);
  assert.equal(unused.summary.procedure.total, 6);
  assert.deepEqual((await call("unused_elements", { transitive: true })).json.unused.map((u: { id: string }) => u.id).sort(), ["p_chain_a", "p_chain_b", "p_unused"]);
  assert.ok((await call("unused_elements", { types: ["nonsense"] })).error);
  assert.equal((await call("unused_elements", { limit: 1 })).json.unused.length, 1);

  console.log("references-mcp-check OK");
} finally {
  await client.close();
  rmSync(join(dir, ".."), { recursive: true, force: true });
}
