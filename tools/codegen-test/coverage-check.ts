// KUYRUK 140: layer.json "generates" must list every field the generator uses, or the editor and the MCP coverage tool
// badge it "not generated". For each engine this changes one field of a project at a time (in every element of the
// type that shows it) and generates again without Gradle: a field that changes the output but is not declared is
// reported, and the check fails. Fields the project does not show, and field types it cannot change (lists, textures,
// layouts), are counted as not exercised.
// usage: node tools/codegen-test/coverage-check.ts [project dir, default the test project] [engine ids]
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { typeFields, visibility, type Element, type FieldDef } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { engineCoverage } from "../../src/engines/coverage.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { TYPE_MODULES } from "../../src/generator/typeModule.ts";
import { loadProject } from "../../src/ir/storage.ts";
import type { ModProject } from "../../src/ir/types.ts";

const [projectArg, ...engineArgs] = process.argv.slice(2);
const projectDir = projectArg ?? join(import.meta.dirname, "project");
const project = loadProject(projectDir);
const registry = typeRegistry();
const procedures = (project.elements.procedure ?? []).map((p) => p.id);

/** Another value of the field, or undefined when its type is not changed by this check. */
function changed(field: FieldDef, value: unknown): unknown {
  switch (field.type) {
    case "boolean": return !value;
    case "integer": case "number": {
      const n = Number(value ?? 0), step = field.type === "integer" ? 1 : (field.step ?? 0.5);
      return field.max !== undefined && n + step > field.max ? n - step : n + step;
    }
    case "text": case "multiline": return `${String(value ?? "")}x`;
    case "color": return value === "#123456" ? "#654321" : "#123456";
    case "select": return field.options?.find((o) => o.value !== value)?.value;
    case "procedure": return procedures.find((id) => id !== value);
    case "item": case "block": return value === "minecraft:dirt" ? "minecraft:stone" : "minecraft:dirt";
    case "range": case "vector": return Array.isArray(value) ? value.map((v, i) => (i === 0 ? Number(v) + 1 : v)) : undefined;
    default: return undefined;
  }
}

/** Generated files and their hashes. */
function generate(p: ModProject, engineId: string): Map<string, string> {
  const engine = listEngines().find((e) => e.id === engineId)!;
  const out = mkdtempSync(join(tmpdir(), "mcedge-cov-"));
  try {
    generateTarget(p, projectDir, engine, out);
    const files = new Map<string, string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.set(relative(out, path), createHash("sha1").update(readFileSync(path)).digest("hex"));
      }
    };
    walk(out);
    return files;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const same = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

const engines = engineArgs.length ? engineArgs : listEngines().map((e) => e.id);
let missing = 0;
const log = console.log;
for (const engineId of engines) {
  const coverage = engineCoverage(listEngines().find((e) => e.id === engineId)!);
  console.log = () => {};
  const base = generate(project, engineId);
  const again = generate(project, engineId);
  console.log = log;
  if (!same(base, again)) throw new Error(`${engineId}: two generations of the same project differ`);
  const found: string[] = [];
  let exercised = 0, unexercised = 0;
  for (const [typeId, elements] of Object.entries(project.elements)) {
    const type = registry.byId.get(typeId);
    if (!type || !TYPE_MODULES.has(typeId) || !coverage[typeId]) continue;
    const fields = typeFields(type);
    for (const field of fields) {
      if (coverage[typeId][field.key] !== undefined) continue;
      // Every element of the type that shows the field gets another value.
      let touched = false;
      const next = elements.map((element) => {
        if (!visibility({ fields, values: element })(field.key)) return element;
        const value = changed(field, element[field.key]);
        if (value === undefined) return element;
        touched = true;
        return { ...element, [field.key]: value } as Element;
      });
      if (!touched) { unexercised++; continue; }
      exercised++;
      console.log = () => {};
      let output: Map<string, string>;
      try { output = generate({ ...project, elements: { ...project.elements, [typeId]: next } }, engineId); }
      catch (error) { console.log = log; found.push(`${typeId}.${field.key} (changing it fails generation: ${(error as Error).message.split("\n")[0]})`); continue; }
      console.log = log;
      if (!same(base, output)) found.push(`${typeId}.${field.key}`);
    }
  }
  missing += found.length;
  console.log(`${engineId}: ${exercised} undeclared fields changed, ${unexercised} not exercised; generated but not declared: ${found.length ? found.join(", ") : "none"}`);
}
process.exit(missing ? 1 : 0);
