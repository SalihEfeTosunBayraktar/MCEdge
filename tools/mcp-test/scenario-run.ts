/**
 * Runs one scenario file on a project through the MCP server and prints the steps (heavy: Gradle + a server).
 *   node tools/mcp-test/scenario-run.ts <project dir> <engine> <scenario.json>
 * Use a copy of the project: the engine's out/ folder is regenerated with the test probe.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect } from "./client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
const [project, engine, file] = process.argv.slice(2);
const mcp = await connect(resolve(project));
const result = await mcp.call<any>("run_scenario", { engine, file: resolve(file) });
for (const s of result.steps) console.log(`${s.label ?? s.op}: ${JSON.stringify(s.value ?? s.error)}${s.pass === undefined ? "" : s.pass ? " PASS" : " FAIL"}${s.messages ? ` messages ${JSON.stringify(s.messages)}` : ""}`);
console.log(`passed ${result.passed} failed ${result.failed} errors ${result.errors}${result.fatal ? ` fatal ${result.fatal}` : ""}`);
await mcp.close();
process.exitCode = result.ok ? 0 : 1;
