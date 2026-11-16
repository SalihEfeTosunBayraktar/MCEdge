import type { Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { compileProcedure, defaultValue, type CompiledProcedure, type CompileIssue, type CompileScope, type ProcEnv, type Segment } from "../procedures/compile.ts";
import { ImportSet } from "../procedures/javaNames.ts";
import { DEPENDENCIES, type Dependency } from "../procedures/model.ts";
import { compileScope, globalVars, type FieldUse } from "../procedures/project.ts";
import { BLOCK_PLACE_LISTENERS, HOE_USE_LISTENERS } from "../procedures/triggers.ts";
import { blockDataHolderSource, blockPlaceEventsSource, blockPlaceMixin, helperSources, hoeUseEventsSource, hoeUseMixin, networkSources, procedureSources, registrationSource, SYNC_SEGMENT, variablesSource, type JavaSource } from "../procedures/runtime.ts";
import { elementTriggers, GLOBAL_TRIGGERS_BY_ID, triggerCode, type ElementTriggerCtx } from "../procedures/triggers.ts";
import { commonTag } from "./commonTags.ts";
import { bubbleClientInit, bubbleRenderMixin, bubbleRenderSource, bubbleSegment, bubblesSource, bubbleTick, usesBubbles } from "./bubbles.ts";
import { guiSessionsClass, guiSessionsSource, sessionGuis, usesSessions } from "./guiSessions.ts";
import { transitionsSource } from "./transitions.ts";
import { radialClientInit, radialSegments, radialServerHooks, radialSources, radialUsed } from "./radial.ts";
import { pascal } from "./java.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * Procedure generation for one engine, computed once per generate run and shared by the procedure type module
 * (procedure classes, packets, registrations) and the element modules (overrides calling procedures).
 */
export interface ProcedureBuild {
  env: ProcEnv;
  compiled: Map<string, CompiledProcedure>;
  sources: JavaSource[];
  /** Mod constructor statements (modBus in scope on Forge/NeoForge). */
  init: string[];
  /** Client initialisation statements (modBus in scope on Forge/NeoForge). */
  clientInit: string[];
  /** Problems to report with the build: blocks or triggers this engine does not generate. */
  warnings: string[];
  /** Fabric mixins the procedures need. */
  mixins: { id: string; code: string; client?: boolean }[];
  /** Whether the mod has the bubble runtime (<Mod>Bubbles), which reads bubbles.json. */
  bubbles: boolean;
  uses: FieldUse[];
  scope: CompileScope;
}

const builds = new WeakMap<object, Map<string, ProcedureBuild>>();

export function procEnv(env: GenEnv): ProcEnv {
  return { gen: env.mc, loader: env.loader, modId: env.modId, pkg: env.project.mod.package, modClass: `${pascal(env.modId)}Mod`, tag: (id) => commonTag(env, id), ...(env.probe?.profile ? { profile: true } : {}) };
}

export function procedureBuild(env: GenEnv): ProcedureBuild {
  const perProject = builds.get(env.generated) ?? new Map<string, ProcedureBuild>();
  builds.set(env.generated, perProject);
  const known = perProject.get(env.engine.id);
  if (known) return known;
  const build = createBuild(env);
  perProject.set(env.engine.id, build);
  return build;
}

function createBuild(env: GenEnv): ProcedureBuild {
  const penv = procEnv(env);
  const project = { elements: env.generated, variables: env.project.variables };
  const { scope, uses } = compileScope(project, typeRegistry().byId, penv.modClass);
  const compiled = new Map<string, CompiledProcedure>();
  const warnings: string[] = [];
  const segments: Segment[] = [];
  const helpers = new Set<string>();
  let usesQueue = false;
  for (const unit of scope.procedures.values()) {
    const result = compileProcedure(unit, scope, penv);
    compiled.set(unit.id, result);
    segments.push(...result.segments);
    result.helpers.forEach((h) => helpers.add(h));
    usesQueue ||= result.usesQueue;
    for (const issue of summarize(result.issues)) warnings.push(`procedure/${unit.id}: ${issue}`);
  }
  // Global triggers.
  const triggers: string[] = [];
  for (const element of env.generated.procedure ?? []) {
    const id = String(element.globalTrigger ?? "no_ext_trigger");
    const unit = scope.procedures.get(element.id)!;
    const trigger = GLOBAL_TRIGGERS_BY_ID.get(id);
    const code = trigger && triggerCode(trigger.code, penv.gen, penv.loader);
    if (!code) {
      if (id !== "no_ext_trigger") warnings.push(`procedure/${element.id}: global trigger "${id}" is not generated for ${env.engine.name}`);
      continue;
    }
    const imports = new ImportSet(penv.gen);
    const call = `${penv.pkg}.procedures.${unit.className}.execute(${unit.deps.map((d) => "%" + d).join(", ")})`;
    const text = code({
      run: (deps, cancel) => {
        const args = call.replace(/%(\w+)/g, (_, d: Dependency) => deps[d] ?? defaultValue(DEPENDENCIES[d].type === "world" ? undefined : (DEPENDENCIES[d].type as never), imports));
        return `${args};\n${cancel ? `if (${penv.pkg}.procedures.ProcedureHelpers.takeCancel()) {\n${cancel}\n}` : `${penv.pkg}.procedures.ProcedureHelpers.takeCancel();`}`;
      },
    });
    if (text) triggers.push(text);
  }
  // Defaults of missing dependencies reference simple names; qualify the few that can appear.
  const qualified = triggers.map((t) => qualifyDefaults(t, penv));
  const vars = env.project.variables.map((v) => ({ ...globalVars(project).get(v.name)!, initial: v.initial, scope: v.scope }));
  // The runtime is written for procedures, and for radial menus even in a mod without any.
  const hasProcedures = compiled.size > 0 || (env.generated.radial_menu?.length ?? 0) > 0;
  const listensToPlace = qualified.some((t) => t.includes(BLOCK_PLACE_LISTENERS));
  const listensToHoe = qualified.some((t) => t.includes(HOE_USE_LISTENERS));
  const syncsVars = vars.length > 0;
  // GUI labels whose text procedure runs on the server: the menu sends each text when it changes (KUYRUK 105).
  const syncsGuiText = (env.generated.gui ?? []).some((g) => guiServerTexts(g, scope).length > 0);
  if (syncsGuiText) segments.push({ name: GUI_TEXT_SEGMENT, path: "gui_text", direction: "toClient", fields: [{ name: "menu", type: "number" }, { name: "index", type: "number" }, { name: "text", type: "text" }], method: "receive", owner: guiTextClass(penv) });
  // Session GUIs (Q205): each menu sends its session's id and values to its player when they change.
  const syncsSessions = compiled.size > 0 && sessionGuis(env).length > 0;
  if (syncsSessions) segments.push({ name: GUI_SESSION_SEGMENT, path: "gui_session", direction: "toClient", fields: [{ name: "menu", type: "number" }, { name: "session", type: "text" }, { name: "data", type: "tag" }], method: "receive", owner: guiSessionsClass(env) });
  const procedureCode = [...compiled.values()].map((c) => `${c.source}${c.clientSource ?? ""}`);
  // Radial menus (Q227): one runtime for every menu, with its packets, server hooks and the bubbles its slices show.
  const radial = radialUsed(env, procedureCode, qualified);
  if (radial) {
    segments.push(...radialSegments(penv));
    qualified.push(...radialServerHooks(penv));
  }
  // Status bubbles (Q206): a store ticked on the server and sent to each dimension's clients.
  const bubbles = radial || usesBubbles(penv, procedureCode);
  if (bubbles) {
    segments.push(bubbleSegment(penv));
    qualified.push(bubbleTick(penv));
  }
  if (syncsVars) segments.push({ name: SYNC_SEGMENT, path: "variables_sync", direction: "toClient", fields: [{ name: "scope", type: "number" }, { name: "data", type: "tag" }], method: "receive", owner: `${penv.pkg}.procedures.${penv.modClass}Variables` });
  const sources: JavaSource[] = [];
  const init: string[] = [];
  const clientInit: string[] = [];
  if (hasProcedures) {
    for (const c of compiled.values()) sources.push(...procedureSources(penv, c));
    sources.push(...helperSources(penv, helpers));
    if (penv.gen !== "1.16.5") sources.push(blockDataHolderSource(penv.pkg));
    sources.push(...networkSources(penv, segments));
    if (syncsGuiText) sources.push(guiTextSource(penv));
    // Session blocks without a session GUI still need the store (the GUI module writes it otherwise).
    if (!sessionGuis(env).length && usesSessions(env, [...compiled.values()].map((c) => `${c.source}${c.clientSource ?? ""}`))) sources.push(guiSessionsSource(env));
    if (bubbles) sources.push(transitionsSource(penv), bubblesSource(penv), bubbleRenderSource(penv));
    if (radial) sources.push(...radialSources(env, penv, (id, deps, returns) => callIn({ env: penv, compiled, scope, warnings }, id, deps, "radial_menu", returns)));
    sources.push(registrationSource(penv, qualified, usesQueue, vars.some((v) => v.player), syncsVars));
    if (listensToPlace) sources.push(blockPlaceEventsSource(penv.pkg));
    if (listensToHoe) sources.push(hoeUseEventsSource(penv.pkg));
    sources.push(variablesSource(penv, vars));
    const registration = `${penv.pkg}.procedures.${penv.modClass}Procedures.init(${penv.loader === "fabric" ? "" : "modBus"});`;
    init.push(registration);
    clientInit.push(`${penv.pkg}.procedures.client.${penv.modClass}NetworkClient.register(${penv.loader === "neoforge" ? "modBus" : ""});`);
    if (bubbles) clientInit.push(...bubbleClientInit(penv));
    if (radial) clientInit.push(...radialClientInit(penv));
  }
  return { env: penv, compiled, sources, init, clientInit, warnings, uses, scope, bubbles: bubbles && hasProcedures, mixins: [...(listensToPlace ? [blockPlaceMixin(penv.pkg, env.modId)] : []), ...(listensToHoe ? [hoeUseMixin(penv.pkg, env.modId)] : []),
    ...(bubbles && hasProcedures && penv.loader === "fabric" ? [bubbleRenderMixin(penv)] : [])] };
}

/** Packet carrying a server-computed GUI label text: menu container id, widget index, text. */
export const GUI_TEXT_SEGMENT = "GuiTextSync";
/** Packet carrying a session menu's session id and values (Q205): menu container id, session id, values. */
export const GUI_SESSION_SEGMENT = "GuiSessionSync";

/** Client class holding the label texts the open menu's server sent. */
const guiTextClass = (env: ProcEnv) => `${env.pkg}.procedures.client.${env.modClass}GuiText`;

/** Widget indexes and procedure ids of a GUI's labels whose text procedure runs on the server. */
export function guiServerTexts(gui: Element, scope: CompileScope): { index: number; procedure: string }[] {
  const widgets = (Array.isArray(gui.components) ? gui.components : []) as Record<string, unknown>[];
  return widgets.flatMap((w, index) => {
    const id = w.textProcedure;
    return w.kind === "label" && typeof id === "string" && scope.procedures.get(id)?.home === "server" ? [{ index, procedure: id }] : [];
  });
}

/** Client read of a synced label text, for the screen. */
export function guiTextRead(env: GenEnv, menu: string, index: number): string {
  return `${guiTextClass(procEnv(env))}.text(${menu}, ${index})`;
}

function guiTextSource(env: ProcEnv): JavaSource {
  const legacy = env.gen === "1.16.5";
  const cls = `${env.modClass}GuiText`;
  const level = legacy ? "net.minecraft.world.World" : "net.minecraft.world.level.Level";
  return {
    path: `${env.pkg.replaceAll(".", "/")}/procedures/client/${cls}.java`,
    code: `package ${env.pkg}.procedures.client;

/** Generated by MCEdge: label texts computed by the open menu on the server (sent when they change). */
public final class ${cls} {
    private static int menu = -1;
    private static final java.util.Map<Integer, String> TEXT = new java.util.HashMap<>();

    private ${cls}() {}

    public static void receive(${level} level, double menu, double index, String text) {
        if ((int) menu != ${cls}.menu) {
            TEXT.clear();
            ${cls}.menu = (int) menu;
        }
        TEXT.put((int) index, text);
    }

    public static String text(int menu, int index) {
        return menu == ${cls}.menu ? TEXT.getOrDefault(index, "") : "";
    }
}
`,
  };
}

/** One line per issue kind and block, so a large procedure does not flood the build log. */
function summarize(issues: CompileIssue[]): string[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (issue.kind === "empty_input") continue;
    const key = `${issue.block ? `${issue.block}: ` : ""}${issue.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => (n > 1 ? `${key} (${n} blocks)` : key));
}

function qualifyDefaults(code: string, env: ProcEnv): string {
  const legacy = env.gen === "1.16.5";
  return code
    .replace(/(?<![.\w])ItemStack\.EMPTY\b/g, `${legacy ? "net.minecraft.item" : "net.minecraft.world.item"}.ItemStack.EMPTY`)
    .replace(/(?<![.\w])Blocks\.AIR\b/g, `${legacy ? "net.minecraft.block" : "net.minecraft.world.level.block"}.Blocks.AIR`)
    .replace(/(?<![.\w])Direction\.NORTH\b/g, `${legacy ? "net.minecraft.util" : "net.minecraft.core"}.Direction.NORTH`)
    .replace(/(?<![.\w])InteractionResult\.PASS\b/g, legacy ? "net.minecraft.util.ActionResultType.PASS" : "net.minecraft.world.InteractionResult.PASS");
}

/** Return value types element triggers expect from their procedure (type.json "returns"). */
const RETURN_FOR: Record<string, string> = { logic: "logic", number: "number", actionresulttype: "actionresult" };

/**
 * Call expression of the procedure an element field names, for fields whose caller is not an override (event
 * listeners, key handlers): `deps` maps the dependencies the caller provides. Undefined when the field is empty or
 * its procedure is not generated (reported as a build warning).
 */
export function procedureCall(env: GenEnv, typeId: string, element: Element, fieldKey: string, deps: Partial<Record<Dependency, string>>): string | undefined {
  const procedureId = element[fieldKey];
  if (typeof procedureId !== "string" || !procedureId) return undefined;
  const build = procedureBuild(env);
  const unit = build.compiled.has(procedureId) ? build.scope.procedures.get(procedureId) : undefined;
  if (!unit) {
    build.warnings.push(`${typeId}/${element.id}: ${fieldKey} uses procedure "${procedureId}", which is not generated`);
    return undefined;
  }
  const imports = new ImportSet(build.env.gen);
  return `${build.env.pkg}.procedures.${unit.className}.execute(${unit.deps.map((d) => deps[d] ?? qualifyDefaults(defaultValue(DEPENDENCIES[d].type === "world" ? undefined : (DEPENDENCIES[d].type as never), imports), build.env)).join(", ")})`;
}

/**
 * Call expression of a procedure named outside an element field (a block field of an embedded program, a list row):
 * undefined when empty, not generated, or not returning `returns` (each reported as a build warning under `where`).
 */
export function procedureCallById(env: GenEnv, procedureId: unknown, deps: Partial<Record<Dependency, string>>, where: string, returns?: "logic" | "number"): string | undefined {
  if (typeof procedureId !== "string" || !procedureId) return undefined;
  return callIn(procedureBuild(env), procedureId, deps, where, returns);
}

/** procedureCallById within a build, also while it is being made. */
function callIn(build: Pick<ProcedureBuild, "env" | "compiled" | "scope" | "warnings">, procedureId: string, deps: Partial<Record<Dependency, string>>, where: string, returns?: "logic" | "number"): string | undefined {
  const unit = build.compiled.has(procedureId) ? build.scope.procedures.get(procedureId) : undefined;
  if (!unit) {
    build.warnings.push(`${where} uses procedure "${procedureId}", which is not generated`);
    return undefined;
  }
  if (returns && unit.returnType !== returns) {
    build.warnings.push(`${where} needs procedure "${procedureId}" to return ${returns}`);
    return undefined;
  }
  const imports = new ImportSet(build.env.gen);
  return `${build.env.pkg}.procedures.${unit.className}.execute(${unit.deps.map((d) => deps[d] ?? qualifyDefaults(defaultValue(DEPENDENCIES[d].type === "world" ? undefined : (DEPENDENCIES[d].type as never), imports), build.env)).join(", ")})`;
}

/** Records a problem of an element this engine generates only in part. */
export function buildWarning(env: GenEnv, text: string): void {
  const warnings = procedureBuild(env).warnings;
  if (!warnings.includes(text)) warnings.push(text);
}

/**
 * Overrides calling an element's procedures, for the element triggers this engine generates. `extras` passes
 * behaviour an override must keep (an item that starts using on right-click, a block's tick schedule).
 */
export function procedureMembers(env: GenEnv, typeId: string, element: Element, extras: Record<string, string> = {}): { members: string[]; handled: Set<string> } {
  const build = procedureBuild(env);
  const type = typeRegistry().byId.get(typeId);
  const members: string[] = [];
  const handled = new Set<string>();
  if (!type) return { members, handled };
  const byId = new Map(elementTriggers(build.env.pkg).map((t) => [t.id, t]));
  const fields = type.pages.flatMap((p) => p.groups.flatMap((g) => g.fields)).filter((f) => f.type === "procedure");
  for (const field of fields) {
    const procedureId = element[field.key];
    if (typeof procedureId !== "string" || !procedureId) continue;
    const trigger = byId.get(field.trigger ?? "");
    const code = trigger && triggerCode(trigger.member, build.env.gen, build.env.loader);
    if (!code) continue;
    const unit = build.compiled.has(procedureId) ? build.scope.procedures.get(procedureId) : undefined;
    if (!unit) {
      build.warnings.push(`${typeId}/${element.id}: ${field.label} uses procedure "${procedureId}", which is not generated`);
      continue;
    }
    const wanted = field.returns ? RETURN_FOR[field.returns] : undefined;
    if (field.returns === "logic" && unit.returnType !== "logic") {
      build.warnings.push(`${typeId}/${element.id}: ${field.label} needs procedure "${procedureId}" to return logic`);
      continue;
    }
    if (field.returns === "string_list" && unit.returnType !== "text") {
      build.warnings.push(`${typeId}/${element.id}: ${field.label} needs procedure "${procedureId}" to return text`);
      continue;
    }
    const imports = new ImportSet(build.env.gen);
    const ctx: ElementTriggerCtx = {
      call: (deps) => `${build.env.pkg}.procedures.${unit.className}.execute(${unit.deps.map((d) => deps[d] ?? qualifyDefaults(defaultValue(DEPENDENCIES[d].type === "world" ? undefined : (DEPENDENCIES[d].type as never), imports), build.env)).join(", ")})`,
      returns: wanted && unit.returnType === wanted ? wanted : undefined,
      extra: extras[field.key],
    };
    members.push(code(ctx));
    handled.add(field.key);
  }
  return { members, handled };
}
