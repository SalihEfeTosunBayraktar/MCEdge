// KUYRUK 204: text_translate resolves in the language of the side it runs on, so on a server procedure it is the
// server's language for every player. validate warns (translatedStore) when such text is written into a store the
// clients read (global/player text variables, block/entity/item/session data text), directly, through text blocks or
// through a local variable. Decided: showing it in chat to the player, or a translation in a client-side procedure,
// does not warn. With the path of a translate block, and as a warning (never an error).
// usage: node tools/codegen-test/translated-store-check.ts
//        node tools/codegen-test/translated-store-check.ts <project dir>   (report only: counts the warnings of a project)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../../src/ir/problems.ts";
import { loadProblemSettings, loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { exampleProject } from "../ui-test/cdp.ts";

const issuesOf = (dir: string) => classify(validateProject(loadProject(dir), dir), loadProblemSettings(dir)).shown.filter((i) => i.code === "translatedStore");

const report = process.argv[2];
if (report) {
  const found = issuesOf(report);
  for (const i of found) console.log(`${i.severity}: ${i.path}: ${i.message}`);
  console.log(`translatedStore warnings: ${found.length}`);
  process.exit(0);
}

const dir = exampleProject();
const translate = (key = "my.key") => ({ block: "text_translate", inputs: { key } });
const entity = { block: "dep_entity", fields: { dep: "entity" } };
const procedure = (id: string, blocks: object[], globalTrigger = "player_log_in", variables: object[] = []) => {
  mkdirSync(join(dir, "elements", "procedures"), { recursive: true });
  const program = { format: 1, variables, stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, ...blocks] }] };
  writeFileSync(join(dir, "elements", "procedures", `${id}.json`), JSON.stringify({ id, globalTrigger, program }, null, 2));
};
writeFileSync(join(dir, "variables.json"), JSON.stringify({ variables: [{ name: "motd", type: "string", scope: "global_world", initial: "" }, { name: "label", type: "string", scope: "player_map", initial: "" }] }));

// Warns: a translation (alone, in a join, through a local variable) stored for the clients.
procedure("player_set", [{ block: "player_text_set", fields: { var: "label" }, inputs: { entity, value: translate() } }]);
procedure("global_join", [{ block: "global_text_set", fields: { var: "motd" }, inputs: { value: { block: "text_join", inputs: { a: "Hi ", b: translate("a.b") } } } }]);
procedure("block_data", [{ block: "block_set_data_text", inputs: { x: 0, y: 0, z: 0, key: "k", value: translate() } }]);
procedure("via_local", [
  { block: "local_text_set", fields: { var: "t" }, inputs: { value: translate() } },
  { block: "global_text_set", fields: { var: "motd" }, inputs: { value: { block: "local_text_get", fields: { var: "t" } } } },
], "player_log_in", [{ name: "t", type: "text" }]);
// No warning: shown in chat (the player's game translates), a literal or a number-made text stored, a draft stack,
// a disabled block, and the translation in a procedure only a client field (an item tooltip) runs.
procedure("chat", [{ block: "entity_send_chat", inputs: { entity, text: translate() } }]);
procedure("plain", [{ block: "global_text_set", fields: { var: "motd" }, inputs: { value: { block: "text_join", inputs: { a: "x", b: { block: "text_from_number", inputs: { value: 3 } } } } } }]);
procedure("disabled", [{ block: "global_text_set", disabled: true, fields: { var: "motd" }, inputs: { value: translate() } }]);
procedure("client_only", [{ block: "player_text_set", fields: { var: "label" }, inputs: { entity, value: translate() } }], "no_ext_trigger");
const item = join(dir, "elements", "items", "ruby.json");
writeFileSync(item, JSON.stringify({ ...JSON.parse(readFileSync(item, "utf8")), specialInformationProcedure: "client_only" }, null, 2));

const found = issuesOf(dir);
const at = (id: string) => found.filter((i) => i.path.startsWith(`procedure/${id}.`));
assert.equal(found.length, 4, found.map((i) => i.path).join("\n"));
assert.ok(found.every((i) => i.severity === "warning"), "a warning, never an error");
assert.equal(at("player_set")[0].path, "procedure/player_set.program.stacks[0].blocks[1].inputs.value");
assert.equal(at("global_join")[0].path, "procedure/global_join.program.stacks[0].blocks[1].inputs.value.inputs.b");
assert.equal(at("block_data").length, 1);
assert.equal(at("via_local")[0].path, "procedure/via_local.program.stacks[0].blocks[2].inputs.value");
assert.match(at("player_set")[0].message, /server's language is used for every player, because player_text_set syncs/);
for (const id of ["chat", "plain", "disabled", "client_only"]) assert.equal(at(id).length, 0, `${id} does not warn`);
console.log(found.map((i) => `${i.severity}: ${i.path}`).join("\n"));
console.log("PASS");
