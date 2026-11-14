// Calls the generator MCP tools on the codegen test project through a real stdio MCP connection and prints the
// answers (shortened). usage: node tools/codegen-test/mcp-check.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const client = new Client({ name: "mcedge-codegen-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "mcp", join(import.meta.dirname, "project")], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { error: !!r.isError, text: r.content.map((c) => c.text).join("\n") };
};
const show = (label: string, r: { error: boolean; text: string }, max = 900) => console.log(`== ${label}${r.error ? " (error)" : ""}\n${r.text.slice(0, max)}`);
show("coverage living_entity", await call("coverage", { type: "living_entity" }));
show("entity_models", await call("entity_models"), 1500);
const aiBlocks = JSON.parse((await call("procedure_blocks", { category: "ai" })).text) as { blocks: { id: string; engines: string[] }[] };
console.log(`== procedure_blocks ai: ${aiBlocks.blocks.filter((b) => b.id.startsWith("ai_")).map((b) => `${b.id}(${b.engines.length})`).join(" ")}`);
show("write_ai_goals ruby_zombie", await call("write_ai_goals", { entity: "ruby_zombie", program: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, { block: "ai_leap", fields: { speed: 0.6 } }, { block: "ai_wander" }] }] } }));
show("write_ai_goals bad block", await call("write_ai_goals", { entity: "ruby_zombie", program: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, { block: "log", inputs: { text: "x" } }] }] } }));
// Custom models (KUYRUK #15): list them with kind and users, assign one to a block, read the block coverage, restore.
const models = JSON.parse((await call("list_resources")).text).models as { use: string; kind: string; usedBy: string[] }[];
console.log(`== list_resources models\n${models.map((m) => `${m.use} (${m.kind}): ${m.usedBy.join(", ") || "-"}`).join("\n")}`);
show("update_element ruby_gem_block -> ruby_lamp (JSON)", await call("update_element", { type: "block", id: "ruby_gem_block", values: { renderType: 2, customModelName: "ruby_lamp" } }), 300);
const gaps = (await call("coverage", { type: "block" })).text;
console.log(`== coverage block mentions renderType/customModelName: ${/renderType|customModelName/.test(gaps) ? gaps.split("\n").filter((l) => /renderType|customModelName/.test(l)).join(" | ") : "no (generated on every engine)"}`);
await call("update_element", { type: "block", id: "ruby_gem_block", values: { renderType: 3, customModelName: "ruby_gem" } });
await client.close();
