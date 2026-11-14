// Lists, per element type, the fields (and restricted values) each engine does not generate: the editor badges.
// usage: node tools/codegen-test/gaps.ts [typeId]   ("T" = type not generated, "-" = field not generated, "=a|b" = only these values)
import { engineCoverage } from "../../src/engines/coverage.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { typeFields } from "../../src/elements/model.ts";
const reg = typeRegistry();
const only = process.argv[2];
const engines = listEngines();
const cov = new Map(engines.map((e) => [e.id, engineCoverage(e)]));
for (const type of reg.byId.values()) {
  if (only && type.id !== only) continue;
  const rows: string[] = [];
  const keys: string[] = [];
  for (const f of typeFields(type)) { keys.push(f.key); for (const s of f.fields ?? []) keys.push(`${f.key}.${s.key}`); }
  for (const k of keys) {
    const per = engines.map((e) => { const c = cov.get(e.id)![type.id]; if (!c) return "T"; const v = c[k]; return v === true ? "" : v ? "=" + v.join("|") : "-"; });
    if (per.some((p) => p !== "")) rows.push(`  ${k}: ${engines.map((e, i) => per[i] ? `${e.id.replace(/neoforge|fabric|forge/, (m) => m[0])}${per[i]}` : "").filter(Boolean).join(" ")}`);
  }
  if (rows.length) console.log(`${type.id} (${rows.length})\n${rows.join("\n")}`);
}
