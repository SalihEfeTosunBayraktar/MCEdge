// Rewrites the procedures of an imported project from one java_code block to procedure blocks, in place: only the
// `program` of a procedure element changes, and only where java2blocks converted all of it and the result is safe.
// A conversion is dropped (the procedure stays java_code) when, compared with the Java it replaces, it
//   - needs the other side (a block that runs only on the client or only on the server in a procedure of the other side),
//   - takes dependencies its trigger or element field does not provide (they would arrive as null),
//   - or takes a different dependency list while Java code that stays calls it as `execute(...)` by that list.
// usage: node tools/import-mcreator/apply-blocks.ts <project dir> [--dry]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { typeRegistry } from "../../src/elements/registry.ts";
import type { Element } from "../../src/elements/model.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { compileProcedure } from "../../src/procedures/compile.ts";
import { asProgram, type ProcedureIR } from "../../src/procedures/model.ts";
import { compileScope, pascal, providedDependencies } from "../../src/procedures/project.ts";
import { ROOT } from "../../src/paths.ts";
import { Miss, methodBody, Translator, type Ast } from "./java2blocks.ts";
import { javaBlock, readProject } from "./readProject.ts";

const dir = resolve(process.argv[2] ?? "");
const dry = process.argv.includes("--dry");
if (!process.argv[2] || !existsSync(join(dir, "elements/procedures"))) {
  console.log("usage: node tools/import-mcreator/apply-blocks.ts <project dir> [--dry]");
  process.exit(2);
}

/** Syntax trees of the Java of each procedure, by procedure id. */
function parse(codes: Map<string, string>): Map<string, Ast> {
  const work = mkdtempSync(join(tmpdir(), "mcedge-apply-"));
  try {
    const source = join(work, "src");
    mkdirSync(source);
    for (const [id, code] of codes) writeFileSync(join(source, `${id}.java`), `class P { Object run() throws Exception {\n${code}\n} }\n`);
    const bundled = join(ROOT, ".toolchains/jdk-21.0.12.1+1/bin/java.exe");
    execFileSync(existsSync(bundled) ? bundled : "java", [join(import.meta.dirname, "java-ast/JavaAst.java"), source, join(work, "out")], { stdio: ["ignore", "ignore", "inherit"], maxBuffer: 1 << 28 });
    return new Map([...codes.keys()].map((id) => [id, JSON.parse(readFileSync(join(work, "out", `${id}.json`), "utf8")) as Ast]));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const info = readProject(dir);
const project = loadProject(dir);
const original = new Map((project.elements.procedure ?? []).map((p) => [p.id, p]));
const codes = new Map<string, string>();
for (const [id, element] of original) {
  const code = javaBlock(element as never);
  if (code && code.fields?.gen === "1.16.5") codes.set(id, String(code.fields.code ?? ""));
}
const trees = parse(codes);

// 1. Translate.
const candidates = new Map<string, ProcedureIR>();
const missed = new Map<string, number>();
for (const [id, tree] of trees) {
  const translator = new Translator(info.variables, String(original.get(id)!.returnType ?? "none"), { gameRules: info.gameRules, guis: info.guis, procedures: info.procedures });
  try {
    candidates.set(id, translator.program(methodBody(tree)));
  } catch (error) {
    if (!(error instanceof Miss)) throw new Error(`${id}: ${(error as Error).stack}`);
    missed.set(error.message, (missed.get(error.message) ?? 0) + 1);
  }
}

// 2. Drop what is unsafe, until the rest is stable (dropping one changes what calls it).
const modClass = `${pascal(project.mod.id)}Mod`;
const env = { gen: "1.16.5" as const, loader: "forge" as const, modId: project.mod.id, pkg: project.mod.package, modClass };
const dropped = new Map<string, string>();
const callsOf = (code: string) => [...code.matchAll(/\b(\w+)Procedure\.execute\(/g)].map((m) => m[1]);
const idsByClass = new Map([...original.keys()].map((id) => [pascal(id), id]));

const finalDeps = new Map<string, string[]>();
for (let changed = true; changed;) {
  changed = false;
  const programs = new Map<string, ProcedureIR>([...candidates].filter(([id]) => !dropped.has(id)));
  const procedures: Element[] = [...original.values()].map((p) => (programs.has(p.id) ? { ...p, program: programs.get(p.id)! } : p));
  const { scope, uses } = compileScope({ elements: { ...project.elements, procedure: procedures }, variables: project.variables }, typeRegistry().byId, modClass);
  // Java that stays calls these by their dependency list.
  const calledFromJava = new Set<string>();
  for (const [id, code] of codes) if (!programs.has(id)) for (const name of callsOf(code)) calledFromJava.add(idsByClass.get(name) ?? name);
  for (const [id] of programs) {
    const unit = scope.procedures.get(id)!;
    const was = info.procedures.get(id)!.deps;
    const reasons: string[] = [];
    finalDeps.set(id, unit.deps);
    const result = compileProcedure(unit, scope, env);
    if (result.segments.length) reasons.push("needs the other side");
    for (const issue of result.issues) if (issue.kind !== "empty_input") reasons.push(`${issue.kind}: ${issue.block ?? ""} ${issue.message}`);
    const provided = providedDependencies(original.get(id)!, uses);
    const extra = unit.deps.filter((d) => !was.includes(d));
    if (provided && extra.some((d) => !provided.includes(d))) reasons.push("dependency its runner does not provide");
    if (calledFromJava.has(id) && (unit.deps.length !== was.length || extra.length)) reasons.push("dependency list changed, Java calls it");
    if (reasons.length) {
      dropped.set(id, reasons[0]);
      changed = true;
    }
  }
}

// 3. Write.
const final = [...candidates.keys()].filter((id) => !dropped.has(id));
const changedDeps = final.filter((id) => {
  const was = info.procedures.get(id)!.deps;
  const now = finalDeps.get(id)!;
  return now.length !== was.length || now.some((d) => !was.includes(d));
});
if (!dry) {
  for (const id of final) {
    const path = join(dir, "elements/procedures", `${id}.json`);
    const text = readFileSync(path, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const element = JSON.parse(text);
    element.program = asProgram(candidates.get(id));
    writeFileSync(path, JSON.stringify(element, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : ""));
  }
}

const reasons = new Map<string, number>();
for (const reason of dropped.values()) reasons.set(reason.replace(/[0-9]+/g, "N"), (reasons.get(reason.replace(/[0-9]+/g, "N")) ?? 0) + 1);
console.log(`${dry ? "would convert" : "converted"} ${final.length} of ${original.size} procedures (${codes.size} were java_code for 1.16.5)`);
console.log(`not converted by shape ${candidates.size === codes.size ? 0 : codes.size - candidates.size}, converted but kept as Java ${dropped.size}`);
console.log(`  ${changedDeps.length} converted procedures take another dependency list than their Java did (callers by trigger or block follow)`);
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  kept as Java: ${n} x ${reason}`);
