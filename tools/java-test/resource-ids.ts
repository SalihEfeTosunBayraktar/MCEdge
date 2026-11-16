/**
 * Q240: the mod's own registry ids and resource paths offered inside Java strings (pure functions, no app).
 *   node tools/java-test/resource-ids.ts
 */
import { collectResourceIds, matchResourceIds, stringAtCursor } from "../../src/java/resourceIds.ts";
import { scanModResources } from "../../src/java/scanResources.ts";
import { copyProject } from "../ui-test/cdp.ts";
import { assert } from "../mcp-test/client.ts";

const ids = collectResourceIds({
  files: [
    "assets/demo/blockstates/ruby_block.json",
    "assets/demo/models/item/ruby.json",
    "assets/demo/models/block/ruby_block.json",
    "assets/demo/textures/item/ruby.png",
    "assets/demo/textures/gui/panel.png",
    "assets/demo/particles/spark.json",
    "assets/demo/sounds/ding.ogg",
    "assets/demo/lang/en_us.json",
    "data/demo/recipes/ruby_block.json",
    "data/demo/recipe/ruby_new.json",
    "data/demo/loot_tables/blocks/ruby_block.json",
    "data/demo/tags/items/gems.json",
    "data/demo/advancements/first_ruby.json",
    "data/demo/README.txt",
    "pack.mcmeta",
  ],
  sounds: { demo: ["ding", "machine.hum"] },
  lang: { demo: ["item.demo.ruby", "block.demo.ruby_block", "entity.demo.golem", "gui.demo.title", "item.other.thing"] },
});
const kinds = (id: string) => ids.find((e) => e.id === id)?.kinds.join(",");

assert(kinds("demo:ruby") === "item", `item id from models/item and lang: ${kinds("demo:ruby")}`);
assert(kinds("demo:ruby_block") === "block,recipe", `block id from blockstates and lang, recipe of the same name: ${kinds("demo:ruby_block")}`);
assert(kinds("demo:block/ruby_block") === "model", "model ids");
assert(kinds("demo:item/ruby") === "model,texture" && kinds("demo:gui/panel") === "texture", `texture sprite ids: ${kinds("demo:item/ruby")}`);
assert(kinds("demo:textures/gui/panel.png") === "path" && kinds("demo:sounds/ding.ogg") === "path", "resource paths");
assert(kinds("demo:spark") === "particle", "particle");
assert(kinds("demo:ding") === "sound" && kinds("demo:machine.hum") === "sound", "sounds.json events");
assert(kinds("demo:ruby_new") === "recipe", "1.21 recipe folder");
assert(kinds("demo:blocks/ruby_block") === "loot_table", "loot table");
assert(kinds("demo:gems") === "tag", "tag");
assert(kinds("demo:first_ruby") === "advancement", "advancement");
assert(kinds("demo:golem") === "entity", "entity from lang");
assert(kinds("gui.demo.title") === "lang" && kinds("item.demo.ruby") === "lang", "lang keys");
assert(!kinds("demo:thing") && !ids.some((e) => e.id.includes("README")), "other namespaces' lang ids and stray files are not ids");
assert(ids.every((e, i) => i === 0 || ids[i - 1].id.localeCompare(e.id) <= 0), "sorted");

// The string under the cursor.
assert(JSON.stringify(stringAtCursor(`new ResourceLocation("demo:ru`, 29)) === JSON.stringify({ start: 22, prefix: "demo:ru" }), "inside a string: prefix");
assert(stringAtCursor(`foo("a", b`, 10) === undefined, "after a closed string: none");
assert(stringAtCursor(`x = "a\\"b`, 9)?.prefix === "a\\\"b", "escaped quote stays inside");
assert(stringAtCursor(`char c = '"'; foo(`, 18) === undefined, "a quote char literal does not open a string");
assert(stringAtCursor(`// "comment`, 11) === undefined, "comments are not strings");
assert(stringAtCursor(`foo("")`, 5)?.prefix === "", "empty string");

// Matching.
assert(matchResourceIds(ids, "demo:ru").map((e) => e.id).every((id) => id.startsWith("demo:ru")), "prefix match");
assert(matchResourceIds(ids, "panel")[0].id.includes("panel"), "substring match");
assert(matchResourceIds(ids, "demo", 3).length === 3, "limit");
assert(matchResourceIds(ids, "a b").length === 0, "text with spaces is not an id");

// A real mod on disk (read-only copy).
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-Legacy", "ETREconomy-Legacy");
const real = collectResourceIds(scanModResources(project));
const has = (id: string, kind: string) => real.some((e) => e.id === id && e.kinds.includes(kind as never));
assert(real.length > 100, `ETREconomy-Legacy has ${real.length} ids`);
assert(has("etreco:admin_book", "item"), "etreco:admin_book is an item");
assert(has("etreco:textures/screens/adminbook.png", "path"), "screen texture path");
assert(real.some((e) => e.kinds.includes("recipe")) && real.some((e) => e.kinds.includes("advancement")), "recipes and advancements");
console.log("PASS resource ids");
