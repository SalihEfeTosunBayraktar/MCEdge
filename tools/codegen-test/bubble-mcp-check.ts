// Q216: bubble elements through a real stdio MCP connection, on a copy of the codegen test project: the generic element
// tools create, read and update a bubble, procedure_blocks lists the bubble_show block, find_references sees a procedure
// showing the bubble, and the generator writes it into bubbles.json. usage: node tools/codegen-test/bubble-mcp-check.ts
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "../..");
const base = mkdtempSync(join(tmpdir(), "mcedge-bubble-mcp-"));
const dir = join(base, "p");
cpSync(join(import.meta.dirname, "project"), dir, { recursive: true, filter: (from) => !from.includes(`${join("project", "out")}`) });
const client = new Client({ name: "mcedge-bubble-test", version: "1.0.0" });
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
  assert.match(JSON.stringify(await call("list_element_types")), /"bubble"/);
  assert.match(JSON.stringify(await call("element_type_schema", { type: "bubble" })), /backgroundMode/);

  const created = await call("create_element", { type: "bubble", id: "quest_hint", values: { icon: "textures/ruby.png", caption: "Quest: {text}", appear: ["fade"], disappear: ["slide_up"], disappearTicks: 12, disappearEasing: "ease_out", duration: 80 } });
  assert.deepEqual(created.element.appear, ["fade"]);
  assert.equal(created.element.caption, "Quest: {text}");
  assert.equal(created.element.width, 32, "type defaults fill the rest");
  assert.deepEqual(created.issues, []);
  const updated = await call("update_element", { type: "bubble", id: "quest_hint", values: { backgroundMode: "nine_slice", background: "textures/bubble_frame.png", sliceBorder: 4, width: 48 } });
  assert.equal(updated.element.width, 48);
  assert.equal((await call("read_element", { type: "bubble", id: "quest_hint" })).backgroundMode, "nine_slice");

  const blocks = await call("procedure_blocks", { category: "bubbles" });
  const show = (blocks.blocks ?? blocks).find((b: { id: string }) => b.id === "bubble_show");
  assert.ok(show, "bubble_show is listed");
  assert.deepEqual(show.fields.map((f: { name: string; registry?: string }) => [f.name, f.registry]), [["bubble", "bubble_element"]]);
  assert.deepEqual(show.inputs.map((i: { name: string }) => i.name), ["entity", "caption", "duration"]);

  const refs = JSON.stringify(await call("find_references", { type: "bubble", id: "trade_offer" }));
  assert.match(refs, /bubble_designed/, "the procedure showing trade_offer uses it");

  await call("regenerate_code", { engines: ["neoforge-1.21.5"] });
  const data = JSON.parse(readFileSync(join(dir, "out/neoforge-1.21.5/src/main/resources/assets/wavethree/bubbles.json"), "utf8"));
  assert.equal(data.styles.quest_hint.slice, 4);
  assert.equal(data.styles.quest_hint.width, 48);
  assert.equal(data.styles.quest_hint.icon, "wavethree:textures/bubble/quest_hint_icon.png");
  assert.deepEqual(data.styles.quest_hint.timing, { appear: { effects: ["fade"], ticks: 5, easing: "back" }, disappear: { effects: ["slide_up"], ticks: 12, easing: "ease_out" }, active: 80 }, "show / hide timing written to bubbles.json");
  assert.match(JSON.stringify(await call("element_type_schema", { type: "bubble" })), /disappearEasing/);
  console.log("PASS bubble MCP: create/read/update bubble, procedure_blocks bubble_show, find_references, bubbles.json");
} finally {
  await client.close();
  rmSync(base, { recursive: true, force: true });
}
