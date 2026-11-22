/**
 * Fast gate for the template gallery (Q252), no Gradle: every starter of config/starters/gallery.json has its files,
 * adds cleanly to a fresh project (no validation problem, textures copied), has a valid smoke scenario and its name and
 * description in every UI language, and a starter is listed only with a passing record on every target.
 *   node tools/starters/check.ts
 * The slow check, real builds and a server run per target, is tools/starters/verify.ts, which writes the records.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scenarioProblems } from "../../src/build/scenario.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { createProject } from "../../src/ir/createProject.ts";
import { applyStarter, listStarters, loadStarter, starterScenario, starterTargets } from "../../src/ir/starters.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { ROOT } from "../../src/paths.ts";

const parent = mkdtempSync(join(tmpdir(), "mcedge-starters-check-"));
const strings = (lang: string) => JSON.parse(readFileSync(join(ROOT, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const [en, tr] = [strings("en"), strings("tr")];
try {
  const engines = listEngines().map((e) => e.id);
  assert.deepEqual([...starterTargets()].sort(), engines, `the gallery targets are the engines MCEdge has (${engines.join(", ")})`);
  const all = listStarters(true);
  assert.ok(all.length >= 5, "at least five starters");
  for (const starter of all) {
    const file = loadStarter(starter.id);
    for (const lang of [en, tr]) for (const part of ["name", "desc"]) assert.ok(lang[`starter.${starter.id}.${part}`]?.trim(), `starter.${starter.id}.${part} in en and tr`);
    for (const t of file.textures) assert.ok(existsSync(join(ROOT, "config", "starters", starter.id, t.from)), `${starter.id}: texture ${t.from} exists`);
    assert.deepEqual(scenarioProblems(starterScenario(starter.id, starter.params, "starters")), [], `${starter.id}: the smoke scenario is valid`);
    const dir = createProject({ parent, name: starter.id, modId: `t_${starter.id}`, package: `dev.t.${starter.id}`, template: "empty" });
    const result = applyStarter(dir, starter.id, starter.params);
    assert.ok(result.applied, `${starter.id}: adds cleanly ${JSON.stringify([result.errors, result.newProblems])}`);
    assert.deepEqual(validateProject(loadProject(dir), dir).map((i) => `${i.path}: ${i.message}`), [], `${starter.id}: no problems in the project`);
    for (const texture of result.textures) assert.ok(existsSync(join(dir, texture)), `${starter.id}: ${texture} copied`);
    assert.throws(() => applyStarter(dir, starter.id, starter.params), /already has/, `${starter.id}: the same name twice is refused`);
    assert.throws(() => applyStarter(dir, starter.id, { name: "Bad Name" }), /lowercase/, `${starter.id}: a bad name word is refused`);
    const twice = applyStarter(dir, starter.id, { name: "other" });
    assert.ok(twice.applied, `${starter.id}: another name word adds a second copy`);
    // The listing rule: listed only when every target built and passed the server test.
    const complete = starterTargets().every((t) => starter.verified[t]?.build === "pass" && starter.verified[t]?.server === "pass");
    assert.equal(starter.listed, complete, `${starter.id}: listed exactly when every target passed`);
    console.log(`ok  ${starter.id}: ${starter.elements.join(", ")} (${starter.listed ? "listed" : "not listed"})`);
  }
  // A project made from a starter, and one that cannot be made leaves nothing behind.
  const listed = listStarters();
  if (listed.length) {
    const dir = createProject({ parent, name: "From starter", modId: "from_starter", package: "dev.t.fromstarter", template: "empty", starter: { id: listed[0].id, params: listed[0].params } });
    assert.ok(Object.keys(loadProject(dir).elements).length > 0, "create_project with a starter has its elements");
  }
  assert.throws(() => createProject({ parent, name: "x", modId: "nope_mod", package: "dev.t.nope", template: "empty", starter: { id: "missing", params: {} } }), /no starter/);
  assert.equal(existsSync(join(parent, "nope_mod")), false, "a refused starter leaves no folder");
  console.log("starters check OK");
} finally {
  rmSync(parent, { recursive: true, force: true });
}
