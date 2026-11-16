// Q227: radial menus through a real stdio MCP connection, on a copy of the codegen test project: the generic element
// tools create, read and update a radial_menu, procedure_blocks lists the radial blocks, procedure_triggers the "slice
// chosen" trigger, find_references sees a procedure and a menu opening a menu, and the generator writes the new menu
// into radial_menus.json. usage: node tools/codegen-test/radial-mcp-check.ts
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "../..");
const base = mkdtempSync(join(tmpdir(), "mcedge-radial-mcp-"));
const dir = join(base, "p");
cpSync(join(import.meta.dirname, "project"), dir, { recursive: true, filter: (from) => !from.includes(`${join("project", "out")}`) });
const client = new Client({ name: "mcedge-radial-test", version: "1.0.0" });
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
  assert.match(JSON.stringify(await call("list_element_types")), /"radial_menu"/);
  assert.match(JSON.stringify(await call("element_type_schema", { type: "radial_menu" })), /conditionMode/);

  // List rows carry every one of their fields, as for any list field.
  const slice = (values: Record<string, unknown>) => ({ description: "", condition: "", conditionMode: "hidden", ...values });
  const tabs = [{ id: "main", label: "Main", source: "list", slices: [
    slice({ id: "trade", label: "Trade", iconKind: "item", item: "minecraft:emerald", action: "command", command: "/trade" }),
    slice({ id: "back", label: "Back", iconKind: "none", action: "menu", menu: "small" }),
  ] }];
  const created = await call("create_element", { type: "radial_menu", id: "quick", values: { title: "Quick", tabs } });
  assert.equal(created.element.title, "Quick");
  assert.equal(created.element.size, 160, "type defaults fill the rest");
  assert.deepEqual(created.issues, []);
  const updated = await call("update_element", { type: "radial_menu", id: "quick", values: { openMode: "toggle", size: 200, appear: ["fade", "slide_down"] } });
  assert.equal(updated.element.size, 200);
  assert.equal((await call("read_element", { type: "radial_menu", id: "quick" })).openMode, "toggle");

  const blocks = await call("procedure_blocks", { category: "gui" });
  const open = (blocks.blocks ?? blocks).find((b: { id: string }) => b.id === "radial_open");
  assert.ok(open, "radial_open is listed");
  assert.deepEqual(open.fields.map((f: { name: string; registry?: string }) => [f.name, f.registry]), [["menu", "radial_menu_element"]]);
  for (const id of ["radial_close", "radial_set_slice"]) assert.ok((blocks.blocks ?? blocks).some((b: { id: string }) => b.id === id), `${id} is listed`);
  const bubbles = await call("procedure_blocks", { category: "bubbles" });
  assert.ok((bubbles.blocks ?? bubbles).some((b: { id: string }) => b.id === "runtime_image_bubble"), "runtime_image_bubble is listed");
  assert.match(JSON.stringify(await call("procedure_triggers")), /radial_slice_chosen/);

  const refs = JSON.stringify(await call("find_references", { type: "radial_menu", id: "small" }));
  assert.match(refs, /quick/, "the menu opening small refers to it");
  assert.match(JSON.stringify(await call("find_references", { type: "radial_menu", id: "wheel" })), /radial_blocks/, "the procedure opening wheel refers to it");

  await call("regenerate_code", { engines: ["neoforge-1.21.5"] });
  const data = JSON.parse(readFileSync(join(dir, "out/neoforge-1.21.5/src/main/resources/assets/wavethree/radial_menus.json"), "utf8"));
  assert.equal(data.menus.quick.size, 200);
  assert.equal(data.menus.quick.mode, "toggle");
  assert.deepEqual(data.menus.quick.tabs[0].slices.map((s: { id: string; action: { kind: string } }) => [s.id, s.action.kind]), [["trade", "command"], ["back", "menu"]]);
  console.log("PASS radial MCP: create/read/update radial_menu, radial blocks and trigger, find_references, radial_menus.json");
} finally {
  await client.close();
  rmSync(base, { recursive: true, force: true });
}
