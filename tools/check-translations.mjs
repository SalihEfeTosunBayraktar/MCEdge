// Checks every language file of config/ui-strings against en.json (Q249): lists missing and extra keys per language.
// Extra keys, placeholders that differ from en, empty values and a missing "language.name" fail. Missing keys are
// reported but do not fail, because the app shows English for them; pass --strict (tr is always strict) to fail on them too.
//   node tools/check-translations.mjs [--strict]
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../config/ui-strings/", import.meta.url);
const strict = process.argv.includes("--strict");
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const en = load("en.json");
const ph = (s) => [...new Set(String(s).match(/\{\w+\}/g) ?? [])].sort().join(" ");
let problems = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json").sort()) {
  const code = file.slice(0, -5);
  const table = load(file);
  const bad = (msg) => { problems++; console.log(`FAIL ${code}: ${msg}`); };
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(code)) bad(`file name is not a language code`);
  if (!table["language.name"]?.trim()) bad(`"language.name" (the name shown in the picker) is missing`);
  const missing = Object.keys(en).filter((k) => !(k in table));
  const extra = Object.keys(table).filter((k) => !(k in en));
  for (const k of extra) bad(`extra key ${k} (not in en)`);
  for (const [k, v] of Object.entries(table)) {
    if (!(k in en)) continue;
    if (typeof v !== "string" || !v.trim()) bad(`${k} is empty`);
    else if (ph(v) !== ph(en[k])) bad(`${k} placeholders [${ph(v)}] differ from en [${ph(en[k])}]`);
  }
  if (missing.length && (strict || code === "tr")) for (const k of missing) bad(`missing key ${k}`);
  const done = Object.keys(en).length - missing.length;
  console.log(`${code}: ${done}/${Object.keys(en).length} keys translated, ${missing.length} fall back to en, ${extra.length} extra`);
  if (missing.length && !strict && code !== "tr") console.log(`  missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""}`);
}
console.log(problems ? `${problems} problem(s)` : "OK");
process.exit(problems ? 1 : 0);
