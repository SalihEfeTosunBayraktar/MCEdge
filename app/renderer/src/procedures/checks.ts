import { typeFields } from "../../../../src/elements/model.ts";
import { analyzeProcedure } from "../../../../src/procedures/analyze.ts";
import { compileProcedure, type CompiledProcedure, type ProcEnv } from "../../../../src/procedures/compile.ts";
import type { Gen } from "../../../../src/procedures/javaNames.ts";
import type { Dependency, ProcedureIR } from "../../../../src/procedures/model.ts";
import { compileScope, globalVars, pascal, procedureFieldUses, procedureLookup, providedDependencies, PROGRAM_FIELD } from "../../../../src/procedures/project.ts";
import type { Element, EngineInfo, ProjectSnapshot } from "../../../shared/api.ts";
import { elementName } from "../model.ts";
import { t } from "../strings.ts";
import { elementTypes } from "../types.ts";
import type { ChoiceSource } from "./blocklySetup.ts";
import type { BlockWarning } from "./ProcedureWorkspace.tsx";

/* Live checks and the Java preview of the procedure being edited, computed in the renderer from the core. */

export function procEnvOf(engine: EngineInfo | undefined, snapshot: ProjectSnapshot): ProcEnv | undefined {
  if (!engine) return undefined;
  const gen: Gen = engine.minecraft === "1.16.5" ? "1.16.5" : engine.minecraft.startsWith("1.21") ? "1.21.5" : "26.3";
  const { mod } = snapshot.project;
  return { gen, loader: engine.loader as ProcEnv["loader"], modId: mod.id, pkg: mod.package, modClass: `${pascal(mod.id)}Mod` };
}

/** The project with the edited procedure's program replaced by the editor's current one. */
function withProgram(snapshot: ProjectSnapshot, element: Element, ir: ProcedureIR) {
  const procedures = (snapshot.project.elements.procedure ?? []).map((p) => (p.id === element.id ? { ...element, [PROGRAM_FIELD]: ir } : p));
  if (!procedures.some((p) => p.id === element.id)) procedures.push({ ...element, [PROGRAM_FIELD]: ir });
  return { ...snapshot.project, elements: { ...snapshot.project.elements, procedure: procedures } };
}

const typeMap = () => new Map(elementTypes().map((type) => [type.id, type]));

/** Dependencies whoever runs this procedure provides (undefined: unknown, every dependency is a parameter). */
export function providedFor(snapshot: ProjectSnapshot, element: Element): Dependency[] | undefined {
  return providedDependencies(element, procedureFieldUses(snapshot.project, typeMap()));
}

/** Element fields that run this procedure, for the details panel. */
export function callersOf(snapshot: ProjectSnapshot, id: string) {
  return procedureFieldUses(snapshot.project, typeMap()).filter((u) => u.procedureId === id);
}

export function compileFor(snapshot: ProjectSnapshot, element: Element, ir: ProcedureIR, env: ProcEnv): CompiledProcedure | undefined {
  const project = withProgram(snapshot, element, ir);
  const { scope } = compileScope(project, typeMap(), env.modClass);
  const unit = scope.procedures.get(element.id);
  return unit && compileProcedure(unit, scope, env);
}

/** Warnings for the blocks of a procedure program: missing dependencies, engine coverage, sides, references. */
export function procedureWarnings(snapshot: ProjectSnapshot, element: Element, ir: ProcedureIR, engine: EngineInfo | undefined, isProcedure: boolean): BlockWarning[] {
  const env = procEnvOf(engine, snapshot);
  const project = withProgram(snapshot, element, ir);
  const globals = globalVars(project);
  const analysis = analyzeProcedure(ir, {
    lookup: procedureLookup(project),
    provided: isProcedure ? providedFor(snapshot, element) : undefined,
    engine: env && engine ? { gen: env.gen, loader: env.loader, name: engine.name } : undefined,
    globals: (scope, type) => [...globals.values()].filter((g) => g.player === (scope === "player") && g.type === type).map((g) => g.name),
  });
  const warnings: BlockWarning[] = analysis.warnings.map((w) => ({
    path: w.path,
    message: w.kind === "missing_dependency" ? t("proc.warn.missingDeps", { deps: (w.deps ?? []).join(", ") })
      : w.kind === "not_generated" ? t("proc.warn.notGenerated", { engine: engine?.name ?? "" })
        : w.kind === "unknown_variable" ? t("proc.warn.variable")
          : w.kind === "unknown_procedure" ? t("proc.warn.procedure")
            : w.kind === "unknown_block" ? t("proc.warn.unknownBlock", { block: w.block })
              : t("proc.warn.noStart"),
  }));
  if (env && isProcedure) {
    for (const issue of compileFor(snapshot, element, ir, env)?.issues ?? []) {
      if (issue.kind === "side") warnings.push({ path: issue.path, message: t(issue.side === "client" ? "proc.warn.clientOnly" : "proc.warn.serverOnly") });
      if (issue.kind === "return") warnings.push({ path: issue.path, message: t("proc.warn.returnAcross") });
    }
  }
  return warnings;
}

/** Procedure fields of a type, for documentation of the dependencies element fields provide. */
export const procedureFieldsOf = (typeId: string) => {
  const type = typeMap().get(typeId);
  return type ? typeFields(type).filter((f) => f.type === "procedure") : [];
};

/** What the project offers block dropdowns and the Variables category: globals and procedures (locals are the editor's own). */
export function projectChoices(snapshot: ProjectSnapshot): Omit<ChoiceSource, "locals"> {
  const globals = () => [...globalVars(snapshot.project).values()];
  return {
    globals: (scope, type) => globals().filter((g) => g.player === (scope === "player") && g.type === type).map((g) => g.name),
    procedures: () => (snapshot.project.elements.procedure ?? []).map((p) => ({ id: p.id, name: elementName("procedure", p) })),
    allGlobals: () => globals().map((g) => ({ name: g.name, type: g.type, player: g.player })),
  };
}
