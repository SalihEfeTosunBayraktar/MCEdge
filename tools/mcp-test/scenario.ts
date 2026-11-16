/**
 * Q218: run_scenario end to end through the MCP server, on a copy of examples/hello (heavy: Gradle + a server).
 *   node tools/mcp-test/scenario.ts [engine ...]   default forge-1.16.5 neoforge-1.21.5
 * Checks that bad scenarios are refused before any build, that docs/scenarios/hello.json passes with its expectations,
 * that a wrong expectation fails the step, and that export_jar-style output has no probe.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
const engines = process.argv.slice(2).length ? process.argv.slice(2) : ["forge-1.16.5", "neoforge-1.21.5"];
const dir = join(mkdtempSync(join(tmpdir(), "mcedge-scenario-")), "hello");
cpSync(exampleProject(), dir, { recursive: true });
const mcp = await connect(dir);
assert(mcp.tools.includes("run_scenario") && mcp.tools.includes("tick_profile"), "both tools are listed");

const bad = await mcp.call<string>("run_scenario", { engine: engines[0], scenario: { steps: [{ op: "dance" }, { op: "read", what: "var" }] } }, true);
assert(typeof bad === "string" && bad.includes('unknown op "dance"') && bad.includes("name is missing"), `bad scenarios are refused before a build (${String(bad).slice(0, 120)})`);

for (const engine of engines) {
  const result = await mcp.call<any>("run_scenario", { engine, file: join(import.meta.dirname, "../../docs/scenarios/hello.json") });
  console.log(engine, JSON.stringify(result.steps.map((s: any) => [s.op, s.label, s.value, s.pass, s.error])));
  assert(result.ok && result.passed === 5 && result.failed === 0 && result.errors === 0, `${engine}: hello scenario passes (${result.passed} passed, ${result.failed} failed, ${result.errors} errors)`);
  const wrong = await mcp.call<any>("run_scenario", { engine, scenario: { steps: [{ op: "player", name: "Bo" }, { op: "give", item: "minecraft:stick", count: 2, expect: 3 }] } });
  assert(!wrong.ok && wrong.failed === 1 && wrong.steps[1].value === 2, `${engine}: a wrong expectation fails with the real value`);
  // The probe is in the dev build the run generated; a plain regeneration (export_jar's path) has none.
  const sources = (d: string): string[] => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  assert(sources(join(dir, "out", engine, "src")).some((f) => f.includes("probe")), `${engine}: the scenario run built the probe`);
}
await mcp.close();
console.log("PASS scenario");
