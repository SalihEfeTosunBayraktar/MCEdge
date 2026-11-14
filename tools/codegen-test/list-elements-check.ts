// list_elements on a project of 900 elements through a real stdio MCP connection: the default page stays small, the
// filters (type, query, folder) and paging work, and each result carries its folder.
// usage: node tools/codegen-test/list-elements-check.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildBigProject } from "./big-fixture.ts";

const root = join(import.meta.dirname, "../..");
const base = mkdtempSync(join(tmpdir(), "mcedge-list-"));
const dir = join(base, "p");
buildBigProject(dir);

const client = new Client({ name: "mcedge-list-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "mcp", dir], cwd: root }));
const call = async (args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name: "list_elements", arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join("\n");
  return { error: !!r.isError, text, json: r.isError ? undefined : JSON.parse(text) };
};
try {
  const first = await call();
  assert.ok(first.text.length < 25_000, `default page is ${first.text.length} characters`);
  assert.equal(first.json.total, 900);
  assert.equal(first.json.elements.length, 100);
  assert.equal(first.json.next, 100);
  assert.deepEqual(Object.keys(first.json.elements[0]).sort(), ["folder", "id", "name", "type"]);
  const procs = (await call({ type: "procedure" })).json.elements;
  assert.equal(procs.find((e: { id: string }) => e.id === "proc_000").folder, "Logic/Jobs", "each result carries its folder");
  assert.equal(procs.find((e: { id: string }) => e.id === "proc_003").folder, "Logic");
  assert.equal(procs.find((e: { id: string }) => e.id === "proc_001").folder, "", "an unfiled element has an empty folder");

  // Paging reaches every element exactly once and the last page has no next.
  const seen = new Set<string>();
  for (let offset = 0, page = await call({ limit: 250 }); ; page = await call({ limit: 250, offset })) {
    for (const e of page.json.elements) seen.add(`${e.type}/${e.id}`);
    if (page.json.next === undefined) break;
    offset = page.json.next;
  }
  assert.equal(seen.size, 900);

  assert.equal((await call({ type: "item" })).json.total, 200);
  const byName = await call({ query: "ruby sword" });
  assert.deepEqual(byName.json.elements.map((e: { id: string }) => e.id), ["item_007"], "query matches the display name");
  assert.equal((await call({ query: "PROC_00" })).json.total, 10, "query matches ids without case");
  assert.equal((await call({ type: "procedure", query: "proc_1" })).json.total, 100);

  const logic = await call({ folder: "Logic", limit: 500 });
  assert.equal(logic.json.total, 200, "a folder includes its subfolders");
  const jobs = await call({ folder: "Logic/Jobs", limit: 500 });
  assert.equal(jobs.json.total, 100);
  assert.ok(jobs.json.elements.every((e: { folder: string }) => e.folder === "Logic/Jobs"));
  assert.equal((await call({ folder: "", limit: 500 })).json.total, 900 - 200 - 50, "\"\" is the elements in no folder");
  assert.equal((await call({ folder: "Logic", type: "item" })).json.total, 0, "filters combine");
  assert.match((await call({ folder: "Nowhere" })).text, /no folder/);
  assert.match((await call({ type: "nonsense" })).text, /unknown element type/);
  assert.ok((await call({ limit: 5000 })).error, "limit above 500 is refused");
  console.log(`list-elements-check OK (default page ${first.text.length} characters of 900 elements; a page of 500 ${(await call({ limit: 500 })).text.length})`);
} finally {
  await client.close();
  rmSync(base, { recursive: true, force: true });
}
