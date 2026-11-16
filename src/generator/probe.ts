import { pascal } from "./java.ts";
import { typeRegistry } from "../elements/registry.ts";
import { elementTriggers, GLOBAL_TRIGGERS_BY_ID, triggerCode } from "../procedures/triggers.ts";
import { procedureBuild } from "./procedures.ts";
import { probeCore } from "./probeCore.ts";
import { probeGame } from "./probeGame.ts";
import type { GenEnv, JavaSourceFile } from "./typeModule.ts";

/**
 * The test probe of dev builds (Q218 run_scenario, Q219 tick_profile). Two classes in `<package>.probe`:
 *   <Mod>Probe       engine-neutral: reads run/mcedge-probe/scenario.json when the server has started, runs its steps on
 *                    the server thread, and writes run/mcedge-probe/result.json (probeCore.ts).
 *   <Mod>ProbeGame   the thin adapter: the vanilla and loader calls a step needs, one source per generation and loader
 *                    (probeGame.ts).
 * Nothing is written without `env.probe`, which only the scenario and profile tools and `build --probe` set.
 */
export function probeOutputs(env: GenEnv): { sources: JavaSourceFile[]; init: string[] } {
  if (!env.probe) return { sources: [], init: [] };
  const pkg = env.project.mod.package;
  const dir = `${pkg.replaceAll(".", "/")}/probe`;
  const probe = `${pkg}.probe.${probeClass(env)}`;
  const start = triggerCode(GLOBAL_TRIGGERS_BY_ID.get("mod_serverload")!.code, env.mc, env.loader);
  if (!start) throw new Error(`the test probe needs the server start trigger, which ${env.engine.name} lacks`);
  return {
    sources: [
      { path: `${dir}/${probeClass(env)}.java`, code: probeCore(env, procedureTable(env)) },
      { path: `${dir}/${probeClass(env)}Game.java`, code: probeGame(env) },
    ],
    // The server start trigger's own registration for this engine; the probe starts when the scenario file exists.
    init: [start({ run: (deps) => `${probe}.start(${deps.world}.getServer());` })],
  };
}

/** Matches the class the profile build's procedures call (src/procedures/compile.ts). */
export const probeClass = (env: GenEnv) => `${pascal(env.modId)}ModProbe`;

/** One row per procedure: id, Java class, dependency names in parameter order, and the tick triggers that run it. */
export interface ProcedureRow {
  id: string;
  className: string;
  deps: string[];
  ticks: string[];
}

/** Tick triggers that call each procedure: global tick triggers and element fields with a server tick trigger. */
export function procedureTable(env: GenEnv): ProcedureRow[] {
  const build = procedureBuild(env);
  const ticks = new Map<string, string[]>();
  const add = (id: string, trigger: string) => ticks.set(id, [...(ticks.get(id) ?? []), trigger]);
  for (const element of env.generated.procedure ?? []) {
    const trigger = String(element.globalTrigger ?? "");
    if (/_ticks$/.test(trigger)) add(element.id, trigger);
  }
  const tickFields = new Set(elementTriggers(env.project.mod.package).filter((t) => t.side === "server" && t.id.includes("tick")).map((t) => t.id));
  const registry = typeRegistry();
  for (const [typeId, elements] of Object.entries(env.generated)) {
    const fields = registry.byId.get(typeId)?.pages.flatMap((p) => p.groups.flatMap((g) => g.fields)).filter((f) => f.type === "procedure" && tickFields.has(f.trigger ?? "")) ?? [];
    for (const element of elements) {
      for (const field of fields) {
        const procedure = element[field.key];
        if (typeof procedure === "string" && procedure) add(procedure, `${field.trigger}:${typeId}/${element.id}`);
      }
    }
  }
  return [...build.scope.procedures.values()].filter((u) => build.compiled.has(u.id))
    .map((u) => ({ id: u.id, className: u.className, deps: [...u.deps], ticks: ticks.get(u.id) ?? [] }));
}
