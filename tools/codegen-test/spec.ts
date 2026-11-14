// Codegen test project spec: element id -> overrides on the type defaults.
import commonTags from "../../config/common-tags.json" with { type: "json" };
const T = "textures/ruby.png";
/** Tags the tag probe resolves: the common-tags table (Forge names and their modern tags) and the Forge tags ETR's trade boxes use. */
export const PROBE_TAGS = [...new Set([...Object.keys(commonTags.vanilla), ...Object.keys(commonTags.modern), ...Object.values(commonTags.modern),
  "forge:crops", "forge:seeds", "forge:ores", "forge:ingots", "forge:gems"])];
const log = (text: string) => ({ format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "log", inputs: { text } }] }] });
const entityLog = { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
  { block: "start" },
  { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[wavethree] ran for ", b: { block: "entity_name", inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } } } } } } } },
] }] };
/** AI goals program: one goal block per entry ([block, fields]). */
const ai = (...goals: [string, Record<string, unknown>?][]) => ({ format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...goals.map(([block, fields]) => ({ block, fields: fields ?? {} }))] }] });
const dep = { block: "dep_entity", fields: { dep: "entity" } };
const tankAt = { x: 0, y: 100, z: 0 };
const chestAt = { x: 2, y: 100, z: 0 };
const [dx, dy, dz] = ["x", "y", "z"].map((name) => ({ block: "dep_number", fields: { dep: name } }));
const openGui = { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
  { block: "start" },
  { block: "gui_open", fields: { gui: "ruby_gui" }, inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } } } },
] }] };
export const SPEC: Record<string, Record<string, Record<string, unknown>>> = {
  procedure: {
    // KUYRUK #38: the place trigger on every engine; a dispenser places through BlockItem without a player.
    place_probe: { title: "Place probe", returnType: "none", globalTrigger: "block_place", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] placed z ", b: { block: "text_from_number", inputs: { value: dz } } } } } },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "GT" }, inputs: { a: dz, b: 3 } }, then: [{ block: "cancel_event" }] } },
    ] }] } },
    // KUYRUK 46 P1: UseHoeEvent mapping (the hoe's own use; a mixin on ItemStack.useOn on Fabric).
    hoe_probe: { title: "Hoe probe", returnType: "none", globalTrigger: "player_use_hoe", program: log("[probe] hoe used") },
    // KUYRUK 49: a message the client translates (key and arguments in the component); compile coverage on every engine.
    translated_probe: { title: "Translated probe", returnType: "none", globalTrigger: "player_use_hoe", program: { format: 1, variables: [{ name: "args", type: "list" }], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" },
      { block: "local_list_set", fields: { var: "args" }, inputs: { value: { block: "list_new" } } },
      { block: "list_add", inputs: { list: { block: "local_list_get", fields: { var: "args" } }, value: "Ada" } },
      { block: "list_add", inputs: { list: { block: "local_list_get", fields: { var: "args" } }, value: 3 } },
      { block: "player_message_translated", fields: { actionbar: false }, inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } }, key: "wavethree.probe.hello", args: { block: "local_list_get", fields: { var: "args" } } } },
    ] }] } },
    // Modern client sync of energy: the server feeds the tank at 0 100 0 each player tick, the client logs what it sees.
    tank_feed: { title: "Tank feed", returnType: "none", globalTrigger: "player_ticks", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "block_energy_receive", inputs: { ...tankAt, amount: 1 } },
    ] }] } },
    tank_client_probe: { title: "Tank client probe", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[client] energy ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "stored" }, inputs: tankAt } } } } } } },
    ] }] } },
    ruby_tooltip: { title: "Ruby tooltip", returnType: "string", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_text", inputs: { value: { block: "entity_name", inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } } } } } }] }] } },
    never: { title: "Never", returnType: "logic", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_logic", inputs: { value: false } }] }] } },
    beast_scale: { title: "Beast scale", returnType: "number", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_number", inputs: { value: 1.1 } }] }] } },
    beast_tick: { title: "Beast tick", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "entity_data_set_logic", fields: { mob: "ruby_beast", name: "idle" }, inputs: { entity: dep, value: true } },
      { block: "entity_data_set_number", fields: { mob: "ruby_golem", name: "power" }, inputs: { entity: dep, value: 3 } },
      { block: "log", inputs: { text: { block: "entity_data_get_text", fields: { mob: "ruby_golem", name: "title" }, inputs: { entity: dep } } } },
    ] }] } },
    // Blocks the Java to blocks converter uses (KUYRUK #30): block data, block inventory, text, other dimension.
    imported_blocks: { title: "Imported blocks", returnType: "none", program: { format: 1, variables: [{ name: "stack", type: "itemstack" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_decimal_format", inputs: { value: { block: "block_data_number", inputs: { x: dx, y: dy, z: dz, key: "charge" } }, pattern: "##R" } } } },
      { block: "block_set_data_number", inputs: { x: dx, y: dy, z: dz, key: "charge", value: { block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a: { block: "block_data_number", inputs: { x: dx, y: dy, z: dz, key: "charge" } }, b: 1 } } } },
      { block: "block_set_data_text", inputs: { x: dx, y: dy, z: dz, key: "owner", value: "ruby" } },
      { block: "block_set_data_logic", inputs: { x: dx, y: dy, z: dz, key: "open", value: { block: "logic_negate", inputs: { value: { block: "block_data_logic", inputs: { x: dx, y: dy, z: dz, key: "open" } } } } } },
      { block: "log", inputs: { text: { block: "block_data_text", inputs: { x: dx, y: dy, z: dz, key: "owner" } } } },
      { block: "block_set_slot_item", inputs: { x: dx, y: dy, z: dz, slot: 0, itemstack: { block: "item_stack", fields: { item: "ruby" }, inputs: { count: 3 } } } },
      { block: "local_itemstack_set", fields: { var: "stack" }, inputs: { value: { block: "block_slot_item", inputs: { x: dx, y: dy, z: dz, slot: 0 } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: { block: "text_translate", inputs: { key: "item.wavethree.ruby" } }, b: { block: "item_name", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } } } },
      { block: "block_place_keeping", fields: { block: "ruby_chest" }, inputs: { x: dx, y: dy, z: dz } },
      { block: "block_place_keeping", fields: { block: "ruby_chest", data: false }, inputs: { x: dx, y: dy, z: dz } },
      { block: "block_break_dropping", inputs: { x: dx, y: dy, z: dz } },
      { block: "gui_set_slot_item", inputs: { entity: dep, slot: 1, itemstack: { block: "item_random_in_tag", fields: { tag: "minecraft:logs" } } } },
      { block: "if", inputs: { cond: { block: "logic_ternary_logic", inputs: { cond: { block: "entity_has_permission", inputs: { entity: dep, level: 4 } }, a: { block: "item_rarity_is", fields: { rarity: "RARE" }, inputs: { itemstack: { block: "gui_slot_item", inputs: { entity: dep, slot: 1 } } } }, b: false } }, then: [
        { block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "math_single", fields: { op: "TRUNC" }, inputs: { value: 2.7 } } } } } },
      ] } },
      // Second slice of the converter (KUYRUK #30): ray trace, entity query, sounds, energy, effects, item drops, properties, tools.
      { block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "entity_look_block", fields: { axis: "Y", shape: "outline" }, inputs: { entity: dep, distance: 4 } } } } } },
      { block: "log", inputs: { text: { block: "entity_name", inputs: { entity: { block: "world_nearest_entity_in_box", fields: { kind: "player" }, inputs: { x1: 0, y1: 0, z1: 0, x2: 4, y2: 4, z2: 4, x: dx, y: dy, z: dz } } } } } },
      { block: "sound_play_in", fields: { sound: "minecraft:block.furnace.fire_crackle", category: "BLOCKS" }, inputs: { x: dx, y: dy, z: dz, volume: 1, pitch: 1 } },
      { block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "capacity" }, inputs: { x: dx, y: dy, z: dz } } } } } },
      { block: "block_energy_receive", inputs: { x: dx, y: dy, z: dz, amount: 10 } },
      { block: "block_energy_extract", inputs: { x: dx, y: dy, z: dz, amount: 10 } },
      { block: "effect_add_ticks", fields: { effect: "minecraft:haste" }, inputs: { entity: dep, ticks: 40, amplifier: 1 } },
      { block: "world_spawn_item", fields: { persistent: true }, inputs: { x: dx, y: dy, z: dz, itemstack: { block: "item_stack", fields: { item: "ruby" }, inputs: { count: 1 } }, delay: 10 } },
      { block: "block_set_property", fields: { property: "power" }, inputs: { x: dx, y: dy, z: dz, value: 15 } },
      { block: "block_set_property_logic", fields: { property: "powered" }, inputs: { x: dx, y: dy, z: dz, value: true } },
      { block: "local_itemstack_set", fields: { var: "stack" }, inputs: { value: { block: "block_slot_item", inputs: { x: dx, y: dy, z: dz, slot: 1 } } } },
      { block: "item_hurt_break", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } }, amount: 2 } },
      { block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a: { block: "effect_ticks_left", fields: { effect: "minecraft:haste" }, inputs: { entity: dep } }, b: { block: "world_total_day_time" } } } } } } },
      { block: "gui_remove_slot_item", inputs: { entity: dep, slot: 1, amount: 1 } },
      { block: "if", inputs: { cond: { block: "logic_operation", fields: { op: "AND" }, inputs: { a: { block: "entity_is_monster", inputs: { entity: dep } }, b: { block: "item_is_tool", fields: { tool: "pickaxe" }, inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } }, then: [
        { block: "log", inputs: { text: { block: "text_from_double", inputs: { value: { block: "math_arithmetic", fields: { op: "DIVIDE_INT" }, inputs: { a: 7, b: 2 } } } } } },
      ] } },
      // Last slice of the converter (KUYRUK #37): text of stacks, substring, game rule, sky and weather, animals, GUI at a block, totem, inventory, block use.
      { block: "log", inputs: { text: { block: "text_substring_java", inputs: { value: { block: "text_from_itemstack", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } }, from: 1, to: 2 } } } },
      { block: "world_set_game_rule_number", fields: { rule: "randomTickSpeed" }, inputs: { value: 3 } },
      { block: "if", inputs: { cond: { block: "logic_operation", fields: { op: "AND" }, inputs: { a: { block: "world_can_see_sky_from_water", inputs: { x: dx, y: dy, z: dz } }, b: { block: "logic_operation", fields: { op: "OR" }, inputs: { a: { block: "world_raining_flag" }, b: { block: "entity_is_animal", inputs: { entity: dep } } } } } }, then: [
        { block: "gui_open_at", fields: { gui: "ruby_gui" }, inputs: { entity: dep, x: dx, y: dy, z: dz } },
        { block: "client_item_activation", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } },
        { block: "return_void" },
      ] } },
      { block: "player_clear_matching", inputs: { entity: dep, itemstack: { block: "local_itemstack_get", fields: { var: "stack" } }, amount: 1 } },
      { block: "if", inputs: { cond: { block: "player_has_stack", inputs: { entity: dep, itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } }, then: [
        { block: "log", inputs: { text: { block: "text_from_number", inputs: { value: { block: "entity_count_item", inputs: { entity: dep, itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } } } },
      ] } },
      { block: "block_use", inputs: { entity: dep, x: dx, y: dy, z: dz } },
      { block: "if", inputs: { cond: { block: "block_material_is", fields: { material: "STONE" }, inputs: { blockstate: { block: "block_state_at", inputs: { x: dx, y: dy, z: dz } } } }, then: [
        { block: "log", inputs: { text: "stone" } },
      ] } },
      { block: "in_dimension", fields: { dimension: "minecraft:overworld" }, inputs: { do: [
        { block: "block_set_data_number", inputs: { x: 0, y: 64, z: 0, key: "seen", value: 1 } },
      ] } },
    ] }] } },
    fuel_time: { title: "Fuel time", returnType: "number", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_number", inputs: { value: 600 } }] }] } },
    dispense_result: { title: "Dispense result", returnType: "itemstack", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_itemstack", inputs: { value: { block: "item_stack", fields: { item: "minecraft:diamond" }, inputs: { count: 1 } } } }] }] } },
    always: { title: "Always", returnType: "logic", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "return_logic", inputs: { value: true } }] }] } },
    entity_log: { title: "Entity log", returnType: "none", program: entityLog },
    plain_log: { title: "Plain log", returnType: "none", program: log("[wavethree] plain") },
    // KUYRUK 105: a label text with a server-side statement (ETR new_jobs_ui): computed by the menu on the server and synced.
    server_label_text: { title: "Server label text", returnType: "string", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_boolean", fields: { value: "true" } }, then: [
        { block: "player_number_set", fields: { var: "wallet" }, inputs: { entity: dep, value: 7 } },
        { block: "return_text", inputs: { value: { block: "text_join", inputs: { a: "[label] wallet ", b: { block: "text_from_number", inputs: { value: { block: "player_number_get", fields: { var: "wallet" }, inputs: { entity: dep } } } } } } } },
      ] } },
    ] }] } },
    // KUYRUK 106: once per server tick (world_ticks runs per dimension); logs every 100 day-time ticks, each value once.
    server_tick_probe: { title: "Server tick probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 100 } }, b: 0 } }, then: [
        { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] server tick ", b: { block: "text_from_number", inputs: { value: { block: "world_time" } } } } } } },
      ] } },
    ] }] } },
    // KUYRUK 43: a GUI tick procedure that writes a slot (setGuiSlotItem calls broadcastChanges, which runs the tick again).
    gui_tick_write: { title: "GUI tick write", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "gui_set_slot_item", inputs: { entity: dep, slot: 4, itemstack: { block: "item_stack", fields: { item: "minecraft:stone" }, inputs: { count: 1 } } } },
      { block: "call_procedure", fields: { procedure: "plain_log" } },
    ] }] } },
    open_ruby_gui: { title: "Open ruby GUI", returnType: "none", program: openGui },
    // KUYRUK #41: a player opens ruby_gui at 3 100 7 now and then; its label logs the position the client menu has.
    gui_pos_open: { title: "GUI position open", returnType: "none", globalTrigger: "player_ticks", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_total_day_time" }, b: 200 } }, b: 100 } }, then: [
        { block: "log", inputs: { text: "[gui] ruby_gui" } },
        { block: "gui_open_at", fields: { gui: "ruby_gui" }, inputs: { entity: dep, x: 3, y: 100, z: 7 } },
      ] } },
    ] }] } },
    gui_pos_label: { title: "GUI position label", returnType: "string", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[guipos] ", b: { block: "text_join", inputs: { a: { block: "text_from_number", inputs: { value: dx } }, b: { block: "text_join", inputs: { a: " ", b: { block: "text_from_number", inputs: { value: dz } } } } } } } } } },
      { block: "return_text", inputs: { value: "pos" } },
    ] }] } },
    shoot_ruby: { title: "Shoot ruby arrow", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "projectile_shoot", fields: { type: "ruby_arrow" }, inputs: { shooter: { block: "dep_entity", fields: { dep: "entity" } }, power: 2, inaccuracy: 0 } },
    ] }] } },
  },
  custom_element: {
    ruby_util: { code: "package dev.mcedge.wavethree.util;\n\npublic final class RubyUtil {\n    private RubyUtil() {}\n\n    public static int twice(int value) {\n        return value * 2;\n    }\n}\n" },
    empty_custom: {},
  },
  living_entity: {
    ruby_golem: { mobName: "Ruby Golem", mobModelTexture: "textures/ruby_block.png", health: 30, attackStrength: 5, isBoss: true, bossBarColor: "RED", mobDrop: "ruby", equipmentMainHand: "minecraft:iron_sword", immuneToFallDamage: true, immuneToArrows: true, livingSound: "wavethree:ruby_chime", whenMobIsHurt: "entity_log", whenMobDies: "plain_log", restrictionBiomes: [{ biome: "minecraft:plains" }], spawnEggTexture: T, spawnEggBaseColor: "#aa0000", spawnEggDotColor: "#ffffff", visualScale: 1.2,
      mobLabel: "Gary", boundingBoxScale: 1.2, solidBoundingBox: true, mountedYOffset: 0.5, onInitialSpawn: "entity_log", spawningCondition: "always", spawnInDungeons: true, isShakingCondition: true,
      entityDataEntries: [{ name: "power", type: "number", defaultValue: "7" }, { name: "angry", type: "logic", defaultValue: "true" }, { name: "title", type: "string", defaultValue: "boss" }],
      modelLayers: [{ model: "Default", texture: T, glow: true, disableHurtOverlay: true, syncedDataCondition: "angry" }, { model: "Default", texture: "textures/ruby_block.png", condition: "always" }],
      aixml: ai(["ai_float"], ["ai_attack_melee", { speed: 1.3, longMemory: true }], ["ai_attack_range_melee", { range: 3 }], ["ai_leap"], ["ai_hurt_by_target", { callHelp: true }], ["ai_target_entity", { entity: "minecraft:player", mustSee: true }], ["ai_target_entity", { entity: "minecraft:pig", condition: "always" }], ["ai_target_entity", { entity: "ruby_sheep" }], ["ai_avoid_entity", { entity: "minecraft:creeper" }], ["ai_avoid_entity", { entity: "minecraft:player" }], ["ai_wander_avoid_water", { speed: 0.9, continueCondition: "always" }], ["ai_watch_entity", { entity: "minecraft:player" }], ["ai_watch_entity", { entity: "minecraft:cow" }], ["ai_look_around"], ["ai_doors_open", { mode: "open_and_close" }], ["ai_doors_break"], ["ai_break_blocks", { block: "minecraft:sand" }], ["ai_restrict_sun"], ["ai_move_indoors"], ["ai_find_water"], ["ai_breathe_air"], ["ai_climb_powder_snow"], ["ai_attack_procedure", { procedure: "entity_log" }], ["ai_follow_mob"], ["ai_follow_boat"], ["ai_eat_grass"], ["ai_panic"]) },
    ruby_sheep: { mobName: "Ruby Sheep", mobModelName: "Cow", mobBehaviourType: "Creature", mobSpawningType: "creature", breedable: true, tameable: true, breedTriggerItems: [{ item: "ruby" }, { item: "#minecraft:flowers" }], mobModelTexture: "textures/ruby_block.png", doesDespawnWhenIdle: false, mobCreatureType: "UNDEAD", onRightClickedOn: "entity_log",
      ridable: true, canControlForward: true, canControlStrafe: true, guiBoundTo: "ruby_gui", inventorySize: 3, inventoryStackSize: 16,
      aixml: ai(["ai_float"], ["ai_panic", { speed: 1.4 }], ["ai_breed"], ["ai_tempt", { item: "ruby" }], ["ai_tempt", { item: "#minecraft:flowers", scared: true }], ["ai_follow_parent"], ["ai_follow_owner"], ["ai_owner_hurt_by_target"], ["ai_owner_hurt_target"], ["ai_wander"]) },
    ruby_bat: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Bat", mobModelName: "Ghast", visualScale: 0.3, modelWidth: 0.8, modelHeight: 0.8, flyingMob: true, mobSpawningType: "ambient", restrictionBiomes: [{ biome: "#minecraft:is_overworld" }],
      ranged: true, rangedAttackItem: "ruby", rangedAttackInterval: 30, sensitiveToVibration: true, vibrationalEvents: [{ event: "minecraft:step" }, { event: "minecraft:block_place" }], vibrationSensitivityRadius: 12, onReceivedVibration: "plain_log", canReceiveVibrationCondition: "always",
      aixml: ai(["ai_fly_random", { speed: 1 }], ["ai_attack_fly", { speed: 1.2 }], ["ai_target_entity", { entity: "minecraft:player" }], ["ai_doors_open"]) },
    ruby_fish: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Fish", mobModelName: "Cod", waterMob: true, mobBehaviourType: "Creature", mobSpawningType: "waterCreature", breatheUnderwater: true, pushedByFluids: false, modelWidth: 0.5, modelHeight: 0.3,
      aixml: ai(["ai_swim_random", { speed: 1 }], ["ai_panic"], ["ai_follow_mob"]) },
    ruby_raider: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Raider", mobModelName: "Witch", mobBehaviourType: "Raider", raidCelebrationSound: "minecraft:entity.villager.celebrate", raidSpawnsWave1: 1, raidSpawnsWave2: 2, ranged: true, rangedItemType: "ruby_arrow", spawnThisMob: false, mobCreatureType: "ILLAGER" },
    ruby_beast: { mobName: "Ruby Beast", mobModelName: "ruby_beast", mobModelTexture: "textures/ruby_block.png", mobBehaviourType: "Creature", spawnThisMob: false, visualScaleProcedure: "beast_scale", transparentModelConditionProcedure: "never",
      entityDataEntries: [{ name: "idle", type: "logic", defaultValue: "true" }],
      animations: [{ animation: "WALK", walking: true, speed: 1.5, amplitude: 2 }, { animation: "RubyBeastAnimation.IDLE", syncedDataCondition: "idle", speed: 1 }, { animation: "missing_anim" }],
      modelLayers: [{ model: "ruby_imp", texture: T }, { model: "Cow", texture: T }], onMobTickUpdate: "beast_tick" },
    ruby_blob: { mobName: "Ruby Blob", mobModelName: "ruby_blob", mobModelTexture: "textures/ruby_block.png", spawnThisMob: false, animations: [{ animation: "bounce", condition: "always" }], boundingBoxScaleProcedure: "beast_scale", solidBoundingBoxProcedure: "always", breatheUnderwaterProcedure: "always", pushedByFluidsProcedure: "never" },
    ruby_zombie: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Zombie", aiBase: "Zombie", mobModelName: "Spider", spawnThisMob: true, mobSpawningType: "monster", aixml: ai(["ai_leap"]) },
    ruby_wolf: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Wolf", aiBase: "Wolf", mobModelName: "Ocelot", spawnThisMob: false },
    ruby_cube: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Cube", aiBase: "Slime", mobModelName: "Slime", spawnThisMob: false, aixml: ai(["ai_float"]) },
    ...Object.fromEntries(["Chicken", "Creeper", "Pig", "Piglin", "Salmon", "Silverfish", "Villager"].map((m) => [`model_${m.toLowerCase()}`, { mobName: m, mobModelName: m, mobModelTexture: "textures/ruby_block.png", spawnThisMob: false, hasSpawnEgg: false, mobBehaviourType: "Creature" }])),
    ...Object.fromEntries(["Bat", "Blaze", "Chicken", "Cow", "Creeper", "Enderman", "Horse", "IronGolem", "MagmaCube", "Ocelot", "Pig", "Skeleton", "Spider", "Squid", "Villager", "Witch"].map((b) => [`base_${b.toLowerCase()}`, { mobName: `Base ${b}`, mobModelTexture: "textures/ruby_block.png", aiBase: b, spawnThisMob: false, hasSpawnEgg: false }])),
  },
  plant: {
    ruby_flower: { name: "Ruby Flower", texture: T, hasTileEntity: true, forceTicking: true, suspiciousStewEffect: "minecraft:speed", suspiciousStewDuration: 160, canBePlacedOn: [{ item: "minecraft:grass_block" }, { item: "#minecraft:sand" }], generateFeature: true, frequencyOnChunks: 4, patchSize: 32, restrictionBiomes: [{ biome: "minecraft:plains" }], onRightClicked: "entity_log", isWaterloggable: false, specialInformationProcedure: "ruby_tooltip" },
    ruby_tall: { name: "Ruby Tall", plantType: "double", texture: T, textureBottom: "textures/ruby_block.png", tintType: "Grass", generateFeature: true, generateAtAnyHeight: false },
    ruby_cane: { name: "Ruby Cane", plantType: "growapable", growapableSpawnType: "Desert", growapableMaxHeight: 4, texture: T, isBonemealable: true, onBonemealSuccess: "", placingCondition: "always", onTickUpdate: "plain_log" },
    ruby_bloom: { name: "Ruby Bloom", texture: T, model: "ruby_lamp", generateFeature: false },
    ruby_sapling: { name: "Ruby Sapling", plantType: "sapling", texture: T, trees1: "minecraft:oak", trees2: "minecraft:fancy_oak", secondaryTreeChance: 0.2, customBoundingBox: true, boundingBoxes: [{ minX: 2, minY: 0, minZ: 2, maxX: 14, maxY: 12, maxZ: 14, subtract: false }] },
  },
  fluid: {
    ruby_water: { name: "Ruby Water", textureStill: "textures/ruby_block.png", textureFlowing: "textures/ruby_block.png", textureRenderOverlay: "textures/ruby.png", tintType: "Water", hasFog: true, fogColor: "#AA2233", fogEndDistance: 12, canMultiply: true, spawnParticles: true, dripParticle: "minecraft:dripping_water", luminance: 4, lightOpacity: 2, bucketName: "Bucket of Ruby Water", specialInformation: "Shiny", specialInformationProcedure: "ruby_tooltip", creativeTabs: ["MISC"], onEntityCollides: "entity_log", onTickUpdate: "plain_log", tickRate: 40, flowCondition: "always", beforeReplacingBlock: "plain_log", flammability: 5 },
    ember: { name: "Ember", type: "LAVA", textureStill: "textures/ruby.png", textureFlowing: "textures/ruby.png", tintType: "No tint", generateBucket: true, bucketName: "Ember Bucket", emptySound: "minecraft:block.lava.extinguish", luminosity: 15, luminance: 15, ignitedByLava: true, colorOnMap: "RED", emissiveRendering: true, rarity: "RARE" },
  },
  special_entity: {
    ruby_boat: { name: "Ruby Boat", entityTexture: "textures/ruby_block.png", itemTexture: T, onTickUpdate: "", onPlayerCollidesWith: "entity_log" },
    ruby_chest_raft: { entityType: "ChestRaft", name: "Ruby Chest Raft", entityTexture: "textures/ruby_block.png", itemTexture: T, rarity: "RARE", creativeTabs: ["TOOLS"] },
  },
  projectile: {
    ruby_arrow: { title: "Ruby Arrow", projectileItem: "ruby", damage: 7, knockback: 2, showParticles: true, igniteFire: true, onHitsBlock: "plain_log", onHitsEntity: "entity_log", onHitsPlayer: "entity_log", onFlyingTick: "" },
    floating_shard: { entityModel: "ruby_imp", customModelTexture: T, projectileItem: "minecraft:prismarine_shard", disableGravity: true, disableDiscarding: true, actionSound: "", modelWidth: 1, modelHeight: 1 },
  },
  gui: {
    // KUYRUK 182, 183: label backgrounds (opacity, padding, scaled) and alignment.
    styled_gui: {
      title: "Styled", type: 0, width: 176, height: 166,
      components: [
        { kind: "label", name: "plain", x: 8, y: 6, text: "Plain", color: "#404040" },
        { kind: "label", name: "boxed", x: 8, y: 20, text: "Boxed", color: "#FFFFFF", background: "#000000", backgroundOpacity: 60, backgroundPadding: 2 },
        { kind: "label", name: "big", x: 8, y: 40, text: "Big", color: "#FFFFFF", background: "#3366FF", textScale: 2 },
        { kind: "label", name: "mid", x: 88, y: 70, text: "Centred", color: "#FFFFFF", align: "center", background: "#000000" },
        { kind: "label", name: "right", x: 168, y: 90, text: "Right", color: "#404040", align: "right" },
        { kind: "label", name: "bigmid", x: 88, y: 110, text: "Big", color: "#404040", align: "center", textScale: 2 },
      ],
    },
    // KUYRUK 186: state images: a state chosen by a number procedure (index), by a percentage read every 10 ticks with
    // its animation restarting, and by the states' conditions (the first that holds; a state without one always holds).
    state_gui: {
      title: "States", type: 0, width: 176, height: 166,
      components: [
        { kind: "state_image", name: "by_index", x: 8, y: 8, width: 16, height: 16, stateProcedure: "beast_scale",
          states: [{ image: "textures/ruby.png" }, { image: "textures/toggle_on.png" }, { image: "textures/spark_strip.png", frame: 2 }] },
        { kind: "state_image", name: "by_percent", x: 30, y: 8, width: 32, height: 32, stateProcedure: "fuel_time", stateValue: "percent", updateTicks: 10, restartAnimation: true, z: 2,
          states: [{ image: "textures/toggle_on.png" }, { image: "textures/ruby_apple.png" }] },
        { kind: "state_image", name: "by_condition", x: 70, y: 8, width: 16, height: 16, condition: "always",
          states: [{ image: "textures/ruby.png", condition: "never" }, { image: "textures/toggle_on.png", condition: "always" }, { image: "textures/ruby_block.png" }] },
      ],
    },
    // KUYRUK 167: the same two-state file as normal and hover texture is the one-file layout.
    same_hover_gui: {
      title: "Same Hover", type: 0, width: 176, height: 166,
      components: [{ kind: "image_button", x: 10, y: 10, width: 16, height: 16, image: "textures/two_state.png", hoverImage: "textures/two_state.png", procedure: "plain_log" }],
    },
    ruby_gui: {
      title: "Ruby Workbench", type: 1, width: 176, height: 166, onOpen: "entity_log", onClosed: "plain_log", onTick: "gui_tick_write",
      components: [
        { kind: "label", name: "title", x: 8, y: 6, text: "Ruby Workbench", color: "#404040" },
        { kind: "slot", x: 25, y: 30, id: 0 },
        { kind: "slot", x: 61, y: 30, id: 1, limit: "ruby" },
        { kind: "slot", x: 133, y: 30, id: 2, output: true },
        { kind: "button", name: "go", x: 90, y: 54, width: 40, height: 20, text: "Go", procedure: "entity_log" },
        { kind: "button", x: 132, y: 54, width: 36, height: 20, text: "Open", procedure: "open_ruby_gui" },
        // KUYRUK 100: an invisible button (anonymous Button subclass) and a scaled button compile on every engine.
        { kind: "button", x: 8, y: 72, width: 30, height: 12, text: "Hidden", procedure: "plain_log", invisible: true },
        { kind: "button", x: 40, y: 72, width: 40, height: 12, text: "Small", procedure: "plain_log", textScale: 0.5 },
        { kind: "text_field", x: 8, y: 54, width: 78, height: 16, text: "Name" },
        { kind: "checkbox", x: 96, y: 6, text: "Lock" },
        { kind: "image", x: 100, y: 30, image: T, condition: "always" },
        { kind: "image_button", x: 150, y: 6, width: 16, height: 8, image: T, procedure: "plain_log", condition: "always" },
        // KUYRUK #61: normal and hover states in two files.
        { kind: "image_button", x: 150, y: 16, width: 16, height: 16, image: T, hoverImage: "textures/ruby_apple.png", procedure: "plain_log" },
        { kind: "label", x: 8, y: 16, textProcedure: "ruby_tooltip", condition: "always", color: "#404040" },
        // KUYRUK #41: the client menu knows the block it was opened at.
        { kind: "label", x: 8, y: 150, textProcedure: "gui_pos_label", color: "#404040" },
        // KUYRUK 105: text computed on the server (the procedure sets a player variable).
        { kind: "label", x: 8, y: 140, textProcedure: "server_label_text", color: "#404040" },
        { kind: "slot", x: 79, y: 30, id: 3, locked: true },
        // KUYRUK 44: a display slot (filled by the tick procedure) is not given back when an unbound menu closes.
        { kind: "slot", x: 97, y: 48, id: 4, lockCondition: "never", keepOnClose: true },
        // KUYRUK 103: z order. Front pass (z > 0): an image over the slots and a label over it; a back image (z < 0).
        { kind: "image", x: 24, y: 29, width: 20, height: 20, image: T, z: 2, condition: "always" },
        { kind: "label", x: 26, y: 34, text: "Top", color: "#FFFFFF", z: 3 },
        { kind: "image", x: 0, y: 0, width: 176, height: 166, image: "textures/ruby_block.png", z: -1 },
        // KUYRUK 96: a toggle button with four textures (the on one animated by its .mcmeta) and one with only two.
        { kind: "toggle_button", x: 150, y: 34, width: 16, height: 16, image: T, hoverImage: "textures/ruby_apple.png", onImage: "textures/toggle_on.png", onHoverImage: "textures/ruby_block.png", stateProcedure: "always", procedure: "plain_log", condition: "always" },
        { kind: "toggle_button", x: 150, y: 52, width: 20, height: 20, image: T, onImage: "textures/ruby_apple.png", procedure: "plain_log" },
      ],
    },
    plain_screen: {
      type: 0, width: 200, height: 100, doesPauseGame: true, renderBgLayer: false,
      components: [
        { kind: "label", x: 10, y: 10, text: "Hello", color: "#FFFFFF" },
        { kind: "button", x: 10, y: 40, width: 80, height: 20, text: "Log" },
      ],
    },
  },
  block: {
    // KUYRUK 46 B2/B4/B5/B6: waterlogging with the sky light rule, middle-click item, faces hidden between neighbours, post-process flag.
    legacy_props_block: { texture: "textures/ruby_block.png", name: "Legacy Props Block", rotationMode: 1, isWaterloggable: true, hasCustomOpacity: true, lightOpacity: 0, connectedSides: true, hasPostProcess: true, emissiveRendering: true, creativePickItem: "ruby" },
    ruby_chest: { texture: "textures/ruby_block.png", name: "Ruby Chest", hasInventory: true, guiBoundTo: "ruby_gui", openGUIOnRightClick: true, inventorySize: 9, inventoryStackSize: 32, inventoryInSlotIDs: [{ slot: 0 }, { slot: 1 }], inventoryOutSlotIDs: [{ slot: 2 }],
      // KUYRUK 101: a machine for the recipe viewer integration (generated only with it on: tools/codegen-test/integrations-check.ts).
      rvCategory: true, rvTitle: "Ruby Chest", rvCatalysts: [{ item: "ruby" }], rvRecipes: [
        { inputs: [{ item: "ruby", count: 2 }, { item: "minecraft:coal", count: 1 }], outputs: [{ item: "gem_a", count: 1 }], time: 100, energy: 400 },
        { inputs: [{ item: "minecraft:diamond", count: 1 }], outputs: [{ item: "gem_b", count: 2 }, { item: "gem_c", count: 1 }], time: 0, energy: 0 },
      ] },
    ruby_tip_block: { texture: "textures/ruby_block.png", name: "Ruby Tip Block", specialInformation: "hidden", specialInformationProcedure: "ruby_tooltip", onStartToDestroy: "entity_log", onHitByProjectile: "entity_log", onEntityFallsOn: "entity_log" },
    // Project models (KUYRUK #15): JSON with a rotated element and display transforms, OBJ, a .bbmodel converted on build.
    ruby_lamp: { texture: "textures/ruby_block.png", name: "Ruby Lamp", renderType: 2, customModelName: "ruby_lamp", rotationMode: 1, hasTransparency: true, transparencyType: "CUTOUT", luminance: 10,
      boundingBoxes: [{ mx: 3, my: 0, mz: 3, Mx: 13, My: 2, Mz: 13, subtract: false }, { mx: 7, my: 2, mz: 7, Mx: 9, My: 10, Mz: 9, subtract: false }, { mx: 5, my: 10, mz: 5, Mx: 11, My: 16, Mz: 11, subtract: false }], creativeTabs: ["DECORATIONS"] },
    ruby_gem_block: { texture: "textures/ruby_block.png", name: "Ruby Gem Block", renderType: 3, customModelName: "ruby_gem", hasTransparency: true, transparencyType: "TRANSLUCENT", boundingBoxes: [{ mx: 3, my: 1, mz: 3, Mx: 13, My: 15, Mz: 13, subtract: false }] },
    ruby_pedestal: { texture: "textures/ruby_block.png", name: "Ruby Pedestal", renderType: 2, customModelName: "ruby_pedestal" },
    // KUYRUK 161: the block's own textures for its custom model's slots (a JSON variable with an animated texture, an OBJ material).
    ruby_lamp_recolored: { texture: "textures/ruby_block.png", name: "Ruby Lamp Recolored", renderType: 2, customModelName: "ruby_lamp", hasTransparency: true, transparencyType: "CUTOUT",
      customModelTextures: { "0": "textures/ruby.png", "1": "textures/toggle_on.png" } },
    ruby_gem_recolored: { texture: "textures/ruby_block.png", name: "Ruby Gem Recolored", renderType: 3, customModelName: "ruby_gem", hasTransparency: true, transparencyType: "TRANSLUCENT",
      customModelTextures: { ember: "textures/ruby.png" } },
    // KUYRUK #46: one block carrying the fields the ETR audit found missing (item display, material, ...).
    legacy_match_block: { texture: "textures/ruby_block.png", name: "Legacy Match Block", material: "METAL", itemDisplay: '{"thirdperson_righthand":{"rotation":[10,-45,170],"translation":[0,1.5,-2.75],"scale":[0.375,0.375,0.375]}}' },
    // Energy and a water-only tank with no inventory (KUYRUK #27).
    ruby_tank: { texture: "textures/ruby_block.png", name: "Ruby Tank", hasEnergyStorage: true, energyCapacity: 1000, energyMaxReceive: 200, energyMaxExtract: 100, energyInitial: 50, isFluidTank: true, fluidCapacity: 8000, fluidRestrictions: [{ fluid: "minecraft:water" }], onRandomUpdateEvent: "tank_client_probe" },
    // Java model blocks (KUYRUK #21): block entity renderer with animations (one always, one behind a condition).
    ruby_statue: { texture: "textures/ruby_block.png", name: "Ruby Statue", renderType: 4, customModelName: "ruby_beast", rotationMode: 1, animations: [{ animation: "IDLE", speed: 1 }, { animation: "WALK", speed: 2, condition: "always" }] },
    // Block states (KUYRUK #22): logic, integer and text properties; rows with texture + boxes, a JSON model, a built-in shape; a bad row.
    ruby_switch: { texture: "textures/ruby_block.png", name: "Ruby Switch", rotationMode: 1,
      customProperties: [{ name: "lit", type: "logic", value: "false" }, { name: "level", type: "integer", min: 0, max: 3, value: "1" }, { name: "mood", type: "string", arrayData: [{ value: "calm" }, { value: "angry" }], value: "calm" }],
      states: [
        { stateMap: { lit: "true" }, texture: "textures/ruby.png", hasCustomBoundingBox: true, boundingBoxes: [{ mx: 0, my: 0, mz: 0, Mx: 16, My: 8, Mz: 16, subtract: false }] },
        { stateMap: { mood: "angry", facing: "north" }, texture: "textures/ruby_block.png", renderType: 2, customModelName: "ruby_lamp" },
        { stateMap: { level: "3" }, renderType: 11, texture: "textures/ruby_apple.png" },
        { stateMap: { nope: "1" }, texture: "textures/ruby_block.png" },
      ] },
    ruby_layers: { texture: "textures/ruby_block.png", name: "Ruby Layers", multipartModel: true, hasTransparency: true, transparencyType: "CUTOUT",
      customProperties: [{ name: "top", type: "logic", value: "true" }], states: [{ stateMap: { top: "true" }, texture: "textures/ruby_block.png", renderType: 2, customModelName: "ruby_lamp" }] },
    missing_model_block: { texture: "textures/ruby_block.png", name: "Missing Model Block", renderType: 3, customModelName: "no_such_model" },
    ruby_safe: { texture: "textures/ruby_block.png", name: "Ruby Safe", hasInventory: true, guiBoundTo: "ruby_gui", openGUIOnRightClick: true, inventoryDropWhenDestroyed: false, inventoryComparatorPower: false, onRightClicked: "entity_log" },
  },
  game_rule: { snake_probe_rule: { displayName: "Snake probe rule", description: "KUYRUK 46 R1: a name that is not camelCase", category: "PLAYER", type: "Number", defaultValueNumber: 7, ruleName: "snake_probe_rule" }, probe_rule: { displayName: "Probe rule", description: "KUYRUK 37", category: "PLAYER", type: "Number", defaultValueNumber: 5 } },
  command: {
    // Runtime check of KUYRUK #37 on every engine (commands-rules-*.txt, expected lines in tools/codegen-test/rules-check.sh).
    probecmd: { commandName: "probe", permissionLevel: "No requirement", argsxml: { format: 1, variables: [{ name: "stack", type: "itemstack" }], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] legacy goldPrice ", b: { block: "text_from_number", inputs: { value: { block: "global_number_get", fields: { var: "goldPrice" } } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] rule ", b: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule: "probeRule" } } } } } } } },
      // KUYRUK 51: a rule whose ruleName is snake_case is found by its camelCase name, by its snake_case name, and set under either.
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] snake camel ", b: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule: "snakeProbeRule" } } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] snake exact ", b: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule: "snake_probe_rule" } } } } } } } },
      { block: "world_set_game_rule_number", fields: { rule: "snakeProbeRule" }, inputs: { value: 11 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] snake set ", b: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule: "snake_probe_rule" } } } } } } } },
      { block: "world_set_game_rule_number", fields: { rule: "probeRule" }, inputs: { value: 43 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] set ", b: { block: "text_from_number", inputs: { value: { block: "world_game_rule_number", fields: { rule: "probeRule" } } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] logic ", b: { block: "text_from_logic", inputs: { value: { block: "world_game_rule_logic", fields: { rule: "keepInventory" } } } } } } } },
      { block: "local_itemstack_set", fields: { var: "stack" }, inputs: { value: { block: "item_stack", fields: { item: "minecraft:iron_pickaxe" }, inputs: { count: 1 } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] text ", b: { block: "text_from_itemstack", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } } } },
      { block: "item_hurt_break", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } }, amount: 3 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] damage ", b: { block: "text_from_number", inputs: { value: { block: "item_damage", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } } } } } },
      { block: "item_hurt_break", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } }, amount: 9999 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] broken ", b: { block: "text_from_itemstack", inputs: { itemstack: { block: "local_itemstack_get", fields: { var: "stack" } } } } } } } },
      // KUYRUK #27: limits of energy and tanks; a second run in the same world prints what the first left, so saving shows.
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] energy ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] energy capacity ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "capacity" }, inputs: tankAt } } } } } } },
      { block: "block_energy_receive", inputs: { ...tankAt, amount: 300 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] energy received ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      { block: "block_energy_extract", inputs: { ...tankAt, amount: 999 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] energy extracted ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      // KUYRUK 99: a negative receive drains, past the extract limit (100): 150 + 200 - 250 = 100 on every engine.
      { block: "block_energy_receive", inputs: { ...tankAt, amount: 300 } },
      { block: "block_energy_receive", inputs: { ...tankAt, amount: -250 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] energy drained ", b: { block: "text_from_number", inputs: { value: { block: "block_energy", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      // KUYRUK 99: procedures write and read a block's slot without a side (1.16.5 asked the item handler with a null side).
      { block: "block_set_slot_item", inputs: { ...chestAt, slot: 1, itemstack: { block: "item_stack", fields: { item: "minecraft:diamond" }, inputs: { count: 5 } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] slot ", b: { block: "text_from_number", inputs: { value: { block: "item_count", inputs: { itemstack: { block: "block_slot_item", inputs: { ...chestAt, slot: 1 } } } } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] fluid ", b: { block: "text_from_number", inputs: { value: { block: "block_fluid", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] fluid capacity ", b: { block: "text_from_number", inputs: { value: { block: "block_fluid", fields: { what: "capacity" }, inputs: tankAt } } } } } } },
      { block: "block_fluid_fill", fields: { fluid: "minecraft:lava" }, inputs: { ...tankAt, amount: 500 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] lava refused ", b: { block: "text_from_number", inputs: { value: { block: "block_fluid", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      { block: "block_fluid_fill", fields: { fluid: "minecraft:water" }, inputs: { ...tankAt, amount: 5000 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] filled ", b: { block: "text_from_number", inputs: { value: { block: "block_fluid", fields: { what: "stored" }, inputs: tankAt } } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] fluid id ", b: { block: "block_fluid_id", inputs: tankAt } } } } },
      { block: "block_fluid_drain", inputs: { ...tankAt, amount: 1000 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] drained ", b: { block: "text_from_number", inputs: { value: { block: "block_fluid", fields: { what: "stored" }, inputs: tankAt } } } } } } },
    ] }] } },
    typedcmd: { commandName: "typed", commandArguments: "word:kind double:amount player:target logic:flag", permissionLevel: "No requirement", argsxml: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "call_procedure", fields: { procedure: "plain_log" } },
      { block: "log", inputs: { text: { block: "entity_name", inputs: { entity: { block: "command_arg_entity", fields: { name: "target" } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: { block: "command_arg_text", fields: { name: "kind" } }, b: { block: "text_from_number", inputs: { value: { block: "command_arg_number", fields: { name: "amount" } } } } } } } },
    ] }] } },
    entityprobe: { commandName: "entityprobe", permissionLevel: "No requirement", argsxml: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[probe] cmd entity ", b: { block: "entity_name", inputs: { entity: { block: "dep_entity", fields: { dep: "entity" } } } } } } } }] }] } }, // KUYRUK 46 C1+C2: no tail argument, returns 0, fake player without an entity
    rubycmd: { commandName: "ruby", permissionLevel: "No requirement", argsxml: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[wavethree] ruby command word ", b: { block: "command_param_text", inputs: { index: 0 } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[wavethree] ruby command number ", b: { block: "command_param_number", inputs: { index: 1 } } } } } },
      { block: "call_procedure", fields: { procedure: "plain_log" } },
    ] }] } },
    // KUYRUK 139: every tag of config/common-tags.json (and the c: tags, which map back on 1.16.5) as a procedure gets it:
    // a random item of the item tag and a block tag test (tags-check.ts reads the "[tag]" lines).
    tagprobe: { commandName: "tagprobe", permissionLevel: "No requirement", argsxml: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" },
      ...PROBE_TAGS.map((tag) => ({ block: "log", inputs: { text: { block: "text_join", inputs: { a: `[tag] item ${tag} `, b: { block: "item_id", inputs: { itemstack: { block: "item_random_in_tag", fields: { tag } } } } } } } })),
      ...([["forge:dirt", "minecraft:dirt"], ["forge:planks", "minecraft:oak_planks"], ["forge:logs", "minecraft:oak_log"], ["forge:stone", "minecraft:stone"], ["c:stones", "minecraft:stone"]] as const).map(([tag, block]) =>
        ({ block: "log", inputs: { text: { block: "text_join", inputs: { a: `[tag] block ${tag} ${block} `, b: { block: "text_from_logic", inputs: { value: { block: "block_in_tag", fields: { tag }, inputs: { blockstate: { block: "block_state_of", fields: { block } } } } } } } } } })),
    ] }] } },
    rubyop: { commandName: "rubyop", type: "MULTIPLAYER_ONLY", permissionLevel: "2" },
    rubyclient: { commandName: "rubyclient", type: "CLIENTSIDE", argsxml: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[wavethree] client command ", b: { block: "command_param_text", inputs: { index: 0 } } } } } },
    ] }] } },
  },
  creative_tab: {
    gem_tab: { name: "Gems", icon: "gem_a", order: [
      { kind: "element", type: "item", id: "gem_c" }, { kind: "section", title: "Gems" }, { kind: "spacer", slots: 2 },
      { kind: "element", type: "item", id: "gem_a" }, { kind: "spacer" }, { kind: "element", type: "armor", id: "ruby_armor" }, { kind: "end" },
      { kind: "element", type: "item", id: "not_in_tab" },
    ] },
  },
  armor: {
    ruby_armor: { creativeTabs: ["COMBAT", "gem_tab"], textureHelmet: T, textureBody: T, textureLeggings: T, textureBoots: T, armorTextureFile: "textures/ruby_block.png", helmetName: "Ruby Helmet", bodyName: "Ruby Chestplate", leggingsName: "Ruby Leggings", bootsName: "Ruby Boots",
      helmetSpecialInformationProcedure: "ruby_tooltip", bootsSpecialInformation: "Plain boots", leggingsSpecialInformationProcedure: "ruby_tooltip" },
    // Custom worn model (models/ruby_crown.java) on every piece, a translucent chestplate, JSON and OBJ item models.
    crown_armor: { textureHelmet: T, textureBody: T, textureLeggings: T, textureBoots: T, armorTextureFile: "textures/ruby_block.png", helmetName: "Ruby Crown", bodyName: "Ruby Mantle", leggingsName: "Ruby Greaves", bootsName: "Ruby Sabatons",
      helmetModelName: "ruby_crown", helmetModelPart: "Head", helmetModelTexture: "models/ruby_crown.png", helmetItemRenderType: 1, helmetItemCustomModelName: "ruby_lamp",
      bodyModelName: "ruby_crown", bodyModelPart: "Body", armsModelPartL: "LeftArm", armsModelPartR: "RightArm", bodyModelTexture: "models/ruby_crown.png", bodyTranslucency: true,
      leggingsModelName: "ruby_crown", leggingsModelPartL: "LeftLeg", leggingsModelPartR: "RightLeg", leggingsModelTexture: "models/ruby_crown.png",
      bootsModelName: "ruby_crown", bootsModelPartL: "LeftLeg", bootsModelPartR: "RightLeg", bootsItemRenderType: 2, bootsItemCustomModelName: "ruby_gem" },
  },
  tool: {
    ruby_shield: { texture: T, name: "Ruby Shield", toolType: "Shield", model: "ruby_lamp", blockingModel: "ruby_gem" },
    ruby_sword: { texture: T, name: "Ruby Sword", toolType: "Sword", model: "ruby_gem", guiTexture: "textures/ruby_apple.png" },
    ruby_buckler: { texture: "textures/ruby_block.png", name: "Ruby Buckler", toolType: "Shield", model: "ruby_imp", blockingModel: "ruby_beast" },
    ruby_club: { texture: "textures/ruby_block.png", name: "Ruby Club", toolType: "Sword", model: "ruby_imp", blockingModel: "Normal blocking", guiTexture: "textures/ruby_apple.png" },
  },
  item_extension: {
    stick_fuel: { item: "minecraft:stick", enableFuel: true, fuelPower: 400, compostLayerChance: 0.3 },
    ruby_fuel: { item: "ruby", enableFuel: true, fuelPower: 3200 },
    ruby_compost: { item: "ruby_bag", compostLayerChance: 0.65 },
    wand_fuel: { item: "ruby_wand", enableFuel: true, fuelPower: 100, fuelPowerProcedure: "fuel_time", fuelSuccessCondition: "always", hasDispenseBehavior: true, dispenseSuccessCondition: "always", dispenseResultItemstack: "dispense_result" },
    apple_dispense: { item: "minecraft:apple", hasDispenseBehavior: true },
  },
  overlay: {
    ruby_hud: { priority: "HIGH", displayCondition: "always", baseTexture: "", components: [
      { kind: "label", name: "hello", x: 4, y: 4, text: "Ruby HUD", color: "#FF5555" },
      { kind: "image", x: 4, y: 16, image: "textures/ruby.png", width: 16, height: 16, condition: "never" },
      { kind: "label", x: 4, y: 34, textProcedure: "ruby_tooltip", condition: "always", color: "#FF5555" },
    ] },
    ruby_vignette: { baseTexture: "textures/ruby_block.png", displayCondition: "never", components: [] },
    chest_note: { overlayTarget: "Chest", priority: "LOW", displayCondition: "always", components: [{ kind: "label", x: 4, y: 4, text: "Ruby chest", color: "#FFAA00" }] },
    title_note: { overlayTarget: "MainMenu", priority: "HIGHEST", components: [{ kind: "label", x: 4, y: 4, text: "Wave Three", color: "#FFFFFF" }] },
    dialog_note: { overlayTarget: "SimpleDialog", components: [{ kind: "label", x: 4, y: 4, text: "26.x only", color: "#FFFFFF" }] },
    // KUYRUK 170: anchors (the overlay's, a widget's own) and the scale modes.
    corner_hud: { anchor: "bottom", displayCondition: "always", components: [
      { kind: "label", name: "corner_tl", x: 4, y: 4, text: "Top left", color: "#55FF55", anchor: "top_left" },
      { kind: "image", x: 407, y: 220, image: "textures/ruby.png", width: 16, height: 16, anchor: "bottom_right" },
      { kind: "label", name: "corner_b", x: 190, y: 200, text: "Bottom", color: "#55FFFF" },
    ] },
    styled_hud: { displayCondition: "always", components: [
      { kind: "label", name: "hud_boxed", x: 4, y: 60, text: "Boxed HUD", color: "#FFFF55", background: "#000000", backgroundOpacity: 50 },
      { kind: "label", name: "hud_mid", x: 213, y: 4, text: "Centred HUD", color: "#FFFFFF", align: "center", anchor: "top" },
    ] },
    // KUYRUK 186: state images on an overlay (static state fields), by conditions and by a procedure read every 5 ticks.
    state_hud: { displayCondition: "always", components: [
      { kind: "state_image", x: 4, y: 100, width: 16, height: 16, states: [{ image: "textures/ruby.png", condition: "never" }, { image: "textures/toggle_on.png", condition: "always" }] },
      { kind: "state_image", x: 24, y: 100, width: 16, height: 16, stateProcedure: "beast_scale", updateTicks: 5, anchor: "left",
        states: [{ image: "textures/spark_strip.png", frame: 0 }, { image: "textures/spark_strip.png", frame: 1 }] },
    ] },
    fit_hud: { anchor: "top_right", scaleMode: "fit", displayCondition: "always", components: [{ kind: "label", name: "fit_tr", x: 360, y: 4, text: "Fit", color: "#FFFF55" }] },
    fixed_hud: { scaleMode: "fixed", fixedScale: 3, displayCondition: "always", components: [{ kind: "label", name: "fixed_c", x: 200, y: 116, text: "Fixed", color: "#FF55FF" }] },
  },
  item: {
    ruby: { texture: T, name: "Ruby", creativeTabs: ["MATERIALS"] },
    // KUYRUK 98: the gem_tab order (gem_c first, a section, a 2-slot spacer, gem_a, the four armor pieces; gem_b unordered).
    // KUYRUK 172: an end marker after the armor, so gem_b (appended) stands outside the section.
    gem_a: { texture: T, name: "Gem A", creativeTabs: ["gem_tab"] },
    gem_b: { texture: T, name: "Gem B", creativeTabs: ["gem_tab"] },
    gem_c: { texture: T, name: "Gem C", creativeTabs: ["MATERIALS", "gem_tab"] },
    // KUYRUK #46 (I2, I3): a drink with a finish procedure, a left-behind bottle and its own drinking sound.
    legacy_potion: { texture: T, name: "Legacy Potion", stackSize: 3, isFood: true, animation: "drink", useDuration: 30, isAlwaysEdible: true, eatResultItem: "minecraft:glass_bottle", onFinishUsingItem: "entity_log", useSound: "minecraft:entity.generic.drink" },
    ruby_bag: { texture: T, name: "Ruby Bag", stackSize: 1, guiBoundTo: "ruby_gui", openGUIOnRightClick: true, inventorySize: 3, inventoryStackSize: 16 },
    ruby_wand: { texture: T, name: "Ruby Wand", guiBoundTo: "plain_screen", openGUIOnRightClick: true, onRightClickedInAir: "entity_log" },
    // KUYRUK 46 I1: runs before the clicked block's own use (onItemUseFirst; a UseBlockCallback on Fabric).
    use_first_probe: { texture: T, name: "Use First Probe", onRightClickedOnBlock: "entity_log" },
    // KUYRUK 46 I4: a damaged crafting remainder is not repairable on 1.16.5 (MCreator rule).
    worn_file: { texture: T, name: "Worn File", damageCount: 64, stayInGridWhenCrafting: true, damageOnCrafting: true },
    ruby_scepter: { texture: T, name: "Ruby Scepter", model: "ruby_gem" },
    ruby_beacon: { texture: T, name: "Ruby Beacon", model: "ruby_lamp" },
    // KUYRUK #23: the block ruby_lamp's item field must not collide with this item's field.
    ruby_lamp_item: { texture: T, name: "Ruby Lamp Item" },
    ruby_totem: { texture: "textures/ruby_block.png", name: "Ruby Totem", model: "ruby_beast", guiTexture: T, animations: [{ animation: "idle", speed: 1 }, { animation: "walk", speed: 2, condition: "always" }] },
    // Item states (KUYRUK #22): a custom property from a procedure and the built-in damaged property.
    ruby_charm: { texture: T, name: "Ruby Charm", damageCount: 50, customProperties: { charge: "beast_scale" }, states: [{ stateMap: { charge: 1 }, model: "Normal", texture: "textures/ruby_apple.png" }, { stateMap: { damaged: 1 }, model: "Tool" }] },
    ruby_idol: { texture: "textures/ruby_block.png", name: "Ruby Idol", model: "ruby_imp" },
    ruby_bow: { texture: T, name: "Ruby Bow", model: "Ranged item" },
    ruby_launcher: { texture: T, name: "Ruby Launcher", stackSize: 1, onRightClickedInAir: "shoot_ruby", specialInformation: "hidden", specialInformationProcedure: "ruby_tooltip" },
  },
};
