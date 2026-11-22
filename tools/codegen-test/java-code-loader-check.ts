// Q282: a java_code block has an optional loader (any | neoforge | forge | fabric) next to its gen. One procedure holds a
// java_code block for every gen x loader (plus one without the field, as an older project has it) and is generated for all
// 5 engines without Gradle: a block is emitted only where its gen and loader both match; every other one leaves the
// "not generated" note, and the build reports it. A block without the field behaves as before (any loader).
// usage: node tools/codegen-test/java-code-loader-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { listEngines } from "../../src/engines/registry.ts";

const ROOT = join(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "mcedge-q282-"));
const pkg = "dev.mcedge.loadercode";
writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "loadercode", name: "Loader Code", version: "0.1.0", package: pkg, authors: ["MCEdge"], description: "Q282", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }, null, 2));
const type = typeRegistry().byId.get("procedure")!;
mkdirSync(join(dir, "elements", type.folder), { recursive: true });

const GENS = ["1.16.5", "1.21.5", "26.3"];
const LOADERS = ["legacy", "any", "neoforge", "forge", "fabric"]; // legacy: no loader field at all
const mark = (gen: string, loader: string) => `MARK_${gen.replaceAll(".", "_")}_${loader}`;
const blocks = GENS.flatMap((gen) => LOADERS.map((loader) => ({
  block: "java_code",
  fields: { code: `System.out.println("${mark(gen, loader)}");`, deps: "", imports: "", gen, ...(loader === "legacy" ? {} : { loader }) },
})));
writeFileSync(join(dir, "elements", type.folder, "loader_probe.json"), JSON.stringify({
  ...newElement(type, "loader_probe"), title: "loader_probe", returnType: "none", globalTrigger: "no_ext_trigger",
  program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...blocks] }] },
}, null, 2));

const engines = listEngines().map((e) => ({ id: e.id, loader: e.loader, gen: e.minecraft === "1.16.5" ? "1.16.5" : e.minecraft.startsWith("1.21") ? "1.21.5" : "26.3" }));
assert.equal(engines.length, 5);
const javaDir = `src/main/java/${pkg.replaceAll(".", "/")}/procedures`;
for (const e of engines) {
  const out = spawnSync("node", ["src/cli.ts", "build", dir, "--target", e.id, "--no-gradle"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(out.status, 0, `${e.id}: generate failed\n${out.stdout}${out.stderr}`);
  const java = readFileSync(join(dir, "out", e.id, javaDir, "LoaderProbeProcedure.java"), "utf8");
  let emitted = 0;
  for (const gen of GENS) for (const loader of LOADERS) {
    const should = gen === e.gen && (loader === "legacy" || loader === "any" || loader === e.loader);
    assert.equal(java.includes(`"${mark(gen, loader)}"`), should, `${e.id}: java_code gen ${gen} loader ${loader} ${should ? "must be emitted" : "must be skipped"}`);
    if (should) emitted++;
  }
  // Same note as a gen mismatch: one per skipped block of the right Minecraft version, and the build says so.
  const skippedForLoader = LOADERS.filter((l) => l !== "legacy" && l !== "any" && l !== e.loader).length;
  const loaderNotes = java.split(`is not generated for ${e.loader}`).length - 1;
  assert.equal(loaderNotes, skippedForLoader, `${e.id}: a loader mismatch leaves the "not generated" note`);
  assert.ok((out.stdout + out.stderr).includes(`Java written for ${LOADERS.find((l) => l !== "legacy" && l !== "any" && l !== e.loader)} does nothing on ${e.loader}`), `${e.id}: the build reports the skipped block\n${out.stdout}${out.stderr}`);
  console.log(`${e.id}: ${emitted} of ${GENS.length * LOADERS.length} blocks emitted (gen ${e.gen}, loader ${e.loader})`);
}
console.log(`java-code-loader-check OK (${dir})`);
