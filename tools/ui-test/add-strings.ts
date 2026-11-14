/**
 * Adds UI strings to config/ui-strings/en.json and tr.json from a JSON file of { key: [english, turkish] },
 * keeping existing keys and appending new ones at the end:  node tools/ui-test/add-strings.ts strings.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./cdp.ts";

const entries = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, [string, string]>;
for (const [index, lang] of ["en", "tr"].entries()) {
  const file = join(REPO, "config", "ui-strings", `${lang}.json`);
  const strings = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  for (const [key, values] of Object.entries(entries)) strings[key] = values[index];
  writeFileSync(file, JSON.stringify(strings, null, 2) + "\n");
}
console.log(`${Object.keys(entries).length} strings written`);
