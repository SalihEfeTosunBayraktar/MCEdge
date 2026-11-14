// What the converter needs to know about a project: its variables, the dependencies and return types of its
// procedures, and its game rules.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../../src/ir/storage.ts";
import { inferDependencies } from "../../src/procedures/analyze.ts";
import { asProgram } from "../../src/procedures/model.ts";
import { procedureLookup } from "../../src/procedures/project.ts";
import type { ProcedureInfo, Variable } from "./java2blocks.ts";

export interface ProjectInfo {
  variables: Variable[];
  procedures: Map<string, ProcedureInfo>;
  gameRules: string[];
  guis: string[];
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** The java_code block of a procedure element, when its program is one. */
export function javaBlock(element: { program: { stacks: { blocks: { block: string; fields?: Record<string, string> }[] }[] } }) {
  return element.program.stacks[0]?.blocks.find((b) => b.block === "java_code");
}

export function readProject(root: string): ProjectInfo {
  const procedures = new Map<string, ProcedureInfo>();
  const dir = join(root, "elements/procedures");
  // Procedures that already are blocks take the dependencies their blocks need.
  const project = loadProject(root);
  const lookup = procedureLookup(project);
  for (const file of readdirSync(dir)) {
    const element = json(join(dir, file));
    const code = javaBlock(element);
    const deps = code ? String(code.fields?.deps ?? "").split(/\s+/).filter(Boolean) : inferDependencies(asProgram(element.program), lookup);
    procedures.set(file.slice(0, -5), { deps, returnType: String(element.returnType ?? "none") });
  }
  const rules = join(root, "elements/game_rules");
  const guis = join(root, "elements/guis");
  return {
    variables: json(join(root, "variables.json")).variables,
    procedures,
    gameRules: existsSync(rules) ? readdirSync(rules).map((file) => file.slice(0, -5)) : [],
    guis: existsSync(guis) ? readdirSync(guis).map((file) => file.slice(0, -5)) : [],
  };
}
