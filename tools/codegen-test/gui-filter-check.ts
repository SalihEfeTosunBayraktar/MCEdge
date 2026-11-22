// Q257: a slot's place filter (`allowed` rows of items and #tags, plus `limit`) is generated into mayPlace on every
// engine, adds to lockCondition (not locked AND matches), and the menu's moveItemStackTo (shift click) asks mayPlace.
// Generates the test project (no Gradle) and reads FilterGuiMenu.java (filter_gui). Run tools/codegen-test/make.ts first
// when spec.ts changed.
// usage: node tools/codegen-test/gui-filter-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
for (const engine of ["forge-1.16.5", "neoforge-1.21.5", "neoforge-26.3", "fabric-1.21.5", "fabric-26.3"]) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(gen.status, 0, `${engine}: generate failed\n${gen.stdout}${gen.stderr}`);
  const menu = readFileSync(join(T, "project/out", engine, "src/main/java/dev/mcedge/wavethree/world/inventory/FilterGuiMenu.java"), "utf8");
  const legacy = engine.startsWith("forge");
  const places = [...menu.matchAll(/mayPlace\([^)]*\) \{ return ([^;]*); \}/g)].map((m) => m[1]);
  const pickups = [...menu.matchAll(/mayPickup\([^)]*\) \{ return ([^;]*); \}/g)].map((m) => m[1]);
  assert.equal(places.length, 4, `${engine}: slots 0, 1, 3 and 4 have mayPlace (slot 2 is plain): ${places.length}`);
  // Slot 0: not locked AND the gem tag; the #forge tag follows the version (#c from 1.21).
  assert.ok(/^!\S*NeverProcedure\.execute\(\) && \(/.test(places[0]), `${engine}: slot 0 lock and filter: ${places[0]}`);
  assert.ok(legacy ? places[0].includes("stack.getItem().is(net.minecraft.tags.ItemTags.createOptional(") && places[0].includes("\"forge:gems\"") : places[0].includes("stack.is(net.minecraft.tags.TagKey.create(") && places[0].includes("\"c:gems\""), `${engine}: slot 0 tag: ${places[0]}`);
  assert.ok(/^!\S*NeverProcedure\.execute\(\) && \("minecraft:paper"\.equals\(/.test(places[1]), `${engine}: slot 1 lock and item: ${places[1]}`);
  assert.ok(/^!\S*AlwaysProcedure\.execute\(\) && \("minecraft:bone"\.equals\(.*\|\| "minecraft:stick"\.equals\(/.test(places[2]), `${engine}: slot 3 lock and (limit or allowed): ${places[2]}`);
  assert.ok(/^\("minecraft:stick"\.equals\(/.test(places[3]), `${engine}: slot 4 item only: ${places[3]}`);
  assert.equal(pickups.length, 3, `${engine}: the locked slots refuse pickup`);
  assert.ok(/Slot\(container, 2, \d+, \d+\)\)\);/.test(menu), `${engine}: slot 2 (no filter, no lock) is a plain slot`);
  const move = menu.slice(menu.indexOf("protected boolean moveItemStackTo("), menu.indexOf("public boolean clickMenuButton("));
  assert.equal(move.split("slot.mayPlace(stack)").length - 1, 2, `${engine}: shift click checks mayPlace in both loops`);
  // Q258: filtered slots (FilterSlot) get the stack first, then the rest; the filtered slots are exactly 0, 1, 3 and 4.
  assert.equal([...menu.matchAll(/new FilterSlot\(container, (\d+),/g)].map((m) => m[1]).join(","), "0,1,3,4", `${engine}: filtered slots are FilterSlots`);
  assert.ok(/private static class FilterSlot extends \S*Slot \{/.test(menu), `${engine}: FilterSlot class`);
  assert.ok(move.includes("for (boolean preferred : new boolean[] {true, false})") && move.split("preferred != (slot instanceof FilterSlot)").length - 1 === 2, `${engine}: two passes, preferred then the rest, in both loops`);
}
console.log("gui-filter-check OK");
