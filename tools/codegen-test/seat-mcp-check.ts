// Q225, Q226: seatable blocks and multi-blocks through a real stdio MCP connection, on a copy of the codegen test project:
// element_type_schema lists the Seat fields and multiBlock, update_element makes a block two cells wide with a sitting and
// a lying seat, procedure_blocks lists the seat blocks, and the generator writes the block (seats, cells) into seats.json. usage: node tools/codegen-test/seat-mcp-check.ts
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "../..");
const base = mkdtempSync(join(tmpdir(), "mcedge-seat-mcp-"));
const dir = join(base, "p");
cpSync(join(import.meta.dirname, "project"), dir, { recursive: true, filter: (from) => !from.includes(`${join("project", "out")}`) });
const client = new Client({ name: "mcedge-seat-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "mcp", dir], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join("\n");
  assert.ok(!r.isError, `${name}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
try {
  const schema = JSON.stringify(await call("element_type_schema", { type: "block" }));
  for (const key of ["seatable", "seatHeightMode", "seats", "seatEmptyHand", "seatDismount", "yaw", "pose", "multiBlock"]) assert.ok(schema.includes(`"${key}"`), `schema has ${key}`);

  const updated = await call("update_element", { type: "block", id: "ruby_tip_block", values: {
    seatable: true, seats: [{ x: 4, y: 0, z: 8, yaw: 0, pose: "sit" }, { x: 16, y: 0, z: 8, yaw: 90, pose: "lie" }],
    multiBlock: true, boundingBoxes: [{ mx: 0, my: 0, mz: 0, Mx: 32, My: 8, Mz: 16, subtract: false }],
  } });
  assert.equal(updated.element.seatable, true);
  assert.deepEqual(updated.issues, []);

  const blocks = await call("procedure_blocks", { category: "entity" });
  const ids = (blocks.blocks ?? blocks).map((b: { id: string }) => b.id);
  for (const id of ["entity_sit_on_block", "entity_is_sitting", "entity_stand_up"]) assert.ok(ids.includes(id), `${id} is listed: ${ids}`);

  await call("regenerate_code", { engines: ["neoforge-1.21.5"] });
  const data = JSON.parse(readFileSync(join(dir, "out/neoforge-1.21.5/src/main/resources/data/wavethree/seats.json"), "utf8"));
  // Automatic height: both seats on the slab-high box, 0.5 blocks; the second turned to 90 and lying; two cells east-west.
  assert.deepEqual(data["wavethree:ruby_tip_block"].seats, [[0.25, 0.5, 0.5, 0, 0], [1, 0.5, 0.5, 90, 1]]);
  assert.deepEqual(data["wavethree:ruby_tip_block"].cells, [[0, 0, 0], [1, 0, 0]]);
  assert.equal(data["wavethree:ruby_chair"].seats[0][1], 0.5);
  console.log("PASS seat MCP: element_type_schema Seat fields and multiBlock, update_element, procedure_blocks seat blocks, seats.json with cells");
} finally {
  await client.close();
  rmSync(base, { recursive: true, force: true });
}
