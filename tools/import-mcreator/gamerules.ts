// MCreator 1.16.5 import, game rules (KUYRUK #11): every GameRules.register(...) of the decompiled mod becomes a
// game_rule element whose camelCase name in game stays the same (MCEdge ids are snake_case; the generator camels
// them back).
// usage: node tools/import-mcreator/gamerules.ts <legacy mod dir> <project dir>
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/gamerules.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const en = JSON.parse(readFileSync(join(main, "resources/assets", modId, "lang/en_us.json"), "utf8")) as Record<string, string>;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".java") ? [join(dir, n)] : []));
const RULE = /GameRules\.register\("(\w+)",\s*(?:GameRules\.)?Category\.(\w+),\s*create\(([^)]*)\)\)/;
const type = typeRegistry().byId.get("game_rule")!;
mkdirSync(join(projectDir, "elements/game_rules"), { recursive: true });
let count = 0;
for (const file of walk(join(main, "java"))) {
  const code = readFileSync(file, "utf8");
  const m = RULE.exec(code);
  if (!m) continue;
  const [, name, category, value] = m;
  const logic = /BooleanValue/.test(code);
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const id = name.replace(/([A-Z])/g, "_$1").toLowerCase();
  const element = {
    ...newElement(type, id),
    // A name that is not the camelCase of its id (question_repeat_ticks) is kept exactly.
    ...(camel(id) !== name ? { ruleName: name } : {}),
    displayName: en[`gamerule.${name}`] ?? name,
    description: en[`gamerule.${name}.description`] ?? "",
    category,
    type: logic ? "Logic" : "Number",
    ...(logic ? { defaultValueLogic: value.trim() === "true" } : { defaultValueNumber: Number(value) }),
  };
  writeFileSync(join(projectDir, "elements/game_rules", `${id}.json`), JSON.stringify(element, null, 2));
  count++;
}
console.log(`imported ${count} game rules`);
