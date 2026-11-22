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
/** Q205: the session the entity's open GUI shows, and a log line "<prefix><session> <rest>". */
const sessionOf = { block: "gui_session_id", inputs: { entity: dep } };
// Q263 data_probe helpers: the probe's mob variable, a saved value read, and a left-leaning text join of many parts.
const dataMob = { block: "local_entity_get", fields: { var: "mob" } };
const cartRef = { block: "local_entity_get", fields: { var: "cart" } };
/** Q264: the item id in a hand of an entity. */
const handId = (entity: unknown, hand: string) => ({ block: "item_id", inputs: { itemstack: { block: "player_hand_item", fields: { hand }, inputs: { entity } } } });
/** Q265 structure probe helpers. */
const idx = { block: "local_number_get", fields: { var: "i" } };
const sCount = (structure: string, air = false) => ({ block: "structure_block_count", fields: { air }, inputs: { structure } });
const sSize = (structure: string, axis: string) => ({ block: "structure_size", fields: { axis }, inputs: { structure } });
const sPos = (structure: string, axis: string) => ({ block: "structure_block_pos", fields: { axis, air: false }, inputs: { structure, index: idx } });
const addN = (a: unknown, b: unknown) => ({ block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a, b } });
/** Logs the count and size of a structure, then places it block by block at the origin and logs the first `shown` entries. */
const structureProbe = (tag: string, structure: string, origin: [number, number, number], shown: number, facing: boolean) => [
  { block: "log", inputs: { text: joinAll(`[struct] ${tag} count `, fromNumber(sCount(structure)), " air ", fromNumber(sCount(structure, true)), " size ", fromNumber(sSize(structure, "x")), " ", fromNumber(sSize(structure, "y")), " ", fromNumber(sSize(structure, "z"))) } },
  { block: "for_range", fields: { var: "i" }, inputs: { from: 0, to: { block: "math_arithmetic", fields: { op: "MINUS" }, inputs: { a: sCount(structure), b: 1 } }, step: 1, do: [
    { block: "block_place_state", inputs: {
      blockstate: { block: "structure_block_state", fields: { air: false }, inputs: { structure, index: idx } },
      x: addN(origin[0], sPos(structure, "x")), y: addN(origin[1], sPos(structure, "y")), z: addN(origin[2], sPos(structure, "z")) } },
    { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "LT" }, inputs: { a: idx, b: shown } }, then: [
      { block: "log", inputs: { text: joinAll(`[struct] ${tag} #`, fromNumber(idx), " ", { block: "structure_block_id", fields: { air: false }, inputs: { structure, index: idx } }, " ",
        fromNumber(sPos(structure, "x")), " ", fromNumber(sPos(structure, "y")), " ", fromNumber(sPos(structure, "z")),
        ...(facing ? [" ", { block: "block_state_text", fields: { property: "facing" }, inputs: { blockstate: { block: "structure_block_state", fields: { air: false }, inputs: { structure, index: idx } } } }] : [])) } },
    ] } },
  ] } },
  { block: "log", inputs: { text: `[struct] ${tag} placed` } },
];
const savedGet = (type: string, key: string) => ({ block: `entity_saved_get_${type}`, inputs: { entity: dataMob, key } });
const fromNumber = (value: unknown) => ({ block: "text_from_number", inputs: { value } });
const fromLogic = (value: unknown) => ({ block: "text_from_logic", inputs: { value } });
const joinAll = (...parts: unknown[]): unknown => parts.reduce((a, b) => ({ block: "text_join", inputs: { a, b } }));
const sessionLine = (prefix: string, rest: unknown) => ({ block: "text_join", inputs: { a: prefix, b: { block: "text_join", inputs: { a: sessionOf, b: { block: "text_join", inputs: { a: " ", b: rest } } } } } });
/** Q227: "<menu> <tab> <slice>" of the chosen radial menu slice. */
const depText = (name: string) => ({ block: "dep_text", fields: { dep: name } });
const radialChoice = { block: "text_join", inputs: { a: depText("menu"), b: { block: "text_join", inputs: { a: " ", b: { block: "text_join", inputs: { a: depText("tab"),
  b: { block: "text_join", inputs: { a: " ", b: depText("slice") } } } } } } } };
/** Q227: a radial menu slice with every slice field (the test project writes list rows of nested lists as given). */
const slice = (id: string, values: Record<string, unknown>) => ({ id, label: "", description: "", iconKind: "none", icon: "", item: "minecraft:stone", action: "none", command: "",
  procedure: "", menu: "", gui: "", bubble: "", caption: "", duration: -1, image: "", condition: "", conditionMode: "hidden", ...values });
/** Q203: the slot id onSlotChanged gets, and the change count it keeps in the block's data. */
const slotDep = { block: "dep_number", fields: { dep: "slot" } };
const changes = { block: "block_data_number", inputs: { x: dx, y: dy, z: dz, key: "changes" } };
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
    // Q256: full item stack comparison (item + data, count ignored); compile coverage on every engine.
    stackcmp_probe: { title: "Stack compare probe", returnType: "none", globalTrigger: "player_use_hoe", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" },
      { block: "if", inputs: { cond: { block: "compare_itemstacks_full", inputs: { a: { block: "dep_itemstack", fields: { dep: "itemstack" } }, b: { block: "item_empty" } } }, then: [{ block: "log", inputs: { text: "[probe] stack equal" } }] } },
    ] }] } },
    // Q261: entity_navigate_to / entity_navigation_done. Once per server tick the nearest entity around 0 100 0 (the pig the
    // runtime script summons) is walked to 10.5 100 0.5; logs "[nav] go", "[nav] walking" (navigation busy) and "[nav] arrived".
    nav_probe: { title: "Navigation probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [{ name: "mob", type: "entity" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "local_entity_set", fields: { var: "mob" }, inputs: { value: { block: "world_nearest_entity", inputs: { x: 0.5, y: 100, z: 0.5, range: 40 } } } },
      { block: "if", inputs: { cond: { block: "entity_exists", inputs: { entity: { block: "local_entity_get", fields: { var: "mob" } } } }, then: [
        { block: "if_else", inputs: { cond: { block: "entity_navigation_done", inputs: { entity: { block: "local_entity_get", fields: { var: "mob" } } } },
          then: [{ block: "if_else", inputs: { cond: { block: "logic_compare", fields: { op: "GT" }, inputs: { a: { block: "entity_distance_to", inputs: { entity: { block: "local_entity_get", fields: { var: "mob" } }, x: 10.5, y: 100, z: 0.5 } }, b: 1.5 } },
            then: [
              { block: "entity_navigate_to", inputs: { entity: { block: "local_entity_get", fields: { var: "mob" } }, x: 10.5, y: 100, z: 0.5, speed: 1 } },
              { block: "log", inputs: { text: "[nav] go" } },
            ],
            else: [{ block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 20 } }, b: 0 } }, then: [{ block: "log", inputs: { text: "[nav] arrived" } }] } }] } }],
          else: [{ block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 20 } }, b: 0 } }, then: [{ block: "log", inputs: { text: "[nav] walking" } }] } }] } },
      ] } },
    ] }] } },
    // Q263: entity_saved_*. Once per server tick the nearest entity around 0 100 0 (the pig the runtime script summons): when its
    // saved logic "probe_set" is false it gets a number, a text and a logic value and logs "[data] wrote"; afterwards, once a second, it logs
    // "[data] read <number> <text> <logic> missing <number> <text> <logic>" (the last three are keys never written, so the defaults).
    // A second server run on the same world must log "read" with the saved values and never "wrote".
    data_probe: { title: "Entity data probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [{ name: "mob", type: "entity" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "local_entity_set", fields: { var: "mob" }, inputs: { value: { block: "world_nearest_entity", inputs: { x: 0.5, y: 100, z: 0.5, range: 40 } } } },
      { block: "if", inputs: { cond: { block: "entity_exists", inputs: { entity: dataMob }, }, then: [
        { block: "if_else", inputs: { cond: savedGet("logic", "probe_set"),
          then: [{ block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 20 } }, b: 0 } }, then: [
            { block: "log", inputs: { text: joinAll("[data] read ", fromNumber(savedGet("number", "probe_n")), " ", savedGet("text", "probe_t"), " ", fromLogic(savedGet("logic", "probe_l")),
              " missing ", fromNumber(savedGet("number", "probe_none")), " ", savedGet("text", "probe_none"), " ", fromLogic(savedGet("logic", "probe_none"))) } },
          ] } }],
          else: [
            { block: "entity_saved_set_number", inputs: { entity: dataMob, key: "probe_n", value: 42.5 } },
            { block: "entity_saved_set_text", inputs: { entity: dataMob, key: "probe_t", value: "hello_world" } },
            { block: "entity_saved_set_logic", inputs: { entity: dataMob, key: "probe_l", value: true } },
            { block: "entity_saved_set_logic", inputs: { entity: dataMob, key: "probe_set", value: true } },
            { block: "log", inputs: { text: joinAll("[data] wrote ", { block: "entity_type_id", inputs: { entity: dataMob } }) } },
          ] } },
      ] } },
    ] }] } },
    // Q264: entity_swing_arm and the hand blocks on a mob. Every 40 ticks the procedure spawns its own pig (and a minecart, a non-living
    // entity), puts a diamond pickaxe in the pig's main hand and a torch in its off hand, logs "[hold] pig main <id> off <id>", swings both
    // arms, logs "[hold] swung", then does the same calls on the minecart and logs "[hold] minecart main <id>" (must stay air, no error), and kills both.
    hold_probe: { title: "Hold probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [{ name: "mob", type: "entity" }, { name: "cart", type: "entity" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 40 } }, b: 0 } }, then: [
        { block: "local_entity_set", fields: { var: "mob" }, inputs: { value: { block: "world_spawn_entity_get", fields: { type: "minecraft:pig" }, inputs: { x: 0.5, y: 100, z: 0.5 } } } },
        { block: "local_entity_set", fields: { var: "cart" }, inputs: { value: { block: "world_spawn_entity_get", fields: { type: "minecraft:minecart" }, inputs: { x: 3.5, y: 100, z: 0.5 } } } },
        { block: "player_set_hand_item", fields: { hand: "main" }, inputs: { entity: dataMob, itemstack: { block: "item_stack", fields: { item: "minecraft:diamond_pickaxe" }, inputs: { count: 1 } } } },
        { block: "player_set_hand_item", fields: { hand: "off" }, inputs: { entity: dataMob, itemstack: { block: "item_stack", fields: { item: "minecraft:torch" }, inputs: { count: 1 } } } },
        { block: "log", inputs: { text: joinAll("[hold] pig main ", handId(dataMob, "main"), " off ", handId(dataMob, "off")) } },
        { block: "entity_swing_arm", fields: { hand: "main" }, inputs: { entity: dataMob } },
        { block: "entity_swing_arm", fields: { hand: "off" }, inputs: { entity: dataMob } },
        { block: "log", inputs: { text: "[hold] swung" } },
        { block: "player_set_hand_item", fields: { hand: "main" }, inputs: { entity: cartRef, itemstack: { block: "item_stack", fields: { item: "minecraft:diamond_pickaxe" }, inputs: { count: 1 } } } },
        { block: "entity_swing_arm", fields: { hand: "main" }, inputs: { entity: cartRef } },
        { block: "log", inputs: { text: joinAll("[hold] minecart main ", handId(cartRef, "main")) } },
        { block: "entity_kill", inputs: { entity: dataMob } },
        { block: "entity_kill", inputs: { entity: cartRef } },
      ] } },
    ] }] } },
    // Q266: a living entity's hurt procedure that returns logic decides the damage. hurt_guard logs "[hurtguard] hurt <amount>" and lets only
    // hits of 10 or more through. Every 40 ticks hurtguard_probe spawns a hurt_guard_mob (health 20), hits it for 4 (cancelled) and 12 (kept),
    // logs its health after each and kills it: expected "[hurtguard] after small 20" and "[hurtguard] after big 8".
    hurt_guard: { title: "Hurt guard", returnType: "logic", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: joinAll("[hurtguard] hurt ", fromNumber({ block: "dep_number", fields: { dep: "amount" } })) } },
      { block: "return_logic", inputs: { value: { block: "logic_compare", fields: { op: "GTE" }, inputs: { a: { block: "dep_number", fields: { dep: "amount" } }, b: 10 } } } },
    ] }] } },
    hurtguard_probe: { title: "Hurt guard probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [{ name: "mob", type: "entity" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 40 } }, b: 0 } }, then: [
        { block: "local_entity_set", fields: { var: "mob" }, inputs: { value: { block: "world_spawn_entity_get", fields: { type: "wavethree:hurt_guard_mob" }, inputs: { x: 6.5, y: 100, z: 6.5 } } } },
        { block: "damage_deal", fields: { type: "generic" }, inputs: { entity: dataMob, amount: 4 } },
        { block: "log", inputs: { text: joinAll("[hurtguard] after small ", fromNumber({ block: "entity_health", inputs: { entity: dataMob } })) } },
        { block: "damage_deal", fields: { type: "generic" }, inputs: { entity: dataMob, amount: 12 } },
        { block: "log", inputs: { text: joinAll("[hurtguard] after big ", fromNumber({ block: "entity_health", inputs: { entity: dataMob } })) } },
        { block: "entity_kill", inputs: { entity: dataMob } },
      ] } },
    ] }] } },
    // Q265: structure_* blocks. Every 40 ticks the procedure logs the count and size of the project template "probe_house" (without and with air)
    // and of vanilla minecraft:igloo/top, places both block by block (house at 0 100 0, igloo at 4 100 0) and logs the first entries; out-of-range reads
    // are logged too. The runtime script compares the log with the template and the igloo with a vanilla /place template copy.
    // Q268: it runs only while the marker gold block at 15 99 15 stands (set and removed by commands-structprobe.txt), so other runtime checks
    // that share the area (rules, energy tank at 0 100 0) are not overwritten.
    structure_probe: { title: "Structure probe", returnType: "none", globalTrigger: "server_ticks", program: { format: 1, variables: [{ name: "i", type: "number" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "if", inputs: { cond: { block: "logic_operation", fields: { op: "AND" }, inputs: { a: { block: "block_at_is", fields: { block: "minecraft:gold_block" }, inputs: { x: 15, y: 99, z: 15 } }, b: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: "world_time" }, b: 40 } }, b: 0 } } } }, then: [
        ...structureProbe("house", "probe_house", [0, 100, 0], 8, true),
        ...structureProbe("igloo", "minecraft:igloo/top", [4, 100, 0], 3, false),
        { block: "log", inputs: { text: joinAll("[struct] misc missing ", fromNumber(sCount("nothing_here")), " range [", { block: "structure_block_id", fields: { air: false }, inputs: { structure: "probe_house", index: 99 } }, "] air0 ",
          { block: "structure_block_id", fields: { air: true }, inputs: { structure: "probe_house", index: 1 } }) } },
      ] } },
    ] }] } },
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
    // Q262: ai_work. The condition holds while a redstone block stands at 20 100 20 (the runtime script sets and removes it); the tick procedure logs "[work] tick".
    work_on: { title: "Work on", returnType: "logic", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" },
      { block: "return_logic", inputs: { value: { block: "block_at_is", fields: { block: "minecraft:redstone_block" }, inputs: { x: 20, y: 100, z: 20 } } } }] }] } },
    work_tick: { title: "Work tick", returnType: "none", program: log("[work] tick") },
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
    // Q229: restarts playback_gui's procedure-started image (a client block, sent to the player from the server).
    replay_gui_image: { title: "Replay GUI image", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "gui_image_restart", fields: { gui: "playback_gui" }, inputs: { image: "replay" } },
    ] }] } },
    // Q202: the server-wide player loop (with the player's own y and the procedure's world), the default loop (players
    // of this world only) and player_by_name (case-insensitive, any dimension; none for an unknown name).
    server_players_probe: { title: "Server players probe", returnType: "none", program: { format: 1, variables: [{ name: "p", type: "entity" }], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "for_each_player", fields: { var: "p", scope: "server" }, inputs: { do: [
        { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[players] server ", b: { block: "text_join", inputs: { a: { block: "entity_name", inputs: { entity: { block: "local_entity_get", fields: { var: "p" } } } },
          b: { block: "text_join", inputs: { a: " y ", b: { block: "text_join", inputs: { a: { block: "text_from_number", inputs: { value: { block: "entity_y", inputs: { entity: { block: "local_entity_get", fields: { var: "p" } } } } } },
            b: { block: "text_join", inputs: { a: " world ", b: { block: "world_dimension_id" } } } } } } } } } } } } },
      ] } },
      { block: "for_each_player", fields: { var: "p" }, inputs: { do: [
        { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[players] dimension ", b: { block: "entity_name", inputs: { entity: { block: "local_entity_get", fields: { var: "p" } } } } } } } },
      ] } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[players] byname ", b: { block: "logic_ternary_text", inputs: {
        cond: { block: "entity_exists", inputs: { entity: { block: "player_by_name", inputs: { name: "Q202_NETHER" } } } },
        a: { block: "text_join", inputs: { a: { block: "entity_name", inputs: { entity: { block: "player_by_name", inputs: { name: "Q202_NETHER" } } } },
          b: { block: "text_join", inputs: { a: " y ", b: { block: "text_from_number", inputs: { value: { block: "entity_y", inputs: { entity: { block: "player_by_name", inputs: { name: "Q202_NETHER" } } } } } } } } } },
        b: "none" } } } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[players] missing ", b: { block: "logic_ternary_text", inputs: {
        cond: { block: "entity_exists", inputs: { entity: { block: "player_by_name", inputs: { name: "nobody" } } } }, a: "found", b: "none" } } } } } },
    ] }] } },
    // Q205: session GUI procedures. The lock reads a session value; open and close log the session and its viewers;
    // open also fills hidden slot 3 and stores a value through the session blocks; the label reads it on the client.
    session_locked: { title: "Session locked", returnType: "logic", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "return_logic", inputs: { value: { block: "session_data_logic", inputs: { session: sessionOf, key: "locked" } } } },
    ] }] } },
    session_open_log: { title: "Session open log", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "session_set_slot_item", inputs: { session: sessionOf, slot: 3, itemstack: { block: "item_stack", fields: { item: "minecraft:stone" }, inputs: { count: 1 } } } },
      { block: "session_set_data_text", inputs: { session: sessionOf, key: "note", value: "hello" } },
      { block: "session_set_data_number", inputs: { session: sessionOf, key: "opens", value: { block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a: { block: "session_data_number", inputs: { session: sessionOf, key: "opens" } }, b: 1 } } } },
      { block: "log", inputs: { text: sessionLine("[session] open ", { block: "text_join", inputs: { a: { block: "session_data_text", inputs: { session: sessionOf, key: "note" } },
        b: { block: "text_join", inputs: { a: " opens ", b: { block: "text_from_number", inputs: { value: { block: "session_data_number", inputs: { session: sessionOf, key: "opens" } } } } } } } }) } },
    ] }] } },
    session_close_log: { title: "Session close log", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: sessionLine("[session] closed ", { block: "text_from_number", inputs: { value: { block: "session_viewer_count", inputs: { session: sessionOf } } } }) } },
    ] }] } },
    session_end: { title: "Session end", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "gui_close_session", inputs: { session: sessionOf } },
    ] }] } },
    session_open: { title: "Session open", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "gui_open_session", fields: { gui: "trade_gui" }, inputs: { entity: dep, session: "probe" } },
    ] }] } },
    // Q206: status bubble blocks (icons textures/bubbles/trade.png, wave.png); the runtime probe drives the store directly.
    bubble_probe: { title: "Bubble probe", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "player_bubble_show", inputs: { entity: dep, icon: "trade", duration: 0 } },
      // Q214: a caption and an animated icon (textures/bubbles/wave.png, 4 frames, wave.png.mcmeta).
      { block: "player_bubble_show_text", inputs: { entity: dep, icon: "wave", text: "Ali", duration: 0 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[bubble] block ", b: { block: "player_bubble_icon", inputs: { entity: dep } } } } } },
      { block: "player_bubble_clear", inputs: { entity: dep } },
    ] }] } },
    // Q225: the seat blocks; the runtime probe (seatprobe/) runs it with a fake player next to a chair.
    seat_probe: { title: "Seat probe", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "entity_sit_on_block", inputs: { entity: dep, x: { block: "dep_number", fields: { dep: "x" } }, y: { block: "dep_number", fields: { dep: "y" } }, z: { block: "dep_number", fields: { dep: "z" } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[seat] procedure sitting ", b: { block: "text_from_logic", inputs: { value: { block: "entity_is_sitting", inputs: { entity: dep } } } } } } } },
      { block: "entity_stand_up", inputs: { entity: dep } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[seat] procedure stood ", b: { block: "text_from_logic", inputs: { value: { block: "entity_is_sitting", inputs: { entity: dep } } } } } } } },
    ] }] } },
    // Q227: radial menu slices: a slice procedure and the slice chosen trigger log what was chosen, the never condition greys
    // out a slice, and the radial blocks (open, close, set slice, runtime image bubble) in one procedure.
    radial_slice: { title: "Radial slice", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[radial] procedure ", b: radialChoice } } } },
    ] }] } },
    radial_chosen: { title: "Radial chosen", returnType: "none", globalTrigger: "radial_slice_chosen", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[radial] chosen ", b: radialChoice } } } },
    ] }] } },
    radial_blocks: { title: "Radial blocks", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "radial_set_slice", fields: { menu: "wheel", state: "hidden" }, inputs: { entity: dep, tab: "main", slice: "hello" } },
      { block: "radial_open", fields: { menu: "wheel" }, inputs: { entity: dep } },
      { block: "radial_close", inputs: { entity: dep } },
      { block: "runtime_image_bubble", inputs: { entity: dep, image: "emotes/spin", caption: "Ali", duration: -1 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[radial] image bubble ", b: { block: "player_bubble_icon", inputs: { entity: dep } } } } } },
    ] }] } },
    // Q216: the standard block with a designed bubble element (trade_offer) and with the default bubble.
    bubble_designed: { title: "Bubble designed", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "bubble_show", fields: { bubble: "trade_offer" }, inputs: { entity: dep, caption: "Ali", duration: -1 } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[bubble] designed ", b: { block: "player_bubble_icon", inputs: { entity: dep } } } } } },
      { block: "bubble_show", fields: { bubble: "" }, inputs: { entity: dep, caption: "", duration: 40 } },
      { block: "player_bubble_clear", inputs: { entity: dep } },
    ] }] } },
    session_label: { title: "Session label", returnType: "string", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "return_text", inputs: { value: { block: "text_join", inputs: { a: { block: "session_data_text", inputs: { session: sessionOf, key: "note" } },
        b: { block: "item_name", inputs: { itemstack: { block: "session_slot_item", inputs: { session: sessionOf, slot: 0 } } } } } } } },
    ] }] } },
    // Q203: watch_gui's onSlotChanged counts changes into the block's data and logs "[slot] <id> <count> changes <n>";
    // a change of slot 2 makes it write slot 2 again (stone x n), which must not run it again. watch_write is a
    // procedure write into slot 1; session_slot_log logs the session and slot of trade_gui's changes.
    slot_changed: { title: "Slot changed", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "block_set_data_number", inputs: { x: dx, y: dy, z: dz, key: "changes", value: { block: "math_arithmetic", fields: { op: "ADD" }, inputs: { a: changes, b: 1 } } } },
      { block: "log", inputs: { text: { block: "text_join", inputs: { a: "[slot] ", b: { block: "text_join", inputs: { a: { block: "text_from_number", inputs: { value: slotDep } }, b: { block: "text_join", inputs: { a: " ",
        b: { block: "text_join", inputs: { a: { block: "text_from_number", inputs: { value: { block: "item_count", inputs: { itemstack: { block: "gui_slot_item", inputs: { entity: dep, slot: slotDep } } } } } },
          b: { block: "text_join", inputs: { a: " changes ", b: { block: "text_from_number", inputs: { value: changes } } } } } } } } } } } } } },
      { block: "if", inputs: { cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: slotDep, b: 2 } }, then: [
        { block: "gui_set_slot_item", inputs: { entity: dep, slot: 2, itemstack: { block: "item_stack", fields: { item: "minecraft:stone" }, inputs: { count: changes } } } },
      ] } },
    ] }] } },
    watch_write: { title: "Watch write", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "gui_set_slot_item", inputs: { entity: dep, slot: 1, itemstack: { block: "item_stack", fields: { item: "minecraft:gold_ingot" }, inputs: { count: 2 } } } },
    ] }] } },
    session_slot_log: { title: "Session slot log", returnType: "none", program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [
      { block: "start" },
      { block: "log", inputs: { text: sessionLine("[slotchange] ", { block: "text_from_number", inputs: { value: slotDep } }) } },
    ] }] } },
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
    // Q262: ai_work with a start condition procedure and a tick procedure (continueCondition empty: the start condition is reused).
    hurt_guard_mob: { mobModelTexture: "textures/ruby_block.png", mobName: "Hurt Guard", mobModelName: "Cow", health: 20, spawnThisMob: false, whenMobIsHurt: "hurt_guard", aixml: ai(["ai_float"]) },
    ruby_worker: { mobModelTexture: "textures/ruby_block.png", mobName: "Ruby Worker", mobModelName: "Cow", spawnThisMob: false, aixml: ai(["ai_float"], ["ai_work", { procedure: "work_tick", condition: "work_on" }]) },
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
    // Q229: playback modes of animated GUI images: hold the last frame from opening, ping-pong on the game clock, and
    // one started by a procedure (the button) that holds its first frame until then.
    playback_gui: {
      title: "Playback", type: 0, width: 176, height: 166,
      components: [
        { kind: "image", x: 10, y: 10, width: 32, height: 32, image: "textures/playback_hold.png" },
        { kind: "image", x: 50, y: 10, width: 32, height: 32, image: "textures/playback_pingpong.png", animationStart: "always" },
        { kind: "image", name: "replay", x: 90, y: 10, width: 32, height: 32, image: "textures/playback_hold.png", animationStart: "procedure" },
        { kind: "button", x: 90, y: 50, width: 40, height: 20, text: "Replay", procedure: "replay_gui_image" },
      ],
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
    // Q257: place filters. Slot 0 takes gems (a #forge tag, #c on 1.21+) and is "locked" while `never` is true (false);
    // slot 1 takes only paper and is locked by `never`; slot 2 takes anything; slot 3 is locked by `always`
    // although its filter lists sticks; slot 4 takes only sticks and has a higher index than the plain slot 2 (Q258: shift
    // click offers sticks to slot 4 first). Checked at runtime by filter-runtime.sh and in text by gui-filter-check.ts.
    filter_gui: {
      title: "Filter", type: 1, width: 176, height: 166,
      components: [
        { kind: "slot", x: 25, y: 30, id: 0, lockCondition: "never", allowed: [{ item: "#forge:gems" }] },
        { kind: "slot", x: 43, y: 30, id: 1, lockCondition: "never", allowed: [{ item: "minecraft:paper" }] },
        { kind: "slot", x: 61, y: 30, id: 2 },
        { kind: "slot", x: 79, y: 30, id: 3, lockCondition: "always", allowed: [{ item: "minecraft:stick" }], limit: "minecraft:bone" },
        { kind: "slot", x: 97, y: 30, id: 4, allowed: [{ item: "minecraft:stick" }] },
      ],
    },
    // Q205: slots from a shared session (no block); slot 0 locks by a session value, slot 2 is a display slot, slot 3
    // exists only in the session (inventorySize 4).
    trade_gui: {
      title: "Trade", type: 1, width: 176, height: 166, inventorySource: "session", inventorySize: 4,
      onOpen: "session_open_log", onClosed: "session_close_log", onSlotChanged: "session_slot_log",
      components: [
        { kind: "slot", x: 25, y: 30, id: 0, lockCondition: "session_locked" },
        { kind: "slot", x: 61, y: 30, id: 1 },
        { kind: "slot", x: 97, y: 30, id: 2, keepOnClose: true },
        { kind: "label", x: 8, y: 6, textProcedure: "session_label", color: "#404040" },
        { kind: "button", x: 120, y: 54, width: 40, height: 20, text: "End", procedure: "session_end" },
      ],
    },
    // Q203: three plain slots watched by onSlotChanged (opened over the ruby_chest by the probe, slotchange-runtime.sh).
    watch_gui: {
      title: "Watch", type: 1, width: 176, height: 166, onSlotChanged: "slot_changed",
      components: [{ kind: "slot", x: 25, y: 30, id: 0 }, { kind: "slot", x: 61, y: 30, id: 1 }, { kind: "slot", x: 97, y: 30, id: 2 }],
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
    // Q229: block textures that play once and hold the last frame, and ping-pong.
    playback_hold_block: { texture: "textures/playback_hold.png", name: "Playback Hold Block" },
    playback_pingpong_block: { texture: "textures/playback_pingpong.png", name: "Playback Ping-pong Block" },
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
    // Q225 seats: a chair (one seat, auto height on its slab-high seat box, turns with its facing) and a bench (two seats at a manual height).
    ruby_chair: { texture: "textures/ruby_block.png", name: "Ruby Chair", rotationMode: 1, seatable: true, seats: [{ x: 8, y: 0, z: 7, yaw: 0 }],
      boundingBoxes: [{ mx: 0, my: 0, mz: 0, Mx: 16, My: 8, Mz: 16, subtract: false }, { mx: 0, my: 8, mz: 13, Mx: 16, My: 16, Mz: 16, subtract: false }] },
    ruby_bench: { texture: "textures/ruby_block.png", name: "Ruby Bench", seatable: true, seatHeightMode: "manual", seatEmptyHand: false, seatDismount: "front",
      seats: [{ x: 4, y: 9, z: 8, yaw: 0 }, { x: 12, y: 9, z: 8, yaw: 0 }], boundingBoxes: [{ mx: 0, my: 0, mz: 2, Mx: 16, My: 8, Mz: 14, subtract: false }] },
    // Q226 multi-blocks (plain box models in project/models): a chair two cells tall, its seat on top of
    // its lower cell facing away from the backrest; an L sofa over 2x3 cells with four sitting seats and one lying spot
    // along its long side.
    tall_chair: { texture: "textures/ruby_block.png", name: "Tall Chair", renderType: 2, customModelName: "tall_chair", customModelTextures: { 0: "textures/ruby_block.png", particle: "textures/ruby_block.png" },
      rotationMode: 1, hasTransparency: true, multiBlock: true, seatable: true, seats: [{ x: 8, y: 17, z: 9, yaw: 180 }],
      boundingBoxes: [{ mx: 0, my: 0, mz: 0, Mx: 16, My: 17, Mz: 16, subtract: false }, { mx: 0, my: 17, mz: 0, Mx: 16, My: 32, Mz: 2, subtract: false }] },
    corner_sofa: { texture: "textures/ruby_block.png", name: "Corner Sofa", renderType: 2, customModelName: "corner_sofa", customModelTextures: { 0: "textures/ruby_block.png", particle: "textures/ruby_block.png" },
      rotationMode: 1, hasTransparency: true, multiBlock: true, seatable: true,
      seats: [{ x: 9, y: 7, z: -7, yaw: 180 }, { x: -5, y: 7, z: 3, yaw: 90 }, { x: -5, y: 7, z: 15, yaw: 90 }, { x: -5, y: 7, z: 27, yaw: 90 }, { x: -8, y: 7, z: 15, yaw: 180, pose: "lie" }, { x: 0, y: 7, z: -8, yaw: 270, pose: "lie" }],
      boundingBoxes: [{ mx: -16, my: 0, mz: -16, Mx: 16, My: 7, Mz: 0, subtract: false }, { mx: -16, my: 0, mz: 0, Mx: 2, My: 7, Mz: 32, subtract: false },
        { mx: -16, my: 7, mz: -16, Mx: -14, My: 16, Mz: 32, subtract: false }, { mx: -16, my: 7, mz: -16, Mx: 16, My: 9, Mz: -15, subtract: false },
        { mx: -16, my: 7, mz: 31, Mx: 2, My: 12, Mz: 32, subtract: false }] },
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
  // Q216: bubble elements. trade_offer: a 9-slice frame (textures/bubble_frame.png), the animated wave icon, a caption
  // with {text}, pop in and fade up and away (Q228) and a sound; plain_note: the built-in background, an icon, free layout
  // and fade in and out; timed_note (Q228, Q229): slide and fade
  // transitions with an ease, a ping-pong background and a play-once icon that holds its last frame.
  bubble: {
    trade_offer: { background: "textures/bubble_frame.png", backgroundMode: "nine_slice", sliceBorder: 4, icon: "textures/bubbles/wave.png", iconSize: 16,
      caption: "Trade: {text}", captionColor: "#ffd24a", captionShadow: true, width: 40, height: 28, padding: 4, tail: 0, scale: 1.2, offset: 0.1,
      appear: ["scale", "fade"], appearTicks: 6, appearEasing: "back", disappear: ["fade", "slide_up"], disappearTicks: 8, disappearEasing: "ease_out",
      duration: 0, sound: "minecraft:entity.experience_orb.pickup" },
    plain_note: { icon: "textures/ruby.png", layout: "free", iconX: 8, iconY: 4, iconSize: 16, caption: "Note", appear: ["fade"], appearTicks: 10, appearEasing: "linear", disappear: ["fade"], disappearTicks: 10, disappearEasing: "linear", duration: 60 },
    // Q228 client check (transition-client-check.sh): ten second transitions so a window image can land inside each one.
    slow_note: { background: "textures/bubble_frame.png", backgroundMode: "nine_slice", sliceBorder: 4, icon: "textures/bubbles/wave.png", iconSize: 16, caption: "Slow: {text}",
      width: 40, height: 28, padding: 4, tail: 0, scale: 1.2, appear: ["fade", "scale", "slide_up"], appearTicks: 200, appearEasing: "ease_out",
      disappear: ["fade", "scale", "slide_down"], disappearTicks: 200, disappearEasing: "linear", duration: 300 },
    timed_note: { background: "textures/playback_pingpong.png", backgroundMode: "plain", icon: "textures/playback_hold.png", iconSize: 16, caption: "Timed",
      appear: ["fade", "slide_up"], appearTicks: 20, appearEasing: "ease_out", disappear: ["fade", "slide_down", "scale"], disappearTicks: 20, disappearEasing: "ease_in_out", duration: 100 },
  },
  // Q227: radial menus. wheel: a list tab with a bubble, a command, a procedure, a submenu, a GUI and a greyed out slice
  // (its condition is false), and a folder tab listing config/wavethree/emotes/ that shows the chosen image as a bubble.
  radial_menu: {
    wheel: { openKey: "R", openMode: "hold", title: "Actions", keyName: "Open the wheel", appear: ["fade", "slide_up"], appearTicks: 6, appearEasing: "ease_out", background: "textures/bubble_frame.png", backgroundMode: "nine_slice", sliceBorder: 4,
      sliceImage: "", hoverImage: "", centerIcon: true, tabs: [
        { id: "main", label: "Main", source: "list", folder: "", pageSize: 8, action: "none", command: "", procedure: "", menu: "", gui: "", bubble: "", caption: "", duration: -1, slices: [
          slice("offer", { label: "Offer", description: "Shows the trade bubble", iconKind: "texture", icon: "textures/bubbles/wave.png", action: "bubble", bubble: "trade_offer", caption: "Ali" }),
          slice("hello", { label: "Say hi", iconKind: "item", item: "minecraft:emerald", action: "command", command: "/say hi" }),
          slice("run", { label: "Procedure", iconKind: "texture", icon: "textures/playback_pingpong.png", action: "procedure", procedure: "radial_slice" }),
          slice("more", { label: "More", iconKind: "item", item: "minecraft:compass", action: "menu", menu: "small" }),
          slice("bag", { label: "Bag", iconKind: "item", item: "minecraft:chest", action: "gui", gui: "ruby_gui" }),
          slice("locked", { label: "Locked", description: "Its condition is false", iconKind: "item", item: "minecraft:barrier", condition: "never", conditionMode: "disabled" }),
        ] },
        { id: "images", label: "Images", source: "folder", folder: "emotes", pageSize: 6, action: "image_bubble", command: "", procedure: "", menu: "", gui: "", bubble: "", caption: "{id}", duration: -1, slices: [] },
      ] },
    small: { openKey: "NONE", openMode: "toggle", title: "Small", size: 120, hole: 20, gap: 6, appear: ["fade"], appearTicks: 4, appearEasing: "linear", tabs: [
      { id: "only", label: "", source: "list", folder: "", pageSize: 8, action: "none", command: "", procedure: "", menu: "", gui: "", bubble: "", caption: "", duration: -1, slices: [
        slice("note", { label: "Note", iconKind: "texture", icon: "textures/ruby.png", action: "bubble", bubble: "plain_note" }),
        slice("ping", { label: "Ping", action: "procedure", procedure: "radial_slice" }),
      ] },
    ] },
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
      { kind: "label", name: "hud_mid", x: 213, y: 150, text: "Centred HUD", color: "#FFFFFF", align: "center", anchor: "top" },
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
    // Q229: item textures that play once and hold the last frame, and ping-pong.
    playback_hold_item: { texture: "textures/playback_hold.png", name: "Playback Hold Item" },
    playback_pingpong_item: { texture: "textures/playback_pingpong.png", name: "Playback Ping-pong Item" },
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
