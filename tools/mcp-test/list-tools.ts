/** Prints every MCP tool with its description and arguments as Markdown rows (for docs/MCP.md). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";

const client = new Client({ name: "mcedge-docs", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "mcp", process.argv[2] ?? exampleProject()], cwd: resolve(import.meta.dirname, "..", "..") }));
for (const tool of (await client.listTools()).tools) {
  const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
  console.log(`| \`${tool.name}\` | ${props.map((p) => `\`${p}\``).join(", ") || "-"} | ${(tool.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
}
await client.close();
