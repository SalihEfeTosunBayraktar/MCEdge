// KUYRUK 132: sound events. A small project with three sound files and sound_events.json: an event naming a missing
// file makes the project invalid (validation and build refuse it); without it, an event "bell" with two files, a
// category and a subtitle is generated on every engine (no Gradle): sounds.json lists bell with both files and its
// subtitle key, the unlisted file is an event of its own, bell's files are no events of their own, the subtitle text
// is in en_us, and <Mod>Sounds registers the events.
// usage: node tools/codegen-test/sound-events-check.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";

const T = import.meta.dirname;
const dir = join(mkdtempSync(join(tmpdir(), "mcedge-sounds-")), "sounds_test");
mkdirSync(join(dir, "sounds"), { recursive: true });
mkdirSync(join(dir, "localization"), { recursive: true });
writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "soundtest", name: "Sound Test", version: "0.1.0", package: "dev.mcedge.soundtest", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }, null, 2));
// The generator only copies the files; any bytes do.
for (const name of ["bell_1", "bell_2", "click"]) writeFileSync(join(dir, "sounds", `${name}.ogg`), `OggS ${name}`);
writeFileSync(join(dir, "sound_events.json"), JSON.stringify({ bell: { category: "block", subtitle: true, files: ["bell_1", "bell_2"] }, broken: { category: "block", files: ["nope"] } }, null, 2));
writeFileSync(join(dir, "localization", "en_us.json"), JSON.stringify({ "subtitles.soundtest.bell": "Bell rings" }, null, 2));

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const issues = validateProject(loadProject(dir), dir).filter((i) => i.path === "sound_events.json");
check(issues.length === 1 && issues[0].message.includes("nope"), `validation: ${JSON.stringify(issues)}`);
const refused = spawnSync("node", ["src/cli.ts", "build", dir, "--target", "neoforge-1.21.5", "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
check(refused.status !== 0 && /nope/.test(refused.stdout + refused.stderr), "build refuses the broken event");
writeFileSync(join(dir, "sound_events.json"), JSON.stringify({ bell: { category: "block", subtitle: true, files: ["bell_1", "bell_2"] } }, null, 2));

for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", dir, "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${engine.id}: generate\n${gen.stderr}${gen.stdout}`); continue; }
  const assets = join(dir, "out", engine.id, "src/main/resources/assets/soundtest");
  const sounds = JSON.parse(readFileSync(join(assets, "sounds.json"), "utf8"));
  check(JSON.stringify(sounds.bell) === JSON.stringify({ subtitle: "subtitles.soundtest.bell", sounds: ["soundtest:bell_1", "soundtest:bell_2"] }), `${engine.id}: bell ${JSON.stringify(sounds.bell)}`);
  check(JSON.stringify(sounds.click) === JSON.stringify({ sounds: ["soundtest:click"] }), `${engine.id}: unlisted file is its own event`);
  check(Object.keys(sounds).sort().join() === "bell,click", `${engine.id}: events ${Object.keys(sounds).sort()}; bell's files are none`);
  check(readdirSync(join(assets, "sounds")).sort().join() === "bell_1.ogg,bell_2.ogg,click.ogg", `${engine.id}: sound files copied`);
  const lang = JSON.parse(readFileSync(join(assets, "lang", "en_us.json"), "utf8"));
  check(lang["subtitles.soundtest.bell"] === "Bell rings", `${engine.id}: subtitle text in en_us`);
  const java = walk(join(dir, "out", engine.id, "src/main/java")).filter((f) => f.endsWith("Sounds.java")).map((f) => readFileSync(f, "utf8")).join("\n");
  check(/BELL/.test(java) && /CLICK/.test(java) && !/BELL_1/.test(java), `${engine.id}: events registered`);
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
