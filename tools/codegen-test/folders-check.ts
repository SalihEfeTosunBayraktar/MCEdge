// Checks the project folder rules (src/ir/folders.ts): renames carry placements, removing moves contents up, bad
// names and targets are refused. usage: node tools/codegen-test/folders-check.ts
import assert from "node:assert/strict";
import { addFolder, ensureFolder, moveElement, moveElements, moveFolder, NO_FOLDERS, removeFolder, renameFolder, setFolderColor, subfolders, summarizeFolders } from "../../src/ir/folders.ts";

let s = addFolder(NO_FOLDERS, "", "Economy");
s = addFolder(s, "Economy", "Shops");
s = addFolder(s, "Economy/Shops", "Old");
s = moveElement(s, "block/a", "Economy/Shops");
s = moveElement(s, "item/b", "Economy/Shops/Old");
assert.deepEqual(subfolders(s, "Economy"), ["Economy/Shops"]);

const renamed = renameFolder(s, "Economy/Shops", "Stores");
assert.equal(renamed.placement["block/a"], "Economy/Stores");
assert.equal(renamed.placement["item/b"], "Economy/Stores/Old");
assert.ok(renamed.folders.includes("Economy/Stores/Old"));

const removed = removeFolder(s, "Economy/Shops");
assert.equal(removed.placement["block/a"], "Economy");
assert.equal(removed.placement["item/b"], "Economy/Old");
assert.deepEqual([...removed.folders].sort(), ["Economy", "Economy/Old"]);

const top = removeFolder(removeFolder(s, "Economy/Shops/Old"), "Economy/Shops");
assert.equal(removeFolder(top, "Economy").placement["block/a"], undefined);

assert.equal(moveElement(s, "block/a", "").placement["block/a"], undefined);
assert.throws(() => moveElement(s, "block/a", "Nowhere"));
assert.throws(() => addFolder(s, "", "a/b"));
assert.throws(() => addFolder(s, "", "Economy"));
assert.throws(() => renameFolder(s, "Economy/Shops/Old", "../x"));
// Bulk work: parents are created, many elements move in one pass, the summary counts.
const deep = ensureFolder(NO_FOLDERS, "A/B/C");
assert.deepEqual(deep.created, ["A", "A/B", "A/B/C"]);
assert.deepEqual(ensureFolder(deep.state, "A/B/D").created, ["A/B/D"], "only the missing folders are created");
assert.throws(() => ensureFolder(deep.state, "A/B"), /exists/);
assert.throws(() => ensureFolder(NO_FOLDERS, "A//B"), /bad folder name/);
assert.throws(() => ensureFolder(NO_FOLDERS, "A/b\\c"), /bad folder name/);
const many = moveElements(deep.state, ["item/a", "item/b", "block/c"], "A/B");
assert.deepEqual(many.placement, { "item/a": "A/B", "item/b": "A/B", "block/c": "A/B" });
assert.deepEqual(moveElements(many, ["item/a", "block/c"], "").placement, { "item/b": "A/B" });
assert.throws(() => moveElements(deep.state, ["item/a"], "Nowhere"), /no folder/);
const sum = summarizeFolders(moveElement(many, "item/d", "A"), new Set(["item/a", "item/b", "block/c", "item/d", "item/e", "item/gone_not_listed"]));
assert.deepEqual(sum.folders.map((f) => [f.path, f.elements, f.total, f.subfolders]), [["A", 1, 4, 1], ["A/B", 3, 3, 1], ["A/B/C", 0, 0, 0]]);
assert.equal(sum.unfiled, 2, "elements in no folder: item/e and item/gone_not_listed");
// Colours follow their folder through rename, move and remove; a folder without one leaves folders.json as it was.
const painted = setFolderColor(setFolderColor(s, "Economy/Shops", "#5A8FE0"), "Economy", "#112233");
assert.deepEqual(painted.colors, { "Economy/Shops": "#5a8fe0", Economy: "#112233" });
assert.deepEqual(renameFolder(painted, "Economy", "Trade").colors, { "Trade/Shops": "#5a8fe0", Trade: "#112233" });
assert.deepEqual(removeFolder(painted, "Economy/Shops").colors, { Economy: "#112233" });
assert.deepEqual(removeFolder(painted, "Economy").colors, { Shops: "#5a8fe0" });
assert.equal(setFolderColor(painted, "Economy", "").colors?.Economy, undefined);
assert.equal("colors" in setFolderColor(setFolderColor(s, "Economy", "#112233"), "Economy", ""), false);
assert.equal(summarizeFolders(painted, new Set()).folders.find((f) => f.path === "Economy")?.color, "#112233");
assert.throws(() => setFolderColor(s, "Economy", "blue"), /bad colour/);
assert.throws(() => setFolderColor(s, "Nowhere", "#112233"), /no folder/);

// Moving a folder takes its subfolders, elements and colours along.
const moved = moveFolder(painted, "Economy/Shops", "");
assert.deepEqual([...moved.folders].sort(), ["Economy", "Shops", "Shops/Old"]);
assert.equal(moved.placement["block/a"], "Shops");
assert.equal(moved.placement["item/b"], "Shops/Old");
assert.deepEqual(moved.colors, { Shops: "#5a8fe0", Economy: "#112233" });
assert.throws(() => moveFolder(s, "Economy", "Economy/Shops"), /into itself/);
assert.throws(() => moveFolder(addFolder(s, "", "Shops"), "Economy/Shops", ""), /exists/);
console.log("folders-check OK");
