import { typeFields, type Element, type ElementType } from "../elements/model.ts";
import { inferDependencies, type ProcedureLookup } from "./analyze.ts";
import type { CompileScope, GlobalVar, ProcedureUnit } from "./compile.ts";
import { GLOBAL_TRIGGERS_BY_ID, elementTriggers } from "./triggers.ts";
import { BLOCKS_BY_ID } from "./blocks/index.ts";
import { asProgram, isDependency, isNode, mainStack, RETURN_TYPES, type BlockNode, type Dependency, type LocalType, type ProcedureIR } from "./model.ts";

/**
 * Procedures in the context of a project: who runs them (the global trigger or element fields), the
 * dependencies those provide, and the units the compiler works on. Pure; works on a loaded project object.
 */

/** Field of the procedure type holding the program. */
export const PROGRAM_FIELD = "program";

interface ProjectLike {
  elements: Record<string, Element[]>;
  variables: { name: string; type: string; scope: string }[];
}

/** An element field that runs a procedure. */
export interface FieldUse {
  typeId: string;
  elementId: string;
  fieldKey: string;
  procedureId: string;
  trigger: string;
  provided: Dependency[];
  side: "server" | "client";
}

const ELEMENT_TRIGGER_SIDES = new Map(elementTriggers("x").map((t) => [t.id, t.side]));
/** Client-side element triggers that are not generated yet but are known to run on the client. */
const CLIENT_TRIGGERS = new Set(["particle_scale", "particle_expiry", "item_glow", "block_display_tick", "tooltip", "item_tooltip", "key_pressed", "key_released", "overlay_display", "entity_model_transparent", "block_animation", "item_animation_condition"]);

export function programOf(element: Element): ProcedureIR {
  return asProgram(element[PROGRAM_FIELD]);
}

/** Every top-level procedure field of the project's elements that names a procedure. */
export function procedureFieldUses(project: ProjectLike, types: ReadonlyMap<string, ElementType>): FieldUse[] {
  const uses: FieldUse[] = [];
  const programs = new Map((project.elements.procedure ?? []).map((p) => [p.id, programOf(p)]));
  for (const [typeId, elements] of Object.entries(project.elements)) {
    const type = types.get(typeId);
    if (!type) continue;
    const fields = typeFields(type).filter((f) => f.type === "procedure");
    for (const element of elements) {
      for (const field of fields) {
        const id = element[field.key];
        if (typeof id !== "string" || !id) continue;
        const trigger = field.trigger ?? "";
        uses.push({
          typeId, elementId: element.id, fieldKey: field.key, procedureId: id, trigger,
          provided: (field.dependencies ?? []).filter(isDependency),
          side: ELEMENT_TRIGGER_SIDES.get(trigger) ?? (CLIENT_TRIGGERS.has(trigger) ? "client" : "server"),
        });
      }
      for (const widget of (Array.isArray(element.components) ? element.components : []) as Record<string, unknown>[]) {
        // A state image's states' conditions run on the client like the widget's own (KUYRUK 186).
        const states = Array.isArray(widget?.states) ? (widget.states as Record<string, unknown>[]).filter((s) => s && typeof s === "object") : [];
        for (const state of states) {
          if (typeof state.condition === "string" && state.condition) uses.push({ typeId, elementId: element.id, fieldKey: "states.condition", procedureId: state.condition, trigger: "gui_widget", provided: ["x", "y", "z", "world", "entity"], side: "client" });
        }
        for (const fieldKey of ["condition", "textProcedure", "lockCondition", "stateProcedure"]) {
          const procedureId = widget[fieldKey];
          if (typeof procedureId !== "string" || !procedureId) continue;
          // A label text that needs the server is computed there by the menu and synced (KUYRUK 105).
          const side = fieldKey === "lockCondition" || (fieldKey === "textProcedure" && usesServerBlocks(procedureId, programs)) ? "server" : "client";
          uses.push({ typeId, elementId: element.id, fieldKey, procedureId, trigger: "gui_widget", provided: ["x", "y", "z", "world", "entity"], side });
        }
      }
    }
  }
  return uses;
}

/**
 * True when a procedure, or one it calls, has a block that runs only on the server (run_on_server included; the
 * client body of run_on_client is not). Such a procedure called on the client would send its server part as a
 * packet on every call and get nothing back.
 */
export function usesServerBlocks(procedureId: string, programs: ReadonlyMap<string, ProcedureIR>, seen = new Set<string>()): boolean {
  if (seen.has(procedureId)) return false;
  seen.add(procedureId);
  const ir = programs.get(procedureId);
  if (!ir) return false;
  const visit = (node: BlockNode): boolean => {
    if (node.disabled) return false;
    if (node.block === "run_on_client") return false;
    if (node.block === "run_on_server" || BLOCKS_BY_ID.get(node.block)?.side === "server") return true;
    if (node.block === "call_procedure" && usesServerBlocks(String(node.fields?.procedure ?? ""), programs, seen)) return true;
    return Object.values(node.inputs ?? {}).some((v) => (Array.isArray(v) ? v.some((n) => isNode(n) && visit(n)) : isNode(v) && visit(v)));
  };
  return (mainStack(ir)?.blocks ?? []).some((n) => isNode(n) && visit(n));
}

export function procedureLookup(project: ProjectLike): ProcedureLookup {
  const procedures = new Map((project.elements.procedure ?? []).map((p) => [p.id, programOf(p)]));
  const globals = new Map(project.variables.map((v) => [v.name, v]));
  return {
    ir: (id) => procedures.get(id),
    globalNeedsWorld: (name) => ["global_world", "global_map"].includes(globals.get(name)?.scope ?? ""),
  };
}

/** Dependencies the runner of a procedure provides: its global trigger, else the fields using it (all of them). */
export function providedDependencies(procedure: Element, uses: FieldUse[]): Dependency[] | undefined {
  const trigger = String(procedure.globalTrigger ?? "no_ext_trigger");
  if (trigger !== "no_ext_trigger") return GLOBAL_TRIGGERS_BY_ID.get(trigger)?.deps ?? undefined;
  const mine = uses.filter((u) => u.procedureId === procedure.id);
  if (!mine.length) return undefined;
  return mine.map((u) => u.provided).reduce((a, b) => a.filter((d) => b.includes(d)));
}

/** Side a procedure runs on: its global trigger's, else client when every field using it runs on the client. */
export function homeSide(procedure: Element, uses: FieldUse[]): "server" | "client" {
  const trigger = String(procedure.globalTrigger ?? "no_ext_trigger");
  if (trigger !== "no_ext_trigger") return GLOBAL_TRIGGERS_BY_ID.get(trigger)?.side ?? "server";
  const mine = uses.filter((u) => u.procedureId === procedure.id);
  return mine.length && mine.every((u) => u.side === "client") ? "client" : "server";
}

const GLOBAL_TYPE: Record<string, LocalType> = { number: "number", logic: "logic", string: "text", itemstack: "itemstack", blockstate: "blockstate", direction: "direction" };

export function globalVars(project: ProjectLike): Map<string, GlobalVar> {
  return new Map(project.variables.map((v) => [v.name, {
    name: v.name,
    type: GLOBAL_TYPE[v.type] ?? "number",
    player: v.scope.startsWith("player"),
    world: v.scope === "global_world" || v.scope === "global_map",
  }]));
}

export function pascal(id: string): string {
  return id.split(/[_/]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

/**
 * A compile unit whose dependencies are inferred when first read. The live checks of the procedure editor build the
 * scope after every edit but only compile one procedure; inferring all of them up front cost ~60-100 ms per edit on
 * ETREconomy (KUYRUK 185). The values are the same, computed once.
 */
function unit(fields: Omit<ProcedureUnit, "deps">, deps: () => Dependency[]): ProcedureUnit {
  let known: Dependency[] | undefined;
  return Object.defineProperty(fields, "deps", { enumerable: true, get: () => (known ??= deps()) }) as ProcedureUnit;
}

/** Compile units and scope of every procedure of a project. */
export function compileScope(project: ProjectLike, types: ReadonlyMap<string, ElementType>, modClass: string): { scope: CompileScope; uses: FieldUse[] } {
  const uses = procedureFieldUses(project, types);
  const lookup = procedureLookup(project);
  const procedures = new Map<string, ProcedureUnit>();
  for (const element of project.elements.procedure ?? []) {
    const ir = programOf(element);
    procedures.set(element.id, unit({
      id: element.id,
      className: `${pascal(element.id)}Procedure`,
      ir,
      returnType: RETURN_TYPES[String(element.returnType ?? "none")],
      home: homeSide(element, uses),
      skipNullCheck: element.skipDependencyNullCheck === true,
    }, () => inferDependencies(ir, lookup, new Set([element.id]))));
  }
  // A command's argument program is its body: a procedure of its own, "command:<id>", on the client for client-side
  // commands and on the server otherwise.
  for (const element of project.elements.command ?? []) {
    const ir = asProgram(element.argsxml);
    procedures.set(`command:${element.id}`, unit({
      id: `command:${element.id}`,
      className: `${pascal(element.id)}CommandProgram`,
      ir,
      returnType: RETURN_TYPES.none,
      home: element.type === "CLIENTSIDE" ? "client" : "server",
      skipNullCheck: false,
    }, () => inferDependencies(ir, lookup, new Set())));
  }
  return { scope: { procedures, globals: globalVars(project), variablesClass: `${modClass}Variables` }, uses };
}
