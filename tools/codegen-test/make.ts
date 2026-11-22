// Writes the codegen test project (project/): every element is its type's defaults plus the overrides in spec.ts
// (list rows likewise). project/models and project/textures are kept files.
// usage: node tools/codegen-test/make.ts
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { newElement, typeFields } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { SPEC } from "./spec.ts";
import { tCompound, tInt, tList, tStr, writeNbt } from "./nbt.ts";

const dir = join(import.meta.dirname, "project");
rmSync(join(dir, "elements"), { recursive: true, force: true });
writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "wavethree", name: "Wave Three", version: "0.1.0", package: "dev.mcedge.wavethree", authors: ["MCEdge"], description: "Codegen test", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }, null, 2));
const registry = typeRegistry();
for (const [typeId, elements] of Object.entries(SPEC)) {
  const type = registry.byId.get(typeId)!;
  mkdirSync(join(dir, "elements", type.folder), { recursive: true });
  for (const [id, values] of Object.entries(elements)) {
    // List rows get their sub-fields' defaults too, so the spec only names what it changes.
    const filled = { ...values };
    for (const field of typeFields(type)) {
      const rows = filled[field.key];
      if (field.type === "list" && Array.isArray(rows)) filled[field.key] = rows.map((row) => ({ ...Object.fromEntries((field.fields ?? []).map((f) => [f.key, f.default])), ...row }));
    }
    writeFileSync(join(dir, "elements", type.folder, `${id}.json`), JSON.stringify({ ...newElement(type, id), ...filled }, null, 2));
  }
}
// Project sound for the sound tests: a vanilla sound from the local Loom asset cache (not committed).
const orb = join(homedir(), ".gradle/caches/fabric-loom/assets/objects/8a/8a04a60d5c28fc60df472a877ca57f37eabc78d7");
if (existsSync(orb)) {
  mkdirSync(join(dir, "sounds"), { recursive: true });
  copyFileSync(orb, join(dir, "sounds", "ruby_chime.ogg"));
}
// Q265: a tiny structure template for the structure probe: 3 x 2 x 3, listed out of order, with a stair (properties), two air blocks and a structure_void.
// Sorted by y, x, z without air it reads: planks 0 0 0, planks 1 0 0, stairs 2 0 0, planks 2 0 1, planks 0 1 0.
const palette = [{ Name: "minecraft:oak_planks" }, { Name: "minecraft:oak_stairs", Properties: { facing: "east", half: "top" } }, { Name: "minecraft:air" }, { Name: "minecraft:structure_void" }];
const house: [number, number, number, number][] = [[2, 0, 1, 0], [0, 1, 0, 0], [1, 1, 2, 2], [2, 0, 0, 1], [1, 0, 1, 3], [0, 0, 1, 2], [1, 0, 0, 0], [0, 0, 0, 0]];
mkdirSync(join(dir, "structures"), { recursive: true });
writeFileSync(join(dir, "structures", "probe_house.nbt"), writeNbt({
  DataVersion: tInt(2586),
  size: tList(3, [tInt(3), tInt(2), tInt(3)]),
  palette: tList(10, palette.map((p) => tCompound({ Name: tStr(p.Name), ...(p.Properties ? { Properties: tCompound(Object.fromEntries(Object.entries(p.Properties).map(([k, v]) => [k, tStr(v)]))) } : {}) }))),
  blocks: tList(10, house.map(([x, y, z, state]) => tCompound({ pos: tList(3, [tInt(x), tInt(y), tInt(z)]), state: tInt(state) }))),
  entities: tList(0, []),
}));
// One variable of each scope, so client sync is generated.
writeFileSync(join(dir, "variables.json"), JSON.stringify({ variables: [
  { name: "wallet", type: "number", scope: "player_persistent", initial: "0" }, { name: "visits", type: "number", scope: "player_lifetime", initial: "0" },
  { name: "goldPrice", type: "number", scope: "global_map", initial: "1" }, { name: "worldNote", type: "string", scope: "global_world", initial: "" },
] }, null, 2));
console.log("wrote", dir);
