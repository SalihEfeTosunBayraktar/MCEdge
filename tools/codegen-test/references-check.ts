// Reference finder and unused report (src/ir/references.ts) on a throwaway project built here: every reference form.
// usage: node tools/codegen-test/references-check.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAllReferences, referencesOf, unusedElements } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { buildRefsProject } from "./refs-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "mcedge-refs-"));
try {
  const dir = join(root, "p");
  buildRefsProject(dir);

  // ---- finder ----
  let input = loadReferenceInput(dir);
  let all = findAllReferences(input);
  const forms = (target: { type: string; id: string }) => referencesOf(all, target).usedBy.map((r) => `${r.from.kind === "element" ? `${r.from.type}/${r.from.id}` : r.from.id}:${r.form}:${r.path}`);
  const helper = forms({ type: "procedure", id: "p_helper" });
  for (const expected of [
    "procedure/p_main:program_procedure:program.stacks[0].blocks[1].fields.procedure",
    "gui/shop:procedure_field:components[0].procedure",
    "block/ruby_block:procedure_field:onRightClicked",
  ]) assert.ok(helper.includes(expected), `p_helper usedBy lacks ${expected}\n${helper.join("\n")}`);
  assert.ok(!helper.some((h) => h.startsWith("procedure/p_helper")), "a procedure calling itself is not its own user");
  assert.ok(forms({ type: "procedure", id: "p_helper" }).some((h) => h.includes("java_code")), "PHelperProcedure class name in java_code");
  const shop = forms({ type: "gui", id: "shop" });
  assert.ok(shop.some((h) => h.startsWith("block/ruby_block:element_field:guiBoundTo")), shop.join("\n"));
  assert.ok(shop.some((h) => h.includes("program_id")), "gui_open block field");
  const gem = forms({ type: "item", id: "gem_item" });
  for (const part of ["recipe/gem_item:registry_field:recipeSlots[4]", "recipe/gem_item:registry_field:recipeReturnStack", "item refmod:gems:tag_entry:entries[0]", "gui/shop:registry_field:components[2].limit", "datapack/refmod/tags/items/money.json:datapack_file", "java_code", "program_id"]) {
    assert.ok(gem.some((g) => g.includes(part)), `gem_item usedBy lacks ${part}\n${gem.join("\n")}`);
  }
  assert.ok(forms({ type: "block", id: "ruby_block" }).some((g) => g.includes("namespaced_id")), "text input holding modid:id");
  assert.equal(referencesOf(all, { type: "block", id: "gem_block" }).uses.length, 1, "uses: gem_block names procedure p_cond");
  assert.ok(!all.some((r) => r.to.type === "item" && r.to.id === "gem_item" && r.form === "java_code" && r.path.includes("GemBlockRenderer")), "class mention of another element's name is not a gem_item reference");

  // ---- unused ----
  const unused = unusedElements(input, all);
  assert.deepEqual(unused.unused.map((u) => u.id).sort(), ["p_chain_a", "p_unused"], "p_main has a trigger, p_helper/p_cond have users; chain_b is used by chain_a");
  const chained = unusedElements(input, all, undefined, true);
  assert.deepEqual(chained.unused.map((u) => u.id).sort(), ["p_chain_a", "p_chain_b", "p_unused"]);
  assert.equal(chained.unused.find((u) => u.id === "p_chain_b")?.reachableOnlyFromUnused, true);
  assert.deepEqual(unused.summary, { procedure: { total: 6, unused: 2 }, gui: { total: 1, unused: 0 } });
  console.log("references-check OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
