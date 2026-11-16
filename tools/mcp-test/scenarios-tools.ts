/**
 * Q241: list_scenarios and reload_data through the MCP server, on a copy of examples/hello.
 *   node tools/mcp-test/scenarios-tools.ts            light: no game (list, refusals)
 *   node tools/mcp-test/scenarios-tools.ts <engine>   also starts a server and reloads its data (heavy: Gradle + a server)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { scenarioTemplate } from "../../src/build/scenarioRun.ts";
import { assert, connect } from "./client.ts";

const engine = process.argv[2];
if (engine && existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
const dir = join(mkdtempSync(join(tmpdir(), "mcedge-scenarios-")), "hello");
cpSync(exampleProject(), dir, { recursive: true });
const mcp = await connect(dir);
assert(mcp.tools.includes("list_scenarios") && mcp.tools.includes("reload_data"), "both tools are listed");

assert((await mcp.call<unknown[]>("list_scenarios")).length === 0, "no scenarios folder lists nothing");
mkdirSync(join(dir, "scenarios"));
writeFileSync(join(dir, "scenarios", "good.json"), JSON.stringify(scenarioTemplate()));
writeFileSync(join(dir, "scenarios", "broken.json"), JSON.stringify({ steps: [{ op: "dance" }] }));
writeFileSync(join(dir, "scenarios", "notjson.json"), "{ nope");
const list = await mcp.call<{ file: string; name: string; steps: number; problems: string[] }[]>("list_scenarios");
assert(list.length === 3 && list[0].file === "scenarios/broken.json", "files are listed by name");
assert(list.find((s) => s.name === "good")!.steps === 6 && list.find((s) => s.name === "good")!.problems.length === 0, "the template is a valid scenario");
assert(list.find((s) => s.name === "broken")!.problems[0].includes("unknown op") && list.find((s) => s.name === "notjson")!.problems[0].includes("not valid JSON"), "problems are listed per file");

const refused = await mcp.call<string>("reload_data", { engine: engine ?? "fabric-1.21.5" }, true);
assert(String(refused).includes("no server started by run_server"), "reload_data without a server says so");

if (engine) {
  await mcp.call("run_server", { engine });
  for (let i = 0; i < 900; i++) {
    if ((await mcp.call<string>("server_log", { lines: 40 })).includes("Done (")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const reloaded = await mcp.call<any>("reload_data", { engine });
  assert(reloaded.reloaded && /reload/i.test(reloaded.reply), `${engine}: reload_data reloads the running server (${reloaded.reply})`);
  await mcp.call("stop_server");
  await new Promise((r) => setTimeout(r, 8000));
}
await mcp.close();
console.log("PASS scenarios-tools");
