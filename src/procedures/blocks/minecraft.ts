import type { BlockDef, CodeArgs } from "../blockTypes.ts";
import { at, body, check, dir, dropdown, ent, idField, list, logic, num, pos, qid, qtag, source, stack, state, stmt, textField, txt, value, W, world, xyz } from "./dsl.ts";

/* Minecraft blocks: world, blocks, entities, players, items, effects, damage, projectiles, particles, sounds,
   commands, advancements, scoreboard, GUI and directions. */

const h = (c: CodeArgs, name: string) => c.h(name);
const S = (c: CodeArgs) => c.i.itemstack;
const SOUND_CATEGORIES = ["MASTER", "MUSIC", "RECORDS", "WEATHER", "BLOCKS", "HOSTILE", "NEUTRAL", "PLAYERS", "AMBIENT", "VOICE"];

const worldBlocks: BlockDef[] = [
  // Runs the blocks inside in another dimension's level, where "world" means that level; nothing runs when the level does
  // not exist or the procedure runs on a client. The compiler writes it (Compiler.inDimension).
  stmt("in_dimension", "world", "server", {
    special: true, deps: W, fields: [idField("dimension", "dimension", "minecraft:overworld")], inputs: [body()], code: () => "",
  }),
  value("world_time", "world", "both", "number", { deps: W, code: (c) => `${h(c, "dayTime")}(${world(c)})` }),
  stmt("world_set_time", "world", "server", { deps: W, inputs: [num("time", 1000)], code: (c) => `${h(c, "setTime")}(${world(c)}, ${c.i.time});` }),
  // Ticks since the world began, not wrapped to one day.
  value("world_total_day_time", "world", "both", "number", { deps: W, code: (c) => `${h(c, "totalDayTime")}(${world(c)})` }),
  value("world_can_see_sky_from_water", "world", "both", "logic", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.canSeeSkyFromBelowWater(${pos(c)})` }),
  value("world_raining_flag", "world", "both", "logic", { deps: W, code: (c) => `${h(c, "rainingFlag")}(${world(c)})` }),
  stmt("world_set_game_rule_number", "world", "server", { deps: W, fields: [textField("rule", "randomTickSpeed")], inputs: [num("value", 3)], code: (c) => `${h(c, "setGameRule")}(${world(c)}, ${c.s(String(c.f.rule))}, ${c.i.value});` }),
  value("world_is_day", "world", "both", "logic", { deps: W, code: (c) => `${h(c, "isDay")}(${world(c)})` }),
  value("world_is_raining", "world", "both", "logic", { deps: W, code: (c) => `${h(c, "raining")}(${world(c)}, false)` }),
  value("world_is_thundering", "world", "both", "logic", { deps: W, code: (c) => `${h(c, "raining")}(${world(c)}, true)` }),
  stmt("world_set_weather", "world", "server", {
    deps: W, fields: [dropdown("kind", ["clear", "rain", "thunder"])], inputs: [num("seconds", 300)],
    code: (c) => `${h(c, "setWeather")}(${world(c)}, ${c.s(String(c.f.kind))}, ${c.i.seconds});`,
  }),
  value("world_dimension_is", "world", "both", "logic", {
    deps: W, fields: [idField("dimension", "dimension", "minecraft:overworld")],
    code: (c) => `${h(c, "dimensionId")}(${world(c)}).equals(${qid(c, "dimension")})`,
  }),
  value("world_dimension_id", "world", "both", "text", { deps: W, code: (c) => `${h(c, "dimensionId")}(${world(c)})` }),
  value("world_is_client", "world", "both", "logic", { deps: W, code: (c) => `${world(c)}.isClientSide()` }),
  value("world_difficulty_is", "world", "both", "logic", {
    deps: W, fields: [dropdown("difficulty", ["PEACEFUL", "EASY", "NORMAL", "HARD"])],
    code: (c) => `${world(c)}.getDifficulty() == ${c.j.Difficulty}.${c.f.difficulty}`,
  }),
  value("world_player_count", "world", "both", "number", { deps: W, code: (c) => `${world(c)}.players().size()` }),
  value("world_game_rule_logic", "world", "server", "logic", {
    deps: W, fields: [textField("rule", "doDaylightCycle")],
    code: (c) => `${h(c, "gameRuleLogic")}(${world(c)}, ${c.s(String(c.f.rule))})`,
  }),
  value("world_game_rule_number", "world", "server", "number", {
    deps: W, fields: [textField("rule", "randomTickSpeed")],
    code: (c) => `${h(c, "gameRuleNumber")}(${world(c)}, ${c.s(String(c.f.rule))})`,
  }),
  stmt("world_explode", "world", "server", {
    deps: W, inputs: [...xyz(), num("power", 4)], fields: [dropdown("mode", ["break", "destroy", "none"])],
    code: (c) => `${h(c, "explode")}(${world(c)}, ${at(c)}, ${c.i.power}, ${c.s(String(c.f.mode))});`,
  }),
  stmt("world_lightning", "world", "server", {
    deps: W, inputs: xyz(), fields: [check("visual", false)],
    code: (c) => `${h(c, "lightning")}(${world(c)}, ${at(c)}, ${c.f.visual === true});`,
  }),
  stmt("world_broadcast", "world", "server", { deps: W, inputs: [txt("text", "Hello everyone")], code: (c) => `${h(c, "broadcast")}(${world(c)}, ${c.i.text});` }),
  stmt("world_spawn_entity", "world", "server", {
    deps: W, fields: [idField("type", "entity", "minecraft:pig")], inputs: [...xyz(), num("yaw", 0)],
    code: (c) => `${h(c, "spawnEntity")}(${world(c)}, ${qid(c, "type")}, ${at(c)}, ${c.i.yaw});`,
  }),
  value("world_spawn_entity_get", "world", "server", "entity", {
    deps: W, fields: [idField("type", "entity", "minecraft:pig")], inputs: [...xyz(), num("yaw", 0)],
    code: (c) => `${h(c, "spawnEntity")}(${world(c)}, ${qid(c, "type")}, ${at(c)}, ${c.i.yaw})`,
  }),
  stmt("world_drop_item", "world", "server", { deps: W, inputs: [...xyz(), stack()], code: (c) => `${h(c, "dropItem")}(${world(c)}, ${at(c)}, ${c.i.itemstack});` }),
  stmt("world_spawn_item", "world", "server", {
    deps: W, fields: [check("persistent", false)], inputs: [...xyz(), stack(), num("delay", 10)],
    code: (c) => `${h(c, "spawnItem")}(${world(c)}, ${at(c)}, ${c.i.itemstack}, ${c.i.delay}, ${c.f.persistent === true});`,
  }),
  stmt("world_spawn_xp", "world", "server", { deps: W, inputs: [...xyz(), num("amount", 5)], code: (c) => `${h(c, "spawnXp")}(${world(c)}, ${at(c)}, ${c.i.amount});` }),
  value("world_entity_count", "world", "both", "number", { deps: W, inputs: [...xyz(), num("range", 8)], code: (c) => `${h(c, "entitiesInRange")}(${world(c)}, ${at(c)}, ${c.i.range}).size()` }),
  value("world_nearest_entity", "world", "both", "entity", { deps: W, inputs: [...xyz(), num("range", 8)], code: (c) => `${h(c, "nearestEntity")}(${world(c)}, ${at(c)}, ${c.i.range}, null)` }),
  value("world_nearest_player", "world", "both", "entity", { deps: W, inputs: [...xyz(), num("range", 16)], code: (c) => `${world(c)}.getNearestPlayer(${at(c)}, ${c.i.range}, false)` }),
  value("world_biome_is", "world", "both", "logic", {
    deps: W, inputs: xyz(), fields: [idField("biome", "biome", "minecraft:plains")],
    code: (c) => `${h(c, "biomeIs")}(${world(c)}, ${at(c)}, ${qid(c, "biome")})`,
  }),
  value("world_height_at", "world", "both", "number", {
    deps: W, inputs: [num("x", 0), num("z", 0)],
    code: (c) => `${world(c)}.getHeight(${c.j.Heightmap}.${c.gen === "1.16.5" ? "Type" : "Types"}.MOTION_BLOCKING, (int) Math.floor(${c.i.x}), (int) Math.floor(${c.i.z}))`,
  }),
  // The entity of a kind nearest to a point among those inside a box; no entity when there is none.
  value("world_nearest_entity_in_box", "world", "both", "entity", {
    deps: W, fields: [dropdown("kind", ["player", "server_player", "item"])],
    inputs: [num("x1", 0), num("y1", 0), num("z1", 0), num("x2", 1), num("y2", 1), num("z2", 1), num("x", 0), num("y", 0), num("z", 0)],
    code: (c) => `${h(c, "nearestInBox")}(${world(c)}, ${c.s(String(c.f.kind))}, ${c.i.x1}, ${c.i.y1}, ${c.i.z1}, ${c.i.x2}, ${c.i.y2}, ${c.i.z2}, ${c.i.x}, ${c.i.y}, ${c.i.z})`,
  }),
  value("world_light_at", "world", "both", "number", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.getMaxLocalRawBrightness(${pos(c)})` }),
  value("world_can_see_sky", "world", "both", "logic", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.canSeeSky(${pos(c)})` }),
  value("world_redstone_power", "world", "both", "number", { deps: W, inputs: xyz(), code: (c) => `${h(c, "redstone")}(${world(c)}, ${at(c)})` }),
  value("world_chunk_loaded", "world", "both", "logic", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.hasChunkAt(${pos(c)})` }),
];

const DATA_TYPES = { number: "Number", logic: "Logic", text: "Text" } as const;
const dataValue = (type: keyof typeof DATA_TYPES) => (type === "number" ? num("value", 0) : type === "logic" ? logic("value", true) : txt("value", ""));

const blockBlocks: BlockDef[] = [
  // Values kept at a block position (see helpers blockData*): readable on both sides, written on the server only.
  ...(Object.keys(DATA_TYPES) as (keyof typeof DATA_TYPES)[]).flatMap((type) => [
    value(`block_data_${type}`, "blocks", "both", type, {
      deps: W, inputs: [...xyz(), txt("key", "")], code: (c) => `${h(c, `blockData${DATA_TYPES[type]}`)}(${world(c)}, ${at(c)}, ${c.i.key})`,
    }),
    // On the client this does nothing, as the MCreator template it replaces.
    stmt(`block_set_data_${type}`, "blocks", "both", {
      deps: W, inputs: [...xyz(), txt("key", ""), dataValue(type)], code: (c) => `${h(c, `setBlockData${DATA_TYPES[type]}`)}(${world(c)}, ${at(c)}, ${c.i.key}, ${c.i.value});`,
    }),
  ]),
  value("block_slot_item", "blocks", "both", "itemstack", { deps: W, inputs: [...xyz(), num("slot", 0)], code: (c) => `${h(c, "blockSlotItem")}(${world(c)}, ${at(c)}, ${c.i.slot})` }),
  stmt("block_set_slot_item", "blocks", "both", {
    deps: W, inputs: [...xyz(), num("slot", 0), stack()], code: (c) => `${h(c, "setBlockSlotItem")}(${world(c)}, ${at(c)}, ${c.i.slot}, ${c.i.itemstack});`,
  }),
  stmt("block_place", "blocks", "server", {
    deps: W, fields: [idField("block", "block", "minecraft:stone")], inputs: xyz(),
    code: (c) => `${world(c)}.setBlock(${pos(c)}, ${h(c, "blockState")}(${qid(c, "block")}), 3);`,
  }),
  stmt("block_break_dropping", "blocks", "server", { deps: W, inputs: xyz(), code: (c) => `${h(c, "breakDropping")}(${world(c)}, ${at(c)});` }),
  stmt("block_set_property", "blocks", "server", { deps: W, fields: [textField("property", "power")], inputs: [...xyz(), num("value", 15)], code: (c) => `${h(c, "setBlockProperty")}(${world(c)}, ${at(c)}, ${c.s(String(c.f.property))}, ${c.i.value});` }),
  stmt("block_set_property_logic", "blocks", "server", { deps: W, fields: [textField("property", "powered")], inputs: [...xyz(), logic("value", true)], code: (c) => `${h(c, "setBlockPropertyLogic")}(${world(c)}, ${at(c)}, ${c.s(String(c.f.property))}, ${c.i.value});` }),
  stmt("block_place_keeping", "blocks", "server", {
    deps: W, fields: [idField("block", "block", "minecraft:stone"), check("data", true)], inputs: xyz(),
    code: (c) => `${h(c, "placeKeeping")}(${world(c)}, ${at(c)}, ${qid(c, "block")}, ${c.f.data !== false});`,
  }),
  stmt("block_place_state", "blocks", "server", { deps: W, inputs: [state(), ...xyz()], code: (c) => `${world(c)}.setBlock(${pos(c)}, ${c.i.blockstate}, 3);` }),
  stmt("block_remove", "blocks", "server", { deps: W, inputs: xyz(), fields: [check("drop", true)], code: (c) => `${world(c)}.destroyBlock(${pos(c)}, ${c.f.drop === true});` }),
  value("block_at_is", "blocks", "both", "logic", {
    deps: W, inputs: xyz(), fields: [idField("block", "block", "minecraft:stone")],
    code: (c) => `${world(c)}.getBlockState(${pos(c)}).getBlock() == ${h(c, "block")}(${qid(c, "block")})`,
  }),
  value("block_state_at", "blocks", "both", "blockstate", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.getBlockState(${pos(c)})` }),
  value("block_id_at", "blocks", "both", "text", { deps: W, inputs: xyz(), code: (c) => `${h(c, "blockId")}(${world(c)}.getBlockState(${pos(c)}))` }),
  value("block_is_air", "blocks", "both", "logic", { deps: W, inputs: xyz(), code: (c) => `${world(c)}.isEmptyBlock(${pos(c)})` }),
  value("block_is_fluid", "blocks", "both", "logic", { deps: W, inputs: xyz(), code: (c) => `!${world(c)}.getFluidState(${pos(c)}).isEmpty()` }),
  value("block_hardness", "blocks", "both", "number", { deps: W, inputs: xyz(), code: (c) => `${h(c, "hardness")}(${world(c)}, ${at(c)})` }),
  value("block_in_tag", "blocks", "both", "logic", { inputs: [state()], fields: [idField("tag", "tag", "minecraft:logs")], code: (c) => `${h(c, "blockInTag")}(${c.i.blockstate}, ${qtag(c, "tag")})` }),
  value("block_state_of", "blocks", "both", "blockstate", { fields: [idField("block", "block", "minecraft:stone")], code: (c) => `${h(c, "blockState")}(${qid(c, "block")})` }),
  value("block_state_id", "blocks", "both", "text", { inputs: [state()], code: (c) => `${h(c, "blockId")}(${c.i.blockstate})` }),
  value("block_state_is", "blocks", "both", "logic", {
    inputs: [state()], fields: [idField("block", "block", "minecraft:stone")],
    code: (c) => `${c.i.blockstate}.getBlock() == ${h(c, "block")}(${qid(c, "block")})`,
  }),
  // Materials went away with 1.20, so this exists for 1.16.5 only.
  value("block_material_is", "blocks", "both", "logic", {
    inputs: [state()], fields: [dropdown("material", ["STONE"])],
    // Materials left the game in 1.20; what a pickaxe mines is the nearest modern set to stone material.
    code: { "1.16.5": (c) => `${c.i.blockstate}.getMaterial() == net.minecraft.block.material.Material.${c.f.material}`, modern: (c) => `${c.i.blockstate}.is(${c.j.BlockTags}.MINEABLE_WITH_PICKAXE)` },
  }),
  value("block_state_number", "blocks", "both", "number", { inputs: [state()], fields: [textField("property", "age")], code: (c) => `${h(c, "stateNumber")}(${c.i.blockstate}, ${c.s(String(c.f.property))})` }),
  value("block_state_logic", "blocks", "both", "logic", { inputs: [state()], fields: [textField("property", "lit")], code: (c) => `${h(c, "stateLogic")}(${c.i.blockstate}, ${c.s(String(c.f.property))})` }),
  value("block_state_text", "blocks", "both", "text", { inputs: [state()], fields: [textField("property", "facing")], code: (c) => `${h(c, "stateText")}(${c.i.blockstate}, ${c.s(String(c.f.property))})` }),
  value("block_state_with", "blocks", "both", "blockstate", {
    inputs: [state(), txt("value", "true")], fields: [textField("property", "lit")],
    code: (c) => `${h(c, "stateWith")}(${c.i.blockstate}, ${c.s(String(c.f.property))}, ${c.i.value})`,
  }),
  stmt("block_bonemeal", "blocks", "server", { deps: W, inputs: xyz(), code: (c) => `${h(c, "bonemeal")}(${world(c)}, ${at(c)});` }),
  stmt("block_schedule_tick", "blocks", "server", { deps: W, inputs: [...xyz(), num("ticks", 10)], code: (c) => `${h(c, "scheduleTick")}(${world(c)}, ${at(c)}, ${c.i.ticks});` }),
];

const E = (c: CodeArgs) => c.i.entity;
const entityBlocks: BlockDef[] = [
  value("entity_x", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getX()` }),
  value("entity_y", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getY()` }),
  value("entity_z", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getZ()` }),
  value("entity_look_block", "entity", "both", "number", {
    inputs: [ent(), num("distance", 5)], fields: [dropdown("axis", ["X", "Y", "Z"]), dropdown("shape", ["collider", "outline"])],
    code: (c) => `${h(c, "lookBlock")}(${E(c)}, ${c.i.distance}, ${c.s(String(c.f.axis))}, ${c.f.shape === "outline"})`,
  }),
  value("entity_eye_y", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getEyeY()` }),
  value("entity_look_x", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getLookAngle().x` }),
  value("entity_look_y", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getLookAngle().y` }),
  value("entity_look_z", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getLookAngle().z` }),
  value("entity_yaw", "entity", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "yaw")}(${E(c)})` }),
  value("entity_pitch", "entity", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "pitch")}(${E(c)})` }),
  stmt("entity_set_rotation", "entity", "both", { inputs: [ent(), num("yaw", 0), num("pitch", 0)], code: (c) => `${h(c, "setRotation")}(${E(c)}, ${c.i.yaw}, ${c.i.pitch});` }),
  value("entity_velocity_x", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getDeltaMovement().x` }),
  value("entity_velocity_y", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getDeltaMovement().y` }),
  value("entity_velocity_z", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getDeltaMovement().z` }),
  stmt("entity_set_velocity", "entity", "both", {
    inputs: [ent(), num("vx", 0), num("vy", 0.5), num("vz", 0)],
    code: (c) => `${E(c)}.setDeltaMovement(${c.i.vx}, ${c.i.vy}, ${c.i.vz});\n${E(c)}.${c.gen === "26.3" ? "needsSync" : "hurtMarked"} = true;`,
  }),
  stmt("entity_push", "entity", "both", {
    inputs: [ent(), num("vx", 0), num("vy", 0.5), num("vz", 0)],
    code: (c) => `${E(c)}.push(${c.i.vx}, ${c.i.vy}, ${c.i.vz});\n${E(c)}.${c.gen === "26.3" ? "needsSync" : "hurtMarked"} = true;`,
  }),
  value("entity_health", "entity", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "health")}(${E(c)})` }),
  value("entity_max_health", "entity", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "maxHealth")}(${E(c)})` }),
  stmt("entity_set_health", "entity", "server", { inputs: [ent(), num("health", 20)], code: (c) => `${h(c, "setHealth")}(${E(c)}, ${c.i.health});` }),
  stmt("entity_heal", "entity", "server", { inputs: [ent(), num("amount", 4)], code: (c) => `${h(c, "heal")}(${E(c)}, ${c.i.amount});` }),
  value("entity_is_alive", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isAlive()` }),
  value("entity_on_ground", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${h(c, "onGround")}(${E(c)})` }),
  value("entity_in_water", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isInWater()` }),
  value("entity_on_fire", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isOnFire()` }),
  value("entity_sneaking", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isShiftKeyDown()` }),
  value("entity_sprinting", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isSprinting()` }),
  value("entity_is_player", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)} instanceof ${c.j.Player}` }),
  value("entity_is_animal", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)} instanceof ${c.j.Animal}` }),
  value("entity_is_monster", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)} instanceof ${c.j.Monster}` }),
  value("entity_is_living", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)} instanceof ${c.j.LivingEntity}` }),
  value("entity_is_baby", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${h(c, "isBaby")}(${E(c)})` }),
  value("entity_is_tamed", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${h(c, "isTamed")}(${E(c)})` }),
  stmt("entity_tame", "entity", "server", { inputs: [ent(), ent("owner")], code: (c) => `${h(c, "tame")}(${E(c)}, ${c.i.owner});` }),
  value("entity_type_is", "entity", "both", "logic", {
    inputs: [ent()], fields: [idField("type", "entity", "minecraft:zombie")],
    code: (c) => `${h(c, "entityId")}(${E(c)}).equals(${qid(c, "type")})`,
  }),
  value("entity_type_id", "entity", "both", "text", { inputs: [ent()], code: (c) => `${h(c, "entityId")}(${E(c)})` }),
  value("entity_in_tag", "entity", "both", "logic", { inputs: [ent()], fields: [idField("tag", "tag", "minecraft:skeletons")], code: (c) => `${h(c, "entityInTag")}(${E(c)}, ${qtag(c, "tag")})` }),
  value("entity_name", "entity", "both", "text", { inputs: [ent()], code: (c) => `${E(c)}.getName().getString()` }),
  value("entity_display_name", "entity", "both", "text", { inputs: [ent()], code: (c) => `${E(c)}.getDisplayName().getString()` }),
  value("entity_uuid", "entity", "both", "text", { inputs: [ent()], code: (c) => `${E(c)}.getStringUUID()` }),
  stmt("entity_set_name", "entity", "server", { inputs: [ent(), txt("name", "Bob")], code: (c) => `${E(c)}.setCustomName(${h(c, "component")}(${c.i.name}));` }),
  stmt("entity_set_fire", "entity", "server", { inputs: [ent(), num("seconds", 5)], code: (c) => `${h(c, "setFire")}(${E(c)}, ${c.i.seconds});` }),
  stmt("entity_extinguish", "entity", "server", { inputs: [ent()], code: (c) => `${E(c)}.clearFire();` }),
  stmt("entity_kill", "entity", "server", { inputs: [ent()], code: (c) => `${h(c, "kill")}(${E(c)});` }),
  stmt("entity_despawn", "entity", "server", { inputs: [ent()], code: (c) => `${h(c, "despawn")}(${E(c)});` }),
  stmt("entity_teleport", "entity", "server", { inputs: [ent(), ...xyz()], code: (c) => `${h(c, "teleport")}(${E(c)}, ${at(c)});` }),
  stmt("entity_set_no_gravity", "entity", "server", { inputs: [ent(), logic("value", true)], code: (c) => `${E(c)}.setNoGravity(${c.i.value});` }),
  stmt("entity_set_invisible", "entity", "server", { inputs: [ent(), logic("value", true)], code: (c) => `${E(c)}.setInvisible(${c.i.value});` }),
  stmt("entity_set_glowing", "entity", "server", {
    inputs: [ent(), logic("value", true)],
    code: { "1.16.5": (c) => `${E(c)}.setGlowing(${c.i.value});`, modern: (c) => `${E(c)}.setGlowingTag(${c.i.value});` },
  }),
  value("entity_vehicle", "entity", "both", "entity", { inputs: [ent()], code: (c) => `${E(c)}.getVehicle()` }),
  stmt("entity_ride", "entity", "server", { inputs: [ent(), ent("vehicle")], code: (c) => `${E(c)}.startRiding(${c.i.vehicle});` }),
  stmt("entity_dismount", "entity", "server", { inputs: [ent()], code: (c) => `${E(c)}.stopRiding();` }),
  value("entity_target", "entity", "both", "entity", { inputs: [ent()], code: (c) => `${h(c, "target")}(${E(c)})` }),
  stmt("entity_set_target", "entity", "server", { inputs: [ent(), ent("target")], code: (c) => `${h(c, "setTarget")}(${E(c)}, ${c.i.target});` }),
  value("entity_distance", "entity", "both", "number", { inputs: [ent("a"), ent("b")], code: (c) => `${c.i.a}.distanceTo(${c.i.b})` }),
  value("entity_distance_to", "entity", "both", "number", { inputs: [ent(), ...xyz()], code: (c) => `Math.sqrt(${E(c)}.distanceToSqr(${at(c)}))` }),
  value("entity_air", "entity", "both", "number", { inputs: [ent()], code: (c) => `${E(c)}.getAirSupply()` }),
  stmt("entity_set_air", "entity", "server", { inputs: [ent(), num("air", 300)], code: (c) => `${E(c)}.setAirSupply((int) ${c.i.air});` }),
  value("entity_has_passengers", "entity", "both", "logic", { inputs: [ent()], code: (c) => `${E(c)}.isVehicle()` }),
  stmt("entity_run_command", "commands", "server", { inputs: [ent(), txt("command", "say hi")], code: (c) => `${h(c, "runCommandAs")}(${E(c)}, ${c.i.command});` }),
  // Entity data entries of this mod's living entities (synced to clients, saved with the entity).
  ...(["number", "logic", "text"] as const).flatMap((type) => [
    value(`entity_data_get_${type}`, "entity", "both", type, {
      inputs: [ent()], fields: [idField("mob", "entity", ""), textField("name", "")],
      code: (c) => {
        const cls = mobClass(c);
        const fallback = type === "number" ? "0" : type === "logic" ? "false" : '""';
        return cls ? `(${E(c)} instanceof ${cls} ? ((${cls}) ${E(c)}).getEntityData().get(${cls}.DATA_${String(c.f.name)}) : ${fallback})` : fallback;
      },
    }),
    stmt(`entity_data_set_${type}`, "entity", "server", {
      inputs: [ent(), type === "number" ? num("value", 0) : type === "logic" ? logic("value", true) : txt("value", "")], fields: [idField("mob", "entity", ""), textField("name", "")],
      code: (c) => {
        const cls = mobClass(c);
        const v = type === "number" ? `(int) (${c.i.value})` : c.i.value;
        return cls ? `if (${E(c)} instanceof ${cls}) ((${cls}) ${E(c)}).getEntityData().set(${cls}.DATA_${String(c.f.name)}, ${v});` : "";
      },
    }),
  ]),
];

/** Class of the living entity element a "mob" field names; undefined for other mods' and vanilla entities. */
function mobClass(c: CodeArgs): string | undefined {
  const id = String(c.f.mob ?? "");
  const [ns, path] = id.includes(":") ? id.split(":") : [c.modId, id];
  if (ns !== c.modId || !/^[a-z0-9_]+$/.test(path ?? "") || !/^[a-z0-9_]+$/.test(String(c.f.name ?? ""))) return undefined;
  return `${c.pkg}.entity.${path.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("")}LivingEntity`;
}

const SLOTS = ["head", "chest", "legs", "feet", "mainhand", "offhand"];
const playerBlocks: BlockDef[] = [
  stmt("player_message", "player", "server", {
    inputs: [ent(), txt("text", "Hello")], fields: [check("actionbar", false)],
    code: (c) => `${h(c, "chat")}(${E(c)}, ${c.i.text}, ${c.f.actionbar === true});`,
  }),
  // The client translates: the key and arguments travel in the component, so a server without the mod's language files still shows text.
  stmt("player_message_translated", "player", "server", {
    inputs: [ent(), txt("key", ""), list("args")], fields: [check("actionbar", false)],
    code: (c) => `${h(c, "chatTranslated")}(${E(c)}, ${c.i.key}, ${c.i.args}, ${c.f.actionbar === true});`,
  }),
  stmt("player_title", "player", "server", { inputs: [ent(), txt("title", "Title"), txt("subtitle", "")], code: (c) => `${h(c, "title")}(${E(c)}, ${c.i.title}, ${c.i.subtitle});` }),
  stmt("player_give", "player", "server", { inputs: [ent(), stack()], code: (c) => `${h(c, "giveItem")}(${E(c)}, ${c.i.itemstack});` }),
  value("player_has_item", "player", "both", "logic", { inputs: [ent()], fields: [idField("item", "item", "minecraft:diamond")], code: (c) => `${h(c, "countItem")}(${E(c)}, ${qid(c, "item")}) > 0` }),
  value("player_item_count", "player", "both", "number", { inputs: [ent()], fields: [idField("item", "item", "minecraft:diamond")], code: (c) => `${h(c, "countItem")}(${E(c)}, ${qid(c, "item")})` }),
  stmt("player_remove_item", "player", "server", {
    inputs: [ent(), num("amount", 1)], fields: [idField("item", "item", "minecraft:diamond")],
    code: (c) => `${h(c, "removeItem")}(${E(c)}, ${qid(c, "item")}, ${c.i.amount});`,
  }),
  stmt("player_clear_matching", "player", "both", { inputs: [ent(), stack(), num("amount", 1)], code: (c) => `${h(c, "clearMatching")}(${E(c)}, ${S(c)}, ${c.i.amount});` }),
  value("player_has_stack", "player", "both", "logic", { inputs: [ent(), stack()], code: (c) => `${h(c, "hasStack")}(${E(c)}, ${S(c)})` }),
  value("entity_count_item", "player", "both", "number", { inputs: [ent(), stack()], code: (c) => `${h(c, "countLike")}(${E(c)}, ${S(c)})` }),
  stmt("block_use", "blocks", "both", { deps: W, inputs: [ent(), ...xyz()], code: (c) => `${h(c, "useBlock")}(${E(c)}, ${at(c)});` }),
  stmt("player_clear_inventory", "player", "server", { inputs: [ent()], code: (c) => `${h(c, "clearInventory")}(${E(c)});` }),
  value("player_hand_item", "player", "both", "itemstack", { inputs: [ent()], fields: [dropdown("hand", ["main", "off"])], code: (c) => `${h(c, "handItem")}(${E(c)}, ${c.f.hand !== "off"})` }),
  stmt("player_set_hand_item", "player", "server", {
    inputs: [ent(), stack()], fields: [dropdown("hand", ["main", "off"])],
    code: (c) => `${h(c, "setHandItem")}(${E(c)}, ${c.f.hand !== "off"}, ${c.i.itemstack});`,
  }),
  value("player_slot_item", "player", "both", "itemstack", { inputs: [ent()], fields: [dropdown("slot", SLOTS)], code: (c) => `${h(c, "slotItem")}(${E(c)}, ${c.s(String(c.f.slot))})` }),
  stmt("player_set_slot_item", "player", "server", {
    inputs: [ent(), stack()], fields: [dropdown("slot", SLOTS)],
    code: (c) => `${h(c, "setSlotItem")}(${E(c)}, ${c.s(String(c.f.slot))}, ${c.i.itemstack});`,
  }),
  value("player_gamemode_is", "player", "server", "logic", {
    inputs: [ent()], fields: [dropdown("mode", ["survival", "creative", "adventure", "spectator"])],
    code: (c) => `${h(c, "gameMode")}(${E(c)}).equals(${c.s(String(c.f.mode))})`,
  }),
  stmt("player_set_gamemode", "player", "server", {
    inputs: [ent()], fields: [dropdown("mode", ["survival", "creative", "adventure", "spectator"])],
    code: (c) => `${h(c, "setGameMode")}(${E(c)}, ${c.s(String(c.f.mode))});`,
  }),
  value("player_is_creative", "player", "both", "logic", { inputs: [ent()], code: (c) => `${h(c, "isCreative")}(${E(c)})` }),
  value("entity_has_permission", "player", "both", "logic", { inputs: [ent(), num("level", 2)], code: (c) => `${h(c, "hasPermission")}(${E(c)}, ${c.i.level})` }),
  value("player_is_op", "player", "server", "logic", { inputs: [ent()], code: (c) => `${h(c, "isOp")}(${E(c)})` }),
  value("player_xp_level", "player", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "xpLevel")}(${E(c)})` }),
  stmt("player_add_levels", "player", "server", { inputs: [ent(), num("levels", 1)], code: (c) => `${h(c, "addXpLevels")}(${E(c)}, ${c.i.levels});` }),
  stmt("player_add_xp", "player", "server", { inputs: [ent(), num("points", 10)], code: (c) => `${h(c, "addXp")}(${E(c)}, ${c.i.points});` }),
  value("player_food", "player", "both", "number", { inputs: [ent()], code: (c) => `${h(c, "food")}(${E(c)})` }),
  stmt("player_set_food", "player", "server", { inputs: [ent(), num("food", 20)], code: (c) => `${h(c, "setFood")}(${E(c)}, ${c.i.food});` }),
  stmt("player_set_saturation", "player", "server", { inputs: [ent(), num("saturation", 5)], code: (c) => `${h(c, "setSaturation")}(${E(c)}, ${c.i.saturation});` }),
  stmt("player_set_flying", "player", "server", { inputs: [ent(), logic("allowed", true)], code: (c) => `${h(c, "setFlying")}(${E(c)}, ${c.i.allowed});` }),
];

const itemBlocks: BlockDef[] = [
  value("item_stack", "items", "both", "itemstack", { fields: [idField("item", "item", "minecraft:diamond")], inputs: [num("count", 1)], code: (c) => `${h(c, "stack")}(${qid(c, "item")}, ${c.i.count})` }),
  value("item_random_in_tag", "items", "both", "itemstack", { fields: [idField("tag", "tag", "minecraft:logs")], code: (c) => `${h(c, "randomItemInTag")}(${qtag(c, "tag")})` }),
  value("item_empty", "items", "both", "itemstack", { code: (c) => `${c.j.ItemStack}.EMPTY` }),
  value("item_count", "items", "both", "number", { inputs: [stack()], code: (c) => `${S(c)}.getCount()` }),
  stmt("item_set_count", "items", "both", { inputs: [stack(), num("count", 1)], code: (c) => `${S(c)}.setCount((int) ${c.i.count});` }),
  stmt("item_grow", "items", "both", { inputs: [stack(), num("amount", 1)], code: (c) => `${S(c)}.grow((int) ${c.i.amount});` }),
  stmt("item_shrink", "items", "both", { inputs: [stack(), num("amount", 1)], code: (c) => `${S(c)}.shrink((int) ${c.i.amount});` }),
  value("item_id", "items", "both", "text", { inputs: [stack()], code: (c) => `${h(c, "itemId")}(${S(c)})` }),
  value("item_is", "items", "both", "logic", { inputs: [stack()], fields: [idField("item", "item", "minecraft:diamond")], code: (c) => `${S(c)}.getItem() == ${h(c, "item")}(${qid(c, "item")})` }),
  value("item_is_empty", "items", "both", "logic", { inputs: [stack()], code: (c) => `${S(c)}.isEmpty()` }),
  value("item_name", "items", "both", "text", { inputs: [stack()], code: (c) => `${h(c, "stackName")}(${S(c)})` }),
  stmt("item_set_name", "items", "both", { inputs: [stack(), txt("name", "Shiny")], code: (c) => `${h(c, "setStackName")}(${S(c)}, ${c.i.name});` }),
  value("item_damage", "items", "both", "number", { inputs: [stack()], code: (c) => `${S(c)}.getDamageValue()` }),
  value("item_max_damage", "items", "both", "number", { inputs: [stack()], code: (c) => `${S(c)}.getMaxDamage()` }),
  stmt("item_set_damage", "items", "both", { inputs: [stack(), num("damage", 0)], code: (c) => `${S(c)}.setDamageValue((int) ${c.i.damage});` }),
  stmt("item_damage_by", "items", "server", { deps: W, inputs: [stack(), num("amount", 1)], code: (c) => `${h(c, "damageStack")}(${S(c)}, ${c.i.amount}, ${world(c)});` }),
  stmt("item_hurt_break", "items", "both", { deps: W, inputs: [stack(), num("amount", 1)], code: { "1.16.5": (c) => `${h(c, "hurtBreak")}(${S(c)}, ${c.i.amount});`, modern: (c) => `${h(c, "hurtBreak")}(${world(c)}, ${S(c)}, ${c.i.amount});` } }),
  value("item_is_damageable", "items", "both", "logic", { inputs: [stack()], code: (c) => `${S(c)}.isDamageableItem()` }),
  stmt("item_enchant", "items", "both", {
    deps: W, inputs: [stack(), num("level", 1)], fields: [idField("enchantment", "enchantment", "minecraft:sharpness")],
    code: (c) => `${h(c, "enchant")}(${world(c)}, ${S(c)}, ${qid(c, "enchantment")}, ${c.i.level});`,
  }),
  value("item_enchant_level", "items", "both", "number", {
    deps: W, inputs: [stack()], fields: [idField("enchantment", "enchantment", "minecraft:sharpness")],
    code: (c) => `${h(c, "enchantLevel")}(${world(c)}, ${S(c)}, ${qid(c, "enchantment")})`,
  }),
  value("item_is_enchanted", "items", "both", "logic", { inputs: [stack()], code: (c) => `${S(c)}.isEnchanted()` }),
  value("item_copy", "items", "both", "itemstack", { inputs: [stack()], code: (c) => `${S(c)}.copy()` }),
  value("item_rarity_is", "items", "both", "logic", {
    inputs: [stack()], fields: [dropdown("rarity", ["COMMON", "UNCOMMON", "RARE", "EPIC"])],
    code: (c) => `${S(c)}.getRarity() == ${c.gen === "1.16.5" ? "net.minecraft.item" : "net.minecraft.world.item"}.Rarity.${c.f.rarity}`,
  }),
  // 1.16.5 tests the item's class; later versions have no tool classes and test the tool tags instead.
  value("item_is_tool", "items", "both", "logic", {
    inputs: [stack()], fields: [dropdown("tool", ["pickaxe", "hoe", "axe", "shovel", "sword"])],
    code: {
      "1.16.5": (c) => `${S(c)}.getItem() instanceof net.minecraft.item.${{ pickaxe: "PickaxeItem", hoe: "HoeItem", axe: "AxeItem", shovel: "ShovelItem", sword: "SwordItem" }[String(c.f.tool)] ?? "PickaxeItem"}`,
      modern: (c) => `${S(c)}.is(${c.j.ItemTags}.${{ pickaxe: "PICKAXES", hoe: "HOES", axe: "AXES", shovel: "SHOVELS", sword: "SWORDS" }[String(c.f.tool)] ?? "PICKAXES"})`,
    },
  }),
  value("item_in_tag", "items", "both", "logic", { inputs: [stack()], fields: [idField("tag", "tag", "minecraft:logs")], code: (c) => `${h(c, "itemInTag")}(${S(c)}, ${qtag(c, "tag")})` }),
  value("item_is_food", "items", "both", "logic", {
    inputs: [stack()],
    code: { "1.16.5": (c) => `${S(c)}.isEdible()`, modern: (c) => `${S(c)}.has(${c.j.DataComponents}.FOOD)` },
  }),
  stmt("item_cooldown", "items", "server", { inputs: [ent(), stack(), num("ticks", 20)], code: (c) => `${h(c, "cooldown")}(${E(c)}, ${S(c)}, ${c.i.ticks});` }),
  value("item_on_cooldown", "items", "both", "logic", { inputs: [ent(), stack()], code: (c) => `${h(c, "onCooldown")}(${E(c)}, ${S(c)})` }),
  value("item_data_number", "items", "both", "number", { inputs: [stack()], fields: [textField("key", "charge")], code: (c) => `${h(c, "stackDataNumber")}(${S(c)}, ${c.s(String(c.f.key))})` }),
  value("item_data_text", "items", "both", "text", { inputs: [stack()], fields: [textField("key", "owner")], code: (c) => `${h(c, "stackDataText")}(${S(c)}, ${c.s(String(c.f.key))})` }),
  value("item_data_logic", "items", "both", "logic", { inputs: [stack()], fields: [textField("key", "active")], code: (c) => `${h(c, "stackDataLogic")}(${S(c)}, ${c.s(String(c.f.key))})` }),
  stmt("item_set_data_number", "items", "both", { inputs: [stack(), num("value", 0)], fields: [textField("key", "charge")], code: (c) => `${h(c, "setStackData")}(${S(c)}, ${c.s(String(c.f.key))}, (Object) Double.valueOf(${c.i.value}));` }),
  stmt("item_set_data_text", "items", "both", { inputs: [stack(), txt("value", "")], fields: [textField("key", "owner")], code: (c) => `${h(c, "setStackData")}(${S(c)}, ${c.s(String(c.f.key))}, (Object) ${c.i.value});` }),
  stmt("item_set_data_logic", "items", "both", { inputs: [stack(), logic("value", true)], fields: [textField("key", "active")], code: (c) => `${h(c, "setStackData")}(${S(c)}, ${c.s(String(c.f.key))}, (Object) Boolean.valueOf(${c.i.value}));` }),
];

const effectBlocks: BlockDef[] = [
  stmt("effect_add", "effects", "server", {
    inputs: [ent(), num("seconds", 30), num("level", 1)], fields: [idField("effect", "effect", "minecraft:speed"), check("ambient", false), check("particles", true)],
    code: (c) => `${h(c, "addEffect")}(${E(c)}, ${qid(c, "effect")}, ${c.i.seconds}, ${c.i.level}, ${c.f.ambient === true}, ${c.f.particles !== false});`,
  }),
  stmt("effect_add_ticks", "effects", "both", {
    inputs: [ent(), num("ticks", 100), num("amplifier", 0)], fields: [idField("effect", "effect", "minecraft:speed"), check("ambient", false), check("particles", true)],
    code: (c) => `${h(c, "addEffectTicks")}(${E(c)}, ${qid(c, "effect")}, ${c.i.ticks}, ${c.i.amplifier}, ${c.f.ambient === true}, ${c.f.particles !== false});`,
  }),
  stmt("effect_remove", "effects", "server", { inputs: [ent()], fields: [idField("effect", "effect", "minecraft:speed")], code: (c) => `${h(c, "removeEffect")}(${E(c)}, ${qid(c, "effect")});` }),
  stmt("effect_clear", "effects", "server", { inputs: [ent()], code: (c) => `${h(c, "clearEffects")}(${E(c)});` }),
  value("effect_ticks_left", "effects", "both", "number", { inputs: [ent()], fields: [idField("effect", "effect", "minecraft:speed")], code: (c) => `${h(c, "effectTicksLeft")}(${E(c)}, ${qid(c, "effect")})` }),
  value("effect_has", "effects", "both", "logic", { inputs: [ent()], fields: [idField("effect", "effect", "minecraft:speed")], code: (c) => `${h(c, "hasEffect")}(${E(c)}, ${qid(c, "effect")})` }),
  value("effect_level", "effects", "both", "number", { inputs: [ent()], fields: [idField("effect", "effect", "minecraft:speed")], code: (c) => `${h(c, "effectLevel")}(${E(c)}, ${qid(c, "effect")})` }),
  value("effect_seconds", "effects", "both", "number", { inputs: [ent()], fields: [idField("effect", "effect", "minecraft:speed")], code: (c) => `${h(c, "effectSeconds")}(${E(c)}, ${qid(c, "effect")})` }),
];

const DAMAGE_TYPES = ["generic", "magic", "fall", "in_fire", "on_fire", "lava", "drown", "starve", "cactus", "out_of_world", "wither", "lightning_bolt", "in_wall", "cramming", "hot_floor", "sweet_berry_bush", "fly_into_wall", "dragon_breath"];
const damageBlocks: BlockDef[] = [
  stmt("damage_deal", "damage", "server", {
    inputs: [ent(), num("amount", 2)], fields: [dropdown("type", DAMAGE_TYPES)],
    code: (c) => `${h(c, "hurt")}(${E(c)}, ${c.s(String(c.f.type))}, ${c.i.amount});`,
  }),
  stmt("damage_deal_source", "damage", "server", { inputs: [ent(), source(), num("amount", 2)], code: (c) => `${h(c, "hurtWith")}(${E(c)}, ${c.i.damagesource}, ${c.i.amount});` }),
  value("damage_source_of", "damage", "both", "damagesource", { deps: W, fields: [dropdown("type", DAMAGE_TYPES)], code: (c) => `${h(c, "damageSource")}(${world(c)}, ${c.s(String(c.f.type))})` }),
  value("damage_source_entity", "damage", "both", "entity", { inputs: [source()], fields: [dropdown("which", ["attacker", "direct"])], code: (c) => `${h(c, "sourceEntity")}(${c.i.damagesource}, ${c.f.which === "direct"})` }),
  value("damage_source_is", "damage", "both", "logic", { inputs: [source()], fields: [dropdown("type", DAMAGE_TYPES)], code: (c) => `${h(c, "damageTypeIs")}(${c.i.damagesource}, ${c.s(String(c.f.type))})` }),
];

const projectileBlocks: BlockDef[] = [
  stmt("projectile_shoot", "projectiles", "server", {
    inputs: [ent("shooter"), num("power", 1.5), num("inaccuracy", 1)], fields: [idField("type", "entity", "minecraft:arrow")],
    code: (c) => `${h(c, "shoot")}(${c.i.shooter}, ${qid(c, "type")}, ${c.i.power}, ${c.i.inaccuracy});`,
  }),
  stmt("projectile_snowball", "projectiles", "server", {
    inputs: [ent("shooter"), num("power", 1.5)],
    code: (c) => `${h(c, "shoot")}(${c.i.shooter}, "minecraft:snowball", ${c.i.power}, 1);`,
  }),
];

const particleBlocks: BlockDef[] = [
  stmt("particle_spawn", "particles", "client", {
    deps: W, fields: [idField("particle", "particle", "minecraft:happy_villager")], inputs: [...xyz(), num("vx", 0), num("vy", 0), num("vz", 0)],
    code: (c) => `${h(c, "clientParticle")}(${world(c)}, ${qid(c, "particle")}, ${at(c)}, ${c.i.vx}, ${c.i.vy}, ${c.i.vz});`,
  }),
  stmt("particle_burst", "particles", "client", {
    deps: W, fields: [idField("particle", "particle", "minecraft:happy_villager")], inputs: [...xyz(), num("count", 20), num("spread", 1)],
    code: (c) => {
      const i = c.temp("i");
      return `for (int ${i} = 0; ${i} < (int) ${c.i.count}; ${i}++) {\n${h(c, "clientParticle")}(${world(c)}, ${qid(c, "particle")}, ${c.i.x} + (Math.random() - 0.5) * ${c.i.spread}, ${c.i.y} + (Math.random() - 0.5) * ${c.i.spread}, ${c.i.z} + (Math.random() - 0.5) * ${c.i.spread}, 0, 0.05, 0);\n}`;
    },
  }),
  stmt("particle_server", "particles", "server", {
    deps: W, fields: [idField("particle", "particle", "minecraft:flame")], inputs: [...xyz(), num("count", 10), num("dx", 0.3), num("dy", 0.3), num("dz", 0.3), num("speed", 0.02)],
    code: (c) => `${h(c, "serverParticles")}(${world(c)}, ${qid(c, "particle")}, ${at(c)}, ${c.i.count}, ${c.i.dx}, ${c.i.dy}, ${c.i.dz}, ${c.i.speed});`,
  }),
];

const soundBlocks: BlockDef[] = [
  stmt("sound_play", "sounds", "server", {
    deps: W, fields: [idField("sound", "sound", "minecraft:entity.experience_orb.pickup")], inputs: [...xyz(), num("volume", 1), num("pitch", 1)],
    code: (c) => `${h(c, "playSound")}(${world(c)}, ${at(c)}, ${qid(c, "sound")}, ${c.i.volume}, ${c.i.pitch});`,
  }),
  stmt("sound_play_in", "sounds", "both", {
    deps: W, fields: [idField("sound", "sound", "minecraft:entity.experience_orb.pickup"), dropdown("category", SOUND_CATEGORIES, "NEUTRAL")], inputs: [...xyz(), num("volume", 1), num("pitch", 1)],
    code: (c) => `${h(c, "playSoundIn")}(${world(c)}, ${at(c)}, ${qid(c, "sound")}, ${c.s(String(c.f.category))}, ${c.i.volume}, ${c.i.pitch});`,
  }),
  stmt("sound_play_local", "sounds", "client", {
    deps: W, fields: [idField("sound", "sound", "minecraft:entity.experience_orb.pickup")], inputs: [...xyz(), num("volume", 1), num("pitch", 1)],
    code: (c) => `${h(c, "playLocalSound")}(${world(c)}, ${at(c)}, ${qid(c, "sound")}, ${c.i.volume}, ${c.i.pitch});`,
  }),
];

const energyBlocks: BlockDef[] = [
  value("block_energy", "blocks", "both", "number", {
    deps: W, inputs: xyz(), fields: [dropdown("what", ["stored", "capacity"])],
    code: (c) => `${h(c, "energyStored")}(${world(c)}, ${at(c)}, ${c.f.what === "capacity"})`,
  }),
  stmt("block_energy_extract", "blocks", "both", { deps: W, inputs: [...xyz(), num("amount", 100)], code: (c) => `${h(c, "extractEnergy")}(${world(c)}, ${at(c)}, ${c.i.amount});` }),
  stmt("block_energy_receive", "blocks", "both", { deps: W, inputs: [...xyz(), num("amount", 100)], code: (c) => `${h(c, "receiveEnergy")}(${world(c)}, ${at(c)}, ${c.i.amount});` }),
  value("block_fluid", "blocks", "both", "number", {
    deps: W, inputs: xyz(), fields: [dropdown("what", ["stored", "capacity"])],
    code: (c) => `${h(c, "fluidAmount")}(${world(c)}, ${at(c)}, ${c.f.what === "capacity"})`,
  }),
  value("block_fluid_id", "blocks", "both", "text", { deps: W, inputs: xyz(), code: (c) => `${h(c, "fluidId")}(${world(c)}, ${at(c)})` }),
  stmt("block_fluid_fill", "blocks", "both", {
    deps: W, inputs: [...xyz(), num("amount", 1000)], fields: [idField("fluid", "fluid", "minecraft:water")],
    code: (c) => `${h(c, "fillFluid")}(${world(c)}, ${at(c)}, ${qid(c, "fluid")}, ${c.i.amount});`,
  }),
  stmt("block_fluid_drain", "blocks", "both", { deps: W, inputs: [...xyz(), num("amount", 1000)], code: (c) => `${h(c, "drainFluid")}(${world(c)}, ${at(c)}, ${c.i.amount});` }),
];

const commandBlocks: BlockDef[] = [
  stmt("command_run", "commands", "server", { deps: W, inputs: [...xyz(), txt("command", "say hi")], code: (c) => `${h(c, "runCommand")}(${world(c)}, ${at(c)}, ${c.i.command});` }),
  // Words typed after a mod command's name (index 0 is the first); "" or 0 when missing.
  value("command_param_text", "commands", "both", "text", { deps: ["command"], inputs: [num("index", 0)], code: (c) => `${h(c, "commandParam")}(${c.dep("command")}, (int) (${c.i.index}))` }),
  // Arguments typed after a mod command, by the name the command gave them.
  value("command_arg_number", "commands", "both", "number", {
    deps: ["arguments"], fields: [textField("name", "amount")],
    code: (c) => `com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(${c.dep("arguments")}, ${c.s(String(c.f.name))})`,
  }),
  value("command_arg_text", "commands", "both", "text", {
    deps: ["arguments"], fields: [textField("name", "word")],
    code: (c) => `com.mojang.brigadier.arguments.StringArgumentType.getString(${c.dep("arguments")}, ${c.s(String(c.f.name))})`,
  }),
  value("command_arg_entity", "commands", "both", "entity", { deps: ["arguments"], fields: [textField("name", "player")], code: (c) => `${h(c, "commandEntity")}(${c.dep("arguments")}, ${c.s(String(c.f.name))})` }),
  value("command_param_number", "commands", "both", "number", { deps: ["command"], inputs: [num("index", 0)], code: (c) => `${h(c, "commandParamNumber")}(${c.dep("command")}, (int) (${c.i.index}))` }),
];

const advancementBlocks: BlockDef[] = [
  stmt("advancement_grant", "advancements", "server", { inputs: [ent()], fields: [idField("advancement", "advancement", "minecraft:story/mine_stone")], code: (c) => `${h(c, "advancement")}(${E(c)}, ${qid(c, "advancement")}, true);` }),
  stmt("advancement_revoke", "advancements", "server", { inputs: [ent()], fields: [idField("advancement", "advancement", "minecraft:story/mine_stone")], code: (c) => `${h(c, "advancement")}(${E(c)}, ${qid(c, "advancement")}, false);` }),
  value("advancement_has", "advancements", "server", "logic", { inputs: [ent()], fields: [idField("advancement", "advancement", "minecraft:story/mine_stone")], code: (c) => `${h(c, "hasAdvancement")}(${E(c)}, ${qid(c, "advancement")})` }),
];

const scoreBlocks: BlockDef[] = [
  value("score_get", "scoreboard", "server", "number", { inputs: [ent()], fields: [textField("objective", "points")], code: (c) => `${h(c, "score")}(${E(c)}, ${c.s(String(c.f.objective))})` }),
  stmt("score_set", "scoreboard", "server", { inputs: [ent(), num("value", 0)], fields: [textField("objective", "points")], code: (c) => `${h(c, "setScore")}(${E(c)}, ${c.s(String(c.f.objective))}, ${c.i.value}, false);` }),
  stmt("score_add", "scoreboard", "server", { inputs: [ent(), num("value", 1)], fields: [textField("objective", "points")], code: (c) => `${h(c, "setScore")}(${E(c)}, ${c.s(String(c.f.objective))}, ${c.i.value}, true);` }),
];

const guiBlocks: BlockDef[] = [
  // Opens the GUI at x, y, z: a block entity inventory there backs its slots.
  stmt("gui_open", "gui", "server", {
    inputs: [ent()], deps: ["x", "y", "z"], fields: [{ name: "gui", kind: "id", registry: "gui", default: "" }],
    code: (c) => !c.f.gui ? "" : `${c.pkg}.init.${c.modClass}Menus.open(${E(c)}, ${c.s(String(c.f.gui).replace(/^.*:/, ""))}, ${h(c, "pos")}(${c.dep("x")}, ${c.dep("y")}, ${c.dep("z")}));`,
  }),
  // The slots of the GUI the entity has open, by slot id.
  value("gui_slot_item", "gui", "both", "itemstack", { inputs: [ent(), num("slot", 0)], code: (c) => `${h(c, "guiSlotItem")}(${E(c)}, ${c.i.slot})` }),
  stmt("gui_set_slot_item", "gui", "both", { inputs: [ent(), num("slot", 0), stack()], code: (c) => `${h(c, "setGuiSlotItem")}(${E(c)}, ${c.i.slot}, ${c.i.itemstack});` }),
  stmt("gui_remove_slot_item", "gui", "both", { inputs: [ent(), num("slot", 0), num("amount", 1)], code: (c) => `${h(c, "removeGuiSlotItem")}(${E(c)}, ${c.i.slot}, ${c.i.amount});` }),
  stmt("gui_open_at", "gui", "server", {
    inputs: [ent(), ...xyz()], fields: [{ name: "gui", kind: "id", registry: "gui", default: "" }],
    code: (c) => !c.f.gui ? "" : `${c.pkg}.init.${c.modClass}Menus.open(${E(c)}, ${c.s(String(c.f.gui).replace(/^.*:/, ""))}, ${h(c, "pos")}(${at(c)}));`,
  }),
  stmt("client_item_activation", "gui", "both", { inputs: [stack()], code: (c) => `${h(c, "itemActivation")}(${S(c)});` }),
  stmt("gui_close", "gui", "server", { inputs: [ent()], code: (c) => `${h(c, "closeScreen")}(${E(c)});` }),
  stmt("client_message", "gui", "client", { inputs: [txt("text", "Hello")], fields: [check("actionbar", true)], code: (c) => `${h(c, "clientMessage")}(${c.i.text}, ${c.f.actionbar === true});` }),
  value("client_player", "gui", "client", "entity", { code: (c) => `${h(c, "clientPlayer")}()` }),
];

const D = (c: CodeArgs) => c.i.direction;
const directionBlocks: BlockDef[] = [
  value("direction", "directions", "both", "direction", { fields: [dropdown("value", ["NORTH", "SOUTH", "EAST", "WEST", "UP", "DOWN"])], code: (c) => `${c.j.Direction}.${c.f.value}` }),
  value("direction_opposite", "directions", "both", "direction", { inputs: [dir()], code: (c) => `${D(c)}.getOpposite()` }),
  value("direction_clockwise", "directions", "both", "direction", { inputs: [dir()], code: (c) => `${D(c)}.getClockWise()` }),
  value("direction_counter_clockwise", "directions", "both", "direction", { inputs: [dir()], code: (c) => `${D(c)}.getCounterClockWise()` }),
  value("direction_step", "directions", "both", "number", { inputs: [dir()], fields: [dropdown("axis", ["X", "Y", "Z"])], code: (c) => `${D(c)}.getStep${c.f.axis}()` }),
  value("direction_of_entity", "directions", "both", "direction", { inputs: [ent()], code: (c) => `${E(c)}.getDirection()` }),
  value("direction_random", "directions", "both", "direction", { deps: W, code: (c) => `${c.j.Direction}.getRandom(${world(c)}.getRandom())` }),
  value("direction_name", "directions", "both", "text", { inputs: [dir()], code: (c) => `${D(c)}.getName()` }),
];

export const MINECRAFT_BLOCKS: BlockDef[] = [
  ...worldBlocks, ...blockBlocks, ...entityBlocks, ...playerBlocks, ...itemBlocks, ...effectBlocks, ...damageBlocks,
  ...energyBlocks, ...projectileBlocks, ...particleBlocks, ...soundBlocks, ...commandBlocks, ...advancementBlocks, ...scoreBlocks,
  ...guiBlocks, ...directionBlocks,
];
