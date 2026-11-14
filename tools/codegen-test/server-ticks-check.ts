// KUYRUK 106: the server_ticks global trigger runs once per server tick on every engine (world_ticks runs once per
// dimension), with the overworld as its world; MCP procedure_triggers lists it for all 5 engines.
// Generates the test project (no Gradle; server_tick_probe uses the trigger). Run tools/codegen-test/make.ts first when spec.ts changed.
// Runtime: rules-check.sh asserts each logged "[probe] server tick <time>" appears once.
// usage: node tools/codegen-test/server-ticks-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { GLOBAL_TRIGGERS_BY_ID, triggerCode } from "../../src/procedures/triggers.ts";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
const trigger = GLOBAL_TRIGGERS_BY_ID.get("server_ticks");
assert.ok(trigger, "server_ticks is a global trigger");
assert.equal(trigger.side, "server");
assert.deepEqual(trigger.deps, ["world"]);
const engines = listEngines();
assert.equal(engines.length, 5);
for (const e of engines) {
  // The same generation/loader mapping as MCP procedure_triggers (src/mcp/procedures.ts engineTargets).
  const gen = e.minecraft === "1.16.5" ? "1.16.5" : e.minecraft.startsWith("1.21") ? "1.21.5" : "26.3";
  assert.ok(triggerCode(trigger.code, gen, e.loader as "forge" | "neoforge" | "fabric"), `${e.id}: listed by procedure_triggers`);
  const out = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", e.id, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, `${e.id}: generate failed\n${out.stdout}${out.stderr}`);
  assert.ok(!/server_tick_probe/.test(out.stdout + out.stderr), `${e.id}: the procedure is not skipped (coverage layer allows server_ticks)`);
  const java = readFileSync(join(T, "project/out", e.id, "src/main/java/dev/mcedge/wavethree/procedures/WavethreeModProcedures.java"), "utf8");
  const calls = java.split("ServerTickProbeProcedure.execute(").length - 1;
  assert.equal(calls, 1, `${e.id}: one call site`);
  const at = java.indexOf("ServerTickProbeProcedure.execute(");
  const listener = java.slice(java.lastIndexOf(e.loader === "fabric" ? "END_SERVER_TICK.register(" : "ServerTickEvent", at), at);
  assert.ok(listener.length > 0, `${e.id}: called from the server tick event`);
  assert.ok(/level = (event\.getServer\(\)|server)\.overworld\(\);/.test(listener), `${e.id}: world is the overworld`);
  assert.ok(!/getAllLevels|for \(/.test(listener), `${e.id}: not once per dimension`);
  if (e.loader === "forge") assert.ok(/Phase\.END\) return;/.test(listener), `${e.id}: end phase only (the event fires twice per tick)`);
}
console.log("server-ticks-check OK");
