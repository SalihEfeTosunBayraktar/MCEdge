/** Starts `mcedge mcp <dir>` over stdio the way an AI client does and calls its tools. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");

export interface Mcp {
  tools: string[];
  /** Base64 PNGs of the last call's image parts (previews, screenshots). */
  lastImages: string[];
  /** Calls a tool; throws when it reports an error unless `allowError`. Returns the text, JSON-parsed when it is JSON. */
  call<T = any>(name: string, args?: Record<string, unknown>, allowError?: boolean): Promise<T>;
  close(): Promise<void>;
}

/**
 * The server: `node src/cli.ts mcp <dir>` from this checkout, or with MCEDGE_MCP_EXE set an installed or packaged app's
 * exe run as Node on its bundled CLI, the command the app's Connect an AI agent dialog gives (Q201).
 */
function serverCommand(projectDir: string, flags: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  const exe = process.env.MCEDGE_MCP_EXE;
  if (!exe) return { command: process.execPath, args: ["src/cli.ts", "mcp", projectDir, ...flags] };
  return { command: exe, args: [join(dirname(exe), "resources", "app.asar", "out", "cli", "index.js"), "mcp", projectDir, ...flags], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** `env`: variables added to the server's (the SDK passes only a safe default set); `info`: the clientInfo sent at initialize. */
export async function connect(projectDir: string, env?: Record<string, string>, info = { name: "mcedge-test", version: "0.0.0" }, flags: string[] = []): Promise<Mcp> {
  const client = new Client(info);
  const server = serverCommand(projectDir, flags);
  // Test agents run unattended (Q255); a test of the gate itself sets MCEDGE_ALLOW_HEADLESS_RUNS to 0.
  const extra = { MCEDGE_ALLOW_HEADLESS_RUNS: "1", ...server.env, ...env };
  await client.connect(new StdioClientTransport({ command: server.command, args: server.args, cwd: REPO, stderr: "inherit",
    ...(Object.keys(extra).length ? { env: { ...getDefaultEnvironment(), ...extra } } : {}) }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const mcp: Mcp = {
    tools,
    lastImages: [],
    async call(name, args = {}, allowError = false) {
      // Builds and Gradle tasks take minutes; the SDK's default request timeout is one minute.
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20 * 60_000, resetTimeoutOnProgress: true });
      // Image parts (screenshots) are left out of the text and kept in lastImages.
      mcp.lastImages = (result.content as { type: string; data: string }[]).filter((c) => c.type === "image").map((c) => c.data);
      const body = (result.content as { type: string; text: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (result.isError && !allowError) throw new Error(`${name}: ${body}`);
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    },
    close: () => client.close(),
  };
  return mcp;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
  console.log(`ok  ${message}`);
}
