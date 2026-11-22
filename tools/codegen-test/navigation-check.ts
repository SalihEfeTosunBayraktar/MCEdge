// Q261: entity_navigate_to / entity_navigation_done are generated on every engine with the mob navigation calls and
// have en/tr labels and tips. Statement is server side, the value block works on both sides.
// usage: node tools/codegen-test/navigation-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../src/paths.ts";
import { blockGenerated } from "../../src/procedures/analyze.ts";
import { BLOCKS_BY_ID } from "../../src/procedures/blocks/index.ts";
import { HELPERS } from "../../src/procedures/helpers.ts";

const nav = BLOCKS_BY_ID.get("entity_navigate_to");
const done = BLOCKS_BY_ID.get("entity_navigation_done");
assert.ok(nav && done, "blocks exist");
assert.equal(nav.side, "server");
assert.equal(done.output, "logic");
for (const [gen, loader] of [["1.16.5", "forge"], ["1.21.5", "neoforge"], ["1.21.5", "fabric"], ["26.3", "neoforge"], ["26.3", "fabric"]] as const) {
  assert.ok(blockGenerated(nav, gen, loader) && blockGenerated(done, gen, loader), `generated on ${gen}/${loader}`);
}
const j = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, string>;
const body = (name: string) => (HELPERS[name].code as unknown as { all: (j: Record<string, string>) => string }).all(j);
assert.match(body("navigateTo"), /instanceof Mob\) \(\(Mob\) entity\)\.getNavigation\(\)\.moveTo\(x, y, z, speed\)/, "navigateTo uses the mob navigation");
assert.match(body("navigationDone"), /!\(entity instanceof Mob\) \|\| \(\(Mob\) entity\)\.getNavigation\(\)\.isDone\(\)/, "navigationDone is true for non-mobs");
for (const lang of ["en", "tr"]) {
  const text = JSON.parse(readFileSync(join(ROOT, `config/procedure-blocks/${lang}.json`), "utf8")) as { blocks: Record<string, string>; tips: Record<string, string> };
  for (const id of ["entity_navigate_to", "entity_navigation_done"]) {
    assert.ok(text.blocks[id]?.includes("%entity"), `${lang}: ${id} label`);
    assert.ok(text.tips[id], `${lang}: ${id} tip`);
  }
  for (const k of ["%x", "%y", "%z", "%speed"]) assert.ok(text.blocks.entity_navigate_to.includes(k), `${lang}: label has ${k}`);
}
console.log("navigation-check OK");
