// Changing the mod id and package (src/ir/modIdentity.ts, KUYRUK 121) on a throwaway project: every "<mod>:" id,
// translation key, datapack folder and package name follows, nothing else changes, and refusals and failures leave the
// project as it was. usage: node tools/codegen-test/identity-check.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeModIdentity } from "../../src/ir/modIdentity.ts";
import { findAllReferences } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { addElement } from "../ui-test/fixtures.ts";
import { buildRefsProject, fingerprint } from "./refs-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "mcedge-identity-"));
const read = (dir: string, path: string) => JSON.parse(readFileSync(join(dir, path), "utf8"));
try {
  const dir = join(root, "p");
  buildRefsProject(dir);
  addElement(dir, "custom_element", "gem_logic", { code: "package refmod.custom;\n\nimport refmod.init.RefmodItems;\n\npublic class GemLogic { String id = \"refmod:gem_item\"; }\n" });
  const refsBefore = findAllReferences(loadReferenceInput(dir)).length;
  const issuesBefore = validateProject(loadProject(dir), dir).length;
  const before = fingerprint(dir);

  // ---- dry run reports and writes nothing ----
  const dry = changeModIdentity(dir, { modId: "gemmod", package: "dev.gem.mod" }, { dryRun: true });
  assert.equal(dry.applied, false);
  assert.deepEqual(dry.modId, { from: "refmod", to: "gemmod" });
  assert.equal(dry.keysRenamed, 5, "five keys carry the mod id");
  assert.deepEqual(dry.datapackMoved, { from: "datapack/refmod", to: "datapack/gemmod" });
  assert.ok(dry.filesChanged.includes("datapack/gemmod/tags/items/money.json"), `datapack file listed at its new place: ${dry.filesChanged.join(", ")}`);
  assert.equal(fingerprint(dir), before, "dry run wrote files");

  // ---- refusals leave the project alone ----
  for (const [change, message] of [
    [{ modId: "Bad Id" }, /not a valid mod id/], [{ package: "Dev..x" }, /not a valid Java package/], [{ modId: "refmod", package: "refmod" }, /nothing to change/],
  ] as const) {
    assert.throws(() => changeModIdentity(dir, change), message);
    assert.equal(fingerprint(dir), before, `refusal of ${JSON.stringify(change)} wrote files`);
  }
  mkdirSync(join(dir, "datapack", "taken"));
  assert.throws(() => changeModIdentity(dir, { modId: "taken" }), /already exists/);
  rmSync(join(dir, "datapack", "taken"), { recursive: true });
  assert.equal(fingerprint(dir), before, "refusal for a taken datapack folder wrote files");

  // ---- a failure halfway is undone ----
  assert.throws(() => changeModIdentity(dir, { modId: "gemmod", package: "dev.gem.mod" }, { onStep: (i) => { if (i === 3) throw new Error("disk full"); } }), /undone/);
  assert.equal(fingerprint(dir), before, "failed change left files behind");
  const lastStep = dry.filesChanged.length; // writes, the datapack move, then mcedge.json
  assert.throws(() => changeModIdentity(dir, { modId: "gemmod" }, { onStep: (i) => { if (i === lastStep) throw new Error("locked"); } }), /undone/);
  assert.equal(fingerprint(dir), before, "failure after the datapack move left files behind");
  assert.ok(existsSync(join(dir, "datapack/refmod")) && !existsSync(join(dir, "datapack/gemmod")), "datapack folder moved back");

  // ---- the change ----
  const done = changeModIdentity(dir, { modId: "gemmod", package: "dev.gem.mod" });
  assert.equal(done.applied, true);
  const mod = loadProject(dir).mod;
  assert.equal(mod.id, "gemmod");
  assert.equal(mod.package, "dev.gem.mod");
  for (const lang of ["en_us", "tr_tr"]) {
    const map = read(dir, `localization/${lang}.json`);
    assert.deepEqual(Object.keys(map).sort(), ["block.gemmod.gem_block", "gui.gemmod.shop.buy", "gui.gemmod.shop.title", "item.gemmod.gem_item", "item.gemmod.gem_item_other", "plain"]);
    assert.equal(map["item.gemmod.gem_item"], "Gem", "texts kept");
  }
  const tags = read(dir, "tags.json").tags[0];
  assert.equal(tags.id, "gemmod:gems");
  assert.deepEqual(tags.entries, ["gem_item", "gemmod:gem_block", "minecraft:diamond", "#c:gems"]);
  assert.ok(!existsSync(join(dir, "datapack/refmod")), "old datapack folder gone");
  assert.deepEqual(read(dir, "datapack/gemmod/tags/items/money.json").values, ["gemmod:gem_item", "gemmod:ruby_block", "minecraft:gold_ingot"]);
  assert.equal(read(dir, "elements/recipes/gem_item.json").recipeSlots[4], "gemmod:gem_item");
  const proc = readFileSync(join(dir, "elements/procedures/p_main.json"), "utf8");
  assert.ok(proc.includes("gemmod:gem_item") && !proc.includes("refmod:"), "procedure ids follow");
  const code = read(dir, "elements/custom_elements/gem_logic.json").code as string;
  assert.ok(code.startsWith("package dev.gem.mod.custom;") && code.includes("import dev.gem.mod.init.RefmodItems;") && code.includes("\"gemmod:gem_item\""), `custom code follows: ${code}`);
  assert.equal(findAllReferences(loadReferenceInput(dir)).length, refsBefore, "every reference kept");
  assert.equal(validateProject(loadProject(dir), dir).length, issuesBefore, "no new problems");

  // ---- the package alone: ids stay ----
  const pkg = changeModIdentity(dir, { package: "dev.gem.other" });
  assert.equal(pkg.modId, undefined);
  assert.equal(pkg.keysRenamed, 0);
  assert.ok((read(dir, "elements/custom_elements/gem_logic.json").code as string).startsWith("package dev.gem.other.custom;"));
  assert.equal(read(dir, "tags.json").tags[0].id, "gemmod:gems");
  console.log("identity-check: dry run, refusals, rollback, id + package change and package-only change OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}
