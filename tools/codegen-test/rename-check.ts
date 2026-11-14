// Rename (src/ir/renamePlan.ts, src/ir/rename.ts) on a throwaway project: every reference form is rewritten, refusals and
// failures leave the project unchanged. usage: node tools/codegen-test/rename-check.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAllReferences, referencesOf } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { renameElement } from "../../src/ir/rename.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { addElement } from "../ui-test/fixtures.ts";
import { buildRefsProject, fingerprint } from "./refs-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "mcedge-rename-"));
try {
  const dir = join(root, "p");
  buildRefsProject(dir);
  addElement(dir, "fluid", "ember", { generateBucket: true }); // claims the item id "ember_bucket"
  const helper = referencesOf(findAllReferences(loadReferenceInput(dir)), { type: "procedure", id: "p_helper" }).usedBy;
  let input: ReturnType<typeof loadReferenceInput>;
  let all: ReturnType<typeof findAllReferences>;
  // ---- rename: dry run changes nothing ----
  const before = fingerprint(dir);
  const dry = renameElement(dir, "procedure", "p_helper", "p_assist", { dryRun: true });
  assert.equal(dry.applied, false);
  assert.ok(dry.referencesChanged >= 5, `p_helper has several places; got ${dry.referencesChanged}`);
  assert.equal(fingerprint(dir), before, "dry run wrote files");

  // ---- rename: refusals leave the project alone ----
  for (const [type, id, to, message] of [
    ["procedure", "p_helper", "p_main", /already used/], ["procedure", "p_helper", "Bad Id", /not a valid id/], ["procedure", "p_helper", "p_helper", /current id/],
    ["procedure", "nothing", "x_y", /no procedure/], ["item", "gem_item", "ruby_block", /already used/], ["item", "gem_item", "ember_bucket", /collides with an id MCEdge derives/],
  ] as const) {
    assert.throws(() => renameElement(dir, type, id, to), message);
    assert.equal(fingerprint(dir), before, `refusal of ${id} -> ${to} wrote files`);
  }
  // A recipe lives in its own id space: it may take an id an item has.
  renameElement(dir, "recipe", "gem_item", "gem_block");
  assert.ok(existsSync(join(dir, "elements/recipes/gem_block.json")) && !existsSync(join(dir, "elements/recipes/gem_item.json")));
  assert.equal(loadProject(dir).localization.en_us["item.refmod.gem_item"], "Gem", "renaming a recipe leaves translations alone");

  // ---- rename: procedure (self call, GUI widgets, block field, program fields, java_code class) ----
  const issuesBefore = validateProject(loadProject(dir), dir).length;
  const proc = renameElement(dir, "procedure", "p_helper", "p_assist");
  assert.equal(proc.applied, true);
  input = loadReferenceInput(dir);
  all = findAllReferences(input);
  assert.equal(referencesOf(all, { type: "procedure", id: "p_assist" }).usedBy.length, helper.length, "same number of users before and after");
  assert.ok(!existsSync(join(dir, "elements/procedures/p_helper.json")));
  const main = readFileSync(join(dir, "elements/procedures/p_main.json"), "utf8");
  assert.ok(main.includes('"procedure": "p_assist"') && main.includes("PAssistProcedure.execute") && !main.includes("PHelperProcedure"), "call block and java_code class renamed");
  assert.ok(main.includes("GemBlockRenderer is unrelated"), "the comment stays");
  const guiText = readFileSync(join(dir, "elements/guis/shop.json"), "utf8");
  assert.ok(guiText.includes('"procedure": "p_assist"') && !guiText.includes("p_helper"));
  assert.ok(readFileSync(join(dir, "elements/blocks/ruby_block.json"), "utf8").includes('"onRightClicked": "p_assist"'));
  assert.ok(readFileSync(join(dir, "elements/procedures/p_assist.json"), "utf8").includes('"procedure": "p_assist"'), "the self call follows the rename");
  assert.equal(validateProject(loadProject(dir), dir).length, issuesBefore, "no new problems");

  // ---- rename: item (tags, datapack, translations, folders, recipe slots, quoted ids) ----
  const item = renameElement(dir, "item", "gem_item", "jewel");
  assert.ok(item.datapack.some((f) => f.path.endsWith("money.json")) && item.tags);
  assert.ok(readFileSync(join(dir, "datapack/refmod/tags/items/money.json"), "utf8").includes('"refmod:jewel"'));
  assert.ok(readFileSync(join(dir, "tags.json"), "utf8").includes('"jewel"'));
  const recipe = readFileSync(join(dir, "elements/recipes/gem_block.json"), "utf8");
  assert.ok(recipe.includes('"refmod:jewel"') && recipe.includes('"recipeReturnStack": "jewel"') && !recipe.includes("gem_item"));
  assert.ok(readFileSync(join(dir, "elements/guis/shop.json"), "utf8").includes('"limit": "jewel"'));
  assert.ok(readFileSync(join(dir, "elements/procedures/p_main.json"), "utf8").includes('"item": "refmod:jewel"'));
  assert.ok(readFileSync(join(dir, "elements/procedures/p_main.json"), "utf8").includes('String s = \\"refmod:jewel\\"'));
  for (const lang of ["en_us", "tr_tr"]) {
    const loc = loadProject(dir).localization[lang];
    assert.equal(loc["item.refmod.jewel"], "Gem");
    assert.equal(loc["item.refmod.gem_item_other"], "keep", "a longer key that merely starts with the id stays");
    assert.ok(!("item.refmod.gem_item" in loc));
  }
  assert.equal(loadProject(dir).folders?.placement["item/jewel"], "Econ");
  assert.ok(!("item/gem_item" in (loadProject(dir).folders?.placement ?? {})));

  // ---- rename: owned texture moves, shared one does not ----
  const block = renameElement(dir, "block", "gem_block", "crystal_block");
  assert.deepEqual(block.textures, [{ from: "textures/blocks/gem_block.png", to: "textures/blocks/crystal_block.png" }]);
  assert.ok(existsSync(join(dir, "textures/blocks/crystal_block.png")) && existsSync(join(dir, "textures/blocks/crystal_block.png.mcmeta")));
  assert.ok(!existsSync(join(dir, "textures/blocks/gem_block.png")) && !existsSync(join(dir, "textures/blocks/gem_block.png.mcmeta")));
  assert.ok(readFileSync(join(dir, "elements/blocks/crystal_block.json"), "utf8").includes('"texture": "textures/blocks/crystal_block.png"'));
  const shared = renameElement(dir, "block", "ruby_block", "red_block");
  assert.deepEqual(shared.textures, [], "other_block uses the texture too, so it is not owned");
  assert.ok(existsSync(join(dir, "textures/blocks/ruby_block.png")));
  assert.ok(readFileSync(join(dir, "datapack/refmod/tags/items/money.json"), "utf8").includes('"refmod:red_block"'), "datapack id of the renamed block");
  assert.equal(readFileSync(join(dir, "elements/guis/shop.json"), "utf8").includes("red_block"), false);
  renameElement(dir, "gui", "shop", "store");
  assert.equal(loadProject(dir).localization.en_us["gui.refmod.store.buy"], "Buy", "widget translations follow the gui id");
  assert.equal(loadProject(dir).folders?.placement["gui/store"], "Econ");
  assert.ok(readFileSync(join(dir, "elements/blocks/red_block.json"), "utf8").includes('"guiBoundTo": "store"'));

  // ---- atomic: a failure at any step restores everything ----
  let failing = 0;
  for (let step = 0; step < 20; step++) {
    const copy = join(root, `fail-${step}`);
    buildRefsProject(copy);
    const snapshot = fingerprint(copy);
    let threw = false;
    try {
      renameElement(copy, "item", "gem_item", "jewel", { onStep: (i) => { if (i === step) throw new Error(`injected at ${i}`); } });
    } catch (error) {
      threw = true;
      assert.match((error as Error).message, /undone/);
    }
    if (!threw) {
      assert.notEqual(fingerprint(copy), snapshot, "a rename that went through changed the project");
      break;
    }
    failing++;
    assert.equal(fingerprint(copy), snapshot, `project differs after a failure at step ${step}`);
  }
  assert.ok(failing >= 6, `expected the item rename to have 6+ steps, saw ${failing}`);
  console.log(`rename-check OK (rename steps checked: ${failing})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
