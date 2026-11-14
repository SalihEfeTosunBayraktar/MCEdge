// Checks config/procedure-blocks/tr.json against en.json: same keys, and every
// %placeholder of an English label/tip/option appears in the Turkish one (same set).
import { readFileSync } from "node:fs";

const load = (n) => JSON.parse(readFileSync(new URL(`../config/procedure-blocks/${n}.json`, import.meta.url), "utf8"));
const en = load("en");
const tr = load("tr");
const ph = (s) => [...new Set(String(s).match(/%[A-Za-z_][A-Za-z0-9_]*/g) ?? [])].sort().join(" ");
let problems = 0;
const bad = (msg) => { problems++; console.log("FAIL " + msg); };

for (const section of Object.keys(en)) {
  for (const key of Object.keys(en[section])) {
    const t = tr[section]?.[key];
    if (t === undefined) {
      if (section === "blocks" || section === "categories" || section === "sides" || section === "tips") bad(`${section}.${key} missing in tr`);
      continue; // options may fall back to English (symbols)
    }
    if (typeof t !== typeof en[section][key]) bad(`${section}.${key} type differs`);
    else if (ph(t) !== ph(en[section][key])) bad(`${section}.${key} placeholders en [${ph(en[section][key])}] tr [${ph(t)}]`);
    if (typeof t === "string" && !t.trim()) bad(`${section}.${key} empty`);
  }
  for (const key of Object.keys(tr[section] ?? {})) if (!(key in en[section])) bad(`${section}.${key} only in tr`);
}
const n = Object.keys(en.blocks).length;
console.log(problems ? `${problems} problem(s)` : `OK: ${n} block labels, ${Object.keys(en.tips).length} tips, placeholders match`);
process.exit(problems ? 1 : 0);
