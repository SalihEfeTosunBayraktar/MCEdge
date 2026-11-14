// Renames a few elements of a real project on a throwaway copy and checks nothing was lost: the reference count and the
// problem count stay the same. The given project is only read. usage: node tools/codegen-test/rename-real-check.ts <project dir>
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAllReferences, referencesOf } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { renameElement } from "../../src/ir/rename.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";

const [source] = process.argv.slice(2);
if (!source) throw new Error("usage: rename-real-check.ts <project dir>");
const root = mkdtempSync(join(tmpdir(), "mcedge-real-"));
try {
  const dir = join(root, "copy");
  cpSync(source, dir, { recursive: true, filter: (path) => !/[\/](out|build|\.git)([\/]|$)/.test(path.slice(source.length)) });
  const problems = () => validateProject(loadProject(dir), dir).length;
  const total = () => findAllReferences(loadReferenceInput(dir)).length;
  const pick = (type: string, wanted: (users: number) => boolean) => {
    const input = loadReferenceInput(dir);
    const all = findAllReferences(input);
    return input.elements[type].map((e) => ({ id: e.id, users: referencesOf(all, { type, id: e.id }).usedBy.length })).filter((c) => wanted(c.users)).sort((a, b) => b.users - a.users)[0];
  };
  const startProblems = problems();
  let refs = total();
  for (const [type, wanted] of [["procedure", (n: number) => n > 2], ["gui", (n: number) => n > 0], ["block", (n: number) => n > 3], ["item", (n: number) => n > 3], ["recipe", () => true], ["creative_tab", (n: number) => n > 0]] as const) {
    const choice = pick(type, wanted);
    if (!choice) continue;
    const result = renameElement(dir, type, choice.id, `${choice.id}_renamed`);
    assert.equal(total(), refs, `${type}/${choice.id}: reference count changed`);
    assert.equal(problems(), startProblems, `${type}/${choice.id}: problem count changed`);
    console.log(`${type}/${choice.id} (${choice.users} users) -> ${result.newId}: ${result.referencesChanged} places, ${result.changedElements.length} other elements, ${result.renamedKeys.length} translation keys, ${result.textures.length} textures, ${result.datapack.length} datapack files; warnings ${result.warnings.length}`);
    refs = total();
  }
  console.log(`rename-real-check OK (problems ${startProblems} before and after)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
