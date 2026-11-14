import type { BlockDef } from "../blockTypes.ts";
import { LOCAL_TYPES, type LocalType, type ValueType } from "../model.ts";
import { anyIn, body, dropdown, ent, global, list, logic, num, numField, procedure, stmt, textField, txt, value, variable, W } from "./dsl.ts";

/* Flow, logic, loops, math, text, lists and variables: the general-purpose blocks. */

const RETURN_TYPES: [string, ValueType][] = [
  ["number", "number"], ["logic", "logic"], ["text", "text"], ["itemstack", "itemstack"], ["blockstate", "blockstate"],
  ["entity", "entity"], ["direction", "direction"], ["actionresult", "actionresult"],
];

const flow: BlockDef[] = [
  stmt("start", "flow", "both", { hat: true, code: () => "" }),
  stmt("call_procedure", "flow", "both", {
    fields: [procedure()],
    code: (c) => {
      const call = c.call(String(c.f.procedure));
      return call ? `${call.className}.execute(${call.args});` : "";
    },
  }),
  ...(["number", "logic", "text", "itemstack", "entity"] as const).map((type) => value(`call_procedure_${type}`, "flow", "both", type, {
    fields: [procedure()],
    code: (c) => {
      const call = c.call(String(c.f.procedure));
      return call ? `${call.className}.execute(${call.args})` : type === "number" ? "0" : type === "logic" ? "false" : type === "text" ? '""' : "null";
    },
  })),
  // Ends a procedure that returns nothing.
  stmt("return_void", "flow", "both", { terminal: true, code: () => "if (true) return;" }),
  ...RETURN_TYPES.map(([name, type]) => stmt(`return_${name}`, "flow", "both", {
    terminal: true,
    inputs: [type === "number" ? num("value", 0) : type === "logic" ? logic("value", true) : type === "text" ? txt("value", "") : { name: "value", type }],
    // "if (true)" keeps javac's reachability rules happy wherever the block sits.
    code: (c) => `if (true) return ${c.i.value};`,
  })),
  // Java typed by hand or imported from a mod: the procedure's dependencies are parameters by name. It is written
  // against one Minecraft version's class names, so it generates only there.
  stmt("java_code", "flow", "both", {
    fields: [textField("code"), textField("deps"), textField("imports"), dropdown("gen", ["1.16.5", "1.21.5", "26.3"])],
    code: (c) => {
      // The compiler reports it as a build warning.
      if (String(c.f.gen) !== c.gen) return `// java_code written for Minecraft ${String(c.f.gen).replace(/[^\w.]/g, "")} is not generated for ${c.gen}`;
      for (const name of String(c.f.imports ?? "").split(/\s+/)) if (name) c.imports.qualified(name);
      // "if (true)" keeps javac's reachability rules happy when the code ends with a return.
      return `if (true) {\n${String(c.f.code ?? "")}\n}`;
    },
  }),
  stmt("run_on_client", "flow", "server", { special: true, inputs: [ent("player"), body()], code: () => "" }),
  stmt("run_on_server", "flow", "client", { special: true, inputs: [body()], code: () => "" }),
  stmt("wait", "flow", "server", { special: true, deps: W, inputs: [num("ticks", 20), body()], code: () => "" }),
  stmt("log", "flow", "both", { inputs: [txt("text", "Hello")], code: (c) => `${c.h("log")}(${c.i.text});` }),
  stmt("cancel_event", "flow", "server", { terminal: false, code: (c) => `${c.h("cancelEvent")}();` }),
  value("dep_number", "flow", "both", "number", {
    depField: "dep", fields: [dropdown("dep", ["x", "y", "z", "amount", "distance", "time", "slot", "hitX", "hitY", "hitZ"])],
    code: (c) => c.dep(String(c.f.dep)),
  }),
  value("dep_entity", "flow", "both", "entity", {
    depField: "dep", fields: [dropdown("dep", ["entity", "sourceentity", "immediatesourceentity"])], code: (c) => c.dep(String(c.f.dep)),
  }),
  value("dep_itemstack", "flow", "both", "itemstack", { depField: "dep", fields: [dropdown("dep", ["itemstack"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("dep_blockstate", "flow", "both", "blockstate", { depField: "dep", fields: [dropdown("dep", ["blockstate", "oldState"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("dep_direction", "flow", "both", "direction", { depField: "dep", fields: [dropdown("dep", ["direction"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("dep_damagesource", "flow", "both", "damagesource", { depField: "dep", fields: [dropdown("dep", ["damagesource"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("dep_logic", "flow", "both", "logic", { depField: "dep", fields: [dropdown("dep", ["moving"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("dep_text", "flow", "both", "text", { depField: "dep", fields: [dropdown("dep", ["text", "command"])], code: (c) => c.dep(String(c.f.dep)) }),
  value("action_result", "flow", "both", "actionresult", {
    fields: [dropdown("result", ["SUCCESS", "CONSUME", "PASS", "FAIL"])],
    code: (c) => `${c.j.InteractionResult}.${c.f.result}`,
  }),
];

const COMPARE: Record<string, string> = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };

const logicBlocks: BlockDef[] = [
  stmt("if", "logic", "both", { inputs: [logic("cond", true), body("then")], code: (c) => `if (${c.i.cond}) {\n${c.i.then}\n}` }),
  stmt("if_else", "logic", "both", {
    inputs: [logic("cond", true), body("then"), body("else")],
    code: (c) => `if (${c.i.cond}) {\n${c.i.then}\n} else {\n${c.i.else}\n}`,
  }),
  value("logic_boolean", "logic", "both", "logic", { fields: [dropdown("value", ["true", "false"])], code: (c) => String(c.f.value === "false" ? "false" : "true") }),
  value("logic_compare", "logic", "both", "logic", {
    inputs: [num("a", 0), num("b", 0)], fields: [dropdown("op", Object.keys(COMPARE))],
    code: (c) => `${c.i.a} ${COMPARE[String(c.f.op)] ?? "=="} ${c.i.b}`,
  }),
  value("logic_operation", "logic", "both", "logic", {
    inputs: [logic("a", true), logic("b", true)], fields: [dropdown("op", ["AND", "OR", "XOR"])],
    code: (c) => `${c.i.a} ${c.f.op === "OR" ? "||" : c.f.op === "XOR" ? "^" : "&&"} ${c.i.b}`,
  }),
  value("logic_negate", "logic", "both", "logic", { inputs: [logic("value", true)], code: (c) => `!${c.i.value}` }),
  value("logic_ternary_number", "logic", "both", "number", { inputs: [logic("cond", true), num("a", 1), num("b", 0)], code: (c) => `${c.i.cond} ? ${c.i.a} : ${c.i.b}` }),
  value("logic_ternary_text", "logic", "both", "text", { inputs: [logic("cond", true), txt("a", "yes"), txt("b", "no")], code: (c) => `${c.i.cond} ? ${c.i.a} : ${c.i.b}` }),
  value("logic_ternary_logic", "logic", "both", "logic", { inputs: [logic("cond", true), logic("a", true), logic("b", false)], code: (c) => `${c.i.cond} ? ${c.i.a} : ${c.i.b}` }),
  value("compare_entities", "logic", "both", "logic", { inputs: [ent("a"), ent("b")], code: (c) => `${c.i.a} == ${c.i.b}` }),
  value("entity_exists", "logic", "both", "logic", { inputs: [ent()], code: (c) => `${c.i.entity} != null` }),
  value("compare_itemstacks", "logic", "both", "logic", {
    inputs: [{ name: "a", type: "itemstack" }, { name: "b", type: "itemstack" }],
    code: { "1.16.5": (c) => `${c.i.a}.sameItem(${c.i.b})`, modern: (c) => `${c.j.ItemStack}.isSameItem(${c.i.a}, ${c.i.b})` },
  }),
  value("compare_item_types", "logic", "both", "logic", { inputs: [{ name: "a", type: "itemstack" }, { name: "b", type: "itemstack" }], code: (c) => `${c.i.a}.getItem() == ${c.i.b}.getItem()` }),
  value("compare_blockstates", "logic", "both", "logic", {
    inputs: [{ name: "a", type: "blockstate" }, { name: "b", type: "blockstate" }], fields: [dropdown("mode", ["block", "state"])],
    code: (c) => (c.f.mode === "state" ? `${c.i.a} == ${c.i.b}` : `${c.i.a}.getBlock() == ${c.i.b}.getBlock()`),
  }),
  value("compare_directions", "logic", "both", "logic", { inputs: [{ name: "a", type: "direction" }, { name: "b", type: "direction" }], code: (c) => `${c.i.a} == ${c.i.b}` }),
];

const loops: BlockDef[] = [
  stmt("repeat", "loops", "both", {
    inputs: [num("times", 10), body()],
    code: (c) => {
      const i = c.temp("i");
      return `for (int ${i} = 0; ${i} < (int) ${c.i.times}; ${i}++) {\n${c.i.do}\n}`;
    },
  }),
  // Boolean.valueOf keeps a constant condition (while true) from making javac reject the code after the loop.
  stmt("while", "loops", "both", { inputs: [logic("cond", false), body()], code: (c) => `while (Boolean.valueOf(${c.i.cond})) {\n${c.i.do}\n}` }),
  stmt("until", "loops", "both", { inputs: [logic("cond", true), body()], code: (c) => `while (!Boolean.valueOf(${c.i.cond})) {\n${c.i.do}\n}` }),
  stmt("for_range", "loops", "both", {
    fields: [variable("number")], inputs: [num("from", 1), num("to", 10), num("step", 1), body()],
    code: (c) => {
      const t = c.temp("n");
      return `for (double ${t} = ${c.i.from}; ${c.i.step} >= 0 ? ${t} <= ${c.i.to} : ${t} >= ${c.i.to}; ${t} += ${c.i.step}) {\n${c.local(String(c.f.var))} = ${t};\n${c.i.do}\n}`;
    },
  }),
  stmt("for_each_entity", "loops", "both", {
    deps: W, fields: [variable("entity")], inputs: [num("x", 0), num("y", 0), num("z", 0), num("range", 8), body()],
    code: (c) => {
      const t = c.temp("e");
      return `for (${c.j.Entity} ${t} : ${c.h("entitiesInRange")}(${c.dep("world")}, ${c.i.x}, ${c.i.y}, ${c.i.z}, ${c.i.range})) {\n${c.local(String(c.f.var))} = ${t};\n${c.i.do}\n}`;
    },
  }),
  stmt("for_each_player", "loops", "both", {
    deps: W, fields: [variable("entity")], inputs: [body()],
    code: (c) => {
      const t = c.temp("p");
      return `for (${c.j.Entity} ${t} : ${c.h("players")}(${c.dep("world")})) {\n${c.local(String(c.f.var))} = ${t};\n${c.i.do}\n}`;
    },
  }),
  stmt("for_each_list", "loops", "both", {
    fields: [variable("number", "index")], inputs: [list(), body()],
    code: (c) => {
      const t = c.temp("k");
      return `for (int ${t} = 0; ${t} < ${c.i.list}.size(); ${t}++) {\n${c.local(String(c.f.index))} = ${t};\n${c.i.do}\n}`;
    },
  }),
  stmt("break", "loops", "both", { terminal: true, code: () => "if (true) break;" }),
  stmt("continue", "loops", "both", { terminal: true, code: () => "if (true) continue;" }),
];

const SINGLE: Record<string, (v: string) => string> = {
  ROOT: (v) => `Math.sqrt(${v})`, ABS: (v) => `Math.abs(${v})`, NEG: (v) => `-${v}`, LN: (v) => `Math.log(${v})`,
  LOG10: (v) => `Math.log10(${v})`, EXP: (v) => `Math.exp(${v})`, POW10: (v) => `Math.pow(10, ${v})`, ROUND: (v) => `Math.round(${v})`,
  ROUNDUP: (v) => `Math.ceil(${v})`, ROUNDDOWN: (v) => `Math.floor(${v})`, TRUNC: (v) => `(double) (int) (${v})`, SIN: (v) => `Math.sin(Math.toRadians(${v}))`,
  COS: (v) => `Math.cos(Math.toRadians(${v}))`, TAN: (v) => `Math.tan(Math.toRadians(${v}))`, ASIN: (v) => `Math.toDegrees(Math.asin(${v}))`,
  ACOS: (v) => `Math.toDegrees(Math.acos(${v}))`, ATAN: (v) => `Math.toDegrees(Math.atan(${v}))`,
};
const PROPERTY: Record<string, (v: string) => string> = {
  EVEN: (v) => `${v} % 2 == 0`, ODD: (v) => `${v} % 2 != 0`, WHOLE: (v) => `${v} % 1 == 0`, POSITIVE: (v) => `${v} > 0`, NEGATIVE: (v) => `${v} < 0`,
};

const math: BlockDef[] = [
  value("math_number", "math", "both", "number", { fields: [numField("value", 0)], code: (c) => { const n = Number(c.f.value) || 0; return Number.isInteger(n) ? `${n}.0` : String(n); } }),
  value("math_arithmetic", "math", "both", "number", {
    inputs: [num("a", 1), num("b", 1)], fields: [dropdown("op", ["ADD", "MINUS", "MULTIPLY", "DIVIDE", "MODULO", "POWER", "DIVIDE_INT"])],
    code: (c) => c.f.op === "POWER" ? `Math.pow(${c.i.a}, ${c.i.b})` : c.f.op === "DIVIDE_INT" ? `(double) ((int) ${c.i.a} / (int) ${c.i.b})` : `${c.i.a} ${{ ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", MODULO: "%" }[String(c.f.op)] ?? "+"} ${c.i.b}`,
  }),
  value("math_single", "math", "both", "number", {
    inputs: [num("value", 0)], fields: [dropdown("op", Object.keys(SINGLE))],
    code: (c) => (SINGLE[String(c.f.op)] ?? SINGLE.ABS)(c.i.value),
  }),
  value("math_constant", "math", "both", "number", {
    fields: [dropdown("constant", ["PI", "E", "INFINITY"])],
    code: (c) => (c.f.constant === "E" ? "Math.E" : c.f.constant === "INFINITY" ? "Double.POSITIVE_INFINITY" : "Math.PI"),
  }),
  value("math_random", "math", "both", "number", { code: () => "Math.random()" }),
  value("math_random_between", "math", "both", "number", {
    inputs: [num("min", 1), num("max", 10)], fields: [dropdown("kind", ["whole", "decimal"])],
    code: (c) => `${c.h("randomBetween")}(${c.i.min}, ${c.i.max}, ${c.f.kind !== "decimal"})`,
  }),
  value("math_min_max", "math", "both", "number", { inputs: [num("a", 0), num("b", 0)], fields: [dropdown("op", ["MIN", "MAX"])], code: (c) => `Math.${c.f.op === "MAX" ? "max" : "min"}(${c.i.a}, ${c.i.b})` }),
  value("math_clamp", "math", "both", "number", { inputs: [num("value", 0), num("low", 0), num("high", 100)], code: (c) => `Math.max(${c.i.low}, Math.min(${c.i.high}, ${c.i.value}))` }),
  value("math_property", "math", "both", "logic", { inputs: [num("value", 0)], fields: [dropdown("prop", Object.keys(PROPERTY))], code: (c) => (PROPERTY[String(c.f.prop)] ?? PROPERTY.EVEN)(c.i.value) }),
  value("math_divisible", "math", "both", "logic", { inputs: [num("a", 10), num("b", 2)], code: (c) => `${c.i.a} % ${c.i.b} == 0` }),
  value("math_atan2", "math", "both", "number", { inputs: [num("y", 0), num("x", 1)], code: (c) => `Math.toDegrees(Math.atan2(${c.i.y}, ${c.i.x}))` }),
  value("math_round_to", "math", "both", "number", {
    inputs: [num("value", 0), num("decimals", 2)],
    code: (c) => `new java.math.BigDecimal(${c.i.value}).setScale((int) ${c.i.decimals}, java.math.RoundingMode.HALF_UP).doubleValue()`,
  }),
  value("math_from_text", "math", "both", "number", { inputs: [txt("text", "0")], code: (c) => `${c.h("textNumber")}(${c.i.text})` }),
];

const TEXT_COMPARE: Record<string, (a: string, b: string) => string> = {
  EQUALS: (a, b) => `${a}.equals(${b})`, EQUALS_IGNORE_CASE: (a, b) => `${a}.equalsIgnoreCase(${b})`, CONTAINS: (a, b) => `${a}.contains(${b})`,
  STARTS_WITH: (a, b) => `${a}.startsWith(${b})`, ENDS_WITH: (a, b) => `${a}.endsWith(${b})`,
};

const text: BlockDef[] = [
  value("text", "text", "both", "text", { fields: [textField("value", "")], code: (c) => c.s(String(c.f.value)) }),
  value("text_join", "text", "both", "text", { inputs: [txt("a", ""), txt("b", "")], code: (c) => `${c.i.a} + ${c.i.b}` }),
  value("text_length", "text", "both", "number", { inputs: [txt("value", "abc")], code: (c) => `${c.i.value}.length()` }),
  value("text_is_empty", "text", "both", "logic", { inputs: [txt("value", "")], code: (c) => `${c.i.value}.isEmpty()` }),
  value("text_compare", "text", "both", "logic", {
    inputs: [txt("a", "abc"), txt("b", "abc")], fields: [dropdown("op", Object.keys(TEXT_COMPARE))],
    code: (c) => (TEXT_COMPARE[String(c.f.op)] ?? TEXT_COMPARE.EQUALS)(c.i.a, c.i.b),
  }),
  value("text_case", "text", "both", "text", { inputs: [txt("value", "abc")], fields: [dropdown("op", ["UPPER", "LOWER"])], code: (c) => `${c.i.value}.${c.f.op === "LOWER" ? "toLowerCase" : "toUpperCase"}(java.util.Locale.ROOT)` }),
  value("text_trim", "text", "both", "text", { inputs: [txt("value", " abc ")], code: (c) => `${c.i.value}.trim()` }),
  value("text_substring", "text", "both", "text", { inputs: [txt("value", "abcdef"), num("from", 0), num("to", 3)], code: (c) => `${c.h("substring")}(${c.i.value}, ${c.i.from}, ${c.i.to})` }),
  value("text_replace", "text", "both", "text", { inputs: [txt("value", "abc"), txt("find", "a"), txt("with", "b")], code: (c) => `${c.i.value}.replace(${c.i.find}, ${c.i.with})` }),
  value("text_index_of", "text", "both", "number", { inputs: [txt("value", "abc"), txt("find", "b")], code: (c) => `${c.i.value}.indexOf(${c.i.find})` }),
  value("text_from_number", "text", "both", "text", { inputs: [num("value", 0)], code: (c) => `${c.h("numberText")}(${c.i.value})` }),
  // A double as Java writes it when joined to text: 5.0, 0.25, 1.0E10.
  value("text_from_double", "text", "both", "text", { inputs: [num("value", 0)], code: (c) => `Double.toString(${c.i.value})` }),
  // An item stack as 1.16.5 writes it joined to text: "3xitem.mod.name". Later versions changed that text, so it is built by hand.
  value("text_from_itemstack", "text", "both", "text", {
    inputs: [{ name: "itemstack", type: "itemstack" }],
    code: { "1.16.5": (c) => `String.valueOf(${c.i.itemstack})`, modern: (c) => `(${c.i.itemstack}.getCount() + " " + ${c.j.BuiltInRegistries}.ITEM.getKey(${c.i.itemstack}.getItem()).getPath())` },
  }),
  value("text_substring_java", "text", "both", "text", {
    inputs: [txt("value", "abcdef"), num("from", 0), num("to", 3)],
    code: (c) => `${c.i.value}.substring((int) ${c.i.from}, (int) ${c.i.to})`,
  }),
  value("text_from_logic", "text", "both", "text", { inputs: [logic("value", true)], code: (c) => `String.valueOf(${c.i.value})` }),
  // DecimalFormat as Java has it: HALF_EVEN rounding, the pattern's affixes, "-0" for negative zero.
  value("text_decimal_format", "text", "both", "text", {
    inputs: [num("value", 3.14159), txt("pattern", "##")],
    code: (c) => `new java.text.DecimalFormat(${c.i.pattern}).format(${c.i.value})`,
  }),
  // The translation of a key in the language of the side it runs on (the key itself where none is loaded).
  value("text_translate", "text", "both", "text", { inputs: [txt("key", "")], code: (c) => `${c.h("translate")}(${c.i.key})` }),
  value("text_format_number", "text", "both", "text", {
    inputs: [num("value", 3.14159), num("decimals", 2)],
    code: (c) => `String.format(java.util.Locale.ROOT, "%." + (int) ${c.i.decimals} + "f", ${c.i.value})`,
  }),
];

const lists: BlockDef[] = [
  value("list_new", "lists", "both", "list", { code: () => "new java.util.ArrayList<Object>()" }),
  stmt("list_add", "lists", "both", { inputs: [list(), anyIn("value")], code: (c) => `${c.i.list}.add(${c.i.value});` }),
  stmt("list_set", "lists", "both", { inputs: [list(), num("index", 0), anyIn("value")], code: (c) => `${c.h("listSet")}(${c.i.list}, ${c.i.index}, ${c.i.value});` }),
  stmt("list_remove_at", "lists", "both", { inputs: [list(), num("index", 0)], code: (c) => `${c.h("listRemove")}(${c.i.list}, ${c.i.index});` }),
  stmt("list_clear", "lists", "both", { inputs: [list()], code: (c) => `${c.i.list}.clear();` }),
  value("list_size", "lists", "both", "number", { inputs: [list()], code: (c) => `${c.i.list}.size()` }),
  value("list_contains", "lists", "both", "logic", { inputs: [list(), anyIn("value")], code: (c) => `${c.i.list}.contains(${c.i.value})` }),
  value("list_index_of", "lists", "both", "number", { inputs: [list(), anyIn("value")], code: (c) => `${c.i.list}.indexOf(${c.i.value})` }),
  ...(["number", "text", "logic", "entity", "itemstack"] as const).map((type) => value(`list_get_${type}`, "lists", "both", type, {
    inputs: [list(), num("index", 0)],
    code: (c) => `${c.h(`list${type[0].toUpperCase()}${type.slice(1)}`)}(${c.i.list}, ${c.i.index})`,
  })),
];

const TYPE_LABEL: Record<LocalType, string> = { number: "number", logic: "logic", text: "text", entity: "entity", itemstack: "itemstack", blockstate: "blockstate", direction: "direction", list: "list" };
const defaultInput = (type: LocalType) =>
  type === "number" ? num("value", 0) : type === "logic" ? logic("value", true) : type === "text" ? txt("value", "") : { name: "value", type: type as ValueType };
/** Global variables keep these types (variables.json "string" is text). */
const GLOBAL_TYPES = ["number", "logic", "text", "itemstack", "blockstate", "direction"] as const;

const variables: BlockDef[] = [
  ...LOCAL_TYPES.flatMap((type) => [
    value(`local_${TYPE_LABEL[type]}_get`, "variables", "both", type as ValueType, { fields: [variable(type)], code: (c) => c.local(String(c.f.var)) }),
    stmt(`local_${TYPE_LABEL[type]}_set`, "variables", "both", { fields: [variable(type)], inputs: [defaultInput(type)], code: (c) => `${c.local(String(c.f.var))} = ${c.i.value};` }),
  ]),
  stmt("local_number_change", "variables", "both", { fields: [variable("number")], inputs: [num("amount", 1)], code: (c) => `${c.local(String(c.f.var))} += ${c.i.amount};` }),
  // Reads work on both sides: the server sends every variable to the clients, so a screen reads what the server holds.
  ...GLOBAL_TYPES.flatMap((type) => [
    value(`global_${type}_get`, "variables", "both", type, { fields: [global(type, "global")], code: (c) => c.globalGet(String(c.f.var)) }),
    stmt(`global_${type}_set`, "variables", "server", { fields: [global(type, "global")], inputs: [defaultInput(type)], code: (c) => c.globalSet(String(c.f.var), c.i.value) }),
    value(`player_${type}_get`, "variables", "both", type, { fields: [global(type, "player")], inputs: [ent()], code: (c) => c.globalGet(String(c.f.var), c.i.entity) }),
    stmt(`player_${type}_set`, "variables", "server", { fields: [global(type, "player")], inputs: [ent(), defaultInput(type)], code: (c) => c.globalSet(String(c.f.var), c.i.value, c.i.entity) }),
  ]),
  stmt("global_number_change", "variables", "server", {
    fields: [global("number", "global")], inputs: [num("amount", 1)],
    code: (c) => c.globalSet(String(c.f.var), `${c.globalGet(String(c.f.var))} + ${c.i.amount}`),
  }),
  stmt("player_number_change", "variables", "server", {
    fields: [global("number", "player")], inputs: [ent(), num("amount", 1)],
    code: (c) => c.globalSet(String(c.f.var), `${c.globalGet(String(c.f.var), c.i.entity)} + ${c.i.amount}`, c.i.entity),
  }),
];

export const BASIC_BLOCKS: BlockDef[] = [...flow, ...logicBlocks, ...loops, ...math, ...text, ...lists, ...variables];
