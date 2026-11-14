// Writes the codegen test project (project/): every element is its type's defaults plus the overrides in spec.ts
// (list rows likewise). project/models and project/textures are kept files.
// usage: node tools/codegen-test/make.ts
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { newElement, typeFields } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { SPEC } from "./spec.ts";

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
// One variable of each scope, so client sync is generated.
writeFileSync(join(dir, "variables.json"), JSON.stringify({ variables: [
  { name: "wallet", type: "number", scope: "player_persistent", initial: "0" }, { name: "visits", type: "number", scope: "player_lifetime", initial: "0" },
  { name: "goldPrice", type: "number", scope: "global_map", initial: "1" }, { name: "worldNote", type: "string", scope: "global_world", initial: "" },
] }, null, 2));
console.log("wrote", dir);
