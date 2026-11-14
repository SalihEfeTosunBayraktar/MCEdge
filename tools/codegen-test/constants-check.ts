// KUYRUK #23 regression: generates the test project on every engine (no Gradle) and checks that no generated Java
// class declares the same static field twice (a block's item field and an item named "<block>_item", ...).
// usage: node tools/codegen-test/constants-check.ts
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".java") ? [join(dir, n)] : []));
let failed = false;
for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { console.log(`${engine.id}: generate failed\n${gen.stderr}`); failed = true; continue; }
  const dupes: string[] = [];
  let fields = 0;
  for (const file of walk(join(T, "project/out", engine.id, "src/main/java"))) {
    // Static fields of the top-level class body (four spaces of indent).
    const names = [...readFileSync(file, "utf8").matchAll(/^ {4}(?:public |private |protected )?static (?:final )?[\w.<>?, ]+? (\w+)\s*[=;]/gm)].map((m) => m[1]);
    fields += names.length;
    const seen = new Set<string>();
    for (const n of names) { if (seen.has(n)) dupes.push(`${file.slice(file.indexOf("java") + 5)}: ${n}`); seen.add(n); }
  }
  console.log(`${engine.id}: ${fields} static fields, ${dupes.length} duplicates${dupes.length ? `\n  ${dupes.join("\n  ")}` : ""}`);
  if (dupes.length) failed = true;
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
