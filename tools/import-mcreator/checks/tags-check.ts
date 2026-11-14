// KUYRUK #193 regression: imports the tags of a small legacy data folder into a fresh project and checks that they land
// in tags.json (own ids without the namespace, no minecraft:air), that tags tags.json cannot hold stay in datapack/,
// and that earlier raw copies are gone. usage: node tools/import-mcreator/checks/tags-check.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { importTags } from "../tags.ts";

const root = join(import.meta.dirname, "../../codegen-test/logs/tags-import-check");
const data = join(root, "legacy/data");
const project = join(root, "project");
rmSync(root, { recursive: true, force: true });
const put = (path: string, json: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json));
};
const tag = (values: unknown[], replace = false) => ({ replace, values });
put(join(data, "mymod/tags/items/money.json"), tag(["mymod:coin", "minecraft:air", "mymod:note"]));
put(join(data, "forge/tags/blocks/lockable.json"), tag(["mymod:safe"]));
put(join(data, "minecraft/tags/items/arrows.json"), tag(["minecraft:arrow", "mymod:stone_arrow", "#minecraft:logs"]));
put(join(data, "minecraft/tags/entity_types/raiders.json"), tag(["mymod:bandit"]));
put(join(data, "minecraft/tags/fluids/water.json"), tag(["mymod:oil"]));
put(join(data, "mymod/tags/functions/tick.json"), tag(["mymod:loop"]));
put(join(data, "mymod/tags/items/empty.json"), tag([]));
put(join(data, "minecraft/tags/blocks/dirt.json"), tag([]));
put(join(data, "minecraft/tags/blocks/logs.json"), tag(["minecraft:air"]));
put(join(data, "minecraft/tags/items/coals.json"), tag(["mymod:coke"], true));
put(join(data, "minecraft/tags/items/optional.json"), tag([{ id: "othermod:gem", required: false }]));
put(join(data, "mymod/tags/game_events/noise.json"), tag(["minecraft:step"]));
// A raw copy an earlier import left, and a tag the project already has.
put(join(project, "datapack/forge/tags/blocks/lockable.json"), tag(["mymod:safe"]));
put(join(project, "tags.json"), { tags: [{ type: "item", id: "mymod:money", entries: ["old"] }, { type: "block", id: "mymod:own", entries: ["safe"] }] });

const count = importTags(data, "mymod", project);
const tags = (JSON.parse(readFileSync(join(project, "tags.json"), "utf8")) as { tags: { type: string; id: string; entries: string[] }[] }).tags;
const got = Object.fromEntries(tags.map((t) => [`${t.type} ${t.id}`, t.entries.join(",")]));
const expected: Record<string, string> = {
  "item mymod:money": "coin,note",
  "block forge:lockable": "safe",
  "item minecraft:arrows": "minecraft:arrow,stone_arrow,#minecraft:logs",
  "entity_type minecraft:raiders": "bandit",
  "fluid minecraft:water": "oil",
  "function mymod:tick": "loop",
  "item mymod:empty": "",
  "block mymod:own": "safe",
};
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
check(count === 7, `imported ${count} tags (expected 7)`);
check(tags.length === Object.keys(expected).length, `tags.json has ${tags.length} tags (expected ${Object.keys(expected).length})`);
for (const [key, entries] of Object.entries(expected)) check(got[key] === entries, `${key}: [${got[key] ?? "missing"}]`);
const datapack = (path: string) => existsSync(join(project, "datapack", path));
check(!datapack("forge/tags/blocks/lockable.json"), "imported tag's earlier datapack copy removed");
check(!datapack("mymod/tags/items/money.json") && !datapack("minecraft/tags/blocks/dirt.json"), "imported and skipped tags not copied to datapack/");
check(datapack("minecraft/tags/items/coals.json"), "replace: true tag kept in datapack/");
check(datapack("minecraft/tags/items/optional.json"), "tag with object entries kept in datapack/");
check(datapack("mymod/tags/game_events/noise.json"), "tag folder without element tag type kept in datapack/");
console.log(failures.length ? "FAIL" : "PASS");
process.exit(failures.length ? 1 : 0);
