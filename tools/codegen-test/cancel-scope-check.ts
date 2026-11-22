// Q281: the cancel_event flag is scoped per event dispatch. An event fired inside a cancelling handler does not consume
// the outer cancel, and a procedure called outside any event (here: directly) leaves nothing for the next event.
// A small project is written to a temp folder: cancel_click (right-click a block: at z 0 it cancels, then spawns an XP orb,
// which fires entity_joins_world inside the handler), on_join (entity_joins_world) and cancel_direct (no trigger, cancels).
// Generated code, every engine: ProcedureHelpers has beginEvent/endEvent and no takeCancel, every trigger call site is
// wrapped, and a Java harness built from that engine's generated helper and wrapper runs the nested, direct, flat and
// throwing cases, and java_code that still calls takeCancel (`java` on PATH, no Gradle).
// `--run [engine...]` also runs the scenario on a headless dedicated server per engine (heavy: Gradle + server):
// the lever at z 0 stays off (the nested orb join did not take the cancel) and the orb exists, then after a direct call of
// cancel_direct the lever at z 2 turns on.
// usage: node tools/codegen-test/cancel-scope-check.ts [--run neoforge-26.3 fabric-1.21.5]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { listEngines } from "../../src/engines/registry.ts";

const ROOT = join(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const runAt = args.indexOf("--run");
const runEngines = runAt < 0 ? [] : args.slice(runAt + 1);

const dir = mkdtempSync(join(tmpdir(), "mcedge-q281-"));
const pkg = "dev.mcedge.cancelscope";
writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "cancelscope", name: "Cancel Scope", version: "0.1.0", package: pkg, authors: ["MCEdge"], description: "Q281", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }, null, 2));
const type = typeRegistry().byId.get("procedure")!;
mkdirSync(join(dir, "elements", type.folder), { recursive: true });
const dep = (name: string) => ({ block: "dep_number", fields: { dep: name } });
const program = (blocks: unknown[]) => ({ format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...blocks] }] });
const procedures: Record<string, Record<string, unknown>> = {
  cancel_click: { globalTrigger: "player_right_click_block", program: program([
    { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: dep("z"), b: 0 } }, then: [
      { block: "cancel_event" },
      { block: "world_spawn_xp", inputs: { x: dep("x"), y: { block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a: dep("y"), b: 1 } }, z: dep("z"), amount: 1 } },
    ] } },
  ]) },
  on_join: { globalTrigger: "entity_joins_world", program: program([{ block: "log", inputs: { text: "[q281] joined" } }]) },
  cancel_direct: { globalTrigger: "no_ext_trigger", program: program([{ block: "cancel_event" }]) },
};
for (const [id, values] of Object.entries(procedures)) {
  writeFileSync(join(dir, "elements", type.folder, `${id}.json`), JSON.stringify({ ...newElement(type, id), title: id, returnType: "none", ...values }, null, 2));
}

const engines = listEngines();
assert.equal(engines.length, 5);
const javaDir = `src/main/java/${pkg.replaceAll(".", "/")}/procedures`;
const HELPERS = `${pkg}.procedures.ProcedureHelpers`;
for (const e of engines) {
  const out = spawnSync("node", ["src/cli.ts", "build", dir, "--target", e.id, "--no-gradle"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(out.status, 0, `${e.id}: generate failed\n${out.stdout}${out.stderr}`);
  const helpers = readFileSync(join(dir, "out", e.id, javaDir, "ProcedureHelpers.java"), "utf8");
  const triggers = readFileSync(join(dir, "out", e.id, javaDir, "CancelscopeModProcedures.java"), "utf8");
  assert.ok(!/takeCancel/.test(triggers), `${e.id}: triggers no longer read the shared flag`);
  const helper = helpers.match(/private static boolean cancelled;[\s\S]*?takeCancel\(\) \{[\s\S]*?\n\s*\}/)?.[0];
  assert.ok(helper, `${e.id}: ProcedureHelpers has the scoped cancel helper`);
  // Every trigger call site runs inside its own dispatch scope; the direct-only procedure has no call site.
  const calls = triggers.split(/Procedure\.execute\(/).length - 1;
  assert.equal(calls, 2, `${e.id}: cancel_click and on_join are called once each`);
  assert.equal(triggers.split(`${HELPERS}.beginEvent()`).length - 1, calls, `${e.id}: every call site begins a dispatch`);
  assert.equal(triggers.split(`${HELPERS}.endEvent(mcedgeCancel)`).length - 1, calls, `${e.id}: every call site ends it`);
  assert.ok(!/CancelDirectProcedure\.execute/.test(triggers), `${e.id}: cancel_direct has no trigger`);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wrapper = triggers.match(new RegExp(`boolean mcedgeCancel = ${esc(HELPERS)}\\.beginEvent\\(\\);\\s*try \\{\\s*[^\\n]*CancelClickProcedure\\.execute\\([^\\n]*\\);\\s*\\} finally \\{\\s*mcedgeCancel = ${esc(HELPERS)}\\.endEvent\\(mcedgeCancel\\);\\s*\\}\\s*if \\(mcedgeCancel\\) \\{`))?.[0];
  assert.ok(wrapper, `${e.id}: the right-click call site is wrapped and cancels from the scoped result\n${triggers}`);
  // The harness runs the generated helper and the generated wrapper, with the procedure call replaced by a Runnable.
  const dispatch = wrapper.replaceAll(HELPERS, "H").replace(/[^\n]*CancelClickProcedure\.execute\([^\n]*\);/, "body.run();");
  const harness = `public class Harness {
static class H {
${helper}
}
static boolean dispatch(Runnable body) {
${dispatch}
return true;
}
return false;
}
static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
public static void main(String[] args) {
check(dispatch(H::cancelEvent), "flat: a cancelling handler cancels its event");
check(!dispatch(() -> {}), "flat: the next event is not cancelled");
boolean[] inner = { true };
check(dispatch(() -> { H.cancelEvent(); inner[0] = dispatch(() -> {}); }), "nested: the outer event stays cancelled");
check(!inner[0], "nested: the inner event does not take the outer cancel");
check(!dispatch(() -> inner[0] = dispatch(H::cancelEvent)), "nested: an inner cancel does not cancel the outer event");
check(inner[0], "nested: the inner event is cancelled");
H.cancelEvent();
check(!dispatch(() -> {}), "direct: a cancel outside any event leaves nothing for the next event");
try { dispatch(() -> { H.cancelEvent(); throw new RuntimeException("x"); }); } catch (RuntimeException e) { }
check(!dispatch(() -> {}), "throw: a failing handler leaves nothing behind");
check(dispatch(() -> { H.cancelEvent(); boolean keep = H.takeCancel(); dispatch(() -> {}); if (keep) H.cancelEvent(); }), "java_code that takes and re-sets the flag still cancels");
System.out.println("HARNESS OK");
}
}
`;
  const hdir = join(dir, "harness", e.id);
  mkdirSync(hdir, { recursive: true });
  writeFileSync(join(hdir, "Harness.java"), harness);
  const run = spawnSync("java", ["Harness.java"], { cwd: hdir, encoding: "utf8", windowsHide: true });
  assert.ok(run.stdout.includes("HARNESS OK"), `${e.id}: harness failed\n${run.stdout}${run.stderr}\n${harness}`);
  console.log(`${e.id}: generated code OK`);
}

if (runEngines.length) {
  const { connect } = await import("../mcp-test/client.ts");
  const lever = "minecraft:lever[face=floor,facing=north]";
  const scenario = { name: "Q281 cancel scope", steps: [
    { op: "player", name: "Dev", pos: [0, 100, -2] },
    { op: "setblock", pos: [0, 99, 0], block: "minecraft:stone" },
    { op: "setblock", pos: [0, 99, 2], block: "minecraft:stone" },
    { op: "setblock", pos: [0, 100, 0], block: lever },
    { op: "setblock", pos: [0, 100, 2], block: lever },
    { label: "nested: click the lever at z 0 (cancelled, spawns an orb)", op: "useBlock", pos: [0, 100, 0], face: "up" },
    { label: "nested: the lever at z 0 stays off", op: "read", what: "block", pos: [0, 100, 0], expect: { contains: "powered=false" } },
    { label: "nested: the orb joined (its own event was not cancelled)", op: "command", command: "execute if entity @e[type=minecraft:experience_orb]", expect: { min: 1 } },
    { label: "direct: call cancel_direct outside any event", op: "call", procedure: "cancel_direct" },
    { label: "direct: click the lever at z 2 (not cancelled)", op: "useBlock", pos: [0, 100, 2], face: "up" },
    { label: "direct: the lever at z 2 turns on", op: "read", what: "block", pos: [0, 100, 2], expect: { contains: "powered=true" } },
  ] };
  for (const engine of runEngines) {
    // One server at a time; game mode stops the run before Gradle starts.
    if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting Gradle or a server");
    const mcp = await connect(dir);
    const result = await mcp.call<any>("run_scenario", { engine, scenario, timeoutSeconds: 900 });
    await mcp.close();
    for (const s of result.steps) console.log(`  ${engine} ${s.label ?? s.op}: ${JSON.stringify(s.value ?? s.error)}${s.pass === undefined ? "" : s.pass ? " PASS" : " FAIL"}`);
    assert.ok(result.ok && result.failed === 0 && result.errors === 0, `${engine}: scenario failed${result.fatal ? `: ${result.fatal}` : ""}`);
    console.log(`${engine}: scenario OK (${result.passed} passed)`);
  }
}
console.log(`cancel-scope-check OK (${dir})`);
