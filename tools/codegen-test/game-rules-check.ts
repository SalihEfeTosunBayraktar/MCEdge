// KUYRUK 51: game rule names in procedures. Validation of unknown names, the reference scan and id rename, and a ruleName change
// reaching the procedures that read the rule, on a throwaway project; plus the helper sources of every engine.
// usage: node tools/codegen-test/game-rules-check.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gameRuleIssues } from "../../src/ir/gameRules.ts";
import { findAllReferences, referencesOf } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { renameElement } from "../../src/ir/rename.ts";
import { loadProject, saveElement } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { HELPERS, helperCode } from "../../src/procedures/helpers.ts";
import { addElement } from "../ui-test/fixtures.ts";

const program = (...blocks: object[]) => ({ format: 1, variables: [], stacks: [{ x: 20, y: 20, blocks: [{ block: "start" }, ...blocks] }] });
const read = (rule: string) => ({ block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule } } } } } });
const root = mkdtempSync(join(tmpdir(), "mcedge-rules-"));
try {
  const dir = join(root, "p");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "rulemod", name: "Rules", version: "1.0.0", package: "rulemod", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] }, variables: [], localization: {} }));
  const base = { displayName: "R", description: "d", category: "PLAYER", type: "Number", defaultValueNumber: 5 };
  addElement(dir, "game_rule", "question_repeat_ticks", { ...base, ruleName: "question_repeat_ticks" });
  addElement(dir, "game_rule", "plain_rule", base);
  addElement(dir, "procedure", "reader", {
    program: program(read("questionRepeatTicks"), read("question_repeat_ticks"), read("plainRule"), read("plain_rule"), read("randomTickSpeed"), read("random_tick_speed"), read("keepInventory"),
      { block: "world_set_game_rule_number", fields: { rule: "questionRepeatTicks" }, inputs: { value: 4 } }),
    globalTrigger: "mod_load",
  });
  addElement(dir, "procedure", "typo", { program: program(read("questionRepeatTick"), read("noSuchRule")), globalTrigger: "mod_load" });

  // ---- validation: names that mean nothing ----
  const issues = gameRuleIssues(loadProject(dir).elements);
  assert.deepEqual(issues.map((i) => i.path.replace(/.*\.fields\.rule$/, "") + i.message.match(/"([^"]+)"/)![1]).sort(), ["noSuchRule", "questionRepeatTick"], JSON.stringify(issues));
  assert.ok(issues.every((i) => i.path.startsWith("procedure/typo.program.stacks[0].blocks[")), "issues point into the procedure");
  assert.ok(validateProject(loadProject(dir), dir).some((i) => /noSuchRule/.test(i.message)), "validateProject reports it");

  // ---- references: the rule is used by the blocks that name it ----
  const used = (id: string) => referencesOf(findAllReferences(loadReferenceInput(dir)), { type: "game_rule", id }).usedBy.filter((r) => r.form === "game_rule_name");
  assert.equal(used("question_repeat_ticks").length, 3, "camelCase, snake_case and the set block");
  assert.equal(used("plain_rule").length, 2);

  // ---- ruleName change: procedures follow ----
  const rule = loadProject(dir).elements.game_rule.find((e) => e.id === "question_repeat_ticks")!;
  saveElement(dir, "game_rule", { ...rule, ruleName: "quiz_gap" });
  const reader = JSON.stringify(loadProject(dir).elements.procedure.find((e) => e.id === "reader")!.program);
  assert.ok(!/questionRepeatTicks|question_repeat_ticks/.test(reader), "old names are gone");
  assert.ok(/quizGap/.test(reader) || /quiz_gap/.test(reader), "new name written");
  assert.equal(gameRuleIssues(loadProject(dir).elements).length, 2, "still only the two typos");

  // ---- id rename: a text naming the id follows, a text naming the ruleName stays ----
  renameElement(dir, "game_rule", "plain_rule", "plain_gate");
  const after = JSON.stringify(loadProject(dir).elements.procedure.find((e) => e.id === "reader")!.program);
  assert.ok(/plainGate/.test(after) && /plain_gate/.test(after) && !/plainRule|plain_rule/.test(after), "id rename rewrites both spellings");
  renameElement(dir, "game_rule", "question_repeat_ticks", "quiz_gap_rule");
  assert.ok(/quizGap|quiz_gap/.test(JSON.stringify(loadProject(dir).elements.procedure.find((e) => e.id === "reader")!.program)), "ruleName reads survive an id rename");
  assert.equal(gameRuleIssues(loadProject(dir).elements).length, 2);

  // ---- helpers: every engine resolves the name before it reads or writes ----
  for (const [gen, loader] of [["1.16.5", "forge"], ["1.21.5", "neoforge"], ["1.21.5", "fabric"], ["26.3", "neoforge"], ["26.3", "fabric"]] as const) {
    for (const name of ["gameRuleId", "gameRuleLogic", "gameRuleNumber", "setGameRule"]) {
      const fn = helperCode(HELPERS[name], gen, loader);
      assert.ok(fn, `${name} on ${gen}/${loader}`);
      const source = fn!(new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, string>);
      if (name === "gameRuleId") assert.ok(/equalsIgnoreCase\(loose\)/.test(source) && /equals\(rule\)/.test(source), "exact first, then loose");
      else assert.ok(/gameRuleId\(world, rule\)/.test(source) && !/equals\(rule\)/.test(source), `${name} uses the resolved id on ${gen}/${loader}`);
    }
  }
  console.log("game-rules-check OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
