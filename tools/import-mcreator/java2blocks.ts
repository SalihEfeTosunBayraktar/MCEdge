// Turns the java_code of a procedure imported from MCreator into version-independent procedure blocks. Works on the
// syntax tree written by java-ast/JavaAst.java. Anything it cannot read raises Miss; the caller keeps that procedure
// as java_code, so no logic is ever guessed. MCreator emits a small set of templates (mcreatorTemplates.ts),
// recognised by their exact text; everything else is read by the shape of its expressions.
//
// Java types are tracked as far as they change the meaning: a number is a double in the blocks, so an int must stay
// an int where Java prints it or divides it, and anything else raises Miss.
import { BLOCKS_BY_ID } from "../../src/procedures/blocks/index.ts";
import type { BlockNode, InputValue, LocalVariable, ProcedureIR } from "../../src/procedures/model.ts";
import { java } from "./javaPrint.ts";
import {
  alphaNormalize, BLOCK_DATA_READ, COMPARE_DISTANCE, ENERGY_CAPACITY, ENERGY_STORED, BLOCK_SLOT_COUNT, BLOCK_SLOT_ITEM, DELAY_HEAD, DELAY_TAIL, GUI_SLOT_COUNT, GUI_SLOT_ITEM, RANDOM_ITEM,
  REPLACE_KEEPING, REPLACE_KEEPING_PLAIN, REPLACE_KEEPING_WORLD,
} from "./mcreatorTemplates.ts";

export type Ast = { k: string; [key: string]: any };
/** `loose`: a number whose Java type is not known to be double (an int or float dependency), so it cannot be printed. */
type Value = { node: InputValue; type: string; int?: boolean; id?: string; loose?: boolean };
type Local = { type: string; int: boolean };

export class Miss extends Error {}

const fail = (what: string): never => { throw new Miss(what); };
const COMPARE: Record<string, string> = { EQUAL_TO: "EQ", NOT_EQUAL_TO: "NEQ", LESS_THAN: "LT", LESS_THAN_EQUAL: "LTE", GREATER_THAN: "GT", GREATER_THAN_EQUAL: "GTE" };
const ARITHMETIC: Record<string, string> = { PLUS: "ADD", MINUS: "MINUS", MULTIPLY: "MULTIPLY", DIVIDE: "DIVIDE", REMAINDER: "MODULO" };
const LOCAL_TYPES: Record<string, string> = { String: "text", ItemStack: "itemstack", Entity: "entity", BlockState: "blockstate", Direction: "direction" };
const DATA_TYPES: Record<string, "number" | "text" | "logic"> = { Double: "number", String: "text", Boolean: "logic" };
const ENTITY_CLASSES = /^(Entity|LivingEntity|PlayerEntity|ServerPlayerEntity)$/;
const WORLD_CLASSES = /^(IWorld|World|ServerWorld)$/;
const VARIABLES_CLASS = /\.(get|set)_(\w+)$/;
const DEPENDENCY_BLOCKS: Record<string, string> = { number: "dep_number", entity: "dep_entity", itemstack: "dep_itemstack", blockstate: "dep_blockstate", direction: "dep_direction", damagesource: "dep_damagesource", logic: "dep_logic", text: "dep_text" };
const DIMENSIONS: Record<string, string> = { OVERWORLD: "minecraft:overworld", NETHER: "minecraft:the_nether", END: "minecraft:the_end" };
/** MCP names of the 1.16.5 `Effects` fields and the effect ids they stand for. */
const EFFECTS: Record<string, string> = {
  MOVEMENT_SPEED: "speed", MOVEMENT_SLOWDOWN: "slowness", DIG_SPEED: "haste", DIG_SLOWDOWN: "mining_fatigue", DAMAGE_BOOST: "strength",
  JUMP: "jump_boost", CONFUSION: "nausea", REGENERATION: "regeneration", DAMAGE_RESISTANCE: "resistance", FIRE_RESISTANCE: "fire_resistance",
  WATER_BREATHING: "water_breathing", INVISIBILITY: "invisibility", BLINDNESS: "blindness", NIGHT_VISION: "night_vision", HUNGER: "hunger",
  WEAKNESS: "weakness", POISON: "poison", WITHER: "wither", HEALTH_BOOST: "health_boost", ABSORPTION: "absorption", SATURATION: "saturation",
  GLOWING: "glowing", LEVITATION: "levitation", LUCK: "luck", UNLUCK: "unluck", SLOW_FALLING: "slow_falling", CONDUIT_POWER: "conduit_power",
  DOLPHINS_GRACE: "dolphins_grace", BAD_OMEN: "bad_omen", HERO_OF_THE_VILLAGE: "hero_of_the_village",
};
const SOUND_CATEGORIES = new Set(["MASTER", "MUSIC", "RECORDS", "WEATHER", "BLOCKS", "HOSTILE", "NEUTRAL", "PLAYERS", "AMBIENT", "VOICE"]);
const TOOL_CLASSES: Record<string, string> = { PickaxeItem: "pickaxe", HoeItem: "hoe", AxeItem: "axe", ShovelItem: "shovel", SwordItem: "sword" };
/** Blocks whose value changes the world or runs other code: they must not move into a place Java evaluates later. */
const IMPURE = /^(call_procedure|world_spawn_entity_get)/;

/** Dotted text of a name, call or cast chain, for matching shapes. */
export function chain(node: Ast | undefined): string {
  if (!node) return "";
  switch (node.k) {
    case "IDENTIFIER": return node.name;
    case "MEMBER_SELECT": return `${chain(node.expression)}.${node.identifier}`;
    case "METHOD_INVOCATION": return `${chain(node.methodSelect)}()`;
    case "PARENTHESIZED": return chain(node.expression);
    case "TYPE_CAST": return chain(node.expression);
    case "NEW_CLASS": return `new ${chain(node.identifier)}`;
    default: return node.k;
  }
}

const strip = (node: Ast): Ast => (node.k === "PARENTHESIZED" || node.k === "TYPE_CAST" ? strip(node.expression) : node);
const body = (node: Ast | undefined): Ast[] => (!node ? [] : node.k === "BLOCK" ? node.statements : [node]);
const block = (id: string, fields?: BlockNode["fields"], inputs?: BlockNode["inputs"]): BlockNode => ({ block: id, ...(fields ? { fields } : {}), ...(inputs ? { inputs } : {}) });
const lastName = (name: string) => name.slice(name.lastIndexOf(".") + 1);
const itemId = (text: string) => (text.startsWith("etreco:") ? text.slice(7) : text);
const pascal = (id: string) => id.split(/[_/]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const camel = (id: string) => id.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const typeName = (node: Ast | undefined): string => (node?.k === "PRIMITIVE_TYPE" ? String(node.primitiveTypeKind) : lastName(chain(node)));

/** Whether a value tree holds a block that runs other code, so evaluating it earlier or more often changes behaviour. */
function impure(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(impure);
  if (!value || typeof value !== "object") return false;
  const node = value as BlockNode;
  return IMPURE.test(node.block) || Object.values(node.inputs ?? {}).some(impure);
}

export interface Variable { name: string; scope: string; type: string }
export interface ProcedureInfo { deps: string[]; returnType: string }
export interface TranslatorOptions {
  /** Ids of the project's game rule elements, to name the rules a constant stands for. */
  gameRules?: string[];
  /** Ids of the project's GUI elements, to name the GUI an `open<Name>` call opens. */
  guis?: string[];
  /** The project's procedures by id: the dependencies they take (in order) and what they return. */
  procedures?: ReadonlyMap<string, ProcedureInfo>;
}

export class Translator {
  private readonly vars = new Map<string, Variable>();
  private readonly locals = new Map<string, Local>();
  private readonly inlined = new Map<string, Value>();
  private readonly positions = new Map<string, Ast[]>();
  /** `TileEntity te = world.getBlockEntity(pos)` locals: the level and position they stand for. */
  private readonly blockEntities = new Map<string, { level: number; pos: Ast[] }>();
  /** The item of item stack locals made from a registry item. */
  private readonly stackItems = new Map<string, string>();
  /** `MinecraftServer server = ServerLifecycleHooks.getCurrentServer()` locals. */
  private readonly servers = new Set<string>();
  /** Names of worlds and the dimension level each stands for (0: the procedure's own). */
  private readonly worlds = new Map<string, number>([["world", 0]]);
  private level = 0;
  private levels = 0;
  /** Whether the statements being read only run on the server (inside a check or a dimension block). */
  private serverOnly = false;
  /** Blocks the program uses that the catalog does not have yet. */
  readonly planned = new Set<string>();

  private readonly returnType: string;
  private readonly options: TranslatorOptions;
  private readonly classes = new Map<string, string>();

  constructor(variables: Variable[], returnType: string, options: TranslatorOptions = {}) {
    this.returnType = returnType;
    this.options = options;
    for (const v of variables) this.vars.set(v.name, v);
    for (const id of options.procedures?.keys() ?? []) this.classes.set(`${pascal(id)}Procedure`, id);
  }

  /** The statements of a method body as a program; throws Miss at the first shape it cannot read. */
  program(statements: Ast[]): ProcedureIR {
    const blocks = this.statements(statements);
    const variables: LocalVariable[] = [...this.locals].map(([name, local]) => ({ name, type: local.type as LocalVariable["type"] }));
    return { format: 1, variables, stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...blocks] }] };
  }

  private need(id: string, fields?: BlockNode["fields"], inputs?: BlockNode["inputs"]): BlockNode {
    if (!BLOCKS_BY_ID.has(id)) this.planned.add(id);
    return block(id, fields, inputs);
  }

  // ---- statements ----

  private statements(list: Ast[]): BlockNode[] {
    const out: BlockNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const dimension = this.dimensionAlias(list[i]);
      if (dimension) {
        out.push(this.inDimension(dimension.name, dimension.id, list.slice(i + 1)));
        break;
      }
      const sequence = this.sequence(list, i);
      if (sequence) {
        out.push(...sequence.blocks);
        i += sequence.length - 1;
        continue;
      }
      out.push(...this.statement(list[i]));
    }
    return out;
  }

  /**
   * `int v = n; BlockPos p = ...; BlockState s = world.getBlockState(p); Property<?> prop = s.getBlock().getStateDefinition().getProperty("name");
   * if (prop instanceof IntegerProperty && prop.getPossibleValues().contains(v)) world.setBlock(p, s.setValue(prop, v), 3);`.
   */
  private propertySequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [count, pos, state, property, set] = list.slice(at, at + 5).map((s) => (s.k === "VARIABLE" || s.expression?.k === "ASSIGNMENT" ? this.assigned(s) : undefined));
    const type = list[at + 3]?.k === "VARIABLE" ? java(list[at + 3].type) : "Property<?>";
    const test = list[at + 4];
    if (!count || !pos || !state || !property || !test || type !== "Property<?>") return undefined;
    const world = /^(\w+|this\.world)\.getBlockState\((\w+)\)$/.exec(java(state.init));
    const named = /^(\w+)\.getBlock\(\)\.getStateDefinition\(\)\.getProperty\("(\w+)"\)$/.exec(java(property.init));
    if (!world || !named || world[2] !== pos.name || named[1] !== state.name) return undefined;
    const [v, p, s, prop, w] = [count.name, pos.name, state.name, property.name, world[1]];
    const expected = `if((${prop} instanceof IntegerProperty&&${prop}.getPossibleValues().contains(${v}))){${w}.setBlock(${p},(BlockState)${s}.setValue((net.minecraft.state.Property)${prop},(Comparable)${v}),3);}`;
    if (java(test) !== expected) return undefined;
    this.worldAt(w);
    const value = this.numberValue(count.init);
    if (!value.int) return fail("integer property set from a double");
    const [x, y, z] = this.position(pos.init).map((n) => this.number(n));
    return { blocks: [this.need("block_set_property", { property: named[2] }, { x, y, z, value: value.node })], length: 5 };
  }

  /** `BlockPos p; state = world.getBlockState(p); Property<?> prop = ...getProperty("name"); if (prop instanceof BooleanProperty) world.setBlock(p, state.setValue(prop, true), 3);`. */
  private booleanPropertySequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [pos, state, property, set] = list.slice(at, at + 4);
    const held = state && (state.k === "VARIABLE" || (state.k === "EXPRESSION_STATEMENT" && state.expression.k === "ASSIGNMENT")) ? this.assigned(state) : undefined;
    if (!held || property?.k !== "VARIABLE" || java(property.type) !== "Property<?>" || !set) return undefined;
    const world = /^(\w+|this\.world)\.getBlockState\((\w+)\)$/.exec(java(held.init));
    const named = /^(\w+)\.getBlock\(\)\.getStateDefinition\(\)\.getProperty\("(\w+)"\)$/.exec(java(property.initializer));
    if (!world || !named || world[2] !== pos.name || named[1] !== held.name) return undefined;
    const literal = /\(Comparable\)(true|false)\),3\);\}$/.exec(java(set))?.[1];
    const expected = `if((${property.name} instanceof BooleanProperty)){${world[1]}.setBlock(${pos.name},(BlockState)${held.name}.setValue((net.minecraft.state.Property)${property.name},(Comparable)${literal}),3);}`;
    if (!literal || java(set) !== expected) return undefined;
    this.worldAt(world[1]);
    const [x, y, z] = this.position(pos.initializer).map((n) => this.number(n));
    return { blocks: [this.need("block_set_property_logic", { property: named[2] }, { x, y, z, value: block("logic_boolean", { value: literal }) })], length: 4 };
  }

  /** `entity.teleportTo(x, y, z); if (entity instanceof ServerPlayerEntity) ((ServerPlayerEntity) entity).connection.teleport(x, y, z, yRot, xRot, emptySet)`. */
  private teleportSequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [move, notify] = list.slice(at, at + 2);
    const match = /^(\w+)\.teleportTo\((.+)\);$/.exec(java(move));
    if (!match || notify?.k !== "IF" || notify.elseStatement) return undefined;
    const [name] = [match[1]];
    const coordinates = strip(move.expression).arguments;
    const tell = body(notify.thenStatement);
    const expected = `if((${name} instanceof ServerPlayerEntity)){((ServerPlayerEntity)${name}).connection.teleport(${coordinates.map(java).join(",")},${name}.yRot,${name}.xRot,Collections.emptySet());}`;
    if (coordinates.length !== 3 || tell.length !== 1 || java(notify) !== expected) return undefined;
    const [x, y, z] = coordinates.map((n: Ast) => this.number(n));
    return { blocks: [block("entity_teleport", undefined, { entity: this.entity({ k: "IDENTIFIER", name }), x, y, z })], length: 2 };
  }

  /** `stack.getOrCreateTag().putDouble("key", value)`, or putString / putBoolean: a value kept in the stack's data. */
  private stackTagWrite(method: string, node: Ast): BlockNode[] | undefined {
    const kinds: Record<string, "number" | "text" | "logic"> = { putDouble: "number", putString: "text", putBoolean: "logic" };
    const tag = (node.methodSelect as Ast).expression ? strip((node.methodSelect as Ast).expression) : undefined;
    if (!kinds[method] || tag?.k !== "METHOD_INVOCATION" || lastName(chain(tag.methodSelect)) !== "getOrCreateTag" || node.arguments[0]?.k !== "STRING_LITERAL") return undefined;
    const type = kinds[method];
    const value = this.typed(node.arguments[1], type);
    return [block(`item_set_data_${type}`, { key: String(node.arguments[0].value) }, { itemstack: this.typed(tag.methodSelect.expression, "itemstack"), value })];
  }

  /**
   * `AtomicReference<IItemHandler> r = new AtomicReference<>(); e.getCapability(ITEM_HANDLER, null).ifPresent(c -> r.set(c));
   * if (r.get() != null) for (int i = 0; i < r.get().getSlots(); i++) { ItemStack s = r.get().getStackInSlot(i).copy();
   * if (stack.getItem() == s.getItem()) total += s.getCount(); }`: MCreator's "count of an item in an inventory".
   */
  private countItemsSequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [made, capability, loop] = list.slice(at, at + 3);
    const ref = /^AtomicReference<IItemHandler> (\w+)=new AtomicReference<>\(\);$/.exec(java(made))?.[1];
    if (!ref || !capability || !loop) return undefined;
    const owner = new RegExp(String.raw`^(\w+)\.getCapability\(CapabilityItemHandler\.ITEM_HANDLER_CAPABILITY,null\)\.ifPresent\(\( capability\)->${ref}\.set\(capability\)\);$`).exec(java(capability))?.[1];
    const shape = new RegExp(String.raw`^if\(\(${ref}\.get\(\)!=null\)\)\{for\(int (\w+)=0;\1<${ref}\.get\(\)\.getSlots\(\);\1\+\+\)\{ItemStack (\w+)=${ref}\.get\(\)\.getStackInSlot\(\1\)\.copy\(\);if\(\(.+\.getItem\(\)==\2\.getItem\(\)\)\)\{(\w+)\+=\2\.getCount\(\);\}\}\}$`).exec(java(loop));
    if (!owner || !shape) return undefined;
    const compare = strip(body(body(loop.thenStatement)[0].statement)[1].condition);
    const stack = this.typed(strip(compare.leftOperand).methodSelect.expression, "itemstack");
    const total = block("entity_count_item", undefined, { entity: this.entity({ k: "IDENTIFIER", name: owner }), itemstack: stack });
    return { blocks: this.localChange(shape[3], total, true), length: 3 };
  }

  /** `Advancement a = player.server.getAdvancements().getAdvancement(id); AdvancementProgress p = ...; if (!p.isDone()) for (c : p.getRemainingCriteria()) award(a, c);` */
  private advancementSequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [found, progress, award] = list.slice(at, at + 3);
    const first = /^Advancement (\w+)=\(\(ServerPlayerEntity\)(\w+)\)\.server\.getAdvancements\(\)\.getAdvancement\(new ResourceLocation\("([^"]+)"\)\);$/.exec(java(found));
    if (!first || !progress || !award) return undefined;
    const [, adv, player, id] = first;
    const [ap, criterion] = [/^AdvancementProgress (\w+)=/.exec(java(progress))?.[1], "(\\w+)"];
    if (!ap || java(progress) !== `AdvancementProgress ${ap}=((ServerPlayerEntity)${player}).getAdvancements().getOrStartProgress(${adv});`) return undefined;
    const done = new RegExp(String.raw`^if\(\(!${ap}\.isDone\(\)\)\)\{for\(String ${criterion}:${ap}\.getRemainingCriteria\(\)\)\{\(\(ServerPlayerEntity\)${player}\)\.getAdvancements\(\)\.award\(${adv},\1\);\}\}$`);
    if (!done.test(java(award))) return undefined;
    return { blocks: [block("advancement_grant", { advancement: id }, { entity: this.entity({ k: "IDENTIFIER", name: player }) })], length: 3 };
  }

  /** `if (stack.hurt(n, ThreadLocalRandom.current(), null)) { stack.shrink(1); stack.setDamageValue(0); }` */
  private hurtBranch(node: Ast): BlockNode[] | undefined {
    const text = java(node);
    const match = /^if\(\((\w+)\.hurt\((.+),java\.util\.concurrent\.ThreadLocalRandom\.current\(\),null\)\)\)\{\1\.shrink\(1\);\1\.setDamageValue\(0\);\}$/.exec(text);
    if (!match || node.elseStatement) return undefined;
    const amount = this.number(strip(node.condition).arguments[0]);
    return [this.need("item_hurt_break", undefined, { itemstack: this.typed({ k: "IDENTIFIER", name: match[1] }, "itemstack"), amount })];
  }

  /** `if (world instanceof ServerWorld && server != null) server.getCommands().performCommand(new CommandSource(...level, 4...), String.format("gamerule %s %d", RULE.toString(), value))`. */
  private gameRuleCommand(node: Ast): BlockNode[] | undefined {
    const world = /^\((\w+) instanceof ServerWorld&&\(\(World\)\1\)\.getServer\(\)!=null\)$/.exec(java(node.condition))?.[1];
    const statements = body(node.thenStatement);
    if (!world || node.elseStatement || statements.length !== 1) return undefined;
    const head = `((World)${world}).getServer().getCommands().performCommand(new CommandSource(ICommandSource.NULL,Vector3d.ZERO,Vector2f.ZERO,((ServerWorld)${world}).getLevel(),4,"",new StringTextComponent(""),((World)${world}).getServer(),null).withSuppressedOutput(),String.format("gamerule %s %d",`;
    if (!java(statements[0]).startsWith(head)) return undefined;
    this.worldAt(world);
    const [, rule, value] = statements[0].expression.arguments[1].arguments;
    const constant = lastName(chain(strip(rule).methodSelect.expression));
    const id = this.options.gameRules?.find((known) => known.toUpperCase() === constant) ?? fail(`game rule ${constant}`);
    const amount = this.numberValue(value);
    if (!amount.int) return fail("game rule set from a double");
    return [this.need("world_set_game_rule_number", { rule: camel(id) }, { value: amount.node })];
  }

  /** `if (!e.level.isClientSide && e.level.getServer() != null) e.level.getServer().getCommands().performCommand(e.createCommandSourceStack().withSuppressedOutput().withPermission(4), text)`. */
  private entityCommand(node: Ast): BlockNode[] | undefined {
    const entity = /^\(!(\w+)\.level\.isClientSide&&\1\.level\.getServer\(\)!=null\)$/.exec(java(node.condition))?.[1];
    const statements = body(node.thenStatement);
    if (!entity || node.elseStatement || statements.length !== 1) return undefined;
    const head = `${entity}.level.getServer().getCommands().performCommand(${entity}.createCommandSourceStack().withSuppressedOutput().withPermission(4),`;
    if (!java(statements[0]).startsWith(head)) return undefined;
    return [block("entity_run_command", undefined, { entity: this.entity({ k: "IDENTIFIER", name: entity }), command: this.text(statements[0].expression.arguments[1]) })];
  }

  /** `e.level.getBlockState(p).getBlock().use(state, level, p, (PlayerEntity) e, Hand.MAIN_HAND, BlockRayTraceResult.miss(new Vector3d(p.getX(), p.getY(), p.getZ()), Direction.UP, p))`. */
  private useBlock(node: Ast): BlockNode[] | undefined {
    const match = /^(\w+)\.level\.getBlockState\((\w+)\)\.getBlock\(\)\.use\(\1\.level\.getBlockState\(\2\),\1\.level,\2,\(PlayerEntity\)\1,Hand\.MAIN_HAND,BlockRayTraceResult\.miss\(new Vector3d\(\2\.getX\(\),\2\.getY\(\),\2\.getZ\(\)\),Direction\.UP,\2\)\)$/.exec(java(node));
    if (!match) return undefined;
    const [x, y, z] = (this.positions.get(match[2]) ?? fail("block position")).map((n) => this.number(n));
    return [this.need("block_use", undefined, { entity: this.entity({ k: "IDENTIFIER", name: match[1] }), x, y, z })];
  }

  /** `Block.dropResources(world.getBlockState(pos), (World) world, pos); world.destroyBlock(pos, false);` */
  private breakDropping(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const drop = /^Block\.dropResources\((\w+)\.getBlockState\((new BlockPos\(.*\))\),\(World\)\1,\2\);$/.exec(java(list[at]));
    if (!drop || java(list[at + 1]) !== `${drop[1]}.destroyBlock(${drop[2]},false);`) return undefined;
    this.worldAt(drop[1]);
    const [x, y, z] = this.position(list[at].expression.arguments[2]).map((n) => this.number(n));
    return { blocks: [this.need("block_break_dropping", undefined, { x, y, z })], length: 2 };
  }

  /** Templates MCreator spreads over several statements: a block data write and a replaced block that keeps its data. */
  private sequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const first = list[at];
    if (first.k === "VARIABLE" && java(first.type) === "AtomicReference<IItemHandler>") return this.countItemsSequence(list, at);
    if (first.k === "VARIABLE" && typeName(first.type) === "Advancement") return this.advancementSequence(list, at);
    if (first.k === "EXPRESSION_STATEMENT" && /\.teleportTo$/.test(chain(strip(first.expression).methodSelect ?? {} as Ast))) return this.teleportSequence(list, at);
    if (/^_value/.test(this.assignedName(first))) return this.propertySequence(list, at);
    if (first.k === "VARIABLE" && typeName(first.type) === "ItemEntity") return this.spawnItemSequence(list, at);
    if (first.k === "VARIABLE" && typeName(first.type) === "BlockPos" && java(list[at + 2]?.type ?? {} as never) === "Property<?>") return this.booleanPropertySequence(list, at);
    const reused = first.k === "EXPRESSION_STATEMENT" && first.expression.k === "ASSIGNMENT" && this.positions.has(chain(first.expression.variable));
    if (first.k === "EXPRESSION_STATEMENT" && !reused) return this.breakDropping(list, at);
    if (!reused && (first.k !== "VARIABLE" || typeName(first.type) !== "BlockPos")) return undefined;
    const write = this.dataWriteSequence(list.slice(at, at + 5));
    if (write) {
      if (!this.serverOnly) return fail("block data write that may run on a client");
      return { blocks: [write], length: 5 };
    }
    const kept = this.replacedBlock(list, at, 10, REPLACE_KEEPING, true) ?? this.replacedBlock(list, at, 6, REPLACE_KEEPING_PLAIN, false);
    return kept;
  }

  /** The statements that put another block in place and copy its properties over (and, when `data`, its block entity data). */
  private replacedBlock(list: Ast[], at: number, count: number, template: string, data: boolean): { blocks: BlockNode[]; length: number } | undefined {
    const rest = list.slice(at, at + count);
    const text = rest.map(java).join("");
    const world = /^(?:BlockPos )?\w+=new BlockPos\(.*\);(?:BlockState )?\w+=.*\.defaultBlockState\(\);(?:BlockState )?\w+=([\w.]+)\.getBlockState/.exec(text)?.[1];
    if (world === undefined || rest.length !== count || alphaNormalize(text, world) !== alphaNormalize(template, REPLACE_KEEPING_WORLD)) return undefined;
    this.worldAt(world);
    const [position, made] = [this.assigned(rest[0]), this.assigned(rest[1])];
    this.positions.set(position.name, this.position(position.init));
    const [x, y, z] = this.positions.get(position.name)!.map((n) => this.number(n));
    const state = this.typed(made.init, "blockstate") as BlockNode;
    return { blocks: [this.need("block_place_keeping", { block: String(state.fields?.block), data }, { x, y, z })], length: count };
  }

  private assignedName(node: Ast): string {
    return node.k === "VARIABLE" ? node.name : node.k === "EXPRESSION_STATEMENT" && node.expression.k === "ASSIGNMENT" ? chain(node.expression.variable) : "";
  }

  /** The name and value a declaration `Type name = value;` or an assignment `name = value;` sets. */
  private assigned(node: Ast): { name: string; init: Ast } {
    if (node.k === "VARIABLE") return { name: node.name, init: node.initializer };
    return { name: chain(node.expression.variable), init: node.expression.expression };
  }

  private statement(node: Ast): BlockNode[] {
    switch (node.k) {
      case "BLOCK": return this.statements(node.statements);
      case "EMPTY_STATEMENT": return [];
      case "EXPRESSION_STATEMENT": return this.expressionStatement(node.expression);
      case "VARIABLE": return this.declaration(node);
      case "IF": return this.branch(node);
      case "RETURN": return this.returning(node);
      case "BREAK": return [block("break")];
      case "CONTINUE": return [block("continue")];
      case "WHILE_LOOP": return [block("while", undefined, { cond: this.logic(node.condition), do: this.statements(body(node.statement)) })];
      case "FOR_LOOP": return this.counted(node);
      default: return fail(`statement ${node.k}`);
    }
  }

  private branch(node: Ast): BlockNode[] {
    const written = this.guardedDataWrite(node) ?? this.guiSlotSet(node) ?? this.soundBranch(node) ?? this.hurtBranch(node) ?? this.gameRuleCommand(node) ?? this.entityCommand(node) ?? this.blockEntityGuard(node);
    if (written) return written;
    const known = this.constant(node.condition);
    if (known === true) return this.statements(body(node.thenStatement));
    if (known === false) return this.statements(body(node.elseStatement));
    const cond = this.logic(node.condition);
    const outer = this.serverOnly;
    this.serverOnly ||= this.impliesServer(node.condition);
    const then = this.statements(body(node.thenStatement));
    this.serverOnly = outer;
    if (!node.elseStatement) return [block("if", undefined, { cond, then })];
    return [block("if_else", undefined, { cond, then, else: this.statements(body(node.elseStatement)) })];
  }

  /**
   * `if (entity instanceof PlayerEntity) { Container _current = ...containerMenu; if (_current instanceof Supplier) { Object invobj = ...get();
   * if (invobj instanceof Map) { <locals and stack changes> ((Slot) ((Map) invobj).get(slot)).set(stack); _current.broadcastChanges(); } } }`.
   */
  private guiSlotSet(node: Ast): BlockNode[] | undefined {
    const level = (statement: Ast, condition: string, count: number): Ast[] | undefined => {
      const list = body(statement.thenStatement);
      return statement.k === "IF" && !statement.elseStatement && java(statement.condition) === condition && list.length === count ? list : undefined;
    };
    const merged = java(node.condition).endsWith("&&entity instanceof PlayerEntity)");
    const [menu, supplier] = level(node, merged ? java(node.condition) : "(entity instanceof PlayerEntity)", 2) ?? [];
    if (!menu || java(menu) !== "Container _current=((PlayerEntity)entity).containerMenu;") return undefined;
    const [slots, map] = level(supplier, "(_current instanceof Supplier)", 2) ?? [];
    if (!slots || java(slots) !== "Object invobj=((Supplier)_current).get();") return undefined;
    const inner = map?.k === "IF" && !map.elseStatement && java(map.condition) === "(invobj instanceof Map)" ? body(map.thenStatement) : [];
    const set = inner[inner.length - 2];
    if (inner.length < 2 || java(inner[inner.length - 1]) !== "_current.broadcastChanges();" || !/^\(\(Slot\)\(\(Map\)invobj\)\.get\(.+\)\)\.(?:set|remove)\(.+\);$/.test(java(set))) return undefined;
    const prefix = inner.slice(0, -2);
    if (!prefix.every((s) => s.k === "VARIABLE" || (s.k === "EXPRESSION_STATEMENT" && /\.(setCount|shrink|grow)$/.test(chain(strip(s.expression).methodSelect))))) return fail("code in a GUI slot change");
    const call = set.expression;
    const slot = strip(call.methodSelect.expression).arguments[0];
    const before = this.statements(prefix);
    const entity = this.entity({ k: "IDENTIFIER", name: "entity" });
    const change = lastName(chain(call.methodSelect)) === "remove"
      ? this.need("gui_remove_slot_item", undefined, { entity, slot: this.number(slot), amount: this.number(call.arguments[0]) })
      : block("gui_set_slot_item", undefined, { entity, slot: this.number(slot), itemstack: this.typed(call.arguments[0], "itemstack") });
    const blocks = [...before, change];
    return merged ? [block("if", undefined, { cond: this.logic(node.condition), then: blocks })] : blocks;
  }

  /**
   * `if (world instanceof World && !world.isClientSide()) world.playSound(null, pos, sound, category, volume, pitch); else world.playLocalSound(x, y, z, sound,
   * category, volume, pitch, false);`: one sound, heard by everyone from the server and locally on a client.
   */
  private soundBranch(node: Ast): BlockNode[] | undefined {
    const world = /^\((\w+) instanceof World&&!\1\.isClientSide\(\)\)$/.exec(java(node.condition))?.[1];
    if (!world || !node.elseStatement) return undefined;
    const server = body(node.thenStatement);
    const client = body(node.elseStatement);
    if (server.length !== 1 || client.length !== 1) return undefined;
    const played = strip(server[0].expression ?? {});
    const local = strip(client[0].expression ?? {});
    if (played.k !== "METHOD_INVOCATION" || local.k !== "METHOD_INVOCATION" || lastName(chain(played.methodSelect)) !== "playSound" || lastName(chain(local.methodSelect)) !== "playLocalSound") return undefined;
    if (played.arguments.length !== 6 || local.arguments.length !== 8 || played.arguments[0].k !== "NULL_LITERAL" || local.arguments[7].value !== false) return fail("sound shape");
    this.worldAt(world);
    const at = this.position(played.arguments[1]);
    const same = at.every((n, i) => java(n) === java(local.arguments[i])) && [2, 3, 4, 5].every((i) => java(played.arguments[i]) === java(local.arguments[i + 1]));
    const category = chain(played.arguments[3]);
    const sound = strip(played.arguments[2]);
    if (!same || !category.startsWith("SoundCategory.") || !SOUND_CATEGORIES.has(lastName(category)) || !/ForgeRegistries\.SOUND_EVENTS\.getValue\(\)$/.test(chain(sound))) return fail("sound shape");
    const id = this.resourceName(sound.arguments[0]);
    const [x, y, z] = at.map((n) => this.number(n));
    return [this.need("sound_play_in", { sound: id.includes(":") ? id : `minecraft:${id}`, category: lastName(category) }, {
      x, y, z, volume: this.number(played.arguments[4]), pitch: this.number(played.arguments[5]),
    })];
  }

  /**
   * `ItemEntity e = new ItemEntity((World) world, x, y, z, stack); e.setPickUpDelay(n); world.addFreshEntity(e);`.
   */
  private spawnItemSequence(list: Ast[], at: number): { blocks: BlockNode[]; length: number } | undefined {
    const [made, delay] = list.slice(at, at + 2);
    const persistent = java(list[at + 2]) === `${/^ItemEntity (\w+)=/.exec(java(made))?.[1]}.setExtendedLifetime();`;
    const added = list[at + 2 + (persistent ? 1 : 0)];
    const match = /^ItemEntity (\w+)=new ItemEntity\(\(World\)([\w.]+),.*\);$/.exec(java(made));
    if (!match || !java(delay).startsWith(`${match[1]}.setPickUpDelay(`) || java(added) !== `${match[2]}.addFreshEntity(${match[1]});`) return undefined;
    this.worldAt(match[2]);
    const [x, y, z] = made.initializer.arguments.slice(1, 4).map((n: Ast) => this.number(n));
    const stack = this.typed(made.initializer.arguments[4], "itemstack");
    const wait = this.number(delay.expression.arguments[0]);
    return { blocks: [this.need("world_spawn_item", { persistent }, { x, y, z, itemstack: stack, delay: wait })], length: persistent ? 4 : 3 };
  }

  /**
   * `if (te != null) { ...slot changes... }` for a block entity local: the slot blocks do nothing where there is no block
   * entity, so the check goes; anything but declarations and slot changes in there would depend on it.
   */
  private blockEntityGuard(node: Ast): BlockNode[] | undefined {
    const name = /^\((\w+)!=null\)$/.exec(java(node.condition))?.[1];
    if (!name || !this.blockEntities.has(name)) return undefined;
    const list = body(node.thenStatement);
    const slotWork = (s: Ast) => s.k === "VARIABLE" || (s.k === "EXPRESSION_STATEMENT" && /\.(ifPresent|setCount|shrink)$/.test(chain(strip(s.expression).methodSelect)));
    if (node.elseStatement || !list.every(slotWork)) return fail("code that runs only where there is a block entity");
    return this.statements(list);
  }

  /** Whether a true condition means the code runs on the server: `!world.isClientSide()`, `world instanceof ServerWorld`, or an `&&` with one. */
  private impliesServer(raw: Ast): boolean {
    const node = strip(raw);
    if (node.k === "CONDITIONAL_AND") return this.impliesServer(node.leftOperand) || this.impliesServer(node.rightOperand);
    if (node.k === "LOGICAL_COMPLEMENT") {
      const call = strip(node.expression);
      return call.k === "METHOD_INVOCATION" && this.worlds.has(chain(call.methodSelect.expression)) && lastName(chain(call.methodSelect)) === "isClientSide";
    }
    return node.k === "INSTANCE_OF" && this.worlds.has(chain(node.expression)) && lastName(chain(node.type)) === "ServerWorld";
  }

  /** Conditions that only guard Java types or a level that exists: a block-free program does not need them. */
  private constant(raw: Ast): boolean | undefined {
    const node = strip(raw);
    if (node.k === "NOT_EQUAL_TO" && node.rightOperand.k === "NULL_LITERAL" && this.worlds.has(chain(node.leftOperand))) return true;
    if (node.k === "NOT_EQUAL_TO" && node.rightOperand.k === "NULL_LITERAL" && this.servers.has(chain(node.leftOperand)) && this.serverOnly) return true;
    if (node.k === "INSTANCE_OF" && this.worlds.has(chain(node.expression))) return /^(World|IWorld)$/.test(lastName(chain(node.type))) ? true : undefined;
    return undefined;
  }

  private returning(node: Ast): BlockNode[] {
    if (!node.expression) return this.returnType === "none" || !this.returnType ? [block("return_void")] : fail("void return in a procedure that returns a value");
    if (this.returnType === "none" || !this.returnType) return fail("value return in a void procedure");
    const value = this.value(node.expression);
    if (value.type !== this.returnType.replace("string", "text")) return fail(`return ${value.type} from a ${this.returnType} procedure`);
    return [block(`return_${value.type}`, undefined, { value: value.node })];
  }

  private counted(node: Ast): BlockNode[] {
    const init = node.initializer?.[0];
    const cond = strip(node.condition ?? { k: "?" });
    const step = node.update?.[0]?.expression;
    if (!init || init.k !== "VARIABLE" || cond.k !== "LESS_THAN" || chain(cond.leftOperand) !== init.name || step?.k !== "POSTFIX_INCREMENT") return fail("for shape");
    if (init.initializer?.k !== "INT_LITERAL" || Number(init.initializer.value) !== 0) return fail("for start");
    if (JSON.stringify(node.statement).includes(`"name":"${init.name}"`)) return fail("for index used");
    const times = this.numberValue(cond.rightOperand);
    if (!times.int) return fail("for limit that is not an int");
    return [block("repeat", undefined, { times: times.node, do: this.statements(body(node.statement)) })];
  }

  private declaration(node: Ast): BlockNode[] {
    const name: string = node.name;
    const type = typeName(node.type);
    const init: Ast | undefined = node.initializer;
    if (init && WORLD_CLASSES.test(type)) {
      this.worlds.set(name, this.worldLevel(init));
      return [];
    }
    if (init && type === "MinecraftServer") {
      if (java(init) !== "ServerLifecycleHooks.getCurrentServer()") return fail("server source");
      this.servers.add(name);
      return [];
    }
    if (init && type === "TileEntity") {
      const lookup = /^(\w+)\.getBlockEntity\(/.exec(java(init));
      if (!lookup || init.k !== "METHOD_INVOCATION" || init.arguments.length !== 1) return fail("block entity source");
      this.worldAt(lookup[1]);
      this.blockEntities.set(name, { level: this.level, pos: this.position(init.arguments[0]) });
      return [];
    }
    if (init && type === "BlockPos") {
      this.positions.set(name, this.position(init));
      return [];
    }
    const local = this.localType(type);
    if (name.startsWith("_setval") && init) {
      const value = this.value(init);
      if (impure(value.node)) return fail("value that runs code, moved to its use");
      this.inlined.set(name, value);
      return [];
    }
    const known = this.locals.get(name);
    if (known && (known.type !== local.type || known.int !== local.int)) return fail(`local ${name} declared twice`);
    this.locals.set(name, local);
    if (!init) return [];
    const value = this.value(init);
    const created = value.node as BlockNode;
    if (local.type === "itemstack" && created.block === "item_stack") this.stackItems.set(name, String(created.fields?.item));
    return [block(`local_${local.type}_set`, { var: name }, { value: this.assignable(value, local) })];
  }

  private localType(typeText: string): Local {
    if (typeText === "DOUBLE") return { type: "number", int: false };
    if (typeText === "INT") return { type: "number", int: true };
    if (typeText === "BOOLEAN") return { type: "logic", int: false };
    const type = LOCAL_TYPES[typeText];
    return type ? { type, int: false } : fail(`local of type ${typeText}`);
  }

  /** The value to store in a local: a number must keep its Java kind, so a double never lands in an int. */
  private assignable(value: Value, local: Local): InputValue {
    if (value.type !== local.type) return fail(`${local.type} local set from ${value.type}`);
    if (local.int && !value.int) return fail("int local set from a double");
    return value.node;
  }

  private position(raw: Ast): Ast[] {
    const node = strip(raw);
    if (node.k === "IDENTIFIER" && this.positions.has(node.name)) return this.positions.get(node.name)!;
    if (node.k === "NEW_CLASS" && lastName(chain(node.identifier)) === "BlockPos" && node.arguments.length === 3) return node.arguments;
    return fail("block position");
  }

  private expressionStatement(raw: Ast): BlockNode[] {
    const node = strip(raw);
    if (node.k === "ASSIGNMENT" && this.blockEntities.has(chain(node.variable))) return this.reassignBlockEntity(chain(node.variable), node.expression);
    if (node.k === "ASSIGNMENT" && this.positions.has(chain(node.variable))) {
      this.positions.set(chain(node.variable), this.position(node.expression));
      return [];
    }
    if (node.k === "ASSIGNMENT") return this.assignment(chain(node.variable), this.value(node.expression));
    if (node.k === "PLUS_ASSIGNMENT" || node.k === "MINUS_ASSIGNMENT") {
      const amount = this.numberValue(node.expression);
      const delta = node.k === "PLUS_ASSIGNMENT" ? amount.node : block("math_arithmetic", { op: "MINUS" }, { a: 0, b: amount.node });
      return this.localChange(chain(node.variable), delta, amount.int === true);
    }
    if (node.k === "POSTFIX_INCREMENT" || node.k === "PREFIX_INCREMENT") return this.localChange(chain(node.expression), 1, true);
    if (node.k === "POSTFIX_DECREMENT" || node.k === "PREFIX_DECREMENT") return this.localChange(chain(node.expression), -1, true);
    if (node.k === "METHOD_INVOCATION") return this.call(node);
    // A stack that is made and dropped on the spot does nothing.
    if (node.k === "NEW_CLASS" && lastName(chain(node.identifier)) === "ItemStack") return this.itemStack(node) && [];
    if (node.k === "NEW_CLASS" && lastName(chain(node.identifier)) === "BlockPos") return this.position(node).map((n) => this.number(n)) && [];
    return fail(`expression statement ${node.k}`);
  }

  /** `te = world.getBlockEntity(pos)` for a block entity local: it now stands for that position. */
  private reassignBlockEntity(name: string, source: Ast): BlockNode[] {
    const lookup = /^(\w+)\.getBlockEntity\(/.exec(java(source));
    if (!lookup || source.k !== "METHOD_INVOCATION" || source.arguments.length !== 1) return fail("block entity source");
    this.worldAt(lookup[1]);
    this.blockEntities.set(name, { level: this.level, pos: this.position(source.arguments[0]) });
    return [];
  }

  private assignment(name: string, value: Value): BlockNode[] {
    if (this.inlined.has(name)) {
      if (impure(value.node)) return fail("value that runs code, moved to its use");
      this.inlined.set(name, value);
      return [];
    }
    const local = this.locals.get(name) ?? fail(`assignment to ${name}`);
    return [block(`local_${local.type}_set`, { var: name }, { value: this.assignable(value, local) })];
  }

  private localChange(name: string, amount: InputValue, int: boolean): BlockNode[] {
    const local = this.locals.get(name);
    if (!local || local.type !== "number") return fail(`change of ${name}`);
    if (local.int && !int) return fail("int local changed by a double");
    return [block("local_number_change", { var: name }, { amount })];
  }

  // ---- worlds and dimensions ----

  /** `IWorld varN = ((ServerWorld) world).getServer().getLevel(World.OVERWORLD)`: a name for another dimension's level. */
  private dimensionAlias(node: Ast): { name: string; id: string } | undefined {
    if (node.k !== "VARIABLE" || !WORLD_CLASSES.test(typeName(node.type)) || !node.initializer) return undefined;
    const match = /^\(\(ServerWorld\)(\w+)\)\.getServer\(\)\.getLevel\(World\.(\w+)\)$/.exec(java(node.initializer));
    if (!match || !DIMENSIONS[match[2]]) return undefined;
    this.worldAt(match[1]);
    return { name: node.name, id: DIMENSIONS[match[2]] };
  }

  /** The rest of the block runs in that dimension, guarded by its null check, as one block. */
  private inDimension(name: string, id: string, statements: Ast[]): BlockNode {
    let rest = statements;
    // `world = world;` at the end does nothing.
    rest = rest.filter((s) => !(s.k === "EXPRESSION_STATEMENT" && s.expression.k === "ASSIGNMENT" && chain(s.expression.variable) === chain(s.expression.expression)));
    const guard = rest.length === 1 && rest[0].k === "IF" && !rest[0].elseStatement ? this.withoutNullCheck(rest[0].condition, name) : undefined;
    if (guard === undefined) return fail("dimension level used without its null check");
    const outer = { level: this.level, serverOnly: this.serverOnly };
    this.level = ++this.levels;
    this.serverOnly = true;
    this.worlds.set(name, this.level);
    try {
      const inner = guard === null ? rest[0].thenStatement : { ...rest[0], condition: guard };
      return this.need("in_dimension", { dimension: id }, { do: this.statements(body(inner)) });
    } finally {
      this.level = outer.level;
      this.serverOnly = outer.serverOnly;
    }
  }

  /** The condition without its leading `name != null`: null when that was all of it, undefined when it has none. */
  private withoutNullCheck(raw: Ast, name: string): Ast | null | undefined {
    const node = strip(raw);
    if (node.k === "NOT_EQUAL_TO" && node.rightOperand.k === "NULL_LITERAL" && chain(node.leftOperand) === name) return null;
    if (node.k !== "CONDITIONAL_AND") return undefined;
    const left = this.withoutNullCheck(node.leftOperand, name);
    if (left === undefined) return undefined;
    return left === null ? node.rightOperand : { ...node, leftOperand: left };
  }

  /** The level a world initializer names: the current one (a plain alias) or fail. */
  private worldLevel(init: Ast): number {
    const text = java(strip(init));
    if (!this.worlds.has(text)) return fail("world from an unknown source");
    return this.worlds.get(text)!;
  }

  private worldAt(name: string): void {
    if (this.worlds.get(name) !== this.level) fail(`world ${name} of another dimension`);
  }

  /** A world argument that must be the one the blocks use: the current level. */
  private world(node: Ast): void {
    this.worldAt(chain(node));
  }

  // ---- calls as statements ----

  private call(node: Ast): BlockNode[] {
    const name = chain(node.methodSelect);
    const set = VARIABLES_CLASS.exec(name);
    if (set?.[1] === "set") return [this.variableSet(set[2], node.arguments)];
    if (name.endsWith(".flush")) return [];
    const select: Ast = node.methodSelect;
    const method = lastName(name);
    if (method === "execute" && this.classes.has(lastName(chain(select.expression)))) return [this.procedureCall(node, "call_procedure", this.classes.get(lastName(chain(select.expression)))!)];
    if (method === "start") return this.delay(node);
    if (method === "giveItemToPlayer") return [block("player_give", undefined, { entity: this.entity(node.arguments[0]), itemstack: this.value(node.arguments[1]).node })];
    if (method === "displayClientMessage") return [this.message(node)];
    if (method === "setCount" || method === "shrink" || method === "grow" || method === "setDamageValue") return [this.stackChange(node, method)];
    if (method === "setBlock") return [this.setBlock(node)];
    if (method === "closeContainer") return [block("gui_close", undefined, { entity: this.entity(select.expression) })];
    if (method === "clearOrCountMatchingItems") return [this.removeItems(node)];
    if (method === "use") {
      const used = this.useBlock(node);
      if (used) return used;
    }
    if (method === "setHoverName" && node.arguments.length === 1) {
      const named = strip(node.arguments[0]);
      if (named.k !== "NEW_CLASS" || lastName(chain(named.identifier)) !== "StringTextComponent") return fail("name that is not plain text");
      return [block("item_set_name", undefined, { itemstack: this.typed(select.expression, "itemstack"), name: this.text(named.arguments[0]) })];
    }
    if (method === "setFoodLevel" && lastName(chain(select.expression)) === "getFoodData()") {
      return [block("player_set_food", undefined, { entity: this.entity(strip(select.expression).methodSelect.expression), food: this.number(node.arguments[0]) })];
    }
    if (method === "giveExperienceLevels" && node.arguments.length === 1) return [block("player_add_levels", undefined, { entity: this.entity(select.expression), levels: this.number(node.arguments[0]) })];
    if (method === "displayItemActivation" && /Minecraft\.getInstance\(\)\.gameRenderer$/.test(chain(select.expression))) return [this.need("client_item_activation", undefined, { itemstack: this.typed(node.arguments[0], "itemstack") })];
    if (method === "ifPresent") return this.slotChange(node);
    const written = this.stackTagWrite(method, node);
    if (written) return written;
    if (method === "addEffect") return [this.effect(node)];
    if (method === "broadcastMessage" && /^\w+\.getPlayerList\(\)\.broadcastMessage$/.test(name) && this.servers.has(name.split(".")[0])) return [this.broadcast(node)];
    if (method === "sendParticles" && node.arguments.length === 9) return [this.serverParticles(node)];
    if (/^open\w+$/.test(method) && lastName(chain(select.expression)).endsWith("Menus")) return [this.openGui(node, method.slice(4))];
    return fail(`call ${this.shape(name)}`);
  }

  /**
   * `player.inventory.clearOrCountMatchingItems(p -> stack.getItem() == p.getItem(), n, craftSlots)` with a local `stack`
   * holding a new item stack: removes n of that item. Unlike the block, Java also clears the crafting grid and cursor.
   */
  private removeItems(node: Ast): BlockNode {
    const [matcher, count] = node.arguments;
    const stack = /^\( ?\w+\)->(\w+)\.getItem\(\)==\w+\.getItem\(\)$/.exec(java(matcher))?.[1];
    const item = stack ? this.stackItems.get(stack) : undefined;
    const owner = strip(node.methodSelect.expression);
    if (!stack || owner.k !== "MEMBER_SELECT" || owner.identifier !== "inventory") return fail("item removal shape");
    // Whatever the stack is made of, the player's own method removes it, crafting grid and cursor included.
    if (!item) return block("player_clear_matching", undefined, { entity: this.entity(owner.expression), itemstack: this.local(stack), amount: this.number(count) });
    if (count.k !== "INT_LITERAL" || Number(count.value) < 1) return fail("item removal shape");
    return block("player_remove_item", { item }, { entity: this.entity(owner.expression), amount: Number(count.value) });
  }

  /** `((ServerWorld) world).sendParticles(ParticleTypes.X, x, y, z, count, dx, dy, dz, speed)`. */
  private serverParticles(node: Ast): BlockNode {
    this.world(node.methodSelect.expression);
    const [particle, ...numbers] = node.arguments;
    const owner = strip(particle);
    const registered = owner.k === "METHOD_INVOCATION" && /ForgeRegistries\.PARTICLE_TYPES\.getValue\(\)$/.test(chain(owner)) ? this.resourceName(owner.arguments[0]) : undefined;
    const constant = owner.k === "MEMBER_SELECT" && chain(owner.expression) === "ParticleTypes" && /^[A-Z][A-Z0-9_]*$/.test(owner.identifier) ? `minecraft:${String(owner.identifier).toLowerCase()}` : undefined;
    const id = registered ?? constant ?? fail("particle type");
    const [x, y, z, count, dx, dy, dz, speed] = numbers.map((n) => this.number(n));
    return this.need("particle_server", { particle: id }, { x, y, z, count, dx, dy, dz, speed });
  }

  /** `((LivingEntity) entity).addEffect(new EffectInstance(Effects.X, ticks, amplifier, ambient, particles))`. */
  private effect(node: Ast): BlockNode {
    const created = strip(node.arguments[0]);
    if (created.k !== "NEW_CLASS" || lastName(chain(created.identifier)) !== "EffectInstance" || created.arguments.length !== 5) return fail("effect shape");
    const [kind, ticks, amplifier, ambient, particles] = created.arguments;
    const registered = /ForgeRegistries\.POTIONS\.getValue\(\)$/.test(chain(kind)) ? this.resourceName(strip(kind).arguments[0]) : undefined;
    const id = registered ?? (chain(kind).startsWith("Effects.") ? `minecraft:${EFFECTS[lastName(chain(kind))]}` : undefined);
    if (!id || id.endsWith(":undefined") || ambient.k !== "BOOLEAN_LITERAL" || particles.k !== "BOOLEAN_LITERAL") return fail("effect type");
    return this.need("effect_add_ticks", { effect: id, ambient: ambient.value === true, particles: particles.value === true }, {
      entity: this.entity(node.methodSelect.expression), ticks: this.number(ticks), amplifier: this.number(amplifier),
    });
  }

  /** `server.getPlayerList().broadcastMessage(new StringTextComponent(text), ChatType.SYSTEM, Util.NIL_UUID)`. */
  private broadcast(node: Ast): BlockNode {
    const text = strip(node.arguments[0]);
    if (text.k !== "NEW_CLASS" || lastName(chain(text.identifier)) !== "StringTextComponent" || node.arguments.length !== 3) return fail("broadcast text");
    if (chain(node.arguments[1]) !== "ChatType.SYSTEM" || chain(node.arguments[2]) !== "Util.NIL_UUID") return fail("broadcast kind");
    if (!this.serverOnly) return fail("broadcast that may run on a client");
    return this.need("world_broadcast", undefined, { text: this.text(text.arguments[0]) });
  }

  /** `Menus.openName(player, new BlockPos(x, y, z), null)`: opens the GUI at the procedure's own x, y, z. */
  private openGui(node: Ast, name: string): BlockNode {
    const gui = this.options.guis?.find((id) => pascal(id) === name) ?? fail(`GUI ${name}`);
    const [player, position, container] = node.arguments;
    const pos = this.position(position);
    if (container?.k !== "NULL_LITERAL") return fail("GUI opened with a container");
    if (pos.every((p, i) => chain(p) === "xyz"[i])) return this.need("gui_open", { gui }, { entity: this.entity(player) });
    const [x, y, z] = pos.map((n) => this.number(n));
    return this.need("gui_open_at", { gui }, { entity: this.entity(player), x, y, z });
  }

  /**
   * `te.getCapability(ITEM_HANDLER, null).ifPresent(capability -> ...)` on a block entity local: shrinking the item in a
   * slot, or putting a stack (or nothing) into one. The block entity's own container does the work from 1.21.5 on.
   */
  private slotChange(node: Ast): BlockNode[] {
    const text = java(node);
    const energy = /^(\w+)\.getCapability\(CapabilityEnergy\.ENERGY,null\)\.ifPresent\(\( capability\)->capability\.(receiveEnergy|extractEnergy)\((.+),false\)\)$/.exec(text);
    if (energy) {
      const owner = this.blockEntities.get(energy[1]);
      if (!owner || owner.level !== this.level) return fail("energy change shape");
      const [x, y, z] = owner.pos.map((n) => this.number(n));
      const amount = this.number(node.arguments[0].body.arguments[0]);
      return [this.need(energy[2] === "extractEnergy" ? "block_energy_extract" : "block_energy_receive", undefined, { x, y, z, amount })];
    }
    const head = String.raw`^(\w+)\.getCapability\(CapabilityItemHandler\.ITEM_HANDLER_CAPABILITY,null\)\.ifPresent\(\( capability\)->\{if\(\(capability instanceof IItemHandlerModifiable\)\)\{`;
    const shrink = new RegExp(String.raw`${head}ItemStack (\w+)=capability\.getStackInSlot\((.+?)\)\.copy\(\);\2\.shrink\((.+?)\);\(\(IItemHandlerModifiable\)capability\)\.setStackInSlot\(\3,\2\);\}\}\)$`).exec(text);
    const set = new RegExp(String.raw`${head}\(\(IItemHandlerModifiable\)capability\)\.setStackInSlot\(.+?,(\w+(?:\.\w+)?)\);\}\}\)$`).exec(text);
    const hurt = new RegExp(String.raw`${head}ItemStack (\w+)=capability\.getStackInSlot\((.+?)\)\.copy\(\);if\(\(\2\.hurt\((.+?),java\.util\.concurrent\.ThreadLocalRandom\.current\(\),null\)\)\)\{\2\.shrink\(1\);\2\.setDamageValue\(0\);\}\(\(IItemHandlerModifiable\)capability\)\.setStackInSlot\(\3,\2\);\}\}\)$`).exec(text);
    const entity = this.blockEntities.get((shrink ?? set ?? hurt)?.[1] ?? "");
    if (!entity || entity.level !== this.level) return fail("slot change shape");
    const [x, y, z] = entity.pos.map((n) => this.number(n));
    const inner = body(body(node.arguments[0].body)[0].thenStatement);
    if (set) {
      const slot = this.number(strip(inner[0].expression).arguments[0]);
      return [this.need("block_set_slot_item", undefined, { x, y, z, slot, itemstack: this.typed(strip(inner[0].expression).arguments[1], "itemstack") })];
    }
    const stack = (shrink ?? hurt)![2];
    const slot = this.number(strip(inner[0].initializer.methodSelect.expression).arguments[0]);
    const amount = this.number(hurt ? strip(inner[1].condition).arguments[0] : inner[1].expression.arguments[0]);
    this.locals.set(stack, { type: "itemstack", int: false });
    return [
      block("local_itemstack_set", { var: stack }, { value: this.need("block_slot_item", undefined, { x, y, z, slot }) }),
      hurt ? this.need("item_hurt_break", undefined, { itemstack: this.local(stack), amount }) : block("item_shrink", undefined, { itemstack: this.local(stack), amount }),
      this.need("block_set_slot_item", undefined, { x, y, z, slot, itemstack: this.local(stack) }),
    ];
  }

  private stackChange(node: Ast, method: string): BlockNode {
    const stack = this.typed(node.methodSelect.expression, "itemstack");
    const amount = this.number(node.arguments[0]);
    const id = { setCount: "item_set_count", shrink: "item_shrink", grow: "item_grow", setDamageValue: "item_set_damage" }[method] ?? fail(`stack change ${method}`);
    const input = id === "item_set_count" ? "count" : id === "item_set_damage" ? "damage" : "amount";
    return block(id, undefined, { itemstack: stack, [input]: amount });
  }

  /** `world.setBlock(pos, state, 3)`: flags 3 is what the place blocks use. */
  private setBlock(node: Ast): BlockNode {
    this.world(node.methodSelect.expression);
    if (node.arguments.length !== 3 || strip(node.arguments[2]).value !== 3) return fail("setBlock flags");
    const [x, y, z] = this.position(node.arguments[0]).map((n) => this.number(n));
    return block("block_place_state", undefined, { blockstate: this.typed(node.arguments[1], "blockstate"), x, y, z });
  }

  private procedureCall(node: Ast, id: string, procedure: string): BlockNode {
    const info = this.options.procedures?.get(procedure) ?? fail(`procedure ${procedure}`);
    if (node.arguments.length !== info.deps.length) return fail("procedure call arguments");
    info.deps.forEach((dep, i) => {
      const argument = node.arguments[i];
      if (dep === "world") this.world(argument);
      else if (chain(argument) !== dep || strip(argument).k !== "IDENTIFIER") fail(`procedure call passes ${java(argument)} for ${dep}`);
    });
    return block(id, { procedure });
  }

  private message(node: Ast): BlockNode {
    const select = strip((node.methodSelect as Ast).expression);
    const text = strip(node.arguments[0]);
    if (text.k !== "NEW_CLASS" || lastName(chain(text.identifier)) !== "StringTextComponent") return fail("message text");
    const actionbar = node.arguments[1]?.value === true;
    return block("player_message", { actionbar }, { entity: this.entity(select), text: this.text(text.arguments[0]) });
  }

  private variableSet(name: string, args: Ast[]): BlockNode {
    const v = this.variable(name);
    const value = this.assignableVariable(this.value(args[args.length - 1]), v.type);
    if (v.scope === "global_map" || v.scope === "global_world") {
      this.world(args[0]);
      return this.need(`global_${v.type}_set`, { var: name }, { value });
    }
    return this.need(`player_${v.type}_set`, { var: name }, { entity: this.entity(args[0]), value });
  }

  private assignableVariable(value: Value, type: string): InputValue {
    return value.type === type ? value.node : fail(`${type} variable set from ${value.type}`);
  }

  private variable(name: string): Variable {
    const v = this.vars.get(name) ?? fail(`variable ${name}`);
    return { ...v, type: v.type === "string" ? "text" : v.type };
  }

  // ---- delayed run, block data write ----

  /** `new Object() { ...tick counter... }.start(world, ticks)`: the Wait block. */
  private delay(node: Ast): BlockNode[] {
    const anonymous = strip(node.methodSelect.expression);
    if (anonymous.k !== "NEW_CLASS" || !anonymous.classBody || node.arguments.length !== 2) return fail("start call");
    const text = java(anonymous.classBody);
    if (!text.startsWith(DELAY_HEAD) || !text.endsWith(DELAY_TAIL)) return fail("delay template");
    this.world(node.arguments[0]);
    const run = anonymous.classBody.members.find((m: Ast) => m.k === "METHOD" && m.name === "run");
    const ticks = this.number(node.arguments[1]);
    this.worlds.set("this.world", this.level);
    return [this.need("wait", undefined, { ticks, do: this.statements(run.body.statements.slice(0, -1)) })];
  }

  /**
   * `if (!world.isClientSide()) { <data write> }`: the five statements MCreator writes to keep a value at a block, run on
   * the server only. Undefined when the statement is some other `if`.
   */
  private guardedDataWrite(node: Ast): BlockNode[] | undefined {
    const guard = /^\(!(.+)\.isClientSide\(\)\)$/.exec(java(node.condition));
    const list: Ast[] = body(node.thenStatement);
    if (!guard || node.elseStatement || list.length !== 5 || list[0].k !== "VARIABLE" || typeName(list[0].type) !== "BlockPos") return undefined;
    this.worldAt(guard[1]);
    const written = this.dataWriteSequence(list, guard[1]);
    return written ? [written] : fail("block data write template");
  }

  /**
   * `BlockPos _bp = ...; TileEntity te = world.getBlockEntity(_bp); BlockState _bs = world.getBlockState(_bp);
   * if (te != null) te.getTileData().putX(key, v); if (world instanceof World) ((World) world).sendBlockUpdated(...)`.
   * The world is the current one, named by the second statement; undefined when the statements are something else.
   */
  private dataWriteSequence(list: Ast[], knownWorld?: string): BlockNode | undefined {
    if (list.length !== 5) return undefined;
    const [first, entity, second, put, update] = list;
    // The first and third statements declare their variables, or assign ones an earlier template declared.
    const bp = first.k === "VARIABLE" ? first : first.k === "EXPRESSION_STATEMENT" && first.expression.k === "ASSIGNMENT"
      ? { k: "VARIABLE", name: chain(first.expression.variable), initializer: first.expression.expression } : undefined;
    const state = second.k === "VARIABLE" ? second : second.k === "EXPRESSION_STATEMENT" && second.expression.k === "ASSIGNMENT"
      ? { k: "VARIABLE", name: chain(second.expression.variable), initializer: second.expression.expression } : undefined;
    const match = /^TileEntity (\w+)=(.+)\.getBlockEntity\((\w+)\);$/.exec(java(entity));
    if (!bp || !state || !match || match[3] !== bp.name || (knownWorld !== undefined && match[2] !== knownWorld)) return undefined;
    const world = match[2];
    const names = { te: match[1], bs: state.name };
    if (java(state.initializer) !== `${world}.getBlockState(${bp.name})`) return undefined;
    const call = body(put.thenStatement)[0];
    if (put.k !== "IF" || java(put.condition) !== `(${names.te}!=null)` || put.elseStatement || body(put.thenStatement).length !== 1) return undefined;
    const kind = /\.put(Double|String|Boolean)$/.exec(java(call.expression.methodSelect));
    if (!kind || java(call.expression.methodSelect) !== `${names.te}.getTileData().put${kind[1]}`) return undefined;
    const sent = `if((${world} instanceof World)){((World)${world}).sendBlockUpdated(${bp.name},${names.bs},${names.bs},3);}`;
    if (java(update) !== sent) return undefined;
    this.worldAt(world);
    const type = DATA_TYPES[kind[1]];
    const at = this.position(bp.initializer);
    this.positions.set(bp.name, at);
    const [x, y, z] = at.map((n) => this.number(n));
    const value = this.typed(call.expression.arguments[1], type);
    if (impure(value)) return fail("block data value that runs code");
    return this.need(`block_set_data_${type}`, undefined, { x, y, z, key: this.text(call.expression.arguments[0]), value });
  }

  // ---- values ----

  private logic(node: Ast): InputValue { return this.typed(node, "logic"); }
  private number(node: Ast): InputValue { return this.typed(node, "number"); }
  private entity(node: Ast): InputValue { return this.typed(node, "entity"); }

  private numberValue(node: Ast): Value {
    const value = this.value(node);
    return value.type === "number" ? value : fail(`number expected, got ${value.type}`);
  }

  private typed(node: Ast, type: string): InputValue {
    const value = this.value(node);
    return value.type === type ? value.node : fail(`${type} expected, got ${value.type}`);
  }

  /** Text for a text input: a number joins only as a Java int, a logic as true / false. */
  private text(node: Ast): InputValue {
    return this.toText(this.value(node));
  }

  private toText(value: Value): InputValue {
    if (value.type === "text") return value.node;
    if (value.type === "number" && value.int) return block("text_from_number", undefined, { value: value.node });
    if (value.type === "number" && value.loose) return fail("a dependency of unknown Java number type joined to text");
    if (value.type === "number") return block("text_from_double", undefined, { value: value.node });
    if (value.type === "logic") return block("text_from_logic", undefined, { value: value.node });
    if (value.type === "itemstack") return block("text_from_itemstack", undefined, { itemstack: value.node });
    return fail(`text from ${value.type}`);
  }

  private local(name: string): BlockNode {
    const local = this.locals.get(name) ?? fail(`local ${name}`);
    return block(`local_${local.type}_get`, { var: name });
  }

  private value(raw: Ast): Value {
    const node = raw;
    switch (node.k) {
      case "PARENTHESIZED": return this.value(node.expression);
      case "TYPE_CAST": return this.cast(node);
      case "INT_LITERAL": case "LONG_LITERAL": return { node: Number(node.value), type: "number", int: true };
      case "DOUBLE_LITERAL": return { node: Number(node.value), type: "number" };
      case "FLOAT_LITERAL": return Math.fround(Number(node.value)) === Number(node.value) ? { node: Number(node.value), type: "number" } : fail("float literal");
      case "BOOLEAN_LITERAL": return { node: block("logic_boolean", { value: String(node.value) }), type: "logic" };
      case "STRING_LITERAL": return { node: String(node.value), type: "text" };
      case "IDENTIFIER": return this.identifier(node.name);
      case "UNARY_MINUS": return this.negative(node);
      case "LOGICAL_COMPLEMENT": return { node: block("logic_negate", undefined, { value: this.logic(node.expression) }), type: "logic" };
      case "CONDITIONAL_AND": case "CONDITIONAL_OR":
        if (node.k === "CONDITIONAL_AND" && this.constant(node.leftOperand) === true) return this.value(node.rightOperand);
        if (node.k === "CONDITIONAL_AND" && this.constant(node.rightOperand) === true) return this.value(node.leftOperand);
        return { node: block("logic_operation", { op: node.k === "CONDITIONAL_OR" ? "OR" : "AND" }, { a: this.logic(node.leftOperand), b: this.logic(node.rightOperand) }), type: "logic" };
      case "EQUAL_TO": case "NOT_EQUAL_TO": case "LESS_THAN": case "LESS_THAN_EQUAL": case "GREATER_THAN": case "GREATER_THAN_EQUAL": return this.comparison(node);
      case "PLUS": case "MINUS": case "MULTIPLY": case "DIVIDE": case "REMAINDER": return this.binary(node);
      case "CONDITIONAL_EXPRESSION": return this.ternary(node);
      case "INSTANCE_OF": return this.instance(node);
      case "METHOD_INVOCATION": return this.invocation(node);
      case "NEW_CLASS": return this.creation(node);
      case "MEMBER_SELECT": return this.member(node);
      default: return fail(`value ${node.k}`);
    }
  }

  /** `(Type) value`: entity casts only narrow a type the blocks check themselves; numeric casts must lose nothing. */
  private cast(node: Ast): Value {
    const target = typeName(node.type);
    const inner = this.value(node.expression);
    if (inner.type === "entity" && ENTITY_CLASSES.test(target)) return inner;
    if (inner.type === "number" && target === "DOUBLE") return { ...inner, int: false };
    if (inner.type === "number" && inner.int && target === "INT") return inner;
    if (inner.type === "number" && target === "INT") return { node: block("math_single", { op: "TRUNC" }, { value: inner.node }), type: "number", int: true };
    return fail(`cast to ${target}`);
  }

  private identifier(name: string): Value {
    if (this.inlined.has(name)) return this.inlined.get(name)!;
    const local = this.locals.get(name);
    if (local) return { node: this.local(name), type: local.type, int: local.int };
    const type = DEPENDENCY_TYPES[name];
    if (type && DEPENDENCY_BLOCKS[type]) return { node: block(DEPENDENCY_BLOCKS[type], { dep: name }), type, loose: type === "number" && !"xyz".includes(name) };
    return fail(`name ${name}`);
  }

  private negative(node: Ast): Value {
    const inner = this.numberValue(node.expression);
    if (typeof inner.node === "number") return { ...inner, node: -inner.node };
    return { ...inner, node: block("math_arithmetic", { op: "MINUS" }, { a: 0, b: inner.node }) };
  }

  private comparison(node: Ast): Value {
    const op = COMPARE[node.k];
    if (node.rightOperand.k === "NULL_LITERAL") {
      const entity = this.entity(node.leftOperand);
      const exists = block("entity_exists", undefined, { entity });
      return { node: op === "NEQ" ? exists : block("logic_negate", undefined, { value: exists }), type: "logic" };
    }
    const a = this.value(node.leftOperand);
    const b = this.value(node.rightOperand);
    const flip = (inner: BlockNode) => (op === "NEQ" ? block("logic_negate", undefined, { value: inner }) : inner);
    if (a.type === "number" && b.type === "number") return { node: block("logic_compare", { op }, { a: a.node, b: b.node }), type: "logic" };
    if (op !== "EQ" && op !== "NEQ") return fail(`compare ${a.type} ${b.type}`);
    if (a.type === "logic" && b.type === "logic") {
      const same = block("logic_operation", { op: "XOR" }, { a: a.node, b: b.node });
      return { node: op === "NEQ" ? same : block("logic_negate", undefined, { value: same }), type: "logic" };
    }
    if (a.type === "entity" && b.type === "entity") return { node: flip(block("compare_entities", undefined, { a: a.node, b: b.node })), type: "logic" };
    const [sorted, ref] = a.id !== undefined ? [b, a] : [a, b];
    if (ref.type === "blockref" && sorted.type === "blockof") return { node: flip(block("block_state_is", { block: ref.id! }, { blockstate: sorted.node })), type: "logic" };
    const kinds = new Set(["itemof", "randomitem"]);
    if (kinds.has(a.type) && kinds.has(b.type)) return { node: flip(block("compare_item_types", undefined, { a: a.node, b: b.node })), type: "logic" };
    if (ref.type === "materialref" && sorted.type === "materialof") return { node: flip(this.need("block_material_is", { material: ref.id! }, { blockstate: sorted.node })), type: "logic" };
    if (ref.type === "rarityref" && sorted.type === "rarityof") return { node: flip(block("item_rarity_is", { rarity: ref.id! }, { itemstack: sorted.node })), type: "logic" };
    if (ref.type === "itemref" && (sorted.type === "itemof" || sorted.type === "randomitem")) return { node: flip(block("item_is", { item: ref.id! }, { itemstack: sorted.node })), type: "logic" };
    return fail(`compare ${a.type} ${b.type}`);
  }

  private binary(node: Ast): Value {
    const a = this.value(node.leftOperand);
    const b = this.value(node.rightOperand);
    if (node.k === "PLUS" && (a.type === "text" || b.type === "text")) {
      return { node: block("text_join", undefined, { a: this.toText(a), b: this.toText(b) }), type: "text" };
    }
    if (a.type !== "number" || b.type !== "number") return fail(`arithmetic ${a.type} ${b.type}`);
    if (node.k === "DIVIDE" && a.int && b.int) return { node: block("math_arithmetic", { op: "DIVIDE_INT" }, { a: a.node, b: b.node }), type: "number", int: true };
    return { node: block("math_arithmetic", { op: ARITHMETIC[node.k] }, { a: a.node, b: b.node }), type: "number", int: a.int === true && b.int === true, loose: a.loose === true || b.loose === true };
  }

  private ternary(node: Ast): Value {
    const food = /^(\w+) instanceof PlayerEntity\?\(\(PlayerEntity\)\1\)\.getFoodData\(\)\.getFoodLevel\(\):0$/.exec(`${java(strip(node.condition))}?${java(node.trueExpression)}:${java(node.falseExpression)}`);
    if (food) return { node: block("player_food", undefined, { entity: this.entity({ k: "IDENTIFIER", name: food[1] }) }), type: "number", int: true };
    const hand = this.handItem(node);
    if (hand) return hand;
    const a = this.value(node.trueExpression);
    const b = this.value(node.falseExpression);
    if (a.type !== b.type || (a.type !== "number" && a.type !== "text" && a.type !== "logic")) return fail(`ternary ${a.type}`);
    return { node: block(`logic_ternary_${a.type}`, undefined, { cond: this.logic(node.condition), a: a.node, b: b.node }), type: a.type, int: a.int === true && b.int === true, loose: a.loose === true || b.loose === true };
  }

  /** `entity instanceof LivingEntity ? ((LivingEntity) entity).getMainHandItem() : ItemStack.EMPTY` is the hand item block. */
  private handItem(node: Ast): Value | undefined {
    const match = /^(\w+) instanceof LivingEntity\?\(\(LivingEntity\)\1\)\.get(MainHand|Offhand)Item\(\):ItemStack\.EMPTY$/.exec(`${java(strip(node.condition))}?${java(node.trueExpression)}:${java(node.falseExpression)}`);
    if (!match) return undefined;
    return { node: block("player_hand_item", { hand: match[2] === "MainHand" ? "main" : "off" }, { entity: this.entity({ k: "IDENTIFIER", name: match[1] }) }), type: "itemstack" };
  }

  private instance(node: Ast): Value {
    const type = lastName(chain(node.type));
    const subject = chain(node.expression);
    if (this.constant(node) === true) return { node: block("logic_boolean", { value: "true" }), type: "logic" };
    if (this.worlds.has(subject) && /^(ServerWorld|ServerLevel)$/.test(type)) return { node: block("logic_negate", undefined, { value: block("world_is_client") }), type: "logic" };
    if (type === "PlayerEntity" || type === "ServerPlayerEntity") return { node: block("entity_is_player", undefined, { entity: this.entity(node.expression) }), type: "logic" };
    if (type === "AnimalEntity") return { node: this.need("entity_is_animal", undefined, { entity: this.entity(node.expression) }), type: "logic" };
    if (type === "MonsterEntity") return { node: this.need("entity_is_monster", undefined, { entity: this.entity(node.expression) }), type: "logic" };
    if (type === "CreeperEntity") return { node: block("entity_type_is", { type: "minecraft:creeper" }, { entity: this.entity(node.expression) }), type: "logic" };
    if (TOOL_CLASSES[type]) {
      const held = this.value(node.expression);
      if (held.type !== "itemof") return fail(`instanceof ${type} of a non item`);
      return { node: this.need("item_is_tool", { tool: TOOL_CLASSES[type] }, { itemstack: held.node }), type: "logic" };
    }
    if (type === "LivingEntity") return { node: block("entity_is_living", undefined, { entity: this.entity(node.expression) }), type: "logic" };
    return fail(`instanceof ${type}`);
  }

  private shape(name: string): string {
    return name.replace(/\bvar\d+\b/g, "world").replace(/_setval\w*/g, "_setval").replace(/_tileEntity\w*/g, "_tileEntity");
  }

  /** `Items.X` / `Blocks.X`: a vanilla constant is the registry id in capitals. */
  private member(node: Ast): Value {
    const owner = chain(node.expression);
    if ((owner === "Blocks" || owner === "Items") && /^[A-Z][A-Z0-9_]*$/.test(node.identifier)) {
      return { node: "", type: owner === "Blocks" ? "blockref" : "itemref", id: `minecraft:${String(node.identifier).toLowerCase()}` };
    }
    if (owner === "Material" && /^[A-Z][A-Z_]*$/.test(node.identifier)) return { node: "", type: "materialref", id: node.identifier };
    if (owner === "Rarity" && /^(COMMON|UNCOMMON|RARE|EPIC)$/.test(node.identifier)) return { node: "", type: "rarityref", id: node.identifier };
    if (/\.level$/.test(owner) && node.identifier === "isClientSide") return { node: block("world_is_client"), type: "logic" };
    if (owner === "ItemStack" && node.identifier === "EMPTY") return { node: block("item_empty"), type: "itemstack" };
    return fail(`value ${this.shape(chain(node))}`);
  }

  private invocation(node: Ast): Value {
    const name = chain(node.methodSelect);
    const get = VARIABLES_CLASS.exec(name);
    if (get?.[1] === "get") return this.variableGet(get[2], node.arguments);
    const select: Ast = node.methodSelect;
    const method = lastName(name);
    const receiver: Ast | undefined = select.expression;
    if (method === "execute" && receiver && this.classes.has(lastName(chain(receiver)))) return this.procedureValue(node, this.classes.get(lastName(chain(receiver)))!);
    if (name.endsWith(".isClientSide")) {
      const owner = chain(receiver);
      if (this.worlds.has(owner)) {
        this.worldAt(owner);
        return { node: block("world_is_client"), type: "logic" };
      }
      if (/\.level$/.test(owner)) return { node: block("world_is_client"), type: "logic" };
    }
    const tagged = this.stackTagRead(method, node);
    if (tagged) return tagged;
    if (method === "getDayTime" && /\.getLevelData\(\)$/.test(chain(receiver))) {
      this.world(strip(receiver).methodSelect.expression);
      return { node: this.need("world_total_day_time"), type: "number", int: true };
    }
    const look = this.lookBlock(node);
    if (look) return look;
    if (/\.getEntitiesOfClass\(\)\.stream\(\)\.sorted\(\)\.findFirst\(\)\.orElse$/.test(name)) return this.nearestInBox(node);
    if (method === "contains" && node.arguments.length === 1 && /\.inventory$/.test(chain(receiver))) return this.inventoryHas(node);
    const math = this.mathCall(name, node);
    if (math) return math;
    const text = this.textCall(method, node);
    if (text) return text;
    const template = this.anonymousCall(node);
    if (template) return template;
    const stack = this.stackCall(method, node);
    if (stack) return stack;
    const registry = this.registryCall(name, node);
    if (registry) return registry;
    if (method === "getValue" && lastName(chain(receiver)) === "getGameRules") return this.gameRule(node);
    if (method === "getInt" && /\.getGameRules\(\)$/.test(chain(receiver))) return this.gameRule(node);
    if (method === "getDouble" && chain(node.arguments[0]) === "arguments") {
      return { node: this.need("command_arg_number", { name: String(node.arguments[1].value) }), type: "number" };
    }
    if (method === "getString" && chain(node.arguments[0]) === "arguments") {
      return { node: this.need("command_arg_text", { name: String(node.arguments[1].value) }), type: "text" };
    }
    if ((method === "getMainHandItem" || method === "getOffhandItem") && node.arguments.length === 0 && receiver) {
      return { node: block("player_hand_item", { hand: method === "getMainHandItem" ? "main" : "off" }, { entity: this.entity(receiver) }), type: "itemstack" };
    }
    if (method === "isShiftKeyDown" && node.arguments.length === 0) return { node: block("entity_sneaking", undefined, { entity: this.entity(receiver!) }), type: "logic" };
    if (method === "hasPermissions" && node.arguments.length === 1) return { node: this.need("entity_has_permission", undefined, { entity: this.entity(receiver!), level: this.number(node.arguments[0]) }), type: "logic" };
    if (name.endsWith("getDisplayName().getString")) return { node: block("entity_display_name", undefined, { entity: this.entity(strip(select.expression).methodSelect.expression) }), type: "text" };
    if (method === "getBlock" && chain(receiver).endsWith(".getBlockState()")) return this.blockOf(node);
    if (method === "getBlockState" && node.arguments.length === 1 && this.worlds.has(chain(receiver))) return this.stateAt(node);
    if (this.worlds.has(chain(receiver)) && node.arguments.length === 1 && (method === "canSeeSkyFromBelowWater" || method === "getMaxLocalRawBrightness")) {
      this.world(receiver);
      const [x, y, z] = this.position(node.arguments[0]).map((n) => this.number(n));
      return method === "canSeeSkyFromBelowWater"
        ? { node: this.need("world_can_see_sky_from_water", undefined, { x, y, z }), type: "logic" }
        : { node: block("world_light_at", undefined, { x, y, z }), type: "number", int: true };
    }
    if (method === "isRaining" && node.arguments.length === 0 && /\.getLevelData\(\)$/.test(chain(receiver))) {
      this.world(strip(receiver).methodSelect.expression);
      return { node: this.need("world_raining_flag"), type: "logic" };
    }
    if (method === "getMaterial" && node.arguments.length === 0 && strip(receiver).k === "METHOD_INVOCATION" && lastName(chain(strip(receiver).methodSelect)) === "getBlockState") {
      return { node: this.stateAt(strip(receiver)).node, type: "materialof" };
    }
    if (name === "ItemTags.getAllTags().getTagOrEmpty().contains") return this.itemInTag(node);
    if (name === "BlockTags.getAllTags().getTagOrEmpty().contains") {
      const held = this.value(node.arguments[0]);
      if (held.type !== "blockof") return fail("tag check of a non block");
      return { node: block("block_in_tag", { tag: this.resourceName(node.methodSelect.expression.arguments[0]) }, { blockstate: held.node }), type: "logic" };
    }
    return fail(`value call ${this.shape(name)}`);
  }

  /** `stack.getOrCreateTag().getDouble("key")`, or getString / getBoolean: a value kept in the stack's data. */
  private stackTagRead(method: string, node: Ast): Value | undefined {
    const kinds: Record<string, "number" | "text" | "logic"> = { getDouble: "number", getString: "text", getBoolean: "logic" };
    const tag = (node.methodSelect as Ast).expression ? strip((node.methodSelect as Ast).expression) : undefined;
    if (!kinds[method] || tag?.k !== "METHOD_INVOCATION" || lastName(chain(tag.methodSelect)) !== "getOrCreateTag" || node.arguments[0]?.k !== "STRING_LITERAL") return undefined;
    const type = kinds[method];
    return { node: block(`item_data_${type}`, { key: String(node.arguments[0].value) }, { itemstack: this.typed(tag.methodSelect.expression, "itemstack") }), type };
  }

  /** `entity.level.clip(new RayTraceContext(eye, eye.add(view * distance), COLLIDER, NONE, entity)).getBlockPos().getX()`, or Y or Z. */
  private lookBlock(node: Ast): Value | undefined {
    const text = java(node);
    const one = String.raw`1(?:\.0)?f`;
    const eye = String.raw`\1\.getEyePosition\(${one}\)`;
    const view = (axis: string, distance: string) => String.raw`\1\.getViewVector\(${one}\)\.${axis}\*${distance}`;
    const again = String.raw`\2`;
    const match = new RegExp(String.raw`^(\w+)\.level\.clip\(new RayTraceContext\(${eye},${eye}\.add\(${view("x", "(.+?)")},${view("y", again)},${view("z", again)}\),BlockMode\.(COLLIDER|OUTLINE),FluidMode\.NONE,\1\)\)\.getBlockPos\(\)\.get([XYZ])\(\)$`).exec(text);
    if (!match) return undefined;
    const add = node.methodSelect.expression.methodSelect.expression.arguments[0].arguments[1];
    const distance = this.number(strip(add.arguments[0]).rightOperand);
    return { node: this.need("entity_look_block", { axis: match[4], shape: match[3].toLowerCase() }, { entity: this.entity({ k: "IDENTIFIER", name: match[1] }), distance }), type: "number", int: true };
  }

  /** `world.getEntitiesOfClass(Class, new AxisAlignedBB(...), null).stream().sorted(nearestTo(x, y, z)).findFirst().orElse(null)`. */
  private nearestInBox(node: Ast): Value {
    const first = node.methodSelect.expression;
    const sorted = first.methodSelect.expression;
    const query = sorted.methodSelect.expression.methodSelect.expression;
    const order = strip(sorted.arguments[0]);
    const comparator = order.k === "METHOD_INVOCATION" ? strip(order.methodSelect.expression) : undefined;
    const box = strip(query.arguments[1]);
    const kinds: Record<string, string> = { "PlayerEntity.class": "player", "ServerPlayerEntity.class": "server_player", "ItemEntity.class": "item" };
    const kind = kinds[java(query.arguments[0])];
    if (node.arguments[0]?.k !== "NULL_LITERAL" || query.arguments[2]?.k !== "NULL_LITERAL" || !kind || box.k !== "NEW_CLASS" || box.arguments.length !== 6
      || comparator?.k !== "NEW_CLASS" || !comparator.classBody || java(comparator.classBody.members[0]) !== COMPARE_DISTANCE) return fail("entity query shape");
    this.world(query.methodSelect.expression);
    const [x1, y1, z1, x2, y2, z2] = box.arguments.map((n: Ast) => this.number(n));
    const [x, y, z] = order.arguments.map((n: Ast) => this.number(n));
    return { node: this.need("world_nearest_entity_in_box", { kind }, { x1, y1, z1, x2, y2, z2, x, y, z }), type: "entity" };
  }

  /** `player.inventory.contains(new ItemStack(item))`: any stack of that item. */
  private inventoryHas(node: Ast): Value {
    const wanted = this.value(node.arguments[0]).node as BlockNode;
    const owner = strip(node.methodSelect.expression);
    if (wanted.block !== "item_stack") return { node: block("player_has_stack", undefined, { entity: this.entity(owner.expression), itemstack: wanted }), type: "logic" };
    return { node: block("player_has_item", { item: String(wanted.fields?.item) }, { entity: this.entity(owner.expression) }), type: "logic" };
  }

  /** `ItemTags.getAllTags().getTagOrEmpty(new ResourceLocation("ns:tag")).contains(stack.getItem())`. */
  private itemInTag(node: Ast): Value {
    const item = this.value(node.arguments[0]);
    if (item.type !== "itemof") return fail("tag check of a non item");
    const tag = this.resourceName(node.methodSelect.expression.arguments[0]);
    return { node: block("item_in_tag", { tag }, { itemstack: item.node }), type: "logic" };
  }

  private procedureValue(node: Ast, procedure: string): Value {
    const type = this.options.procedures?.get(procedure)?.returnType ?? fail(`procedure ${procedure}`);
    const value = type === "string" ? "text" : type;
    if (!["number", "logic", "text", "itemstack", "entity"].includes(value)) return fail(`procedure returning ${type}`);
    return { node: this.procedureCall(node, `call_procedure_${value}`, procedure), type: value };
  }

  private mathCall(name: string, node: Ast): Value | undefined {
    if (name === "Math.random") return { node: block("math_random"), type: "number" };
    if (/^MathHelper\.nextDouble$/.test(name) && chain(node.arguments[0]).includes("ThreadLocalRandom")) {
      return { node: block("math_random_between", { kind: "decimal" }, { min: this.number(node.arguments[1]), max: this.number(node.arguments[2]) }), type: "number" };
    }
    if (name === "Math.floor") return { node: block("math_single", { op: "ROUNDDOWN" }, { value: this.number(node.arguments[0]) }), type: "number" };
    if (name === "Math.round") return { node: block("math_single", { op: "ROUND" }, { value: this.number(node.arguments[0]) }), type: "number", int: true };
    if (/\.nextInt$/.test(name) && chain(node.arguments[0]).includes("ThreadLocalRandom")) {
      return { node: block("math_random_between", { kind: "whole" }, { min: this.number(node.arguments[1]), max: this.number(node.arguments[2]) }), type: "number", int: true };
    }
    return undefined;
  }

  private textCall(method: string, node: Ast): Value | undefined {
    const select: Ast = node.methodSelect;
    const receiver: Ast | undefined = select.expression;
    if (!receiver) return undefined;
    if (method === "equals" && node.arguments.length === 1) {
      return { node: block("text_compare", { op: "EQUALS" }, { a: this.textOperand(receiver), b: this.textOperand(node.arguments[0]) }), type: "logic" };
    }
    if (method === "substring" && node.arguments.length === 2) {
      const [from, to] = [this.numberValue(node.arguments[0]), this.numberValue(node.arguments[1])];
      if (!from.int || !to.int) return fail("substring bounds that are not ints");
      return { node: block("text_substring_java", undefined, { value: this.textOperand(receiver), from: from.node, to: to.node }), type: "text" };
    }
    if (method === "isEmpty" && node.arguments.length === 0) return { node: block("text_is_empty", undefined, { value: this.textOperand(receiver) }), type: "logic" };
    if (method === "length" && node.arguments.length === 0) return { node: block("text_length", undefined, { value: this.textOperand(receiver) }), type: "number", int: true };
    if (method === "replace" && node.arguments.length === 2) {
      return { node: block("text_replace", undefined, { value: this.textOperand(receiver), find: this.textOperand(node.arguments[0]), with: this.textOperand(node.arguments[1]) }), type: "text" };
    }
    if (method === "format" && strip(receiver).k === "NEW_CLASS" && lastName(chain(strip(receiver).identifier)) === "DecimalFormat") {
      const formatter = strip(receiver);
      if (formatter.arguments.length !== 1 || node.arguments.length !== 1) return fail("DecimalFormat shape");
      return { node: block("text_decimal_format", undefined, { value: this.number(node.arguments[0]), pattern: this.textOperand(formatter.arguments[0]) }), type: "text" };
    }
    if (method === "getString" && strip(receiver).k === "NEW_CLASS" && lastName(chain(strip(receiver).identifier)) === "TranslationTextComponent") {
      if (strip(receiver).arguments.length !== 1) return fail("translation with arguments");
      return { node: block("text_translate", undefined, { key: this.textOperand(strip(receiver).arguments[0]) }), type: "text" };
    }
    return undefined;
  }

  /** A text operand of a text method: must be text already (a number would print differently). */
  private textOperand(node: Ast): InputValue {
    const value = this.value(node);
    return value.type === "text" ? value.node : fail(`text expected, got ${value.type}`);
  }

  private variableGet(name: string, args: Ast[]): Value {
    const v = this.variable(name);
    if (v.scope === "global_map" || v.scope === "global_world") {
      this.world(args[0]);
      return { node: this.need(`global_${v.type}_get`, { var: name }), type: v.type };
    }
    return { node: this.need(`player_${v.type}_get`, { var: name }, { entity: this.entity(args[0]) }), type: v.type };
  }

  /** `world.getLevelData().getGameRules().getInt(Mod.init.ModGameRules.RULE)`. */
  private gameRule(node: Ast): Value {
    const constant = lastName(chain(node.arguments[0]));
    const rule = this.options.gameRules?.find((id) => id.toUpperCase() === constant) ?? fail(`game rule ${constant}`);
    return { node: this.need("world_game_rule_number", { rule: camel(rule) }), type: "number", int: true };
  }

  // ---- item stacks, registries, block states ----

  private creation(node: Ast): Value {
    const type = lastName(chain(node.identifier));
    if (type === "ItemStack") return this.itemStack(node);
    return fail(`new ${type}`);
  }

  private itemStack(node: Ast): Value {
    if (node.arguments.length !== 1) return fail("item stack arguments");
    const source = this.value(node.arguments[0]);
    if (source.type === "randomitem") return { node: source.node, type: "itemstack" };
    if (source.type !== "itemref" && source.type !== "blockref") return fail("item stack source");
    return { node: block("item_stack", { item: source.id! }, { count: 1 }), type: "itemstack" };
  }

  /** `ForgeRegistries.ITEMS.getValue(new ResourceLocation("ns:id"))` and the same for blocks. */
  private registryCall(name: string, node: Ast): Value | undefined {
    const registry = /ForgeRegistries\.(ITEMS|BLOCKS)\.getValue$/.exec(name);
    if (registry) {
      const location = strip(node.arguments[0]);
      const id = location.k === "NEW_CLASS" && lastName(chain(location.identifier)) === "ResourceLocation" ? location.arguments[0]?.value : undefined;
      if (typeof id !== "string") return fail("registry id");
      return { node: "", type: registry[1] === "ITEMS" ? "itemref" : "blockref", id: itemId(id) };
    }
    if (/\.defaultBlockState$/.test(name)) {
      const ref = this.value((node.methodSelect as Ast).expression);
      if (ref.type !== "blockref") return fail("defaultBlockState of a non block");
      return { node: block("block_state_of", { block: ref.id! }), type: "blockstate" };
    }
    if (/\.asItem$/.test(name)) {
      const ref = this.value((node.methodSelect as Ast).expression);
      return ref.type === "blockref" ? { node: "", type: "itemref", id: ref.id } : fail("asItem of a non block");
    }
    return undefined;
  }

  /** `stack.getItem()`, `getCount()`, `getHoverName().getString()` on an item stack value. */
  private stackCall(method: string, node: Ast): Value | undefined {
    const receiver: Ast | undefined = (node.methodSelect as Ast).expression;
    if (!receiver || node.arguments.length !== 0) return undefined;
    if (method === "getItem") return { node: this.typed(receiver, "itemstack"), type: "itemof" };
    if (method === "getMaxDamage") return { node: block("item_max_damage", undefined, { itemstack: this.typed(receiver, "itemstack") }), type: "number", int: true };
    if (method === "getDamageValue") return { node: block("item_damage", undefined, { itemstack: this.typed(receiver, "itemstack") }), type: "number", int: true };
    if (method === "getRarity") return { node: this.typed(receiver, "itemstack"), type: "rarityof" };
    if (method === "getCount") return { node: block("item_count", undefined, { itemstack: this.typed(receiver, "itemstack") }), type: "number", int: true };
    const named = strip(receiver);
    if (method === "getString" && named.k === "METHOD_INVOCATION" && lastName(chain(named.methodSelect)) === "getHoverName") {
      return { node: block("item_name", undefined, { itemstack: this.typed(named.methodSelect.expression, "itemstack") }), type: "text" };
    }
    return undefined;
  }

  /** `world.getBlockState(pos)`. */
  private stateAt(node: Ast): Value {
    this.world(node.methodSelect.expression);
    const [x, y, z] = this.position(node.arguments[0]).map((n) => this.number(n));
    return { node: block("block_state_at", undefined, { x, y, z }), type: "blockstate" };
  }

  /** `world.getBlockState(new BlockPos(x, y, z)).getBlock()`: compared with a block by the block state check. */
  private blockOf(node: Ast): Value {
    return { node: this.stateAt(strip((node.methodSelect as Ast).expression)).node, type: "blockof" };
  }

  /** `new ResourceLocation("ns:id")` as its id. */
  private resourceName(node: Ast): string {
    const location = strip(node);
    const id = location.k === "NEW_CLASS" && lastName(chain(location.identifier)) === "ResourceLocation" ? location.arguments[0]?.value : undefined;
    return typeof id === "string" ? id : fail("resource location");
  }

  /** The one-method classes of MCreator, matched by their exact text. */
  private anonymousCall(node: Ast): Value | undefined {
    const select: Ast = node.methodSelect;
    const anonymous = select.expression ? strip(select.expression) : undefined;
    if (anonymous?.k !== "NEW_CLASS" || !anonymous.classBody || anonymous.classBody.members.length !== 1) return undefined;
    // MCreator numbers repeated names with trailing x's (_entx); the templates are written with the first.
    const text = java(anonymous.classBody.members[0]).replace(/\b_ent(?:x+)?\b/g, "_ent");
    const left = /^ int check\(Entity _entity\)\{if\(\(_entity instanceof LivingEntity\)\)\{for\(EffectInstance effect:\(\(LivingEntity\)_entity\)\.getActiveEffects\(\)\)\{if\(\(effect\.getEffect\(\)==net\.minecraftforge\.registries\.ForgeRegistries\.POTIONS\.getValue\(new net\.minecraft\.util\.ResourceLocation\("([^"]+)"\)\)\)\)\{return effect\.getDuration\(\);\}\}\}return 0;\}$/.exec(text);
    if (left) return { node: this.need("effect_ticks_left", { effect: left[1] }, { entity: this.entity(node.arguments[0]) }), type: "number", int: true };
    const typed = /^public Entity getEntity\(\)\{try\{return EntityArgument\.getEntity\(arguments,"(\w+)"\);\}catch\(CommandSyntaxException var\d+\)\{var\d+\.printStackTrace\(\);return null;\}\}$/.exec(text);
    if (typed) return { node: this.need("command_arg_entity", { name: typed[1] }), type: "entity" };
    if (text === ENERGY_STORED || text === ENERGY_CAPACITY) {
      this.world(node.arguments[0]);
      const [x, y, z] = this.position(node.arguments[1]).map((n) => this.number(n));
      return { node: this.need("block_energy", { what: text === ENERGY_CAPACITY ? "capacity" : "stored" }, { x, y, z }), type: "number", int: true };
    }
    if (/^ double convert\(String s\)\{try\{return Double\.parseDouble\(s\.trim\(\)\);\}catch\(Exception var\d+\)\{return 0;\}\}$/.test(text)) {
      return { node: block("math_from_text", undefined, { text: this.textOperand(node.arguments[0]) }), type: "number" };
    }
    if (text === RANDOM_ITEM) return { node: this.need("item_random_in_tag", { tag: this.resourceName(node.arguments[0]) }), type: "randomitem" };
    const read =(Object.keys(BLOCK_DATA_READ) as (keyof typeof BLOCK_DATA_READ)[]).find((type) => BLOCK_DATA_READ[type] === text);
    if (read) {
      this.world(node.arguments[0]);
      const [x, y, z] = this.position(node.arguments[1]).map((n) => this.number(n));
      return { node: this.need(`block_data_${read}`, undefined, { x, y, z, key: this.text(node.arguments[2]) }), type: read };
    }
    if (text === GUI_SLOT_ITEM) return { node: this.need("gui_slot_item", undefined, { entity: this.entity({ k: "IDENTIFIER", name: "entity" }), slot: this.number(node.arguments[0]) }), type: "itemstack" };
    if (text === GUI_SLOT_COUNT) {
      const stack = this.need("gui_slot_item", undefined, { entity: this.entity({ k: "IDENTIFIER", name: "entity" }), slot: this.number(node.arguments[0]) });
      return { node: block("item_count", undefined, { itemstack: stack }), type: "number", int: true };
    }
    if (text === BLOCK_SLOT_ITEM || text === BLOCK_SLOT_COUNT) {
      const count = text === BLOCK_SLOT_COUNT;
      const [x, y, z] = this.position(node.arguments[count ? 1 : 0]).map((n) => this.number(n));
      if (count) this.world(node.arguments[0]);
      else this.worldAt("world");
      const stack = this.need("block_slot_item", undefined, { x, y, z, slot: this.number(node.arguments[count ? 2 : 1]) });
      return count ? { node: block("item_count", undefined, { itemstack: stack }), type: "number", int: true } : { node: stack, type: "itemstack" };
    }
    return undefined;
  }
}

/** Types of the dependencies a procedure can take (model.ts), by name. */
const DEPENDENCY_TYPES: Record<string, string> = {
  x: "number", y: "number", z: "number", amount: "number", distance: "number", time: "number", slot: "number", hitX: "number", hitY: "number", hitZ: "number",
  entity: "entity", sourceentity: "entity", immediatesourceentity: "entity", itemstack: "itemstack", blockstate: "blockstate", oldState: "blockstate",
  direction: "direction", damagesource: "damagesource", moving: "logic", text: "text", command: "text",
};

/** The statements of the wrapped method of a JavaAst file. */
export function methodBody(unit: Ast): Ast[] {
  return unit.typeDecls[0].members.find((m: Ast) => m.k === "METHOD").body.statements;
}
