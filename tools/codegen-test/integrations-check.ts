// KUYRUK #101: optional mod integrations. Copies the test project with the recipe viewer integration turned on
// (required on one copy, optional on the other) and generates it on every engine (no Gradle): the other mod in the
// Gradle file (repositories and lines from config/integrations/recipe_viewer.json) and in the mod metadata as a required
// or optional dependency, the JEI plugin (Forge, NeoForge) or REI plugin with its rei_client entrypoint (Fabric), with
// ruby_chest's category, catalysts and recipes. The test project without the integration has none of it.
// `--build` then compiles the integration copy on all five engines with Gradle (heavy; needs the JEI/REI downloads), with no
// javac [removal] warning (KUYRUK 141).
// usage: node tools/codegen-test/make.ts && node tools/codegen-test/integrations-check.ts [--build [engine...]]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
const copy = (required: boolean) => {
  const dir = join(mkdtempSync(join(tmpdir(), "mcedge-integration-")), "project");
  cpSync(join(T, "project"), dir, { recursive: true, filter: (p) => !/[\\/](out|build|run|\.gradle)$/.test(p) });
  const file = join(dir, "mcedge.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.mod.integrations = [{ id: "recipe_viewer", required }];
  writeFileSync(file, JSON.stringify(json, null, 2));
  return dir;
};
const generate = (dir: string, engine: string) => {
  const r = spawnSync("node", ["src/cli.ts", "build", dir, "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) check(false, `${engine}: generate ${r.stdout}${r.stderr}`);
  return join(dir, "out", engine);
};
const read = (out: string, name: RegExp) => walk(out).filter((f) => name.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");

const config = JSON.parse(readFileSync(join(ROOT, "config/integrations/recipe_viewer.json"), "utf8"));
const optional = copy(false), required = copy(true);
for (const engine of listEngines().map((e) => e.id)) {
  const on = config.engines[engine];
  const out = generate(optional, engine);
  const gradle = read(out, /build\.gradle$/);
  check(on.gradle.every((l: string) => gradle.includes(l)) && on.repositories.every((u: string) => gradle.includes(u)), `${engine}: Gradle has ${on.mod} and its repositories`);
  const fabric = engine.startsWith("fabric");
  const meta = read(out, fabric ? /fabric\.mod\.json$/ : /mods\.toml$/);
  check(fabric ? new RegExp(`"suggests"[^}]*"${on.modId}"`).test(meta) : new RegExp(`modId="${on.modId}"\\s+type="optional"|modId="${on.modId}"\\s+mandatory=false`).test(meta),
    `${engine}: ${on.modId} is an optional dependency in the metadata`);
  const plugin = read(out, fabric ? /ReiPlugin\.java$/ : /JeiPlugin\.java$/);
  check(plugin.includes("ruby_chest") && plugin.includes('"Ruby Chest"') && (plugin.match(/MachineRecipe\(java\.util\.Arrays/g) ?? []).length === 2 && plugin.includes("wavethree:ruby"),
    `${engine}: ${fabric ? "REI" : "JEI"} plugin with ruby_chest's category, its two recipes and the ruby catalyst`);
  if (fabric) check(/"rei_client": \["dev\.mcedge\.wavethree\.integration\.WavethreeModReiPlugin"\]/.test(meta) && (() => { try { JSON.parse(meta); return true; } catch { return false; } })(),
    `${engine}: rei_client entrypoint, fabric.mod.json is valid JSON`);
  const req = read(generate(required, engine), fabric ? /fabric\.mod\.json$/ : /mods\.toml$/);
  check(fabric ? new RegExp(`"depends"[^}]*"${on.modId}"`).test(req) : new RegExp(`modId="${on.modId}"\\s+type="required"|modId="${on.modId}"\\s+mandatory=true`).test(req),
    `${engine}: required when the project says so`);
  const plain = generate(join(T, "project"), engine);
  check(!read(plain, /build\.gradle$/).includes(on.repositories[0]) && !read(plain, /(Jei|Rei)Plugin\.java$/), `${engine}: nothing of it without the integration`);
}
if (process.argv.includes("--build")) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  for (const engine of listEngines().map((e) => e.id).filter((e) => !only.length || only.includes(e))) {
    const r = spawnSync("node", ["src/cli.ts", "build", optional, "--target", engine], { cwd: ROOT, encoding: "utf8" });
    check(r.status === 0, `${engine}: Gradle build with the integration${r.status === 0 ? "" : `\n${r.stdout.slice(-2000)}`}`);
    // KUYRUK 141: the plugin uses no API its mod marked for removal.
    const buildLog = join(optional, "out", engine, "build", "mcedge-build.log");
    const removal = (existsSync(buildLog) ? readFileSync(buildLog, "utf8") : "").split("\n").filter((l) => l.includes("[removal]"));
    check(!removal.length, `${engine}: no [removal] warnings${removal.length ? ` (${removal.length})\n${removal.slice(0, 3).join("\n")}` : ""}`);
  }
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
