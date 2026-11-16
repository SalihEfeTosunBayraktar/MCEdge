/**
 * Q222: unused_translation_keys on a copy of examples/hello with the item "gem" (cascade-fixture.ts): keys no element creates or
 * names are listed per language, keys the engine needs by name (a sound subtitle, a key binding category, a vanilla text) and keys
 * elements or programs use are kept, a key left behind by a deleted element is found, and `remove` deletes the listed keys.
 *   node tools/mcp-test/unused-translations.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";
import { buildCascadeFixture } from "./cascade-fixture.ts";

const project = exampleProject();
buildCascadeFixture(project);
const file = (language: string) => JSON.parse(readFileSync(join(project, `localization/${language}.json`), "utf8")) as Record<string, string>;
const keysOf = (report: { languages: Record<string, { keys: { key: string }[] }> }, language: string) => (report.languages[language]?.keys ?? []).map((k) => k.key);
const mcp = await connect(project);
try {
  assert(mcp.tools.includes("unused_translation_keys"), "the tool is offered");
  const report = await mcp.call("unused_translation_keys");
  assert(keysOf(report, "en_us").join() === "item.hellomcedge.long_gone,old.removed_block", `en_us unused: ${keysOf(report, "en_us")}`);
  assert(keysOf(report, "tr_tr").join() === "old.removed_block", `tr_tr unused: ${keysOf(report, "tr_tr")}`);
  assert(report.keys === 2 && report.languages.en_us.count === 2 && report.languages.en_us.keys[1].text === "Leftover", `counts and texts: ${JSON.stringify(report)}`);
  const kept = ["subtitles.hellomcedge.chime", "key.categories.hellomcedge", "item.minecraft.diamond", "gem.msg", "shared.msg", "item.hellomcedge.gem", "gui.hellomcedge.gem_menu", "item.hellomcedge.ruby"];
  assert(kept.every((k) => !keysOf(report, "en_us").includes(k)), "engine-needed keys and keys elements or programs use are kept");

  // A key left behind by a deleted element is found; one a remaining element still uses is not.
  await mcp.call("delete_element", { type: "item", id: "gem" });
  const after = await mcp.call("unused_translation_keys");
  assert(keysOf(after, "en_us").includes("item.hellomcedge.gem") && keysOf(after, "tr_tr").includes("item.hellomcedge.gem"), `the deleted item's name key is unused in both languages: ${keysOf(after, "tr_tr")}`);
  assert(!keysOf(after, "en_us").includes("gem.msg") && !keysOf(after, "en_us").includes("gui.hellomcedge.gem_menu"), "keys gem_use and gem_menu still use are kept");

  // Remove: one language, then all; the report empties.
  assert((await mcp.call("unused_translation_keys", { languages: ["nl_nl"] }, true)).includes("no nl_nl"), "an unknown language is refused");
  const one = await mcp.call("unused_translation_keys", { languages: ["tr_tr"], remove: true });
  assert(one.removed.tr_tr === 2 && !("old.removed_block" in file("tr_tr")) && "old.removed_block" in file("en_us"), `removed from tr_tr only: ${JSON.stringify(one.removed)}`);
  assert(file("tr_tr")["gem.msg"] === "Mücevher buldun", "used keys of tr_tr stay");
  await mcp.call("unused_translation_keys", { remove: true });
  assert(!("old.removed_block" in file("en_us")) && !("item.hellomcedge.gem" in file("en_us")) && "shared.msg" in file("en_us") && "subtitles.hellomcedge.chime" in file("en_us"), "everything unused is removed from en_us, the rest stays");
  const clean = await mcp.call("unused_translation_keys");
  assert(clean.keys === 0 && Object.keys(clean.languages).length === 0, `nothing unused is left: ${JSON.stringify(clean)}`);
  console.log("PASS");
} finally {
  await mcp.close();
}
