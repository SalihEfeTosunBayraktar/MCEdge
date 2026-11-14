// MCreator 1.16.5 import, procedures (KUYRUK #11): every <X>Procedure class becomes a procedure element whose program
// is one Java block holding the decompiled body, rewritten to MCEdge's classes: variables, procedure calls, registry
// lookups and GUI opening. Listener classes become global triggers. Blocks and items then get the procedures their
// classes called. Run this after blocks.ts and items.ts, which overwrite those elements.
// usage: node tools/import-mcreator/procedures.ts <legacy mod dir> <project dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { DEPENDENCY_NAMES, type Dependency } from "../../src/procedures/model.ts";
import { callArguments, closing, methodBody, procedureCalls, procedureId } from "./javaText.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/procedures.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const javaRoot = join(main, "java");
const pkg = readdirSync(javaRoot)[0];
const pkgDir = join(javaRoot, pkg);
const modClass = `${modId[0].toUpperCase()}${modId.slice(1)}Mod`;
const legacyVars = `${modClass}Variables`;
const vars = `${pkg}.procedures.${modClass}Variables`;
const pascal = (id: string) => id.split("_").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");

const classFiles = (dir: string) => readdirSync(join(pkgDir, dir)).filter((f) => f.endsWith(".java")).map((f) => [f.slice(0, -5), readFileSync(join(pkgDir, dir, f), "utf8")] as const);
const registryIds = (dir: string, pattern = /setRegistryName\("(\w+)"\)/) => new Map(classFiles(dir).map(([cls, code]) => [cls, pattern.exec(code)?.[1] ?? ""]));
const blockIds = registryIds("block", /this\.setRegistryName\("(\w+)"\)/);
const itemIds = registryIds("item");
const effectIds = registryIds("potion");
const particleIds = registryIds("particle");
const guiIds = registryIds("gui", /containerType\.setRegistryName\("(\w+)"\)/);
const gameRules = new Map(classFiles("world").map(([cls, code]) => [cls, (/GameRules\.register\("(\w+)"/.exec(code)?.[1] ?? "").replace(/([A-Z])/g, "_$1").toUpperCase()]));

const lookup = (registry: string, id: string) => `net.minecraftforge.registries.ForgeRegistries.${registry}.getValue(new net.minecraft.util.ResourceLocation("${modId}:${id}"))`;

// ---- what each procedure takes ----

interface Parsed { id: string; className: string; code: string; deps: Dependency[]; returnType: string; core: string; imports: string[] }

const RETURNS: Record<string, string> = { void: "none", boolean: "logic", String: "string", Entity: "entity" };
const procedureFiles = classFiles("procedures");

/** Body of the procedure behind the dependency checks: the last branch of their if / else chain. */
function coreOf(body: string): string {
  if (!/dependencies\.get\("/.test(body)) return body;
  let at = body.indexOf("if (dependencies.get(");
  for (;;) {
    const blockStart = body.indexOf("{", closing(body, at + 3) - 1);
    const blockEnd = closing(body, blockStart);
    const next = /^\s*else (if \(dependencies\.get\(|\{)/.exec(body.slice(blockEnd));
    if (next) {
      const open = blockEnd + next[0].length - (next[1] === "{" ? 1 : next[1].length);
      if (next[1] === "{") return body.slice(open + 1, closing(body, open) - 1);
      at = open;
      continue;
    }
    const after = /^\s*if \(dependencies\.get\(/.exec(body.slice(blockEnd));
    if (after) {
      at = blockEnd + after[0].length - "if (dependencies.get(".length;
      continue;
    }
    return body.slice(blockEnd);
  }
}

const parsed = new Map<string, Parsed>(procedureFiles.flatMap(([className, code]) => {
  const signature = /public static (\w+) executeProcedure\(Map<String, Object> dependencies\)/.exec(code);
  if (!signature) return [];
  const body = methodBody(code, /public static \w+ executeProcedure\(Map<String, Object> dependencies\)/);
  const names = new Set([...body.matchAll(/dependencies\.get\("(\w+)"\)/g)].map((m) => m[1]));
  const core = coreOf(body).replace(/^\s*(?:final )?[\w.<>]+ (\w+) = [^;]*dependencies\.get\("\1"\)[^;]*;\s*$/gm, "");
  const imports = [...code.matchAll(/^import ([\w.]+);$/gm)].map((m) => m[1]).filter((name) => !name.startsWith(`${pkg}.`));
  return [[className, {
    id: procedureId(className), className, code, core, imports,
    deps: DEPENDENCY_NAMES.filter((d) => names.has(d)),
    returnType: RETURNS[signature[1]] ?? "none",
  }]] as [string, Parsed][];
}));

// ---- rewriting the body ----

/** Values of a `Stream.of(new SimpleEntry<>("k", v), ...)...` dependency map. */
function mapValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const m of text.matchAll(/new SimpleEntry<>\(/g)) {
    const { args } = callArguments(text, m.index + m[0].length - 1);
    values.set(JSON.parse(args[0]) as string, args[1]);
  }
  return values;
}

function rewriteCalls(code: string, localMaps: Map<string, string>): string {
  let out = "";
  let at = 0;
  for (const call of procedureCalls(code)) {
    if (call.start < at) continue;
    const callee = parsed.get(call.name);
    if (!callee) throw new Error(`no procedure class ${call.name}`);
    const given = mapValues(call.args);
    if (localMaps.has(call.args.trim())) for (const [k, v] of mapValues(localMaps.get(call.args.trim())!)) given.set(k, v);
    const args = callee.deps.map((d) => given.get(d) ?? (["x", "y", "z"].includes(d) ? "0" : "null")).map((arg) => rewriteCalls(arg, localMaps));
    out += `${code.slice(at, call.start)}${pkg}.procedures.${pascal(callee.id)}Procedure.execute(${args.join(", ")})`;
    at = call.end;
  }
  return out + code.slice(at);
}

/** Statements `PlayerVariablesSync.openGui(player, provider, pos)` become MCEdge's GUI opening. */
function rewriteOpenGui(code: string): string {
  let out = code;
  for (;;) {
    const m = /(?:PlayerVariablesSync|NetworkHooks)\.openGui\(/.exec(out);
    if (!m) return out;
    const { args, end } = callArguments(out, m.index + m[0].length - 1);
    const gui = /new (\w+)\.GuiContainerMod\(/.exec(args[1])?.[1] ?? "";
    const id = guiIds.get(gui);
    if (!id) throw new Error(`GUI class ${gui} unknown`);
    const after = out[end] === ";" ? end + 1 : end;
    out = `${out.slice(0, m.index)}${vars}.flush(${args[0]});\n${pkg}.init.${modClass}Menus.open${pascal(id)}(${args[0]}, ${args[2]}, null);${out.slice(after)}`;
  }
}

/** Start of the expression that ends at `end`, walking back over names, dots and bracket pairs. */
function expressionStart(code: string, end: number): number {
  let i = end;
  for (;;) {
    while (i > 0 && /[\s.]/.test(code[i - 1]) && (code[i - 1] === "." || /^\s*\./.test(code.slice(i)))) i--;
    if (code[i - 1] === ")") {
      let depth = 0;
      do {
        i--;
        if (code[i] === ")") depth++;
        if (code[i] === "(") depth--;
      } while (depth > 0);
    } else if (/[\p{L}\p{N}_]/u.test(code[i - 1] ?? "")) {
      while (/[\p{L}\p{N}_]/u.test(code[i - 1] ?? "")) i--;
    } else return i;
  }
}

/** `<entity>.getCapability(...).ifPresent(capability -> { capability.x = v; sync })` becomes one setter call. */
function rewriteVariableSets(core: string, capability: string): string {
  const pattern = new RegExp(`\\s*\\.getCapability\\(\\s*${capability},\\s*null\\s*\\)\\s*\\.ifPresent\\(`);
  let code = core;
  for (;;) {
    const m = pattern.exec(code);
    if (!m) return code;
    const start = expressionStart(code, m.index);
    const end = closing(code, m.index + m[0].length - 1);
    const set = /capability\.(\w+) = ([^;]*);/.exec(code.slice(m.index, end));
    if (!set) throw new Error(`capability block without a set: ${code.slice(m.index, end)}`);
    code = `${code.slice(0, start)}${vars}.set_${set[1]}(${code.slice(start, m.index)}, ${set[2]})${code.slice(end)}`;
  }
}

function rewrite(core: string): string {
  const capability = `${legacyVars}\\.PLAYER_VARIABLES_CAPABILITY`;
  let code = rewriteVariableSets(core, capability)
    .replace(new RegExp(`\\(\\(${legacyVars}\\.PlayerVariables\\)\\s*([\\s\\S]*?)\\s*\\.getCapability\\(\\s*${capability},\\s*null\\s*\\)\\s*\\.orElse\\(\\s*new ${legacyVars}\\.PlayerVariables\\(\\)\\s*\\)\\s*\\)\\s*\\.(\\w+)`, "g"), `${vars}.get_$2($1)`)
    .replace(new RegExp(`${legacyVars}\\.MapVariables\\.get\\(([\\w().]+)\\)\\.syncData\\([\\w().]+\\);`, "g"), "")
    .replace(new RegExp(`${legacyVars}\\.MapVariables\\.get\\(([\\w().]+)\\)\\.(\\w+) ([-+*/]?)= ([^;]*);`, "g"), (_all, world: string, name: string, operator: string, value: string) =>
      `${vars}.set_${name}(${world}, ${operator ? `${vars}.get_${name}(${world}) ${operator} (${value})` : value});`)
    .replace(new RegExp(`${legacyVars}\\.MapVariables\\.get\\(([\\w().]+)\\)\\.(\\w+)(\\+\\+|--);`, "g"), (_all, world: string, name: string, step: string) => `${vars}.set_${name}(${world}, ${vars}.get_${name}(${world}) ${step[0]} 1);`)
    .replace(new RegExp(`${legacyVars}\\.MapVariables\\.get\\(([\\w().]+)\\)\\.(\\w+)`, "g"), `${vars}.get_$2($1)`)
    .replace(/\(\w+\)dependencies\.get\("(\w+)"\)/g, "$1");
  // Dependency maps filled one put at a time are read when the call is rewritten.
  const localMaps = new Map<string, string>();
  code = rewriteCalls(rewriteOpenGui(code), localMaps);
  return code
    .replace(/(\w+Block)\.block\b/g, (all, cls: string) => (blockIds.get(cls) ? lookup("BLOCKS", blockIds.get(cls)!) : all))
    .replace(/(\w+Item)\.block\b/g, (all, cls: string) => (itemIds.get(cls) ? lookup("ITEMS", itemIds.get(cls)!) : all))
    .replace(/(\w+PotionEffect)\.potion\b/g, (all, cls: string) => (effectIds.get(cls) ? lookup("POTIONS", effectIds.get(cls)!) : all))
    .replace(/(\w+Particle)\.particle\b/g, (all, cls: string) => (particleIds.get(cls) ? `((net.minecraft.particles.BasicParticleType) ${lookup("PARTICLE_TYPES", particleIds.get(cls)!)})` : all))
    .replace(/(\w+GameRule)\.gamerule\b/g, (all, cls: string) => (gameRules.get(cls) ? `${pkg}.init.${modClass}GameRules.${gameRules.get(cls)}` : all))
    .replace(new RegExp(`\\b${modClass}\\.LOGGER\\b`, "g"), "org.apache.logging.log4j.LogManager.getLogger()")
    .replace(new RegExp(`\\b${modClass}\\.RANDOM\\b`, "g"), "java.util.concurrent.ThreadLocalRandom.current()");
}

// ---- triggers ----

const TRIGGERS: Record<string, string> = {
  PlayerTickEvent: "player_ticks", BreakEvent: "block_break", LivingDeathEvent: "entity_dies", EntityInteract: "player_right_click_entity",
  PlayerLoggedInEvent: "player_log_in", RightClickBlock: "player_right_click_block", WorldTickEvent: "world_ticks", EntityPlaceEvent: "block_place",
  LeftClickBlock: "player_left_click_block", UseHoeEvent: "player_use_hoe", Load: "world_load", Unload: "world_unload",
};
/** Java put before the body where a trigger is wider than the event it replaces. */
const TRIGGER_GUARDS: Record<string, string> = {};
const triggerEvent = (code: string) => /public static void \w+\(([\w.]+) event\)/.exec(code.includes("class GlobalTrigger") ? code.slice(code.indexOf("class GlobalTrigger")) : "")?.[1];
const trigger = (code: string) => {
  const event = triggerEvent(code);
  return event ? TRIGGERS[event] ?? `unmapped:${event}` : "no_ext_trigger";
};

const type = typeRegistry().byId.get("procedure")!;
mkdirSync(join(projectDir, "elements/procedures"), { recursive: true });
const unmapped = new Set<string>();
for (const p of parsed.values()) {
  const globalTrigger = trigger(p.code);
  if (globalTrigger.startsWith("unmapped:")) unmapped.add(globalTrigger);
  const element = {
    ...newElement(type, p.id),
    globalTrigger: globalTrigger.startsWith("unmapped:") ? "no_ext_trigger" : globalTrigger,
    returnType: p.returnType,
    program: {
      format: 1, variables: [],
      stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "java_code", fields: { gen: "1.16.5", deps: p.deps.join(" "), imports: p.imports.join(" "), code: `${TRIGGER_GUARDS[triggerEvent(p.code) ?? ""] ?? ""}${rewrite(p.core).trim()}` } }] }],
    },
  };
  writeFileSync(join(projectDir, "elements/procedures", `${p.id}.json`), JSON.stringify(element, null, 2));
}
console.log(`imported ${parsed.size} procedures; unmapped triggers: ${[...unmapped].join(", ") || "none"}`);

// ---- wiring blocks and items ----

/** Legacy method -> element field. */
const BLOCK_METHODS: [RegExp, string][] = [
  [/public ActionResultType use\(/, "onRightClicked"], [/public void onPlace\(/, "onBlockAdded"], [/public void tick\(/, "onTickUpdate"],
  [/public void attack\(/, "onStartToDestroy"], [/public void neighborChanged\(/, "onNeighbourBlockChanges"], [/public void randomTick\(/, "onRandomUpdateEvent"],
  [/public void entityInside\(/, "onEntityCollides"], [/public void stepOn\(/, "onEntityWalksOn"], [/public void setPlacedBy\(/, "onBlockPlayedBy"],
  [/public boolean removedByPlayer\(/, "onDestroyedByPlayer"], [/public void wasExploded\(/, "onDestroyedByExplosion"], [/public void fallOn\(/, "onEntityFallsOn"],
];
const ITEM_METHODS: [RegExp, string][] = [
  [/public ActionResult<ItemStack> use\(/, "onRightClickedInAir"], [/public ActionResultType onItemUseFirst\(/, "onRightClickedOnBlock"], [/public ActionResultType useOn\(/, "onRightClickedOnBlock"],
  [/public ItemStack finishUsingItem\(/, "onFinishUsingItem"], [/public void inventoryTick\(/, "onItemInInventoryTick"], [/public void onCraftedBy\(/, "onCrafted"],
  [/public boolean hurtEnemy\(/, "onEntityHitWith"], [/public boolean onDroppedByPlayer\(/, "onDroppedByPlayer"], [/public void onItemDropped\(/, "onDroppedByPlayer"], [/public boolean onEntitySwing\(/, "onEntitySwing"],
  [/public void releaseUsing\(/, "onStoppedUsing"], [/public void onUseTick\(/, "everyTickWhileUsing"],
];

function wire(folder: string, classes: Map<string, string>, sourceDir: string, methods: [RegExp, string][]): number {
  let wired = 0;
  for (const [cls, code] of classFiles(sourceDir)) {
    const id = classes.get(cls);
    if (!id) continue;
    const file = join(projectDir, "elements", folder, `${id}.json`);
    const element = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [signature, field] of methods) {
      const call = procedureCalls(methodBody(code, signature))[0];
      if (call) {
        element[field] = procedureId(call.name);
        wired++;
      }
    }
    if (folder === "items") {
      const gui = /new (\w+)\.GuiContainerMod\(/.exec(code)?.[1];
      const size = /new ItemStackHandler\((\d+)\)/.exec(code)?.[1];
      if (gui) Object.assign(element, { guiBoundTo: guiIds.get(gui), openGUIOnRightClick: true, inventorySize: Number(size ?? 0), inventoryStackSize: Number(/public int getSlotLimit\(int slot\) \{\s*return (\d+)/.exec(code)?.[1] ?? 64) });
    } else {
      const gui = /new (\w+)\.GuiContainerMod\(/.exec(code)?.[1];
      // A block whose own `use` opens the GUI (a block that opens it from a procedure keeps the right click for that).
      if (gui) Object.assign(element, { guiBoundTo: guiIds.get(gui), ...(/openGui\(/.test(methodBody(code, /public ActionResultType use\(/)) ? { openGUIOnRightClick: true } : {}) });
    }
    writeFileSync(file, JSON.stringify(element, null, 2));
  }
  return wired;
}
console.log(`wired ${wire("blocks", blockIds, "block", BLOCK_METHODS)} block and ${wire("items", itemIds, "item", ITEM_METHODS)} item procedures`);
