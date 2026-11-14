// KUYRUK #25 regression: elements whose derived registry ids collide (a fluid's bucket and an item named
// "<fluid>_bucket", a mob's spawn egg, a sign's wall block, armor pieces) are reported by validateProject, which
// the editor, the CLI and MCP all use; the codegen test project itself has no collision.
// usage: node tools/codegen-test/registry-ids-check.ts
import { join } from "node:path";
import { newElement, type Element } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import type { ModProject } from "../../src/ir/types.ts";

const registry = typeRegistry();
const el = (typeId: string, id: string, values: Record<string, unknown> = {}): Element => ({ ...newElement(registry.byId.get(typeId)!, id), ...values });
const project: ModProject = {
  schemaVersion: 2,
  mod: { id: "clash", name: "Clash", version: "1", package: "dev.clash", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] },
  elements: {
    fluid: [el("fluid", "oil", { generateBucket: true, bucketName: "Oil bucket" })],
    item: [el("item", "oil_bucket"), el("item", "imp_spawn_egg"), el("item", "gem_helmet")],
    living_entity: [el("living_entity", "imp", { hasSpawnEgg: true })],
    block: [el("block", "sign", { blockBase: "Sign" }), el("block", "sign_wall")],
    armor: [el("armor", "gem", { enableHelmet: true })],
  },
  variables: [],
  localization: {},
} as unknown as ModProject;

const issues = validateProject(project, ".").filter((i) => i.message.includes("is also used by"));
const expected = ["item id \"oil_bucket\"", "item id \"imp_spawn_egg\"", "block id \"sign_wall\"", "item id \"gem_helmet\""];
const missing = expected.filter((e) => !issues.some((i) => i.message.includes(e)));
for (const i of issues) console.log(`  ${i.path}: ${i.message}`);
const clean = validateProject(loadProject(join(import.meta.dirname, "project")), join(import.meta.dirname, "project")).filter((i) => i.message.includes("is also used by"));
console.log(`collisions found: ${issues.length}/${expected.length}${missing.length ? `, missing: ${missing.join(", ")}` : ""}; test project collisions: ${clean.length}`);
const ok = !missing.length && !clean.length;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
