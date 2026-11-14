/**
 * KUYRUK 127: list_registry_entries gives an agent what the item/block/entity picker offers: this mod's elements by bare
 * id, vanilla ids with game names (from a client jar when this machine has one) and tags.
 *   node tools/mcp-test/registry-entries.ts
 */
import { exampleProject } from "../ui-test/cdp.ts";
import { clientJar } from "../../src/resources/vanillaAssets.ts";
import { assert, connect } from "./client.ts";

const mcp = await connect(exampleProject());
try {
  const items = await mcp.call("list_registry_entries", { kind: "item", minecraft: "1.21.5" });
  assert(items.mod.some((e: { id: string; name: string }) => e.id === "ruby_block" && e.name === "Block of Ruby"), `mod items by bare id with names: ${JSON.stringify(items.mod)}`);
  assert(items.tags.includes("#minecraft:planks"), "item tags listed");
  const stick = await mcp.call("list_registry_entries", { kind: "item", query: "stick", minecraft: "1.21.5" });
  assert(stick.vanilla.some((e: { id: string }) => e.id === "minecraft:stick"), "query finds minecraft:stick");
  if (clientJar("1.21.5")) {
    assert(items.vanillaTotal > 1000 && stick.vanilla.find((e: { id: string }) => e.id === "minecraft:stick").name === "Stick", `full list with names from the jar (${items.vanillaTotal})`);
    const tr = await mcp.call("list_registry_entries", { kind: "item", query: "stick", minecraft: "1.21.5", language: "tr_tr" });
    console.log(`tr name of the stick: ${tr.vanilla.find((e: { id: string }) => e.id === "minecraft:stick").name}`);
  }
  const blocks = await mcp.call("list_registry_entries", { kind: "block", query: "ruby" });
  assert(blocks.mod.map((e: { id: string }) => e.id).join() === "ruby_block", `blocks: only block providers: ${JSON.stringify(blocks.mod)}`);
  const entities = await mcp.call("list_registry_entries", { kind: "entity", query: "zombie" });
  assert(entities.vanilla.some((e: { id: string }) => e.id === "minecraft:zombie") && entities.tags.length === 0, "entities, no item tags");
  console.log("PASS list_registry_entries");
} finally {
  await mcp.close();
}
