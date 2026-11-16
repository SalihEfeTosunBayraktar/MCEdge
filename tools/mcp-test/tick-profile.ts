/**
 * Q219: tick_profile end to end through the MCP server (heavy: Gradle + a server). Uses a copy of the codegen test
 * project when given none:  node tools/mcp-test/tick-profile.ts [project dir] [engine] [seconds]
 * Checks that the report lists tick procedures sorted by time per tick with calls, time per call and triggers.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect } from "./client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
const [project = resolve(import.meta.dirname, "../codegen-test/project"), engine = "forge-1.16.5", seconds = "10"] = process.argv.slice(2);
const mcp = await connect(resolve(project));
const report = await mcp.call<any>("tick_profile", { engine, seconds: Number(seconds), warmupSeconds: 3, players: 2, top: 5 });
console.log(JSON.stringify(report, null, 2));
const rows = report.procedures as { procedure: string; triggers: string[]; calls: number; usPerCall: number; usPerTick: number }[];
const sorted = rows.every((r, i) => i === 0 || rows[i - 1].usPerTick >= r.usPerTick);
console.log(`top ${rows.length} of ${report.of} over ${report.ticks} ticks`);
for (const r of rows) console.log(`  ${r.procedure.padEnd(36)} ${String(r.usPerTick).padStart(9)} us/tick ${String(r.usPerCall).padStart(9)} us/call ${String(r.calls).padStart(8)} calls  ${r.triggers.join(" ")}`);
if (!report.ticks || !rows.length || !sorted || rows.some((r) => !r.triggers.length || r.calls <= 0)) throw new Error("tick_profile: unexpected report");
await mcp.close();
console.log("PASS tick-profile");
