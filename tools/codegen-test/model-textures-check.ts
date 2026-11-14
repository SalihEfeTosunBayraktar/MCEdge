// KUYRUK 161: a block maps its custom model's texture slots to its own textures. Lists the slots the editor and MCP show
// (JSON variables, OBJ materials), then generates the test project on every engine (no Gradle) and checks the block
// models name the mapped textures over the model's, the textures (and an animation's .mcmeta) are copied, and blocks
// without a mapping, state rows included, are unchanged.
// usage: node tools/codegen-test/model-textures-check.ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { typeFields, valuesOfType } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { modelTextureSlots } from "../../src/resources/modelTextures.ts";

const T = import.meta.dirname;
const project = join(T, "project");
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

// Slots as the editor and MCP list them.
const pngs: string[] = [];
const walk = (dir: string) => readdirSync(dir).forEach((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".png") && pngs.push(relative(project, join(dir, n)).replaceAll("\\", "/"))));
walk(join(project, "textures"));
walk(join(project, "models"));
const read = (path: string) => (existsSync(join(project, path)) ? readFileSync(join(project, path), "utf8") : undefined);
const lamp = await modelTextureSlots("json", "ruby_lamp", "wavethree", read, pngs);
check(JSON.stringify(lamp.map((s) => [s.slot, s.file])) === JSON.stringify([["0", "textures/ruby_block.png"], ["1", "models/ruby_gem_face.png"]]), `ruby_lamp slots ${JSON.stringify(lamp)}`);
const gem = await modelTextureSlots("obj", "ruby_gem", "wavethree", read, pngs);
check(JSON.stringify(gem.map((s) => [s.slot, s.file])) === JSON.stringify([["crystal", "models/ruby_gem_face.png"], ["ember", "textures/ruby_block.png"]]), `ruby_gem slots ${JSON.stringify(gem)}`);

// The mapped textures count as textures the block uses (Resources "used by", texture delete guard).
const block = typeRegistry().byId.get("block")!;
const recolored = JSON.parse(readFileSync(join(project, "elements/blocks/ruby_lamp_recolored.json"), "utf8"));
check(valuesOfType(typeFields(block), recolored, "texture").includes("textures/toggle_on.png"), "valuesOfType lists mapped slot textures");

for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", project, "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${engine.id}: generate\n${gen.stderr}`); continue; }
  const assets = join(project, "out", engine.id, "src/main/resources/assets/wavethree");
  const model = (name: string) => JSON.parse(readFileSync(join(assets, "models/block", `${name}.json`), "utf8")) as { parent?: string; textures?: Record<string, string> };
  const l = model("ruby_lamp_recolored");
  check(l.parent === "wavethree:custom/ruby_lamp" && l.textures?.["0"] === "wavethree:block/ruby_lamp_recolored_model_0" && l.textures?.["1"] === "wavethree:block/ruby_lamp_recolored_model_1",
    `${engine.id}: JSON block model maps its slots ${JSON.stringify(l.textures)}`);
  const g = model("ruby_gem_recolored");
  check(g.parent === "wavethree:custom/ruby_gem" && g.textures?.m1 === "wavethree:block/ruby_gem_recolored_model_ember" && !("m0" in (g.textures ?? {})),
    `${engine.id}: OBJ block model maps material ember to m1 ${JSON.stringify(g.textures)}`);
  const files = ["ruby_lamp_recolored_model_0.png", "ruby_lamp_recolored_model_1.png", "ruby_lamp_recolored_model_1.png.mcmeta", "ruby_gem_recolored_model_ember.png"];
  check(files.every((f) => existsSync(join(assets, "textures/block", f))), `${engine.id}: mapped textures copied (${files.join(", ")})`);
  const plain = model("ruby_lamp");
  check(Object.keys(plain.textures ?? {}).every((k) => k === "particle"), `${engine.id}: an unmapped block keeps the model's textures ${JSON.stringify(plain.textures)}`);
  const custom = JSON.parse(readFileSync(join(assets, "models/custom/ruby_lamp.json"), "utf8")) as { textures: Record<string, string> };
  check(custom.textures["0"] === "wavethree:block/custom/ruby_block", `${engine.id}: the shared custom model is unchanged ${JSON.stringify(custom.textures)}`);
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
