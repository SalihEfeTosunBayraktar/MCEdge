// KUYRUK 139: Forge tags in procedure arguments follow the engine (config/common-tags.json through commonTag).
// Without arguments: the mapping and the generated procedure literals (build the test project with --no-gradle first). With <engine> <server log> (tags-check.sh): every
// "[tag] item <tag> <id>" line of the tagprobe command has an item, and every "[tag] block" line is true, except the
// tags the engine does not have (below, from the vanilla, Forge, NeoForge and Fabric tag files of each version).
// usage: node tools/codegen-test/tags-check.ts [<engine> <log>]
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { commonTag } from "../../src/generator/commonTags.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { PROBE_TAGS } from "./spec.ts";

const [engine, log] = process.argv.slice(2);
const print = console.log;
if (!engine) {
  const modern = { mc: "1.21.5" as const };
  const legacy = { mc: "1.16.5" as const };
  assert.equal(commonTag(modern, "forge:crops"), "c:crops");
  assert.equal(commonTag(modern, "forge:planks"), "minecraft:planks");
  assert.equal(commonTag(legacy, "forge:planks"), "minecraft:planks");
  assert.equal(commonTag(modern, "forge:sandstone"), "c:sandstone/blocks");
  assert.equal(commonTag(modern, "forge:heads"), "minecraft:skulls");
  assert.equal(commonTag(modern, "c:crops"), "c:crops");
  assert.equal(commonTag(legacy, "forge:crops"), "forge:crops");
  assert.equal(commonTag(legacy, "c:crops"), "forge:crops");
  assert.equal(commonTag(legacy, "c:sandstone/blocks"), "forge:sandstone");
  assert.equal(commonTag(legacy, "minecraft:skulls"), "forge:heads");
  assert.equal(commonTag(legacy, "c:dyed/red"), "forge:glass/red");
  assert.equal(commonTag(legacy, "minecraft:logs"), "minecraft:logs");
  // A tag the project ships keeps its id.
  assert.equal(commonTag({ mc: "26.3", ownTags: new Set(["forge:key"]) }, "forge:key"), "forge:key");
  assert.equal(commonTag({ mc: "1.16.5", ownTags: new Set(["c:coins"]) }, "c:coins"), "c:coins");
  // The generated tagprobe procedure carries the engine's tag literals.
  for (const [e, want, not] of [["neoforge-1.21.5", "c:crops", "forge:crops"], ["fabric-26.3", "minecraft:planks", "forge:planks"], ["forge-1.16.5", "forge:crops", "c:crops"]]) {
    const file = `${import.meta.dirname}/project/out/${e}/src/main/java/dev/mcedge/wavethree/procedures/TagprobeCommandProgram.java`;
    const java = readFileSync(file, "utf8");
    assert.ok(java.includes(`"${want}"`), `${e}: ${want} in the tagprobe procedure`);
    assert.ok(!java.includes(`"${not}"`), `${e}: no ${not} in the tagprobe procedure`);
  }
  // Tag files follow the engine too: a project tag forge:ores (its id and a #forge: entry) is c:ores from 1.21;
  // a forge: tag the project ships in datapack/ keeps its id.
  const dir = mkdtempSync(join(tmpdir(), "mcedge-tags-"));
  try {
    cpSync(join(import.meta.dirname, "project/mcedge.json"), join(dir, "mcedge.json"));
    writeFileSync(join(dir, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "forge:ores", entries: ["minecraft:stone", "#forge:gems", "#forge:key"] }] }));
    mkdirSync(join(dir, "datapack/forge/tags/items"), { recursive: true });
    writeFileSync(join(dir, "datapack/forge/tags/items/key.json"), JSON.stringify({ values: ["minecraft:tripwire_hook"] }));
    const project = loadProject(dir);
    for (const [e, file, gems] of [["neoforge-1.21.5", "c/tags/item/ores.json", "#c:gems"], ["forge-1.16.5", "forge/tags/items/ores.json", "#forge:gems"]]) {
      const out = join(dir, "out", e);
      console.log = () => {};
      generateTarget(project, dir, listEngines().find((x) => x.id === e)!, out);
      console.log = print;
      const values = JSON.parse(readFileSync(join(out, "src/main/resources/data", file), "utf8")).values;
      assert.deepEqual(values, ["minecraft:stone", gems, "#forge:key"], `${e}: ${file}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("tags-check: mapping OK");
} else {
  // 1.16.5 lacks the tags named after it (Forge 1.20 names, their c: tags) and has forge:dirt as a block tag only;
  // forge:immovable is a block tag everywhere.
  const empty = engine === "forge-1.16.5"
    ? /^(forge:(dirt|cobblestone\/|glass_colorless|glass_panes_colorless|glass_silica|glass_tinted|immovable|stained_glass\/|tools\/)|minecraft:dirt|c:(cobblestones\/|glass_blocks\/(cheap|tinted)|relocation_not_supported|tools\/(bow|brush|crossbow|fishing_rod|shield)$))/
    : /^(forge:immovable|c:relocation_not_supported)$/;
  const text = readFileSync(log, "utf8");
  const items = new Map([...text.matchAll(/\[tag\] item (\S+) (\S+)/g)].map((m) => [m[1], m[2]]));
  const blocks = [...text.matchAll(/\[tag\] block (\S+) (\S+) (\S+)/g)];
  const bad: string[] = [];
  for (const tag of PROBE_TAGS) {
    const id = items.get(tag);
    if (id === undefined) bad.push(`${tag}: no probe line`);
    else if ((id === "minecraft:air") !== empty.test(tag)) bad.push(`${tag}: ${id} (want ${empty.test(tag) ? "air" : "an item"})`);
  }
  for (const [, tag, block, result] of blocks) if (result !== "true") bad.push(`block ${block} in ${tag}: ${result}`);
  if (blocks.length < 5) bad.push(`${blocks.length} block probe lines, want 5`);
  console.log(`${engine}: ${items.size} item tags, ${[...items.values()].filter((v) => v !== "minecraft:air").length} with items, ${blocks.length} block tests${bad.length ? `\n  ${bad.join("\n  ")}` : ""}`);
  process.exit(bad.length ? 1 : 0);
}
