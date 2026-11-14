/**
 * Q201: an agent connects to an installed or packaged MCEdge, with no Node.js or sources on its side. Starts the
 * command the app's Connect an AI agent dialog gives on a copy of the example project, checks stdout carries only
 * JSON-RPC, lists the tools and calls a few, one of them a write that must reach the file on disk.
 *   MCEDGE_MCP_EXE=<install>\MCEdge.exe node tools/mcp-test/installed.ts
 * Without MCEDGE_MCP_EXE it checks the source checkout's `node src/cli.ts mcp` the same way.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const exe = process.env.MCEDGE_MCP_EXE;
console.log(`server: ${exe ?? "node src/cli.ts"}, project: ${project}`);

if (exe) {
  // The bundled CLI reads the app's own core folders (resources/core), not a checkout's.
  const engines = spawnSync(exe, [join(dirname(exe), "resources", "app.asar", "out", "cli", "index.js"), "engines"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" }).stdout;
  const dirs = engines.trim().split("\n").map((line) => line.split("\t")[2]);
  assert(dirs.length > 0 && dirs.every((dir) => dir.startsWith(join(dirname(exe), "resources", "core", "engines"))), `engines come from resources/core (${dirs.length})`);
}

// stdout is the protocol: every line the server writes must be a JSON-RPC message (no Electron or log noise).
const raw = await new Promise<string>((done, fail) => {
  const child = exe
    ? spawn(exe, [join(dirname(exe), "resources", "app.asar", "out", "cli", "index.js"), "mcp", project], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
    : spawn(process.execPath, ["src/cli.ts", "mcp", project], { cwd: join(import.meta.dirname, "..", "..") });
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
    if (out.includes("\n")) child.stdin.end();
  });
  child.stderr.pipe(process.stderr);
  child.on("error", fail);
  child.on("close", () => done(out));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcedge-installed-test", version: "0.0.0" } } })}\n`);
  setTimeout(() => child.kill(), 30_000);
});
const lines = raw.split("\n").filter((line) => line.length);
assert(lines.length > 0 && lines.every((line) => JSON.parse(line).jsonrpc === "2.0"), `stdout is JSON-RPC only (${lines.length} line(s), first ${JSON.stringify(raw.slice(0, 40))})`);
assert(JSON.parse(lines[0]).result?.serverInfo?.name === "mcedge", "initialize answers as mcedge");

const mcp = await connect(project, undefined, { name: "mcedge-installed-test", version: "0.0.0" });
try {
  assert(mcp.tools.length >= 140, `tools listed: ${mcp.tools.length}`);
  const info = await mcp.call("project_info");
  assert(info.kind === "mcedge" && info.mod.id === "hellomcedge" && info.engines.length > 0, `project_info: ${info.mod.id}, engines ${info.engines.join(", ")}`);
  const list = await mcp.call("list_elements");
  assert(list.total > 0, `list_elements: ${list.total} elements (${list.elements.map((e: { type: string; id: string }) => `${e.type}/${e.id}`).join(", ")})`);
  const problems = await mcp.call("validate_project");
  assert(Array.isArray(problems), `validate_project: ${problems.length} problem(s)`);

  const item = list.elements.find((e: { type: string }) => e.type === "item");
  const file = join(project, "elements", "items", `${item.id}.json`);
  await mcp.call("update_element", { type: "item", id: item.id, values: { stackSize: 17 } });
  const read = await mcp.call("read_element", { type: "item", id: item.id });
  assert(read.stackSize === 17, `update_element then read_element: item/${item.id} stackSize ${read.stackSize}`);
  assert(JSON.parse(readFileSync(file, "utf8")).stackSize === 17, `the write reached the file on disk (${file})`);
} finally {
  await mcp.close();
}
console.log("installed MCP: all checks passed");
