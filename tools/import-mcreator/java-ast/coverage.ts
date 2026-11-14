// How much of a project's java_code converts to blocks, and the shapes that stop the rest.
// usage: node coverage.ts [project dir] [number of misses to list]   (needs work/ast-out from parse_procedures.py)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Miss, methodBody, Translator } from "../java2blocks.ts";
import { javaBlock, readProject } from "../readProject.ts";

const here = `${import.meta.dirname}/work`;
const root = process.argv[2] ?? "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";
const project = readProject(root);
const misses = new Map<string, string[]>();
const big: { id: string; size: number; miss: string }[] = [];
const planned = new Map<string, number>();
let done = 0;
let doneChars = 0;
let chars = 0;
let crashed = 0;
const files = readdirSync(`${here}/ast-out`);
for (const file of files) {
  const id = file.slice(0, -5);
  const element = JSON.parse(readFileSync(`${root}/elements/procedures/${file}`, "utf8"));
  const size = statSync(join(here, "ast-src", `${id}.java`)).size;
  chars += size;
  if (!javaBlock(element)) {
    done++;
    doneChars += size;
    continue;
  }
  const translator = new Translator(project.variables, element.returnType ?? "none", { gameRules: project.gameRules, guis: project.guis, procedures: project.procedures });
  try {
    translator.program(methodBody(JSON.parse(readFileSync(`${here}/ast-out/${file}`, "utf8"))));
    done++;
    doneChars += size;
    for (const p of translator.planned) planned.set(p, (planned.get(p) ?? 0) + 1);
  } catch (error) {
    const key = error instanceof Miss ? error.message : `CRASH ${(error as Error).stack?.split("\n").slice(0, 2).join(" ")}`.slice(0, 160);
    if (!(error instanceof Miss)) crashed++;
    misses.set(key, [...(misses.get(key) ?? []), id]);
    big.push({ id, size, miss: key });
  }
}
console.log(`converted ${done}/${files.length}, code ${(100 * doneChars / chars).toFixed(1)}%, crashes ${crashed}`);
console.log("planned", [...planned].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "));
console.log("first misses per procedure:");
for (const [k, ids] of [...misses].sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.argv[3] ?? 45))) console.log(ids.length, k, "-", ids.slice(0, 3).join(" "));
console.log("largest procedures left:");
for (const { id, size, miss } of big.sort((a, b) => b.size - a.size).slice(0, 12)) console.log(`${(size / 1000).toFixed(0)}k`, id, "-", miss);
