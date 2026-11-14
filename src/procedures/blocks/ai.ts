import type { BlockDef, CodeTable, FieldDef } from "../blockTypes.ts";
import { check, dropdown, idField, numField, stmt } from "./dsl.ts";

/*
 * AI goal blocks of a living entity's "AI goals" field (aixml). Each adds one goal to the mob, in stack order
 * (the first block has the highest priority). The goal code itself is written by the living entity generator
 * (src/generator/mob/ai.ts), which knows the mob class; the code tables here only say where a goal exists:
 * powder snow (1.17) is missing on 1.16.5. In an ordinary procedure these blocks do nothing and are reported.
 * Every goal takes two optional procedures: a start condition and a keep-going condition.
 */

const ONLY_IN_AI = () => "";
const ALL: CodeTable = { all: ONLY_IN_AI };
const conditions = (): FieldDef[] => [
  { name: "condition", kind: "procedure", default: "", optional: true },
  { name: "continueCondition", kind: "procedure", default: "", optional: true },
];
const goal = (id: string, fields: FieldDef[] = [], code: CodeTable = ALL): BlockDef =>
  stmt(id, "ai", "server", { fields: [...fields, ...conditions()], code });
const speed = (def: number) => numField("speed", def);

export const AI_BLOCKS: BlockDef[] = [
  goal("ai_float"),
  goal("ai_attack_melee", [speed(1.2), check("longMemory", false)]),
  goal("ai_attack_range_melee", [speed(1.2), numField("range", 2), check("longMemory", false)]),
  goal("ai_attack_procedure", [speed(1.2), numField("range", 4), numField("interval", 20), { name: "procedure", kind: "procedure", default: "" }]),
  goal("ai_attack_fly", [speed(1), numField("radius", 16)]),
  goal("ai_leap", [speed(0.5)]),
  goal("ai_panic", [speed(1.2)]),
  goal("ai_avoid_entity", [idField("entity", "entity", "minecraft:creeper"), numField("radius", 6), numField("farSpeed", 1), numField("nearSpeed", 1.2)]),
  goal("ai_hurt_by_target", [check("callHelp", false)]),
  goal("ai_target_entity", [idField("entity", "entity", "minecraft:player"), check("mustSee", false), check("mustReach", false)]),
  goal("ai_owner_hurt_target"),
  goal("ai_owner_hurt_by_target"),
  goal("ai_follow_owner", [speed(1), numField("startDistance", 10), numField("stopDistance", 2)]),
  goal("ai_follow_parent", [speed(0.8)]),
  goal("ai_breed", [speed(1)]),
  goal("ai_tempt", [idField("item", "item", "minecraft:wheat"), speed(1), check("scared", false)]),
  goal("ai_follow_mob", [speed(1), numField("stopDistance", 10), numField("area", 5)]),
  goal("ai_follow_boat"),
  goal("ai_wander", [speed(0.8)]),
  goal("ai_wander_avoid_water", [speed(0.8)]),
  goal("ai_fly_random", [speed(0.8)]),
  goal("ai_swim_random", [speed(1)]),
  goal("ai_look_around"),
  goal("ai_watch_entity", [idField("entity", "entity", "minecraft:player"), numField("radius", 6)]),
  goal("ai_breathe_air"),
  goal("ai_find_water"),
  goal("ai_climb_powder_snow", [], { all: ONLY_IN_AI, "1.16.5": null }),
  goal("ai_restrict_sun"),
  goal("ai_move_indoors"),
  goal("ai_doors_open", [dropdown("mode", ["open", "open_and_close"])]),
  goal("ai_doors_break"),
  goal("ai_eat_grass"),
  goal("ai_break_blocks", [idField("block", "block", "minecraft:sand"), speed(1), numField("height", 3)]),
];
