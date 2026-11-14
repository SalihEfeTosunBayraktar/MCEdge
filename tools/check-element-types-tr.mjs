// Checks config/element-types/tr.json against element-types/*/type.json: every type name, description, page and
// group title, field label, help and select option label needs a Turkish entry, and nothing in tr.json may point
// at a type, field or option that no longer exists. Fields added by config/integrations/*.json count as part of the type.
import { readFileSync, readdirSync } from "node:fs";
import { loadIntegrations, withIntegrationGroups } from "../src/elements/integrations.ts";

const root = new URL("../", import.meta.url);
const tr = JSON.parse(readFileSync(new URL("config/element-types/tr.json", root), "utf8"));
let problems = 0;
let texts = 0;
const bad = (msg) => { problems++; console.log("FAIL " + msg); };
const need = (value, where) => { texts++; if (typeof value !== "string" || !value.trim()) bad(`${where} missing in tr`); };

const ids = readdirSync(new URL("element-types/", root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
// The editor shows the fields of the optional mod integrations on an Integrations page, so they are translated in tr.json too.
const { integrations } = loadIntegrations();
for (const id of ids) {
  const [type] = withIntegrationGroups([JSON.parse(readFileSync(new URL(`element-types/${id}/type.json`, root), "utf8"))], integrations);
  const t = tr[type.id];
  if (!t) { bad(`${id}: no entry in tr`); continue; }
  need(t.name, `${id}.name`);
  need(t.description, `${id}.description`);
  const known = { pages: new Set(), groups: new Set(), fields: new Set() };
  const walk = (fields, prefix) => {
    for (const f of fields) {
      const path = prefix + f.key;
      known.fields.add(path);
      const e = t.fields?.[path];
      need(e?.label, `${id}.fields.${path}.label`);
      if (f.help) need(e?.help, `${id}.fields.${path}.help`);
      const values = new Set();
      for (const o of f.options ?? []) { values.add(String(o.value)); need(e?.options?.[String(o.value)], `${id}.fields.${path}.options.${o.value}`); }
      for (const k of Object.keys(e?.options ?? {})) if (!values.has(k)) bad(`${id}.fields.${path}.options.${k} only in tr`);
      if (f.fields) walk(f.fields, path + ".");
      for (const k of ["keyField", "valueField"]) if (f[k]) walk([{ ...f[k], key: k }], path + ".");
    }
  };
  for (const page of type.pages) {
    known.pages.add(page.id);
    need(t.pages?.[page.id], `${id}.pages.${page.id}`);
    for (const g of page.groups) { known.groups.add(g.title); need(t.groups?.[g.title], `${id}.groups.${g.title}`); walk(g.fields, ""); }
  }
  for (const [section, keys] of Object.entries(known)) for (const k of Object.keys(t[section] ?? {})) if (!keys.has(k)) bad(`${id}.${section}.${k} only in tr`);
}
for (const id of Object.keys(tr)) if (!ids.includes(id)) bad(`${id}: type not found`);
console.log(problems ? `${problems} problem(s)` : `OK: ${ids.length} types, ${texts} texts translated`);
process.exit(problems ? 1 : 0);
