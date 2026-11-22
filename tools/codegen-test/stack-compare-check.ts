// Q256: compare_itemstacks_full is generated on every engine with the right Java, has en/tr text and a tip.
// usage: node tools/codegen-test/stack-compare-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../src/paths.ts";
import { blockGenerated } from "../../src/procedures/analyze.ts";
import { BLOCKS_BY_ID } from "../../src/procedures/blocks/index.ts";

const def = BLOCKS_BY_ID.get("compare_itemstacks_full");
assert.ok(def, "block exists");
const j = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, string>;
const ctx = (gen: string) => ({ gen, i: { a: "A", b: "B" }, f: {}, j }) as never;
const src = def.code as unknown as { "1.16.5": (c: never) => string; modern: (c: never) => string };
for (const [gen, loader] of [["1.16.5", "forge"], ["1.21.5", "neoforge"], ["1.21.5", "fabric"], ["26.3", "neoforge"], ["26.3", "fabric"]] as const) {
  assert.ok(blockGenerated(def, gen, loader), `generated on ${gen}/${loader}`);
  const java = (gen === "1.16.5" ? src["1.16.5"] : src.modern)(ctx(gen));
  if (gen === "1.16.5") assert.equal(java, "(A.sameItem(B) && ItemStack.tagMatches(A, B))");
  else assert.equal(java, "ItemStack.isSameItemSameComponents(A, B)");
}
for (const lang of ["en", "tr"]) {
  const text = JSON.parse(readFileSync(join(ROOT, `config/procedure-blocks/${lang}.json`), "utf8")) as { blocks: Record<string, string>; tips: Record<string, string> };
  const label = text.blocks.compare_itemstacks_full;
  assert.ok(label && label.includes("%a") && label.includes("%b"), `${lang}: label`);
  assert.ok(text.tips.compare_itemstacks_full, `${lang}: tip`);
}
console.log("stack-compare-check OK");
