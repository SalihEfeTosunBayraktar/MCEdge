/**
 * KUYRUK #19: element tags over MCP (set_tag, list_tags, delete_tag, problems in validate_project) and their
 * generation on all 5 engines (folder names per version, 1.16.5 skipping tag types it lacks). `--build` builds
 * fabric-1.21.5 and forge-1.16.5 with export_jar and checks the tag files are in the jars (heavy).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const mcp = await connect(project);
try {
  await mcp.call("create_element", { type: "function", id: "tick_economy" });
  const gems = await mcp.call("set_tag", { type: "item", id: "gems", entries: ["ruby", "minecraft:diamond", "#minecraft:coals"] });
  assert(gems.tag.id === "hellomcedge:gems" && gems.issues.length === 0, "set_tag defines a mod tag");
  await mcp.call("set_tag", { type: "block", id: "minecraft:logs", entries: ["ruby_block"] });
  await mcp.call("set_tag", { type: "function", id: "minecraft:tick", entries: ["tick_economy"] });
  await mcp.call("set_tag", { type: "biome", id: "hot_places", entries: ["minecraft:desert", "#minecraft:is_badlands"] });
  const bad = await mcp.call("set_tag", { type: "entity_type", id: "bosses", entries: ["no_such_mob"] });
  assert(bad.issues.some((i: { message: string }) => i.message.includes("no_such_mob")), "unknown mod entries are reported");
  assert((await mcp.call("validate_project")).some((i: { path: string }) => i.path.startsWith("tags[")), "validate_project includes tag problems");
  await mcp.call("delete_tag", { type: "entity_type", id: "bosses" });
  const list = await mcp.call("list_tags");
  assert(list.length === 4, `list_tags (${list.length})`);

  // Generation on all 5 engines.
  for (const engine of listEngines()) {
    const out = mkdtempSync(join(tmpdir(), `mcedge-tags-${engine.id}-`));
    const { warnings } = generateTarget(loadProject(project), project, engine, out);
    const data = join(out, "src/main/resources/data");
    const legacy = engine.minecraft === "1.16.5";
    const read = (path: string) => JSON.parse(readFileSync(join(data, path), "utf8"));
    const gemsFile = read(`hellomcedge/tags/${legacy ? "items" : "item"}/gems.json`);
    assert(gemsFile.values.join() === "hellomcedge:ruby,minecraft:diamond,#minecraft:coals" && gemsFile.replace === false, `${engine.id}: item tag`);
    assert(read(`minecraft/tags/${legacy ? "blocks" : "block"}/logs.json`).values.includes("hellomcedge:ruby_block"), `${engine.id}: adds to minecraft:logs`);
    assert(read(`minecraft/tags/${legacy ? "functions" : "function"}/tick.json`).values.includes("hellomcedge:tick_economy"), `${engine.id}: function tag`);
    if (legacy) {
      assert(!existsSync(join(data, "hellomcedge/tags/worldgen")) && warnings.some((w) => w.includes("biome tag hellomcedge:hot_places")), `${engine.id}: biome tag skipped with a warning`);
    } else {
      assert(read("hellomcedge/tags/worldgen/biome/hot_places.json").values.includes("#minecraft:is_badlands"), `${engine.id}: biome tag`);
    }
  }

  if (process.argv.includes("--build")) {
    for (const engine of ["fabric-1.21.5", "forge-1.16.5"]) {
      const folder = mkdtempSync(join(tmpdir(), "mcedge-tags-jar-"));
      const [result] = await mcp.call("export_jar", { engines: [engine], folder });
      assert(result.ok, `${engine}: built ${JSON.stringify(result.errors ?? [])}`);
      const entries = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-tf", result.jar], { encoding: "utf8" }).stdout;
      assert(entries.includes(`data/hellomcedge/tags/${engine.startsWith("forge-1.16") ? "items" : "item"}/gems.json`), `${engine}: tag file in the jar`);
    }
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
