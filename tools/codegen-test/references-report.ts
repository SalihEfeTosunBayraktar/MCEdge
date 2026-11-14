// Reference census of a project: references by form, and the procedures and GUIs nothing uses. Read-only.
// usage: node tools/codegen-test/references-report.ts <project dir> [--list]
import { findAllReferences, unusedElements } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";

const [dir, flag] = process.argv.slice(2);
if (!dir) throw new Error("usage: references-report.ts <project dir> [--list]");
const input = loadReferenceInput(dir);
const all = findAllReferences(input);
const count = (key: (r: (typeof all)[number]) => string) => Object.entries(all.reduce<Record<string, number>>((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);
console.log(`elements: ${Object.values(input.elements).reduce((n, l) => n + l.length, 0)}; references: ${all.length}`);
console.log("by form:", Object.fromEntries(count((r) => r.form)));
console.log("by target type:", Object.fromEntries(count((r) => r.to.type)));
const direct = unusedElements(input, all);
const chained = unusedElements(input, all, undefined, true);
console.log("unused (procedure, gui), direct:", direct.summary, "listed", direct.unused.length);
console.log("unused including only-used-by-unused:", chained.summary, "listed", chained.unused.length);
if (flag === "--list") for (const u of direct.unused) console.log(`${u.type}/${u.id}`);
