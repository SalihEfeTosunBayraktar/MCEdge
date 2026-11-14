// Smoke test: start `mcedge mcp <dir>` over stdio, list tools and call a few of them.
// usage: node scripts/mcp-smoke.ts <project-dir> [--build]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [projectDir] = process.argv.slice(2);
const client = new Client({ name: "mcedge-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "mcp", projectDir] }));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const body = (result.content as { text: string }[]).map((c) => c.text).join("\n");
  console.log(`--- ${name}${result.isError ? " (error)" : ""}\n${body.slice(0, 1200)}`);
};

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
await call("project_info");
await call("search", { pattern: "new_shopbutton", extension: ".java" });
await call("read_file", { path: "src/main/resources/META-INF/mods.toml", startLine: 1, endLine: 8 });
await call("read_file", { path: "../outside.txt" });
if (process.argv.includes("--build")) await call("build");
await client.close();
