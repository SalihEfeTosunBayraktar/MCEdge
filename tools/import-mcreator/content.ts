// MCreator 1.16.5 import, the rest of the mod's content (KUYRUK #11): variables, commands, overlays, potion effects,
// item extensions, recipes, advancements and tags.
// usage: node tools/import-mcreator/content.ts <legacy mod dir> <project dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { callArguments, closing, methodBody, procedureCalls, procedureId } from "./javaText.ts";
import { importTags } from "./tags.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/content.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const assets = join(main, "resources/assets", modId);
const data = join(main, "resources/data");
const javaRoot = join(main, "java");
const pkgDir = join(javaRoot, readdirSync(javaRoot)[0]);
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const en = readJson<Record<string, string>>(join(assets, "lang/en_us.json"));
const types = typeRegistry().byId;
const javaFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".java")).map((f) => readFileSync(join(dir, f), "utf8")) : []);
const write = (folder: string, element: { id: string }) => {
  mkdirSync(join(projectDir, "elements", folder), { recursive: true });
  writeFileSync(join(projectDir, "elements", folder, `${element.id}.json`), JSON.stringify(element, null, 2));
};
/** Item or block reference of an element field: this mod's without namespace. */
const local = (id: string) => id.replace(`${modId}:`, "");

// ---- variables ----

function variables(): number {
  const code = readFileSync(join(pkgDir, `${modId[0].toUpperCase()}${modId.slice(1)}ModVariables.java`), "utf8");
  const clone = methodBody(code, /public void clonePlayer\(/);
  const onDeath = new Set([...clone.slice(0, clone.indexOf("isWasDeath")).matchAll(/clone\.(\w+) = /g)].map((m) => m[1]));
  const list: { name: string; type: string; scope: string; initial: string }[] = [];
  const read = (section: string, scope: (name: string) => string) => {
    for (const m of section.matchAll(/^ {6}public (double|boolean|String|ItemStack) (\w+) = (.*);$/gm)) {
      const type = { double: "number", boolean: "logic", String: "string", ItemStack: "itemstack" }[m[1]]!;
      const initial = m[1] === "String" ? (JSON.parse(m[3]) as string) : m[1] === "ItemStack" ? "" : m[3];
      list.push({ name: m[2], type, scope: scope(m[2]), initial });
    }
  };
  const section = (name: string) => {
    const open = code.indexOf("{", code.indexOf(`class ${name}`));
    return code.slice(open, closing(code, open));
  };
  read(section("MapVariables"), () => "global_map");
  read(section("PlayerVariables "), (name) => (onDeath.has(name) ? "player_persistent" : "player_lifetime"));
  writeFileSync(join(projectDir, "variables.json"), JSON.stringify({ variables: list }, null, 2));
  return list.length;
}

// ---- commands ----

const COMMAND_ARGUMENTS: [RegExp, string][] = [
  [/StringArgumentType\.word\(\)/, "word"], [/StringArgumentType\.string\(\)/, "string"], [/StringArgumentType\.greedyString\(\)/, "greedy"],
  [/DoubleArgumentType\.doubleArg/, "double"], [/IntegerArgumentType\.integer/, "integer"], [/BoolArgumentType\.bool/, "logic"],
  [/EntityArgument\.players?\(\)/, "player"], [/EntityArgument\.entit(y|ies)\(\)/, "entity"],
];

function commands(): number {
  let count = 0;
  for (const code of javaFiles(join(pkgDir, "command"))) {
    const name = /Commands\.literal\("([^"]+)"\)/.exec(code)?.[1];
    if (!name) continue;
    const args = [...code.matchAll(/Commands\.argument\("(\w+)", (\w+\.\w+\(\w*\))/g)].map((m) => `${COMMAND_ARGUMENTS.find(([re]) => re.test(m[2]))?.[1] ?? "word"}:${m[1]}`);
    const call = procedureCalls(code)[0];
    const element = {
      ...newElement(types.get("command")!, name.replace(/[^a-z0-9_]/g, "_")),
      commandName: name,
      commandArguments: args.join(" "),
      permissionLevel: /hasPermission\((\d)\)/.exec(code)?.[1] ?? "No requirement",
      argsxml: {
        format: 1, variables: [],
        stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...(call ? [{ block: "call_procedure", fields: { procedure: procedureId(call.name) } }] : [])] }],
      },
    };
    write("commands", element);
    count++;
  }
  return count;
}

// ---- overlays ----

function overlays(): number {
  let count = 0;
  const textures = join(assets, "textures");
  for (const code of javaFiles(join(pkgDir, "gui/overlay"))) {
    const cls = /public class (\w+)Overlay/.exec(code)?.[1];
    if (!cls) continue;
    const id = cls.toLowerCase();
    let body = methodBody(code, /public (static )?void eventHandler\(/);
    // A condition around every draw call is the overlay's display condition.
    const wrapper = /if \(([\p{L}\p{N}_]+Procedure)\.executeProcedure\(/u.exec(body.slice(body.indexOf("RenderSystem.disableAlphaTest()")));
    let displayCondition = "";
    if (wrapper) {
      const start = body.indexOf(wrapper[0]);
      const open = body.indexOf("{", closing(body, start + 3) - 1);
      const inner = body.slice(open + 1, closing(body, open) - 1);
      if (/\.draw\(|\bblit\(/.test(inner) && !/\.draw\(|\bblit\(/.test(body.slice(0, start))) {
        const rest = body.slice(closing(body, open));
        if (!/\.draw\(|\bblit\(/.test(rest)) {
          displayCondition = procedureId(wrapper[1]);
          body = inner;
        }
      }
    }
    const components: Record<string, unknown>[] = [];
    const conditionBefore = (from: number, at: number) => {
      const between = body.slice(from, at);
      let open = "";
      for (const call of procedureCalls(between)) if (/if \(\s*$/.test(between.slice(Math.max(0, call.start - 8), call.start)) && !between.slice(call.end).includes("}")) open = call.name;
      return open ? procedureId(open) : "";
    };
    let last = 0;
    for (const m of body.matchAll(/\.draw\(|\bblit\(/g)) {
      const { args, end } = callArguments(body, m.index + m[0].length - 1);
      const condition = conditionBefore(last, m.index);
      last = end;
      const place = (x: string, y: string) => ({ x: Number(/(-?\d+)$/.exec(x)?.[1] ?? 0) + 213, y: Number(/(-?\d+)$/.exec(y)?.[1] ?? 0) + 120 });
      const shown = condition ? { condition } : {};
      if (m[0].startsWith("blit")) {
        const before = body.slice(0, m.index);
        const ref = /new ResourceLocation\("[^:]+:textures\/([^"]+)"\)/.exec(before.slice(before.lastIndexOf(".bind(")))?.[1];
        if (!ref) continue;
        mkdirSync(dirname(join(projectDir, "textures", ref)), { recursive: true });
        copyFileSync(join(textures, ref), join(projectDir, "textures", ref));
        components.push({ kind: "image", ...place(args[1], args[2]), width: Number(args[5]), height: Number(args[6]), image: `textures/${ref}`, ...shown });
      } else {
        const [, text, x, y, tint] = args;
        const call = procedureCalls(text)[0];
        const widget: Record<string, unknown> = { kind: "label", ...place(x, y), color: `#${(Number(tint) & 0xffffff).toString(16).padStart(6, "0")}`, ...shown };
        const key = /TranslationTextComponent\("([^"]+)"\)/.exec(text)?.[1];
        if (call) widget.textProcedure = procedureId(call.name);
        else widget.text = key ? (en[key] ?? key) : /^"(.*)"$/.exec(text)?.[1] ?? text;
        components.push(widget);
      }
    }
    write("overlays", { ...newElement(types.get("overlay")!, id), components, displayCondition });
    count++;
  }
  return count;
}

// ---- potion effects and item extensions ----

function effects(): number {
  let count = 0;
  for (const code of javaFiles(join(pkgDir, "potion"))) {
    const id = /this\.setRegistryName\("(\w+)"\)/.exec(code)?.[1];
    const header = /super\(EffectType\.(\w+), (-?\d+)\)/.exec(code);
    if (!id || !header) continue;
    const onTick = procedureCalls(methodBody(code, /public void applyEffectTick\(/))[0];
    const onStarted = procedureCalls(methodBody(code, /public void applyInstantenousEffect\(/))[0];
    const onExpired = procedureCalls(methodBody(code, /public void removeAttributeModifiers\(/))[0];
    const icon = join(assets, "textures/mob_effect", `${id}.png`);
    if (existsSync(icon)) {
      mkdirSync(join(projectDir, "textures/mob_effect"), { recursive: true });
      copyFileSync(icon, join(projectDir, "textures/mob_effect", `${id}.png`));
    }
    write("potion_effects", {
      ...newElement(types.get("potion_effect")!, id),
      effectName: en[`effect.${id}`] ?? id,
      icon: existsSync(icon) ? `textures/mob_effect/${id}.png` : "",
      color: `#${(Number(header[2]) & 0xffffff).toString(16).padStart(6, "0")}`,
      mobEffectCategory: header[1],
      renderStatusInInventory: /shouldRenderInvText\(EffectInstance effect\) \{\s*return true/.test(code),
      renderStatusInHUD: /shouldRenderHUD\(EffectInstance effect\) \{\s*return true/.test(code),
      onActiveTick: onTick ? procedureId(onTick.name) : "",
      onStarted: onStarted ? procedureId(onStarted.name) : "",
      onExpired: onExpired ? procedureId(onExpired.name) : "",
    });
    count++;
  }
  return count;
}

function itemExtensions(): number {
  const itemDir = join(pkgDir, "item");
  const items = new Map(readdirSync(itemDir).filter((f) => f.endsWith(".java")).map((f) => [f.slice(0, -5), /setRegistryName\("(\w+)"\)/.exec(readFileSync(join(itemDir, f), "utf8"))?.[1]]));
  let count = 0;
  for (const code of javaFiles(join(itemDir, "extension"))) {
    const item = items.get(/getItem\(\) == (\w+)\.block/.exec(code)?.[1] ?? "");
    const burn = /setBurnTime\((\d+)\)/.exec(code)?.[1];
    if (!item) continue;
    write("item_extensions", { ...newElement(types.get("item_extension")!, `${item}_extension`), item, enableFuel: burn !== undefined, fuelPower: Number(burn ?? 1600) });
    count++;
  }
  return count;
}

// ---- recipes, advancements, tags ----

interface Stack { item?: string; tag?: string; count?: number }
const ingredient = (entry: Stack | Stack[]) => {
  const one = Array.isArray(entry) ? entry[0] : entry;
  return one.tag ? `#${one.tag.includes(":") ? one.tag : `minecraft:${one.tag}`}` : local(one.item ?? "");
};

function recipe(id: string, json: Record<string, unknown>): Record<string, unknown> | undefined {
  const base = newElement(types.get("recipe")!, id);
  const result = json.result as Stack & string;
  const type = String(json.type);
  if (type === "minecraft:crafting_shapeless") {
    const slots = Array<string>(9).fill("");
    (json.ingredients as Stack[]).forEach((entry, i) => { slots[i] = ingredient(entry); });
    return { ...base, recipeType: "Crafting", recipeShapeless: true, recipeSlots: slots, recipeReturnStack: local(result.item ?? ""), recipeRetstackSize: result.count ?? 1 };
  }
  if (type === "minecraft:crafting_shaped") {
    const slots = Array<string>(9).fill("");
    const key = json.key as Record<string, Stack | Stack[]>;
    (json.pattern as string[]).forEach((row, y) => [...row].forEach((symbol, x) => { if (symbol !== " ") slots[y * 3 + x] = ingredient(key[symbol]); }));
    return { ...base, recipeType: "Crafting", recipeShapeless: false, recipeSlots: slots, recipeReturnStack: local(result.item ?? ""), recipeRetstackSize: result.count ?? 1 };
  }
  const cooking: Record<string, [string, string, string]> = {
    "minecraft:smelting": ["Smelting", "smeltingInputStack", "smeltingReturnStack"], "minecraft:blasting": ["Blasting", "blastingInputStack", "blastingReturnStack"],
    "minecraft:smoking": ["Smoking", "smokingInputStack", "smokingReturnStack"], "minecraft:campfire_cooking": ["Campfire cooking", "campfireCookingInputStack", "campfireCookingReturnStack"],
  };
  const cook = cooking[type];
  if (cook) return { ...base, recipeType: cook[0], [cook[1]]: ingredient(json.ingredient as Stack), [cook[2]]: local(typeof result === "string" ? result : result.item ?? ""), xpReward: json.experience ?? 0, cookingTime: json.cookingtime ?? 200 };
  return undefined;
}

function recipes(): number {
  const dir = join(data, modId, "recipes");
  let count = 0;
  for (const file of readdirSync(dir)) {
    const id = file.slice(0, -5);
    const element = recipe(id, readJson(join(dir, file)));
    if (!element) {
      console.log(`recipe ${id}: type not imported`);
      continue;
    }
    write("recipes", element as { id: string });
    count++;
  }
  return count;
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** Advancements keep their datapack JSON: the project copies data files as they are. Tags go to tags.json (./tags.ts). */
function dataFiles(): number {
  const target = join(projectDir, "datapack");
  const files = walk(join(data, modId, "advancements"));
  for (const file of files) {
    const to = join(target, file.slice(data.length + 1));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
  }
  return files.length;
}

/** Every translation of the mod: procedures read their own keys (tip1, trans3, ...), which no element owns. */
function translations(): number {
  let count = 0;
  for (const file of readdirSync(join(assets, "lang"))) {
    const entries = readJson<Record<string, string>>(join(assets, "lang", file));
    const target = join(projectDir, "localization", file);
    const existing = existsSync(target) ? readJson<Record<string, string>>(target) : {};
    writeFileSync(target, JSON.stringify({ ...entries, ...existing }, null, 2));
    count += Object.keys(entries).length;
  }
  return count;
}

console.log(`translations ${translations()}, variables ${variables()}, commands ${commands()}, overlays ${overlays()}, effects ${effects()}, item extensions ${itemExtensions()}, recipes ${recipes()}, data files ${dataFiles()}, tags ${importTags(data, modId, projectDir)}`);
