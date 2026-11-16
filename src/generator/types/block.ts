import type { Element } from "../../elements/model.ts";
import { blockExpr, derivedConstant, idExpr, itemExpr, itemForm, itemPkg, jfloat, list, lootJson, qualify, str, tooltipMethod } from "../java.ts";
import { override } from "../itemTraits.ts";
import type { Remap } from "../png.ts";
import type { Context } from "../render.ts";
import { procedureBuild, procedureMembers } from "../procedures.ts";
import { growablePlantBase, PLANT_BASES, plantParts } from "../plants.ts";
import { blockEntityRuntime, blockInventory, openGuiOverride } from "../blockInventory.ts";
import { javaBlockModel, javaItemModel } from "../javaModels.ts";
import { blockProperties, blockstateWithStates, propertyCode, stateCondition, stateHelper, stateRows } from "../states.ts";
import { customModel, customModelSlot } from "../models.ts";
import { mappedSlots } from "../../resources/modelTextures.ts";
import { tooltipProcedureMember } from "../tooltips.ts";
import type { ElementContext, GenEnv, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";
import { multiBlockBase, multiBlockCells, PART_PROPERTY, multiBlockClass, multiBlockFields, multiBlockMembers, multiBlockstate, partBoxes } from "../multiBlock.ts";

/** MCreator step sound names that differ from the SoundType constant. */
const SOUNDS: Record<string, string> = {
  GROUND: "GRAVEL", PLANT: "GRASS", LILY_PADS: "LILY_PAD", CLOTH: "WOOL", SLIME: "SLIME_BLOCK", HONEY: "HONEY_BLOCK",
  CORAL: "CORAL_BLOCK", STEM: "HARD_CROP", HYPHAE: "STEM", ROOT: "ROOTS", NETHER_VINE: "WEEPING_VINES",
  NETHER_VINE_LOWER_PITCH: "TWISTING_VINES", WART: "WART_BLOCK", NETHER_BRICK: "NETHER_BRICKS", NETHER_SPROUT: "NETHER_SPROUTS",
  BONE: "BONE_BLOCK", NETHERITE: "NETHERITE_BLOCK", NETHER_GOLD: "NETHER_GOLD_ORE", AMETHYST_BLOCK: "AMETHYST", MOSS_BLOCK: "MOSS",
};
/** MCreator map color names -> MapColor constants (1.21+). */
/** Block materials: the MapColor constant (1.21+) a material gives the block, and whether lava ignites it. */
const MATERIALS: Record<string, { color: string; flammable?: boolean }> = {
  STONE: { color: "STONE" }, METAL: { color: "METAL" }, HEAVY_METAL: { color: "METAL" }, WOOD: { color: "WOOD", flammable: true }, GLASS: { color: "NONE" },
  DIRT: { color: "DIRT" }, SAND: { color: "SAND" }, GRASS: { color: "GRASS" }, WOOL: { color: "WOOL", flammable: true }, CLAY: { color: "CLAY" }, ICE: { color: "ICE" },
};
/** The block's material: the base block's own, else the Material field. */
const materialOf = (block: Element) => str(block.material) in MATERIALS ? str(block.material) : "STONE";

/** 1.16.5 block material expression: the vanilla material, made flammable for blocks lava ignites, with the map color. */
function legacyMaterial(block: Element, material: string): string {
  const color = str(block.colorOnMap);
  const mapColor = color && color !== "DEFAULT" ? `net.minecraft.block.material.MaterialColor.${MAP_COLORS[color] ?? terracotta(color) ?? color}` : "";
  const M = `net.minecraft.block.material.Material.${material}`;
  if (block.ignitedByLava === true) {
    return `new net.minecraft.block.material.Material(${mapColor || `${M}.getColor()`}, ${M}.isLiquid(), ${M}.isSolid(), ${M}.blocksMotion(), ${M}.isSolidBlocking(), true, ${M}.isReplaceable(), ${M}.getPushReaction())`;
  }
  return mapColor ? `${M}, ${mapColor}` : M;
}

export const MAP_COLORS: Record<string, string> = {
  AIR: "NONE", CLOTH: "WOOL", TNT: "FIRE", IRON: "METAL", FOLIAGE: "PLANT", ADOBE: "COLOR_ORANGE", MAGENTA: "COLOR_MAGENTA",
  LIGHT_BLUE: "COLOR_LIGHT_BLUE", YELLOW: "COLOR_YELLOW", LIME: "COLOR_LIGHT_GREEN", PINK: "COLOR_PINK", GRAY: "COLOR_GRAY",
  SILVER: "COLOR_LIGHT_GRAY", CYAN: "COLOR_CYAN", PURPLE: "COLOR_PURPLE", BLUE: "COLOR_BLUE", BROWN: "COLOR_BROWN",
  GREEN: "COLOR_GREEN", RED: "COLOR_RED", BLACK: "COLOR_BLACK", NETHERRACK: "NETHER", WARPED_WART: "WARPED_WART_BLOCK",
  DEEPSLATE_GRAY: "DEEPSLATE", RAW_IRON_PINK: "RAW_IRON", LICHEN_GREEN: "GLOW_LICHEN",
};
export const terracotta = (name: string) => name.endsWith("_TERRACOTTA") ? `TERRACOTTA_${name.replace("_TERRACOTTA", "").replace("LIME", "LIGHT_GREEN")}` : undefined;
/** Push reaction constants; 26.x renamed them. */
const PUSH_26: Record<string, string> = { NORMAL: "PUSH_PULL", DESTROY: "POPPED", BLOCK: "IMMOVEABLE", PUSH_ONLY: "PUSH", IGNORE: "IGNORE_ENTITY" };
/** Vanilla tool tier -> "needs" tag and 1.16.5 harvest level. */
const TIERS: Record<string, [string, number]> = { NONE: ["", 0], STONE: ["minecraft:needs_stone_tool", 1], IRON: ["minecraft:needs_iron_tool", 2], DIAMOND: ["minecraft:needs_diamond_tool", 3] };

interface Box { mx: number; my: number; mz: number; Mx: number; My: number; Mz: number; subtract?: boolean }

/** Mob path types by MCEdge value per generation; 26.x renamed the danger and damage types. */
const PATHS_1215 = ["BLOCKED", "OPEN", "WALKABLE", "WALKABLE_DOOR", "TRAPDOOR", "POWDER_SNOW", "DANGER_POWDER_SNOW", "FENCE", "LAVA", "WATER",
  "WATER_BORDER", "RAIL", "UNPASSABLE_RAIL", "DANGER_FIRE", "DAMAGE_FIRE", "DANGER_OTHER", "DAMAGE_OTHER", "DOOR_OPEN", "DOOR_WOOD_CLOSED",
  "DOOR_IRON_CLOSED", "BREACH", "LEAVES", "STICKY_HONEY", "COCOA", "DAMAGE_CAUTIOUS", "DANGER_TRAPDOOR"];
const same = (names: string[]) => Object.fromEntries(names.map((name) => [name, name]));
const PATH_TYPES: Record<GenEnv["mc"], Record<string, string>> = {
  "1.16.5": same(PATHS_1215.filter((name) => !["POWDER_SNOW", "DANGER_POWDER_SNOW", "DAMAGE_CAUTIOUS", "DANGER_TRAPDOOR"].includes(name))),
  "1.21.5": same(PATHS_1215),
  "26.3": {
    ...same(PATHS_1215), DANGER_POWDER_SNOW: "ON_TOP_OF_POWDER_SNOW", DANGER_FIRE: "FIRE_IN_NEIGHBOR", DAMAGE_FIRE: "FIRE",
    DANGER_OTHER: "DAMAGING_IN_NEIGHBOR", DAMAGE_OTHER: "DAMAGING", DANGER_TRAPDOOR: "ON_TOP_OF_TRAPDOOR", BIG_MOBS_CLOSE_TO_DANGER: "BIG_MOBS_CLOSE_TO_DANGER",
  },
};

const rect = (x: number, y: number, w: number, h: number, u: number, v: number, flipX = false, flipY = false) => ({ x, y, w, h, u, v, flipX, flipY });
/**
 * 26.x draws signs from block models with a 32x32 texture and shows the standing sign's edit screen from a
 * 24x26 texture. These rearrange the 64x32 entity sign textures (the stored format) into those layouts, face by
 * face as vanilla 26.x lays them out (checked against all vanilla wood types).
 */
export const SIGN_REMAPS = {
  sign: { base: 64, width: 32, height: 32, rects: [
    rect(0, 0, 24, 14, 2, 0), rect(28, 0, 4, 14, 2, 16), rect(24, 2, 2, 12, 26, 2), rect(0, 16, 24, 12, 28, 2), rect(24, 16, 2, 12, 0, 2),
    rect(28, 16, 2, 14, 6, 16), rect(30, 16, 2, 14, 0, 16), rect(0, 28, 24, 2, 26, 1, false, true), rect(28, 30, 2, 2, 4, 15, false, true),
  ] },
  hangingSign: { base: 64, width: 32, height: 32, rects: [
    rect(0, 0, 16, 6, 4, 0), rect(16, 4, 4, 2, 20, 4), rect(0, 7, 16, 2, 24, 4), rect(16, 7, 4, 2, 0, 4), rect(0, 9, 16, 4, 35, 3, true, true),
    rect(2, 14, 14, 12, 2, 12), rect(0, 16, 2, 10, 0, 14), rect(16, 16, 16, 10, 16, 14), rect(2, 26, 14, 2, 16, 13, false, true),
    rect(20, 0, 12, 6, 14, 6), rect(22, 7, 3, 6, 0, 6), rect(28, 8, 3, 4, 6, 7),
  ] },
  signScreen: { base: 64, width: 24, height: 26, rects: [rect(0, 0, 24, 12, 2, 2), rect(11, 12, 2, 14, 2, 16)] },
} satisfies Record<string, Remap>;

/** Bases built on a vanilla block set type (sounds, who can open or press them). */
const SET_BASES = ["Door", "TrapDoor", "Button", "PressurePlate"];

/** Opaque ARGB of an RGB color, as a signed Java int. */
const argb = (rgb: number) => (0xff000000 | rgb) | 0;
/** Fixed tint colors, also used for items and where no world position is known. */
export const TINT_COLORS: Record<string, number> = {
  Foliage: -12012264, "Default foliage": -12012264, "Dry foliage": -10732494, "Birch foliage": -8345771, "Spruce foliage": -10380959,
  Water: argb(0x3f76e4), Sky: argb(0x82a8ff), Fog: argb(0xc0d8ff), "Water fog": argb(0x050533),
};
/** Built-in models that have a tinted variant; a tint picks it. */
const TINTED_RENDER: Record<number, number> = { 11: 110, 12: 120, 15: 150 };

/** Java names per generation. */
function names(env: GenEnv) {
  if (env.mc === "1.16.5") {
    return {
      blk: "net.minecraft.block", state: "net.minecraft.block.BlockState", dir: "net.minecraft.util.Direction",
      pos: "net.minecraft.util.math.BlockPos", getter: "net.minecraft.world.IBlockReader", shape: "net.minecraft.util.math.shapes.VoxelShape",
      shapes: "net.minecraft.util.math.shapes.VoxelShapes", ctx: "net.minecraft.util.math.shapes.ISelectionContext",
      place: "net.minecraft.item.BlockItemUseContext", builder: "net.minecraft.state.StateContainer.Builder<net.minecraft.block.Block, net.minecraft.block.BlockState>",
      props: "net.minecraft.state.properties.BlockStateProperties", fluids: "net.minecraft.fluid.Fluids", fluidState: "net.minecraft.fluid.FluidState",
      rot: "net.minecraft.util.Rotation", mirror: "net.minecraft.util.Mirror", onlyFirst: "net.minecraft.util.math.shapes.IBooleanFunction.ONLY_FIRST",
    };
  }
  return {
    blk: "net.minecraft.world.level.block", state: "net.minecraft.world.level.block.state.BlockState", dir: "net.minecraft.core.Direction",
    pos: "net.minecraft.core.BlockPos", getter: "net.minecraft.world.level.BlockGetter", shape: "net.minecraft.world.phys.shapes.VoxelShape",
    shapes: "net.minecraft.world.phys.shapes.Shapes", ctx: "net.minecraft.world.phys.shapes.CollisionContext",
    place: "net.minecraft.world.item.context.BlockPlaceContext", builder: "net.minecraft.world.level.block.state.StateDefinition.Builder<net.minecraft.world.level.block.Block, net.minecraft.world.level.block.state.BlockState>",
    props: "net.minecraft.world.level.block.state.properties.BlockStateProperties", fluids: "net.minecraft.world.level.material.Fluids",
    fluidState: "net.minecraft.world.level.material.FluidState", rot: "net.minecraft.world.level.block.Rotation", mirror: "net.minecraft.world.level.block.Mirror",
    onlyFirst: "net.minecraft.world.phys.shapes.BooleanOp.ONLY_FIRST",
  };
}

/** File name part of a model texture slot ("0", "Crystal Glass" -> "crystal_glass"). */
const slotFile = (slot: string) => slot.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

/** Texture field -> file suffix; a set side texture gets its own file, an empty one falls back to the main texture. */
const SIDES = { textureTop: "top", textureLeft: "left", textureFront: "front", textureRight: "right", textureBack: "back" } as const;

function element(block: Element, env: GenEnv): ElementContext {
  const n = names(env);
  const legacy = env.mc === "1.16.5";
  const base = str(block.blockBase);
  const rotation = base === "" ? Number(block.rotationMode) : 0;
  // A block spanning several cells (Q226): its cells, origin first.
  const cells = base === "" ? multiBlockCells(env, block, rotation) : undefined;
  const waterlogged = (base === "" || base === "Plant" || base === "GrowablePlant") && block.isWaterloggable === true && !cells;
  const gravity = base === "" && block.hasGravity === true && !cells;
  const tint = str(block.tintType) === "No tint" ? "" : str(block.tintType);
  // A flower pot always shows its plant in the pot model.
  let render = base === "" || PLANT_BASES.includes(base) ? (tint && TINTED_RENDER[Number(block.renderType)]) || Number(block.renderType)
    : base === "FlowerPot" ? (tint ? 150 : 15) : 0;
  // A Java model (type 4) is drawn by a block entity renderer, so the block gets a block entity (without slots when it
  // has no inventory); a missing model falls back to the cube.
  if (render === 4 && !(base === "" && javaBlockModel(env, block, `${env.modId}:textures/block/${block.id}.png`))) render = 10;
  // Energy and tanks live in the block entity as well.
  if ((render === 4 || block.hasEnergyStorage === true || block.isFluidTank === true) && block.hasInventory !== true) {
    block = { ...block, hasInventory: true, inventorySize: 0, guiBoundTo: "", openGUIOnRightClick: false, inventoryInSlotIDs: [], inventoryOutSlotIDs: [] };
  }
  const javaItem = render === 4 && !str(block.itemTexture) ? javaItemModel(env, block.id, str(block.customModelName), `${env.modId}:textures/block/${block.id}.png`) : undefined;
  const setType = SET_BASES.includes(base) ? str(block.blockSetType) : "";
  const id = block.id;
  const tex = (suffix?: string) => `${env.modId}:block/${id}${suffix ? `_${suffix}` : ""}`;
  const side = (key: keyof typeof SIDES) => (str(block[key]) ? tex(SIDES[key]) : tex());
  const textures: NonNullable<ElementContext["textures"]> = [{ from: str(block.texture), to: `block/${id}` }];
  for (const key of Object.keys(SIDES) as (keyof typeof SIDES)[]) if (str(block[key])) textures.push({ from: str(block[key]), to: `block/${id}_${SIDES[key]}` });
  if (str(block.particleTexture)) textures.push({ from: str(block.particleTexture), to: `block/${id}_particle` });
  if (str(block.itemTexture)) textures.push({ from: str(block.itemTexture), to: `item/${id}` });
  // The block's own textures for its custom model's slots (KUYRUK 161).
  if (render === 2 || render === 3) for (const [slot, from] of mappedSlots(block.customModelTextures)) textures.push({ from, to: `block/${id}_model_${slotFile(slot)}` });
  if (base === "DoublePlant" && str(block.textureBottom)) textures.push({ from: str(block.textureBottom), to: `block/${id}_bottom` });
  // Signs render from an entity texture; hanging signs also have their own edit screen background.
  // 26.x draws signs as block models and the standing sign's edit screen from its own texture, both derived here.
  const signTexture = str(block.signEntityTexture);
  if (base === "Sign") {
    textures.push(env.mc === "26.3" ? { from: signTexture, to: `block/signs/${id}`, remap: SIGN_REMAPS.sign } : { from: signTexture, to: `entity/signs/${id}` });
    if (env.mc === "26.3") textures.push({ from: signTexture, to: `gui/signs/${id}`, remap: SIGN_REMAPS.signScreen });
  }
  if (base === "HangingSign") {
    textures.push(env.mc === "26.3" ? { from: signTexture, to: `block/signs/${id}`, remap: SIGN_REMAPS.hangingSign } : { from: signTexture, to: `entity/signs/hanging/${id}` });
    textures.push({ from: str(block.signGUITexture), to: `gui/hanging_signs/${id}` });
  }

  // ---- Properties
  const props: string[] = [];
  if (legacy) {
    props.push("properties");
  } else {
    props.push("properties");
    const color = str(block.colorOnMap);
    const material = MATERIALS[materialOf(block)];
    if (color !== "DEFAULT") props.push(`.mapColor(net.minecraft.world.level.material.MapColor.${MAP_COLORS[color] ?? terracotta(color) ?? color})`);
    else if (material.color !== "STONE" && !PLANT_BASES.includes(base)) props.push(`.mapColor(net.minecraft.world.level.material.MapColor.${material.color})`);
    const instrument = str(block.noteBlockInstrument);
    if (instrument !== "harp") props.push(`.instrument(net.minecraft.world.level.block.state.properties.NoteBlockInstrument.${instrument.toUpperCase()})`);
    if (block.ignitedByLava === true || (material.flammable && !PLANT_BASES.includes(base))) props.push(".ignitedByLava()");
    if (block.isReplaceable === true) props.push(".replaceable()");
    // Pistons cannot move a block spanning several cells.
    const push = cells ? "BLOCK" : str(block.reactionToPushing);
    if (push !== "NORMAL") props.push(`.pushReaction(net.minecraft.world.level.material.PushReaction.${env.mc === "26.3" ? PUSH_26[push] : push})`);
    // Vanilla requires a dynamic shape for blocks that collide and are randomly offset.
    if (block.offsetType !== "NONE" && block.isNotColidable !== true) props.push(".dynamicShape()");
    if (block.offsetType !== "NONE") props.push(`.offsetType(net.minecraft.world.level.block.state.BlockBehaviour.OffsetType.${str(block.offsetType)})`);
  }
  if (block.isCustomSoundType === true) props.push(`.sound(${customSound(env, block)})`);
  else if (block.soundOnStep !== "STONE") props.push(`.sound(${n.blk}.SoundType.${SOUNDS[str(block.soundOnStep)] ?? str(block.soundOnStep)})`);
  if (block.unbreakable === true) props.push(".strength(-1F, 3600000F)");
  else props.push(`.strength(${jfloat(block.hardness)}, ${jfloat(block.resistance)})`);
  if (Number(block.luminance) !== 0) props.push(`.lightLevel(s -> ${block.luminance})`);
  if (block.requiresCorrectTool === true) props.push(".requiresCorrectToolForDrops()");
  const sign = base === "Sign" || base === "HangingSign";
  // Signs never collide, like vanilla signs.
  if (block.isNotColidable === true || sign) props.push(env.mc === "26.3" ? ".noCollision()" : ".noCollission()");
  if (Number(block.slipperiness) !== 0.6) props.push(`.friction(${jfloat(block.slipperiness)})`);
  if (Number(block.speedFactor) !== 1) props.push(`.speedFactor(${jfloat(block.speedFactor)})`);
  if (Number(block.jumpFactor) !== 1) props.push(`.jumpFactor(${jfloat(block.jumpFactor)})`);
  // Vanilla doors, trapdoors and pots let light and the view through.
  // Custom models are rarely full cubes, so they never hide their neighbours' faces.
  const customShape = base === "" && [2, 3, 4].includes(render);
  if ((block.hasTransparency === true || customShape || ["Leaves", "Door", "TrapDoor", "FlowerPot"].includes(base)) && block.isNotColidable !== true) props.push(".noOcclusion()");
  if (block.emissiveRendering === true) props.push(env.mc === "26.3" ? ".emissiveRendering(s -> true)" : ".emissiveRendering((s, w, p) -> true)");
  if (block.hasPostProcess === true && env.mc !== "26.3") props.push(".hasPostProcess((s, w, p) -> true)");
  if (block.forceRedstoneConductor === true) props.push(".isRedstoneConductor((s, w, p) -> true)");
  else if (block.hasTransparency === true) props.push(".isRedstoneConductor((s, w, p) -> false)");
  if (["Fence", "Wall", "FenceGate", "PressurePlate", "Sign", "HangingSign"].includes(base) && !legacy) props.push(".forceSolidOn()");
  if (base === "EndRod" && !legacy) props.push(".forceSolidOff()");
  const destroyTool = str(block.destroyTool);
  const [needsTag, harvestLevel] = TIERS[str(block.vanillaToolTier)];
  if (legacy && destroyTool !== "Not specified") props.push(`.harvestTool(net.minecraftforge.common.ToolType.get("${destroyTool}")).harvestLevel(${harvestLevel})`);
  const plant = PLANT_BASES.includes(base) ? plantParts(env, block) : undefined;
  if (plant) props.push(...plant.props);

  // ---- Class and constructor
  const blk = n.blk;
  const classes: Record<string, string> = legacy
    ? { "": gravity ? `${blk}.FallingBlock` : `${blk}.Block`, Stairs: `${blk}.StairsBlock`, Slab: `${blk}.SlabBlock`, Fence: `${blk}.FenceBlock`, Wall: `${blk}.WallBlock`, Leaves: `${blk}.LeavesBlock`, Pane: `${blk}.PaneBlock`, FenceGate: `${blk}.FenceGateBlock`,
      Door: `${blk}.DoorBlock`, TrapDoor: `${blk}.TrapDoorBlock`, Button: setType === "OAK" ? `${blk}.WoodButtonBlock` : `${blk}.StoneButtonBlock`,
      PressurePlate: `${blk}.PressurePlateBlock`, EndRod: `${blk}.EndRodBlock`, FlowerPot: `${blk}.FlowerPotBlock`, Sign: `${blk}.StandingSignBlock` }
    : { "": gravity ? `${blk}.FallingBlock` : `${blk}.Block`, Stairs: `${blk}.StairBlock`, Slab: `${blk}.SlabBlock`, Fence: `${blk}.FenceBlock`, Wall: `${blk}.WallBlock`, Leaves: str(block.leavesParticleType) ? `${blk}.UntintedParticleLeavesBlock` : `${blk}.TintedParticleLeavesBlock`, Pane: `${blk}.IronBarsBlock`, FenceGate: `${blk}.FenceGateBlock`,
      Door: `${blk}.DoorBlock`, TrapDoor: `${blk}.TrapDoorBlock`, Button: `${blk}.ButtonBlock`, PressurePlate: `${blk}.PressurePlateBlock`,
      EndRod: `${blk}.EndRodBlock`, FlowerPot: `${blk}.FlowerPotBlock`, Sign: `${blk}.StandingSignBlock`, HangingSign: `${blk}.CeilingHangingSignBlock` };
  if (plant) classes[base] = plant.superClass;
  if (cells) classes[base] = multiBlockClass(env);
  const chain = props.join("\n                ");
  const superArgs = cells ? `CELLS, ${chain}` : plant ? plant.superArgs(chain)
    : base === "Stairs" ? (legacy ? `() -> ${blk}.Blocks.AIR.defaultBlockState(), ${chain}` : `${blk}.Blocks.AIR.defaultBlockState(), ${chain}`)
    : base === "FenceGate" && !legacy ? `net.minecraft.world.level.block.state.properties.WoodType.OAK, ${chain}`
      : base === "Leaves" && !legacy ? leavesArgs(env, block, chain)
        : base === "FlowerPot" ? flowerPotArgs(env, block, chain)
          : sign ? (legacy ? `${chain}, WOOD_TYPE` : `WOOD_TYPE, ${chain}`)
          : !setType ? chain
            : legacy ? (base === "PressurePlate" ? `net.minecraft.block.PressurePlateBlock.Sensitivity.${setType === "OAK" ? "EVERYTHING" : "MOBS"}, ${chain}` : chain)
              : `${blk}.state.properties.BlockSetType.${setType}, ${base === "Button" ? `${setType === "OAK" ? 30 : 20}, ` : ""}${chain}`;

  const members: string[] = [];
  // Signs already have a block entity of their own.
  const inventory = sign ? undefined : blockInventory(env, block);
  if (sign && block.hasInventory === true) procedureBuild(env).warnings.push(`block/${id}: signs cannot have an inventory`);
  if (inventory) members.push(...inventory.members);
  const fields: string[] = [];
  const defaults: string[] = [];
  /** Constructor statements after super(). */
  const ctor: string[] = [];
  const stateProps: string[] = [];
  const S = n.state;
  const prot = legacy ? "public" : "protected";
  if (plant) {
    fields.push(...plant.fields);
    defaults.push(...plant.defaults);
    stateProps.push(...plant.stateProps);
    members.push(...plant.members);
  }

  if (gravity) {
    if (env.mc === "1.21.5") members.push(override(`protected com.mojang.serialization.MapCodec<? extends ${blk}.FallingBlock> codec()`, `return simpleCodec(${pascalClass(block)}::new);`));
    if (!legacy) members.push(override(`public int getDustColor(${S} state, ${n.getter} world, ${n.pos} pos)`, "return state.getMapColor(world, pos).col;"));
  }
  if (base === "Stairs") members.push(override("public float getExplosionResistance()", `return ${jfloat(block.resistance)};`));
  const signParts = sign ? signCode(env, block, chain) : undefined;
  if (signParts) { fields.push(...signParts.fields); members.push(...signParts.members); }
  // Older Forge and NeoForge pots join the empty pot by hand; NeoForge 26.x builds that table from all pots itself.
  if (base === "FlowerPot" && env.loader !== "fabric" && env.mc !== "26.3") {
    ctor.push(`((${blk}.FlowerPotBlock) ${blk}.Blocks.FLOWER_POT).addPlant(${idExpr(env, qualify(env, str(block.pottedPlant)))}, () -> this);`);
  }

  // Facing / axis
  if (rotation === 1 || rotation === 3) {
    fields.push(`public static final ${legacy ? "net.minecraft.state.DirectionProperty" : `net.minecraft.world.level.block.state.properties.EnumProperty<${n.dir}>`} FACING = ${blk}.HorizontalBlock.FACING;`.replace(`${blk}.HorizontalBlock`, legacy ? `${blk}.HorizontalBlock` : `${blk}.HorizontalDirectionalBlock`));
  } else if (rotation === 2 || rotation === 4) {
    fields.push(`public static final ${legacy ? "net.minecraft.state.DirectionProperty" : `net.minecraft.world.level.block.state.properties.EnumProperty<${n.dir}>`} FACING = ${blk}.${legacy ? "DirectionalBlock" : "DirectionalBlock"}.FACING;`);
  } else if (rotation === 5) {
    fields.push(`public static final ${legacy ? `net.minecraft.state.EnumProperty<${n.dir}.Axis>` : `net.minecraft.world.level.block.state.properties.EnumProperty<${n.dir}.Axis>`} AXIS = ${n.props}.AXIS;`);
  }
  // Floor, wall and ceiling placement adds the attach face of levers and buttons.
  const pitch = (rotation === 1 || rotation === 3) && block.enablePitch === true;
  const face = legacy ? "net.minecraft.state.properties.AttachFace" : "net.minecraft.world.level.block.state.properties.AttachFace";
  if (pitch) fields.push(`public static final ${legacy ? "net.minecraft.state.EnumProperty" : "net.minecraft.world.level.block.state.properties.EnumProperty"}<${face}> FACE = ${n.props}.ATTACH_FACE;`);
  if (rotation === 5) { defaults.push(`.setValue(AXIS, ${n.dir}.Axis.Y)`); stateProps.push("AXIS"); }
  else if (rotation) { defaults.push(`.setValue(FACING, ${n.dir}.NORTH)`); stateProps.push("FACING"); }
  if (pitch) { defaults.push(`.setValue(FACE, ${face}.WALL)`); stateProps.push("FACE"); }
  if (cells) {
    fields.push(...multiBlockFields(env, cells));
    members.push(...multiBlockMembers(env, rotation));
    defaults.push(".setValue(PART, 0)");
    stateProps.push("PART");
  }
  if (waterlogged) {
    fields.push(`public static final ${legacy ? "net.minecraft.state.BooleanProperty" : "net.minecraft.world.level.block.state.properties.BooleanProperty"} WATERLOGGED = ${n.props}.WATERLOGGED;`);
    defaults.push(".setValue(WATERLOGGED, false)");
    stateProps.push("WATERLOGGED");
  }
  // Custom properties and state rows (plain blocks): extra state properties, per-state models and boxes.
  const customProps = base === "" ? blockProperties(env, block) : [];
  if (base !== "" && list(block.customProperties).length) procedureBuild(env).warnings.push(`block/${id}: custom properties are only generated for blocks without a base`);
  const propCode = propertyCode(env, customProps);
  fields.push(...propCode.fields);
  members.push(...propCode.members);
  defaults.push(...propCode.defaults);
  stateProps.push(...propCode.stateProps);
  const known = new Map<string, string[]>(customProps.map((p) => [p.name, p.values]));
  if (rotation === 1 || rotation === 3) known.set("facing", ["north", "east", "south", "west"]);
  if (rotation === 2 || rotation === 4) known.set("facing", ["north", "east", "south", "west", "up", "down"]);
  if (rotation === 5) known.set("axis", ["x", "y", "z"]);
  if ((rotation === 1 || rotation === 3) && block.enablePitch === true) known.set("face", ["floor", "wall", "ceiling"]);
  if (waterlogged) known.set("waterlogged", ["false", "true"]);
  const rows = base === "" ? stateRows(env, block, known) : [];
  if (stateProps.length) {
    members.push(override(`protected void createBlockStateDefinition(${n.builder} builder)`, `super.createBlockStateDefinition(builder);\n        builder.add(${stateProps.join(", ")});`));
    const facing = rotation === 1 ? "context.getHorizontalDirection().getOpposite()"
      : rotation === 2 ? "context.getNearestLookingDirection().getOpposite()"
        : rotation === 3 ? `context.getClickedFace().getAxis() == ${n.dir}.Axis.Y ? context.getHorizontalDirection().getOpposite() : context.getClickedFace()`
          : rotation === 4 ? "context.getClickedFace()" : "";
    const water = waterlogged ? `.setValue(WATERLOGGED, context.getLevel().getFluidState(context.getClickedPos()).getType() == ${n.fluids}.WATER)` : "";
    const yAxis = `context.getClickedFace().getAxis() == ${n.dir}.Axis.Y`;
    const placed = rotation === 5 ? "state.setValue(AXIS, context.getClickedFace().getAxis())"
      // Looking up or down puts it on the ceiling or floor.
      : pitch && rotation === 1 ? `state.setValue(FACE, context.getNearestLookingDirection() == ${n.dir}.UP ? ${face}.CEILING : context.getNearestLookingDirection() == ${n.dir}.DOWN ? ${face}.FLOOR : ${face}.WALL).setValue(FACING, context.getHorizontalDirection().getOpposite())`
        // On the clicked face: top and bottom faces put it on the floor or ceiling.
        : pitch ? `(${yAxis} ? state.setValue(FACE, context.getClickedFace() == ${n.dir}.UP ? ${face}.FLOOR : ${face}.CEILING).setValue(FACING, context.getHorizontalDirection()) : state.setValue(FACE, ${face}.WALL).setValue(FACING, context.getClickedFace()))`
          : rotation ? `state.setValue(FACING, ${facing})` : "state";
    members.push(override(`public ${S} getStateForPlacement(${n.place} context)`, `${S} state = super.getStateForPlacement(context);\n        return state == null ? null : ${placed}${water};`));
    if (rotation === 5) {
      members.push(override(`${prot} ${S} rotate(${S} state, ${n.rot} rot)`, `if (rot == ${n.rot}.CLOCKWISE_90 || rot == ${n.rot}.COUNTERCLOCKWISE_90) {
            if (state.getValue(AXIS) == ${n.dir}.Axis.X) return state.setValue(AXIS, ${n.dir}.Axis.Z);
            if (state.getValue(AXIS) == ${n.dir}.Axis.Z) return state.setValue(AXIS, ${n.dir}.Axis.X);
        }
        return state;`));
    } else if (rotation) {
      members.push(override(`${prot} ${S} rotate(${S} state, ${n.rot} rot)`, "return state.setValue(FACING, rot.rotate(state.getValue(FACING)));"));
      members.push(override(`${prot} ${S} mirror(${S} state, ${n.mirror} mirror)`, "return state.rotate(mirror.getRotation(state.getValue(FACING)));"));
    }
  }
  if (waterlogged) {
    members.push(override(`${prot} ${n.fluidState} getFluidState(${S} state)`, `return state.getValue(WATERLOGGED) ? ${n.fluids}.WATER.getSource(false) : super.getFluidState(state);`));
    members.push(legacy
      ? override(`public ${S} updateShape(${S} state, ${n.dir} facing, ${S} facingState, net.minecraft.world.IWorld world, ${n.pos} pos, ${n.pos} facingPos)`,
        `if (state.getValue(WATERLOGGED)) world.getLiquidTicks().scheduleTick(pos, ${n.fluids}.WATER, ${n.fluids}.WATER.getTickDelay(world));\n        return super.updateShape(state, facing, facingState, world, pos, facingPos);`)
      : override(`protected ${S} updateShape(${S} state, net.minecraft.world.level.LevelReader world, net.minecraft.world.level.ScheduledTickAccess ticks, ${n.pos} pos, ${n.dir} facing, ${n.pos} facingPos, ${S} facingState, net.minecraft.util.RandomSource random)`,
        `if (state.getValue(WATERLOGGED)) ticks.scheduleTick(pos, ${n.fluids}.WATER, ${n.fluids}.WATER.getTickDelay(world));\n        return super.updateShape(state, world, ticks, pos, facing, facingPos, facingState, random);`));
  }

  // Shape
  const boxes = list<Box>(block.boundingBoxes);
  const full = boxes.length === 1 && !boxes[0].subtract && boxes[0].mx === 0 && boxes[0].my === 0 && boxes[0].mz === 0 && boxes[0].Mx === 16 && boxes[0].My === 16 && boxes[0].Mz === 16;
  /** getShape body for boxes, turned like the blockstate variants. */
  const shapeBody = (boxes: Box[]): string => {
    const shapeOf = (transform: (b: Box) => Box) => shapeExpr(env, boxes.map(transform));
    let body: string;
    if (rotation === 0) body = `return ${shapeOf((b) => b)};`;
    else if (pitch) {
      // Same turns as the blockstate variants: x first, then y.
      const facings = (face: keyof typeof PITCH_Y) => Object.entries(PITCH_Y[face])
        .map(([d, y]) => `                ${d === "WEST" ? "default" : `case ${d}`}: return ${shapeOf((b) => rotY(rotX(b, PITCH_X[face]), y / 90))};`).join("\n");
      body = `switch (state.getValue(FACE)) {
            case FLOOR: switch (state.getValue(FACING)) {
${facings("floor")}
            }
            case WALL: switch (state.getValue(FACING)) {
${facings("wall")}
            }
            default: switch (state.getValue(FACING)) {
${facings("ceiling")}
            }
        }`;
    } else if (rotation === 5) {
      body = `switch (state.getValue(AXIS)) {
            case X: return ${shapeOf((b) => rotY(rotXDown(b), 1))};
            case Z: return ${shapeOf(rotXDown)};
            default: return ${shapeOf((b) => b)};
        }`;
    } else {
      const cases = ["SOUTH", "EAST", "WEST"].map((d) => `            case ${d}: return ${shapeOf((b) => rotY(b, { EAST: 1, SOUTH: 2, WEST: 3 }[d]!))};`);
      if (rotation === 2 || rotation === 4) cases.push(`            case UP: return ${shapeOf(rotXUp)};`, `            case DOWN: return ${shapeOf(rotXDown)};`);
      body = `switch (state.getValue(FACING)) {\n${cases.join("\n")}\n            default: return ${shapeOf((b) => b)};\n        }`;
    }
    return body;
  };
  // State rows with their own boxes come first, while their properties match.
  const stateShapes = rows.filter((r) => r.row.hasCustomBoundingBox === true);
  if ((base === "" || (plant && boxes.length)) && (!full || stateShapes.length)) {
    const own = stateShapes.map((r) => `if (${stateCondition(r)}) {\n            ${shapeBody(list<Box>(r.row.boundingBoxes)).replaceAll("\n", "\n    ")}\n        }\n        `).join("");
    // A multi-block's parts each have their slice of the boxes.
    const body = cells
      ? `switch (state.getValue(PART)) {\n${partBoxes(boxes, cells).map((part, i) => `            ${i ? `case ${i}` : "default"}: {\n                ${shapeBody(part).replaceAll("\n", "\n        ")}\n            }`).join("\n")}\n        }`
      : shapeBody(boxes);
    members.push(override(`public ${n.shape} getShape(${S} state, ${n.getter} world, ${n.pos} pos, ${n.ctx} context)`, own + body));
  }
  if (stateShapes.length) members.push(stateHelper(env));
  if (block.hasTransparency === true && base === "" && !legacy) {
    members.push(override(`public ${n.shape} getVisualShape(${S} state, ${n.getter} world, ${n.pos} pos, ${n.ctx} context)`, `return ${n.shapes}.empty();`));
  }

  if (block.hasCustomOpacity === true) {
    const opacity = Number(block.lightOpacity);
    // A waterlogged block lets the sky light through only while it holds no water (MCreator's rule).
    const sky = waterlogged ? "return state.getFluidState().isEmpty();" : "return true;";
    if (opacity === 0) members.push(legacy
      ? override(`public boolean propagatesSkylightDown(${S} state, ${n.getter} world, ${n.pos} pos)`, sky)
      : override(`protected boolean propagatesSkylightDown(${S} state)`, sky));
    members.push(legacy ? override(`public int getLightBlock(${S} state, ${n.getter} world, ${n.pos} pos)`, `return ${opacity};`)
      : env.mc === "26.3" ? override(`protected int getLightDampening(${S} state)`, `return ${opacity};`)
        : override(`protected int getLightBlock(${S} state)`, `return ${opacity};`));
  }
  if (block.connectedSides === true) {
    members.push(override(`${prot} boolean skipRendering(${S} state, ${S} adjacent, ${n.dir} side)`, "return adjacent.getBlock() == this || super.skipRendering(state, adjacent, side);"));
  }
  if (block.canProvidePower === true) {
    members.push(override(`${prot} boolean isSignalSource(${S} state)`, "return true;"));
    members.push(override(`${prot} int getSignal(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} direction)`, `return ${block.emittedRedstonePower};`));
  }
  if (legacy) {
    if (block.offsetType !== "NONE") members.push(override("public net.minecraft.block.AbstractBlock.OffsetType getOffsetType()", `return net.minecraft.block.AbstractBlock.OffsetType.${str(block.offsetType)};`));
    if (block.reactionToPushing !== "NORMAL" && !cells) members.push(override(`public net.minecraft.block.material.PushReaction getPistonPushReaction(${S} state)`, `return net.minecraft.block.material.PushReaction.${str(block.reactionToPushing)};`));
    if (block.isReplaceable === true) members.push(override(`public boolean canBeReplaced(${S} state, ${n.place} context)`, "return context.getItemInHand().getItem() != this.asItem();"));
  }
  if (str(block.creativePickItem)) {
    members.push(legacy
      ? override(`public net.minecraft.item.ItemStack getCloneItemStack(${n.getter} world, ${n.pos} pos, ${S} state)`, `return new net.minecraft.item.ItemStack(${itemExpr(env, str(block.creativePickItem))});`)
      : override(`protected net.minecraft.world.item.ItemStack getCloneItemStack(net.minecraft.world.level.LevelReader world, ${n.pos} pos, ${S} state, boolean includeData)`, `return new net.minecraft.world.item.ItemStack(${itemExpr(env, str(block.creativePickItem))});`));
  }
  const xpMin = Number(block.xpAmountMin), xpMax = Number(block.xpAmountMax);
  if (xpMax > 0) {
    members.push(legacy
      ? override(`public int getExpDrop(${S} state, net.minecraft.world.IWorldReader world, ${n.pos} pos, int fortune, int silktouch)`, `return silktouch == 0 ? ${xpMin} + RANDOM.nextInt(${xpMax - xpMin + 1}) : 0;`)
      : override(`protected void spawnAfterBreak(${S} state, net.minecraft.server.level.ServerLevel world, ${n.pos} pos, net.minecraft.world.item.ItemStack tool, boolean dropExperience)`,
        `super.spawnAfterBreak(state, world, pos, tool, dropExperience);\n        if (dropExperience) this.tryDropExperience(world, pos, tool, net.minecraft.util.valueproviders.UniformInt.of(${xpMin}, ${xpMax}));`));
  }
  const init: string[] = [];
  const files: ResourceFile[] = [];
  let strip: { block: string; into: string } | undefined;
  // Mob pathfinding
  const pathType = PATH_TYPES[env.mc][str(block.aiPathNodeType)];
  if (pathType) {
    if (legacy) members.push(override(`public net.minecraft.pathfinding.PathNodeType getAiPathNodeType(${S} state, ${n.getter} world, ${n.pos} pos, net.minecraft.entity.MobEntity entity)`, `return net.minecraft.pathfinding.PathNodeType.${pathType};`));
    else if (env.loader === "neoforge") members.push(override(`public net.minecraft.world.level.pathfinder.PathType getBlockPathType(${S} state, ${n.getter} world, ${n.pos} pos, net.minecraft.world.entity.Mob entity)`, `return net.minecraft.world.level.pathfinder.PathType.${pathType};`));
    else init.push(`net.fabricmc.fabric.api.registry.${env.mc === "26.3" ? "LandPathTypeRegistry" : "LandPathNodeTypesRegistry"}.register(${blockExpr(env, id)}, net.minecraft.world.level.pathfinder.PathType.${pathType}, null);`);
  }
  // Redstone dust connects to it; vanilla 1.21.5 connects to signal sources only.
  if (block.canRedstoneConnect === true) {
    if (env.mc === "26.3") members.push(override(`protected boolean shouldRedstoneWireConnectTo(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} direction)`, "return direction != null;"));
    else if (env.loader !== "fabric") members.push(override(`public boolean canConnectRedstone(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} direction)`, "return true;"));
    else if (block.canProvidePower !== true) members.push(override(`protected boolean isSignalSource(${S} state)`, "return true;"));
  }
  const stripped = str(block.strippingResult);
  if (stripped) {
    const target = `${blockExpr(env, stripped)}`;
    if (legacy) {
      members.push(override(`public ${S} getToolModifiedState(${S} state, net.minecraft.world.World world, ${n.pos} pos, net.minecraft.entity.player.PlayerEntity player, net.minecraft.item.ItemStack stack, net.minecraftforge.common.ToolType toolType)`,
        `if (toolType != net.minecraftforge.common.ToolType.AXE) return super.getToolModifiedState(state, world, pos, player, stack, toolType);
        ${S} result = ${target}.defaultBlockState();
        for (net.minecraft.state.Property<?> property : state.getProperties()) if (result.hasProperty(property)) result = copyProperty(result, state, property);
        return result;`));
      members.push(`
    private static <T extends Comparable<T>> ${S} copyProperty(${S} to, ${S} from, net.minecraft.state.Property<T> property) {
        return to.setValue(property, from.getValue(property));
    }
`);
    } else if (env.loader === "neoforge" && env.mc === "1.21.5") {
      members.push(override(`public ${S} getToolModifiedState(${S} state, net.minecraft.world.item.context.UseOnContext context, net.neoforged.neoforge.common.ItemAbility ability, boolean simulate)`,
        `if (ability == net.neoforged.neoforge.common.ItemAbilities.AXE_STRIP && context.getItemInHand().canPerformAction(ability)) return ${target}.withPropertiesOf(state);
        return super.getToolModifiedState(state, context, ability, simulate);`));
    } else if (env.loader === "neoforge") {
      // 26.x axes strip through block transformers, which NeoForge extends with a data map.
      strip = { block: qualify(env, id), into: qualify(env, stripped) };
    } else {
      // Fabric: the block handles the axe before the axe's own transformers.
      const hurt = env.mc === "26.3" ? "stack.hurtAndBreak(1, player, hand)" : "stack.hurtAndBreak(1, player, net.minecraft.world.entity.LivingEntity.getSlotForHand(hand))";
      members.push(override(`protected net.minecraft.world.InteractionResult useItemOn(net.minecraft.world.item.ItemStack stack, ${S} state, net.minecraft.world.level.Level world, ${n.pos} pos, net.minecraft.world.entity.player.Player player, net.minecraft.world.InteractionHand hand, net.minecraft.world.phys.BlockHitResult hit)`,
        `if (!stack.is(net.minecraft.tags.ItemTags.AXES)) return super.useItemOn(stack, state, world, pos, player, hand, hit);
        ${S} result = ${target}.withPropertiesOf(state);
        world.playSound(player, pos, net.minecraft.sounds.SoundEvents.AXE_STRIP${env.mc === "26.3" ? ".value()" : ""}, net.minecraft.sounds.SoundSource.BLOCKS, 1F, 1F);
        world.setBlock(pos, result, 11);
        world.gameEvent(net.minecraft.world.level.gameevent.GameEvent.BLOCK_CHANGE, pos, net.minecraft.world.level.gameevent.GameEvent.Context.of(player, result));
        if (player != null) ${hurt};
        return net.minecraft.world.InteractionResult.SUCCESS;`));
    }
  }
  if (signParts) {
    init.push(...signParts.init);
    // 26.x wall signs are models turned to their facing; before, the block entity draws them.
    const wallStates = env.mc === "26.3"
      ? Object.fromEntries(Object.entries({ south: 0, west: 90, north: 180, east: 270 }).map(([facing, y]) => [`facing=${facing}`, { model: `${env.modId}:block/${id}_wall`, ...(y ? { y } : {}) }]))
      : { "": { model: `${env.modId}:block/${id}` } };
    files.push({ path: `assets/${env.modId}/blockstates/${id}_wall.json`, json: JSON.stringify({ variants: wallStates }, null, 2) });
  }
  if (plant) {
    files.push(...plant.files);
    init.push(...plant.init);
  }
  if (block.generateFeature === true) {
    if (legacy) {
      members.push(oreGen1165(env, block));
      const owner = `${env.project.mod.package}.block.${pascalClass(block)}.Ore`;
      init.push(`modBus.addListener(${owner}::register);`, `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(${owner}::addToBiome);`);
    } else {
      files.push(...oreFiles(env, block));
      if (env.loader === "fabric") init.push(fabricOreModification(env, block));
    }
  }

  // Loader hooks (Forge / NeoForge)
  if (env.loader !== "fabric") {
    const reader = legacy ? "net.minecraft.world.IWorldReader" : "net.minecraft.world.level.LevelReader";
    if (block.displayFluidOverlay === true) {
      const display = legacy ? "net.minecraft.world.IBlockDisplayReader" : env.mc === "26.3" ? "net.minecraft.world.level.BlockAndLightGetter" : "net.minecraft.world.level.BlockAndTintGetter";
      members.push(override(`public boolean shouldDisplayFluidOverlay(${S} state, ${display} world, ${n.pos} pos, ${n.fluidState} fluid)`, "return true;"));
    }
    const beacon = str(block.beaconColorModifier);
    if (beacon) {
      const rgb = parseInt(beacon.slice(1), 16);
      members.push(legacy
        ? override(`public float[] getBeaconColorMultiplier(${S} state, ${reader} world, ${n.pos} pos, ${n.pos} beaconPos)`, `return new float[] { ${((rgb >> 16) & 255) / 255}F, ${((rgb >> 8) & 255) / 255}F, ${(rgb & 255) / 255}F };`)
        : override(`public Integer getBeaconColorMultiplier(${S} state, ${reader} world, ${n.pos} pos, ${n.pos} beaconPos)`, `return ${0xff000000 | rgb};`));
    }
    if (Number(block.enchantPowerBonus) !== 0) {
      members.push(override(`public float getEnchantPowerBonus(${S} state, ${env.mc === "26.3" ? n.getter : reader} world, ${n.pos} pos)`, `return ${jfloat(block.enchantPowerBonus)};`));
    }
    if (Number(block.flammability) !== 0) members.push(override(`public int getFlammability(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} face)`, `return ${block.flammability};`));
    if (Number(block.fireSpreadSpeed) !== 0) members.push(override(`public int getFireSpreadSpeed(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} face)`, `return ${block.fireSpreadSpeed};`));
    if (legacy && block.plantsGrowOn === true) {
      members.push(override(`public boolean canSustainPlant(${S} state, ${n.getter} world, ${n.pos} pos, ${n.dir} facing, net.minecraftforge.common.IPlantable plantable)`, "return true;"));
    }
  }
  const fabricInit: string[] = [];
  if (env.loader === "fabric" && (Number(block.flammability) !== 0 || Number(block.fireSpreadSpeed) !== 0)) {
    fabricInit.push(`net.fabricmc.fabric.api.registry.FlammableBlockRegistry.getDefaultInstance().add(${pascalConst(block)}, ${block.flammability}, ${block.fireSpreadSpeed});`);
  }

  // ---- Tags
  const tags: TagEntry[] = [];
  const self = qualify(env, id);
  if (!legacy && destroyTool !== "Not specified") tags.push({ registry: "block", tag: `minecraft:mineable/${destroyTool}`, value: self });
  if (!legacy && needsTag) tags.push({ registry: "block", tag: needsTag, value: self });
  if (block.isLadder === true) tags.push({ registry: "block", tag: "minecraft:climbable", value: self });
  if (!legacy && block.plantsGrowOn === true) tags.push({ registry: "block", tag: "minecraft:dirt", value: self });
  // Wooden doors, trapdoors, buttons and plates join the wooden tags, which are part of the general ones.
  const set = (tag: string) => (setType === "OAK" ? `wooden_${tag}` : tag);
  const baseTags: Record<string, string[]> = {
    Stairs: ["stairs"], Slab: ["slabs"], Fence: ["fences"], Wall: ["walls"], Leaves: ["leaves"], FenceGate: ["fence_gates"],
    Door: [set("doors")], TrapDoor: [set("trapdoors")], Button: [set("buttons")], PressurePlate: [set("pressure_plates")], FlowerPot: ["flower_pots"],
    Sign: ["standing_signs"], HangingSign: ["ceiling_hanging_signs"],
  };
  if (sign) tags.push({ registry: "block", tag: base === "Sign" ? "minecraft:wall_signs" : "minecraft:wall_hanging_signs", value: `${self}_wall` });
  for (const tag of baseTags[base] ?? []) tags.push({ registry: "block", tag: `minecraft:${tag}`, value: self });
  const itemTags: Record<string, string[]> = {
    Stairs: ["stairs"], Slab: ["slabs"], Fence: ["fences"], Wall: ["walls"], Leaves: ["leaves"], FenceGate: ["fence_gates"],
    Door: [set("doors")], TrapDoor: [set("trapdoors")], Button: [set("buttons")], ...(setType === "OAK" ? { PressurePlate: ["wooden_pressure_plates"] } : {}),
    Sign: ["signs"], HangingSign: ["hanging_signs"],
  };
  if (block.hasBlockItem === true) for (const tag of itemTags[base] ?? []) tags.push({ registry: "item", tag: `minecraft:${tag}`, value: self });

  // ---- Block item
  const hasItem = block.hasBlockItem === true;
  const itemProps: string[] = [];
  if (Number(block.maxStackSize) !== 64) itemProps.push(`.stacksTo(${block.maxStackSize})`);
  if (block.rarity !== "COMMON") itemProps.push(`.rarity(${itemPkg(env)}.Rarity.${str(block.rarity)})`);
  if (block.immuneToFire === true) itemProps.push(".fireResistant()");
  if (javaItem) itemProps.push(...javaItem.props);

  // ---- Models
  const models = blockModels(block, env, render, side, tex);
  // A multi-block's other parts draw nothing; their particles are the block's.
  if (cells) {
    const own = (models.find((m) => m.name === id)?.json as { textures?: Record<string, string> } | undefined)?.textures;
    models.push({ name: `${id}_part`, json: { textures: { particle: own?.particle ?? Object.values(own ?? {})[0] ?? tex() } } });
  }
  // State rows: their own model (and textures) for the property values they name.
  for (const r of rows) {
    let rowRender = (tint && TINTED_RENDER[Number(r.row.renderType)]) || Number(r.row.renderType) || 10;
    if (rowRender === 4) {
      procedureBuild(env).warnings.push(`block/${id}: state ${r.index + 1}: Java models are drawn by the block entity, not per state; the cube is used`);
      rowRender = 10;
    }
    const sfx = `state${r.index}`;
    const rtex = (suffix?: string) => `${env.modId}:block/${id}_${sfx}${suffix ? `_${suffix}` : ""}`;
    textures.push({ from: str(r.row.texture) || str(block.texture), to: `block/${id}_${sfx}` });
    for (const key of Object.keys(SIDES) as (keyof typeof SIDES)[]) if (str(r.row[key])) textures.push({ from: str(r.row[key]), to: `block/${id}_${sfx}_${SIDES[key]}` });
    if (str(r.row.particleTexture)) textures.push({ from: str(r.row.particleTexture), to: `block/${id}_${sfx}_particle` });
    const rside = (key: keyof typeof SIDES) => (str(r.row[key]) ? rtex(SIDES[key]) : rtex());
    // The slot mapping belongs to the block's own model, not to a state's.
    const rowBlock = { ...block, ...r.row, id, blockBase: "", customModelTextures: {} } as Element;
    models.push(...blockModels(rowBlock, env, rowRender, rside, rtex).map((m) => ({ name: m.name === id ? `${id}_${sfx}` : m.name.replace(id, `${id}_${sfx}`), json: m.json })));
  }
  const blockRef = blockExpr(env, id);
  const client: Required<NonNullable<ElementContext["client"]>> = { colors: [], itemColors: [], setup: [] };
  if (signParts) client.setup.push(...signParts.setup);
  const layer = renderLayer(block, base, render);
  if (layer && env.mc === "1.21.5" && env.loader === "neoforge") {
    for (const model of models) (model.json as Record<string, unknown>).render_type = `minecraft:${layer}`;
  } else if (layer && (legacy || (env.mc === "1.21.5" && env.loader === "fabric"))) {
    const type = `net.minecraft.client.renderer.RenderType.${{ cutout: "cutout", cutout_mipped: "cutoutMipped", translucent: "translucent" }[layer]}()`;
    client.setup.push(legacy ? `net.minecraft.client.renderer.RenderTypeLookup.setRenderLayer(${blockRef}, ${type});`
      : `net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap.INSTANCE.putBlock(${blockRef}, ${type});`);
  }
  const itemTinted = tint !== "" && block.isItemTinted === true && block.hasBlockItem === true;
  if (tint) client.colors.push(blockColorRegistration(env, tint, render === 14, blockRef));
  if (itemTinted && legacy) {
    const color = tint === "Grass" ? "net.minecraft.world.GrassColors.get(0.5D, 1.0D)" : String(TINT_COLORS[tint]);
    client.itemColors.push(`event.getItemColors().register((stack, index) -> ${color}, ${itemExpr(env, id)});`);
  }
  // 1.21.4+ item tints are part of the item model definition.
  const itemTints = itemTinted && !legacy
    ? [tint === "Grass" ? { type: "minecraft:grass", temperature: 0.5, downfall: 1.0 } : { type: "minecraft:constant", value: TINT_COLORS[tint] }]
    : undefined;

  return {
    ...(hasItem ? itemForm(env, id, block.creativeTabs) : { tabItems: [], vanillaTab: "" }),
    hasItem,
    hasInventory: block.hasInventory === true,
    itemConstant: derivedConstant(pascalConst(block), "Item"),
    wallConstant: derivedConstant(pascalConst(block), "Wall"),
    superClass: classes[base],
    interfaces: interfaceList([waterlogged ? (legacy ? "net.minecraft.block.IWaterLoggable" : `${blk}.SimpleWaterloggedBlock`) : "", inventory?.interface ?? "", plant?.interface ?? ""]),
    superArgs,
    propsType: legacy ? "net.minecraft.block.AbstractBlock.Properties" : `${blk}.state.BlockBehaviour.Properties`,
    fields: fields.map((f) => `    ${f}\n`).join(""),
    defaultState: (defaults.length ? `\n        this.registerDefaultState(this.stateDefinition.any()${defaults.join("")});` : "") + ctor.map((line) => `\n        ${line}`).join(""),
    members: [...members, ...blockProcedureMembers(env, block, inventory?.openGui ?? "")].join(""),
    // A sign item places the standing or the wall sign.
    itemSuperArgs: sign ? (legacy ? `properties${itemProps.join("")}, block, ${blockExpr(env, `${id}_wall`)}`
      : `block, ${blockExpr(env, `${id}_wall`)}, ${base === "Sign" && env.mc === "26.3" ? "net.minecraft.core.Direction.DOWN, " : ""}properties${itemProps.join("")}`)
      : `block, properties${itemProps.join("")}`,
    hasWall: sign,
    itemMembers: tooltipProcedureMember(env, "block", block, "specialInformationProcedure") ?? tooltipMethod(env, str(block.specialInformation), "item"),
    itemPropsType: `${itemPkg(env)}.Item.Properties`,
    // Door items place both halves.
    itemClass: base === "Door" || base === "DoublePlant" ? `${itemPkg(env)}.${legacy ? "TallBlockItem" : "DoubleHighBlockItem"}`
      : base === "Sign" ? `${itemPkg(env)}.${env.mc === "26.3" ? "StandingAndWallBlockItem" : "SignItem"}`
        : base === "HangingSign" ? `${itemPkg(env)}.HangingSignItem` : `${itemPkg(env)}.BlockItem`,
    // 1.16.5 doors, trapdoors, buttons and plates take their behavior and sounds from the material.
    material: plant ? (block.isReplaceable === true ? "REPLACEABLE_PLANT" : "PLANT") : setType === "IRON" ? "METAL" : setType === "OAK" ? "WOOD" : materialOf(block),
    // 1.16.5 takes the map color with the material, and lava ignites blocks whose material is flammable.
    materialExpr: legacy ? legacyMaterial(block, plant ? (block.isReplaceable === true ? "REPLACEABLE_PLANT" : "PLANT") : setType === "IRON" ? "METAL" : setType === "OAK" ? "WOOD" : materialOf(block)) : "",
    growablePlant: base === "GrowablePlant",
    multiBlock: cells !== undefined,
    itemPkg: itemPkg(env),
    blockClass: `${blk}.Block`,
    fabricInit: fabricInit.join("\n        "),
    init,
    files,
    strip,
    blockstateJson: JSON.stringify(((single: Record<string, unknown>) => (cells ? multiBlockstate(single, cells.length, `${env.modId}:block/${id}_part`) : single))((rows.length
      ? blockstateWithStates(blockstate(block, env, rotation, tex) as Record<string, unknown>, rows, known, (r) => `${env.modId}:block/${id}_state${r.index}`, block.multipartModel === true)
      : blockstate(block, env, rotation, tex)) as Record<string, unknown>), null, 2),
    // A flat item icon: the item texture, or the block texture for cross-shaped plants and crops.
    itemModelJson: javaItem ? JSON.stringify(javaItem.modelJson, null, 2) : JSON.stringify(str(block.itemTexture) || [12, 120, 13].includes(render) || base === "Door" || base === "Sign" || base === "HangingSign"
      ? { parent: "minecraft:item/generated", textures: { layer0: str(block.itemTexture) ? `${env.modId}:item/${id}` : tex() }, ...itemDisplay(block) }
      : { parent: itemModelParent(block, env), ...itemDisplay(block) }, null, 2),
    itemDefinitionJson: JSON.stringify({ model: javaItem ? javaItem.definition : { type: "minecraft:model", model: `${env.modId}:item/${id}`, ...(itemTints ? { tints: itemTints } : {}) } }, null, 2),
    client,
    lootJson: lootTable(block, env, cells !== undefined),
    hasLoot: block.useLootTableForDrops !== true,
    models,
    textures,
    tags,
  };
}

const pascalClass = (block: Element) => block.id.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("") + "Block";
const pascalConst = (block: Element) => block.id.toUpperCase();

/** Leaves constructor arguments (1.21.5+): falling particle chance and, for a chosen particle, that particle. */
function leavesArgs(env: GenEnv, block: Element, chain: string): string {
  const chance = jfloat(block.leavesParticleChance);
  const particle = str(block.leavesParticleType);
  if (!particle) return `${chance}, ${chain}`;
  // Only simple vanilla particles are generated (layer.json), so the ParticleTypes constant is the particle.
  const type = `net.minecraft.core.particles.ParticleTypes.${particle.replace(/^minecraft:/, "").toUpperCase()}`;
  return env.mc === "26.3" ? `${chance}, ${type}, net.minecraft.world.level.block.sounds.AmbientLeavesBlockSoundPlayer.noAmbientSound(), ${chain}` : `${chance}, ${type}, ${chain}`;
}

/**
 * Flower pot constructor arguments. Forge and NeoForge pots name the empty pot and their plant and are added to
 * the empty pot by the constructor (see the ctor statements); vanilla pots register themselves by plant.
 */
function flowerPotArgs(env: GenEnv, block: Element, chain: string): string {
  const plant = blockExpr(env, str(block.pottedPlant));
  if (env.loader === "fabric") return `${plant}, ${chain}`;
  const blk = names(env).blk;
  return `() -> (${blk}.FlowerPotBlock) ${blk}.Blocks.FLOWER_POT, () -> ${plant}, ${chain}`;
}

/**
 * Sign parts: the wood type naming its textures, the wall variant (a second block "<id>_wall" sharing loot and
 * name), and the sign block entity accepting both blocks (NeoForge: an event, Fabric: the entity type; 1.16.5:
 * an own entity type, since vanilla's sign entity type only takes vanilla signs).
 */
function signCode(env: GenEnv, block: Element, chain: string) {
  const id = block.id;
  const hanging = block.blockBase === "HangingSign";
  const owner = `${env.project.mod.package}.block.${pascalClass(block)}`;
  const main = blockExpr(env, id), wall = blockExpr(env, `${id}_wall`);
  const name = JSON.stringify(`${env.modId}:${id}`);
  if (env.mc === "1.16.5") {
    const te = "net.minecraft.tileentity";
    const newEntity = (indent: string) => `
${indent}@Override
${indent}public ${te}.TileEntity newBlockEntity(net.minecraft.world.IBlockReader world) {
${indent}    return new Entity();
${indent}}
`;
    return {
      fields: [
        `public static final net.minecraft.block.WoodType WOOD_TYPE = net.minecraft.block.WoodType.register(net.minecraft.block.WoodType.create(${name}));`,
        `public static ${te}.TileEntityType<Entity> ENTITY_TYPE;`,
      ],
      members: [newEntity("    "), `
    /** The sign on a wall. */
    public static class Wall extends net.minecraft.block.WallSignBlock {
        public Wall(net.minecraft.block.AbstractBlock.Properties properties) {
            super(${chain}
                .dropsLike(${main}), WOOD_TYPE);
        }
${newEntity("        ")}    }

    /** Sign block entity of this sign. */
    public static class Entity extends ${te}.SignTileEntity {
        @Override
        public ${te}.TileEntityType<?> getType() {
            return ENTITY_TYPE;
        }
    }

    public static void registerEntity(net.minecraftforge.event.RegistryEvent.Register<${te}.TileEntityType<?>> event) {
        ENTITY_TYPE = ${te}.TileEntityType.Builder.of(Entity::new, ${main}, ${wall}).build(null);
        ENTITY_TYPE.setRegistryName(${name});
        event.getRegistry().register(ENTITY_TYPE);
    }
`],
      init: [`modBus.addGenericListener(net.minecraft.tileentity.TileEntityType.class, ${owner}::registerEntity);`],
      setup: [`net.minecraft.client.renderer.Atlases.addWoodType(${owner}.WOOD_TYPE);`,
        `net.minecraftforge.fml.client.registry.ClientRegistry.bindTileEntityRenderer(${owner}.ENTITY_TYPE, net.minecraft.client.renderer.tileentity.SignTileEntityRenderer::new);`],
    };
  }
  const props = "net.minecraft.world.level.block.state.properties";
  // 26.x moved the vanilla block entity types to BlockEntityTypes.
  const type = `net.minecraft.world.level.block.entity.${env.mc === "26.3" ? "BlockEntityTypes" : "BlockEntityType"}.${hanging ? "HANGING_SIGN" : "SIGN"}`;
  const lootKey = `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.LOOT_TABLE, ${idExpr(env, `${env.modId}:blocks/${id}`)})`;
  return {
    // WoodType.register is only opened up by NeoForge; Fabric registers through its builder.
    fields: [`public static final ${props}.WoodType WOOD_TYPE = ${env.loader === "fabric"
      ? `new net.fabricmc.fabric.api.object.builder.v1.block.type.WoodTypeBuilder().register(${idExpr(env, `${env.modId}:${id}`)}, ${props}.BlockSetType.OAK)`
      : `${props}.WoodType.register(new ${props}.WoodType(${name}, ${props}.BlockSetType.OAK))`};`],
    members: [`
    /** The sign on a wall. */
    public static class Wall extends net.minecraft.world.level.block.${hanging ? "WallHangingSignBlock" : "WallSignBlock"} {
        public Wall(net.minecraft.world.level.block.state.BlockBehaviour.Properties properties) {
            super(WOOD_TYPE, ${chain}
                .overrideLootTable(java.util.Optional.of(${lootKey}))
                .overrideDescription(${JSON.stringify(`block.${env.modId}.${id}`)}));
        }
    }
`],
    init: env.loader === "neoforge"
      ? [`modBus.addListener(net.neoforged.neoforge.event.BlockEntityTypeAddBlocksEvent.class, event -> event.modify(${type}, ${main}, ${wall}));`]
      : [main, wall].map((b) => `((net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityType) ${type}).${env.mc === "26.3" ? "addValidBlock" : "addSupportedBlock"}(${b});`),
    // Fabric adds registered wood types to the sign sheets itself; 26.x has no sign sheets.
    setup: env.loader === "neoforge" && env.mc === "1.21.5" ? [`net.minecraft.client.renderer.Sheets.addWoodType(${owner}.WOOD_TYPE);`] : [],
  };
}

/** Replaced blocks and biomes of an ore: block ids or "#tags"; one biome tag wins over a biome list. */
function oreTargets(env: GenEnv, block: Element) {
  const replaces = list<Record<string, unknown>>(block.blocksToReplace).map((row) => str(row.block)).filter(Boolean).map((ref) => qualify(env, ref));
  const biomes = list<Record<string, unknown>>(block.restrictionBiomes).map((row) => str(row.biome)).filter(Boolean).map((ref) => qualify(env, ref));
  return { replaces, biomes, biomeTag: biomes.find((b) => b.startsWith("#")) };
}

/** 1.21.5+ ore: configured (26.x: plain) feature, placed feature and on NeoForge the biome modifier adding it. */
function oreFiles(env: GenEnv, block: Element): ResourceFile[] {
  const id = qualify(env, block.id);
  const { replaces, biomes, biomeTag } = oreTargets(env, block);
  const rule = (ref: string) => (ref.startsWith("#") ? { predicate_type: "minecraft:tag_match", tag: ref.slice(1) } : { predicate_type: "minecraft:block_match", block: ref });
  const config = { size: Number(block.frequencyOnChunk), discard_chance_on_air_exposure: 0 };
  const feature = env.mc === "26.3"
    ? { type: "minecraft:ore", ...config, targets: replaces.map((ref) => ({ state: id, target: rule(ref) })) }
    : { type: "minecraft:ore", config: { ...config, targets: replaces.map((ref) => ({ target: rule(ref), state: { Name: id } })) } };
  const placed = {
    feature: id,
    placement: [
      { type: "minecraft:count", count: Number(block.frequencyPerChunks) },
      { type: "minecraft:in_square" },
      { type: "minecraft:height_range", height: {
        type: block.generationShape === "TRIANGLE" ? "minecraft:trapezoid" : "minecraft:uniform",
        min_inclusive: { absolute: Number(block.minGenerateHeight) }, max_inclusive: { absolute: Number(block.maxGenerateHeight) },
      } },
      { type: "minecraft:biome" },
    ],
  };
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const dir = `data/${env.modId}/worldgen`;
  const files = [
    { path: `${dir}/${env.mc === "26.3" ? "feature" : "configured_feature"}/${block.id}.json`, json: json(feature) },
    { path: `${dir}/placed_feature/${block.id}.json`, json: json(placed) },
  ];
  if (env.loader === "neoforge") {
    const set = biomeTag ?? (biomes.length ? biomes : { type: "neoforge:any" });
    files.push({ path: `data/${env.modId}/neoforge/biome_modifier/${block.id}.json`, json: json({ type: "neoforge:add_features", biomes: set, features: id, step: "underground_ores" }) });
  }
  return files;
}

/** Fabric adds the placed ore feature to the chosen biomes through the biome modification API. */
function fabricOreModification(env: GenEnv, block: Element): string {
  const { biomes, biomeTag } = oreTargets(env, block);
  const reg = "net.minecraft.core.registries.Registries";
  const selectors = "net.fabricmc.fabric.api.biome.v1.BiomeSelectors";
  const selector = biomeTag ? `${selectors}.tag(net.minecraft.tags.TagKey.create(${reg}.BIOME, ${idExpr(env, biomeTag.slice(1))}))`
    : biomes.length ? `${selectors}.includeByKey(${biomes.map((b) => `net.minecraft.resources.ResourceKey.create(${reg}.BIOME, ${idExpr(env, b)})`).join(", ")})`
      : `${selectors}.all()`;
  return `net.fabricmc.fabric.api.biome.v1.BiomeModifications.addFeature(${selector}, net.minecraft.world.level.levelgen.GenerationStep.Decoration.UNDERGROUND_ORES, net.minecraft.resources.ResourceKey.create(${reg}.PLACED_FEATURE, ${idExpr(env, qualify(env, block.id))}));`;
}

/**
 * 1.16.5 ore: a configured feature registered at common setup and added to biomes as they load. Its target is
 * its own rule test, since one ore feature there has a single target. 1.16.5 has no biome tags: the dimension
 * tags select biome categories, other tags select nothing.
 */
function oreGen1165(env: GenEnv, block: Element): string {
  const { replaces, biomes } = oreTargets(env, block);
  const rl = (id: string) => `new net.minecraft.util.ResourceLocation(${JSON.stringify(id)})`;
  const test = replaces.map((ref) => (ref.startsWith("#") ? `state.is(net.minecraft.tags.BlockTags.createOptional(${rl(ref.slice(1))}))` : `state.getBlock() == ${blockExpr(env, ref)}`)).join(" || ") || "false";
  const clamp = (n: unknown) => Math.max(0, Math.min(255, Number(n)));
  const min = clamp(block.minGenerateHeight), max = Math.max(min, clamp(block.maxGenerateHeight));
  const placement = block.generationShape === "TRIANGLE"
    ? `net.minecraft.world.gen.placement.Placement.DEPTH_AVERAGE.configured(new net.minecraft.world.gen.placement.DepthAverageConfig(${Math.round((min + max) / 2)}, ${Math.round((max - min) / 2)}))`
    : `net.minecraft.world.gen.placement.Placement.RANGE.configured(new net.minecraft.world.gen.placement.TopSolidRangeConfig(${min}, ${min}, ${max + 1}))`;
  const category = (name: string) => `event.getCategory() == net.minecraft.world.biome.Biome.Category.${name}`;
  const biomeTests = biomes.map((b) => b === "#minecraft:is_nether" ? category("NETHER") : b === "#minecraft:is_end" ? category("THEEND")
    : b === "#minecraft:is_overworld" ? `!(${category("NETHER")} || ${category("THEEND")} || ${category("NONE")})`
      : b.startsWith("#") ? "false" : `${rl(b)}.equals(event.getName())`);
  return `
    /** Generates this block as an ore. */
    public static final class Ore {
        private static net.minecraft.world.gen.feature.ConfiguredFeature<?, ?> feature;
        private static final net.minecraft.world.gen.feature.template.RuleTest TARGET = new net.minecraft.world.gen.feature.template.RuleTest() {
            @Override
            public boolean test(net.minecraft.block.BlockState state, java.util.Random random) {
                return ${test};
            }

            @Override
            protected net.minecraft.world.gen.feature.template.IRuleTestType<?> getType() {
                return TARGET_TYPE;
            }
        };
        private static final net.minecraft.world.gen.feature.template.IRuleTestType<net.minecraft.world.gen.feature.template.RuleTest> TARGET_TYPE = () -> com.mojang.serialization.Codec.unit(TARGET);

        public static void register(net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) {
            event.enqueueWork(() -> {
                net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.Registry.RULE_TEST, ${rl(`${env.modId}:${block.id}_ore_target`)}, TARGET_TYPE);
                feature = net.minecraft.world.gen.feature.Feature.ORE.configured(new net.minecraft.world.gen.feature.OreFeatureConfig(TARGET, ${blockExpr(env, block.id)}.defaultBlockState(), ${Number(block.frequencyOnChunk)}))
                        .decorated(${placement})
                        .squared()
                        .count(${Number(block.frequencyPerChunks)});
                net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_FEATURE, ${rl(`${env.modId}:${block.id}`)}, feature);
            });
        }

        public static void addToBiome(net.minecraftforge.event.world.BiomeLoadingEvent event) {
            if (feature != null${biomeTests.length ? ` && (${biomeTests.join(" || ")})` : ""}) {
                event.getGeneration().addFeature(net.minecraft.world.gen.GenerationStage.Decoration.UNDERGROUND_ORES, feature);
            }
        }
    }
`;
}

function customSound(env: GenEnv, block: Element): string {
  const sound = (key: string) => {
    const id = idExpr(env, qualify(env, str(block[key]) || "minecraft:block.stone.break"));
    return env.mc === "1.16.5" ? `() -> new net.minecraft.util.SoundEvent(${id})` : `net.minecraft.sounds.SoundEvent.createVariableRangeEvent(${id})`;
  };
  return env.mc === "1.16.5"
    ? `new net.minecraftforge.common.util.ForgeSoundType(1F, 1F, ${["breakSound", "stepSound", "placeSound", "hitSound", "fallSound"].map(sound).join(", ")})`
    : `new net.minecraft.world.level.block.SoundType(1F, 1F, ${["breakSound", "stepSound", "placeSound", "hitSound", "fallSound"].map(sound).join(", ")})`;
}

function shapeExpr(env: GenEnv, boxes: Box[]): string {
  const n = names(env);
  const blk = `${n.blk}.Block`;
  const box = (b: Box) => `${blk}.box(${[b.mx, b.my, b.mz, b.Mx, b.My, b.Mz].join(", ")})`;
  const add = boxes.filter((b) => !b.subtract), sub = boxes.filter((b) => b.subtract);
  let expr = add.length ? (add.length === 1 ? box(add[0]) : `${n.shapes}.or(${add.map(box).join(", ")})`) : `${n.shapes}.empty()`;
  if (sub.length) expr = `${n.shapes}.join(${expr}, ${sub.length === 1 ? box(sub[0]) : `${n.shapes}.or(${sub.map(box).join(", ")})`}, ${n.onlyFirst})`;
  return expr;
}

/** Box rotations matching the blockstate rotations used for the facing variants. */
function norm(a: [number, number, number], b: [number, number, number], subtract?: boolean): Box {
  return { mx: Math.min(a[0], b[0]), my: Math.min(a[1], b[1]), mz: Math.min(a[2], b[2]), Mx: Math.max(a[0], b[0]), My: Math.max(a[1], b[1]), Mz: Math.max(a[2], b[2]), subtract };
}
function rotY(b: Box, quarters: number): Box {
  const turn = ([x, y, z]: [number, number, number]): [number, number, number] => [16 - z, y, x];
  let p: [number, number, number] = [b.mx, b.my, b.mz], q: [number, number, number] = [b.Mx, b.My, b.Mz];
  for (let i = 0; i < quarters; i++) { p = turn(p); q = turn(q); }
  return norm(p, q, b.subtract);
}
const rotXUp = (b: Box) => norm([b.mx, 16 - b.mz, b.my], [b.Mx, 16 - b.Mz, b.My], b.subtract);
const rotXDown = (b: Box) => norm([b.mx, b.mz, 16 - b.my], [b.Mx, b.Mz, 16 - b.My], b.subtract);
/** Box turned like a blockstate variant's "x" rotation in degrees (90 = rotXDown). */
const rotX = (b: Box, degrees: number) => Array.from({ length: degrees / 90 }).reduce<Box>((box) => rotXDown(box), b);
/** Blockstate rotations of floor, wall and ceiling attached blocks: x per face, y per facing. */
const PITCH_X = { floor: 0, wall: 90, ceiling: 180 };
const PITCH_Y: Record<keyof typeof PITCH_X, Record<string, number>> = {
  floor: { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 },
  wall: { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 },
  ceiling: { NORTH: 180, EAST: 270, SOUTH: 0, WEST: 90 },
};

/**
 * Chunk render layer before 26.x, which picks it from the textures: the chosen transparency, else what vanilla
 * uses for the model (cutout plants and pots, cutout mipped grass). "" keeps the solid layer.
 */
function renderLayer(block: Element, base: string, render: number): "" | "cutout" | "cutout_mipped" | "translucent" {
  if (block.hasTransparency === true) {
    const type = str(block.transparencyType);
    return type === "SOLID" ? "" : type.toLowerCase() as "cutout" | "cutout_mipped" | "translucent";
  }
  if (render === 14) return "cutout_mipped";
  // Plants drawn with a project model are cut out like the vanilla plant shapes.
  return [12, 120, 13, 15, 150].includes(render) || base === "Door" || base === "TrapDoor" || (PLANT_BASES.includes(base) && [2, 3].includes(render)) ? "cutout" : "";
}

/** Client statement registering a block's biome tint, for the color event of each loader. */
function blockColorRegistration(env: GenEnv, tint: string, grassBlock: boolean, blockRef: string): string {
  if (env.mc === "26.3") {
    const sources = `java.util.List.of(${tintSource(tint, grassBlock)})`;
    return env.loader === "fabric" ? `net.fabricmc.fabric.api.client.rendering.v1.BlockColorRegistry.register(${sources}, ${blockRef});`
      : `event.register(${sources}, ${blockRef});`;
  }
  const legacy = env.mc === "1.16.5";
  const biomes = legacy ? "net.minecraft.world.biome.BiomeColors" : "net.minecraft.client.renderer.BiomeColors";
  const known = "w != null && p != null";
  const average = (what: string, fallback: string) => `(s, w, p, i) -> ${known} ? ${biomes}.getAverage${what}Color(w, p) : ${fallback}`;
  const level = "net.minecraft.client.Minecraft.getInstance().level";
  const biome = (getter: string) => `(s, w, p, i) -> ${known} && ${level} != null ? ${level}.getBiome(p)${legacy ? "" : ".value()"}.get${getter}Color() : ${TINT_COLORS[tint]}`;
  const lambda = tint === "Grass" ? average("Grass", legacy ? "net.minecraft.world.GrassColors.get(0.5D, 1.0D)" : "net.minecraft.world.level.GrassColor.getDefaultColor()")
    : tint === "Foliage" ? average("Foliage", String(TINT_COLORS.Foliage))
      : tint === "Dry foliage" ? average("DryFoliage", String(TINT_COLORS[tint]))
        : tint === "Water" ? average("Water", String(TINT_COLORS.Water))
          : tint === "Sky" ? biome("Sky") : tint === "Fog" ? biome("Fog") : tint === "Water fog" ? biome("WaterFog")
            : `(s, w, p, i) -> ${TINT_COLORS[tint]}`;
  if (legacy) return `event.getBlockColors().register(${lambda}, ${blockRef});`;
  return env.loader === "fabric" ? `net.fabricmc.fabric.api.client.rendering.v1.ColorProviderRegistry.BLOCK.register(${lambda}, ${blockRef});`
    : `event.register(${lambda}, ${blockRef});`;
}

/** 26.x tint source of a tint; sky and fog colors come from the environment attributes at the block. */
export function tintSource(tint: string, grassBlock: boolean): string {
  const sources = "net.minecraft.client.color.block.BlockTintSources";
  const simple: Record<string, string> = { Grass: grassBlock ? "grassBlock()" : "grass()", Foliage: "foliage()", "Dry foliage": "dryFoliage()", Water: "water()" };
  if (simple[tint]) return `${sources}.${simple[tint]}`;
  const attribute = { Sky: "SKY_COLOR", Fog: "FOG_COLOR", "Water fog": "WATER_FOG_COLOR" }[tint];
  if (!attribute) return `${sources}.constant(${TINT_COLORS[tint]})`;
  const state = "net.minecraft.world.level.block.state.BlockState";
  return `new net.minecraft.client.color.block.BlockTintSource() {
            @Override
            public int color(${state} state) {
                return ${TINT_COLORS[tint]};
            }

            @Override
            public int colorInWorld(${state} state, net.minecraft.client.renderer.block.BlockAndTintGetter world, net.minecraft.core.BlockPos pos) {
                net.minecraft.client.multiplayer.ClientLevel level = net.minecraft.client.Minecraft.getInstance().level;
                return level == null ? ${TINT_COLORS[tint]} : net.minecraft.util.ARGB.colorFromVector3f(level.environmentAttributes().getValue(net.minecraft.world.attribute.EnvironmentAttributes.${attribute}, pos));
            }
        }`;
}

/** Block models of a block: name (file under models/block) and JSON. */
function blockModels(block: Element, env: GenEnv, render: number, side: (k: keyof typeof SIDES) => string, tex: (s?: string) => string): { name: string; json: unknown }[] {
  const id = block.id;
  const base = str(block.blockBase);
  const all = tex();
  const particle = str(block.particleTexture) ? tex("particle") : undefined;
  const withParticle = (textures: Record<string, string>) => (particle ? { ...textures, particle } : textures);
  const top = side("textureTop");
  const front = side("textureFront");
  const m = (name: string, parent: string, textures: Record<string, string>) => ({ name, json: { parent: `minecraft:block/${parent}`, textures: withParticle(textures) } });
  switch (base) {
    case "Stairs": {
      const t = { bottom: all, top, side: front };
      return [m(id, "stairs", t), m(`${id}_inner`, "inner_stairs", t), m(`${id}_outer`, "outer_stairs", t)];
    }
    case "Slab": {
      const t = { bottom: all, top, side: front };
      return [m(id, "slab", t), m(`${id}_top`, "slab_top", t), m(`${id}_double`, "cube_bottom_top", t)];
    }
    case "Fence":
      return [m(`${id}_post`, "fence_post", { texture: all }), m(`${id}_side`, "fence_side", { texture: all }), m(`${id}_inventory`, "fence_inventory", { texture: all })];
    case "Wall":
      return [m(`${id}_post`, "template_wall_post", { wall: all }), m(`${id}_side`, "template_wall_side", { wall: all }),
        m(`${id}_side_tall`, "template_wall_side_tall", { wall: all }), m(`${id}_inventory`, "wall_inventory", { wall: all })];
    case "Pane": {
      const t = { pane: all, edge: top };
      return [m(`${id}_post`, "template_glass_pane_post", t), m(`${id}_side`, "template_glass_pane_side", t), m(`${id}_side_alt`, "template_glass_pane_side_alt", t),
        m(`${id}_noside`, "template_glass_pane_noside", t), m(`${id}_noside_alt`, "template_glass_pane_noside_alt", t)];
    }
    case "FenceGate":
      return [m(id, "template_fence_gate", { texture: all }), m(`${id}_open`, "template_fence_gate_open", { texture: all }),
        m(`${id}_wall`, "template_fence_gate_wall", { texture: all }), m(`${id}_wall_open`, "template_fence_gate_wall_open", { texture: all })];
    case "Leaves":
      return [m(id, "leaves", { all })];
    case "DoublePlant": {
      const parent = render === 120 ? "tinted_cross" : "cross";
      return [m(`${id}_bottom`, parent, { cross: str(block.textureBottom) ? tex("bottom") : all }), m(`${id}_top`, parent, { cross: all })];
    }
    case "Door": {
      // 1.16.5 door models are bottom/top with a hinge variant; later ones have left/right and open models.
      const t = { bottom: all, top };
      if (env.mc === "1.16.5") return ["bottom", "top"].flatMap((half) => [m(`${id}_${half}`, `door_${half}`, t), m(`${id}_${half}_hinge`, `door_${half}_rh`, t)]);
      return ["bottom", "top"].flatMap((half) => ["left", "right"].flatMap((hinge) => ["", "_open"].map((open) => m(`${id}_${half}_${hinge}${open}`, `door_${half}_${hinge}${open}`, t))));
    }
    case "TrapDoor":
      return ["bottom", "top", "open"].map((part) => m(`${id}_${part}`, `template_trapdoor_${part}`, { texture: all }));
    case "Button":
      return [m(id, "button", { texture: all }), m(`${id}_pressed`, "button_pressed", { texture: all }), m(`${id}_inventory`, "button_inventory", { texture: all })];
    case "PressurePlate":
      return [m(id, "pressure_plate_up", { texture: all }), m(`${id}_down`, "pressure_plate_down", { texture: all })];
    case "EndRod":
      return [m(id, "end_rod", { end_rod: all })];
    case "Sign":
    case "HangingSign": {
      // Before 26.x the sign is drawn by its block entity and the model only names the break particle.
      if (env.mc !== "26.3") return [{ name: id, json: { textures: { particle: particle ?? all } } }];
      const t = { all: `${env.modId}:block/signs/${id}`, particle: particle ?? all };
      const turns = [0, 1, 2, 3];
      if (base === "Sign") return [...turns.map((r) => m(`${id}_rot_${r}`, `template_sign_rot_${r}`, t)), m(`${id}_wall`, "template_wall_sign", t)];
      return [...turns.flatMap((r) => [m(`${id}_rot_${r}`, `template_hanging_sign_rot_${r}`, t), m(`${id}_attached_rot_${r}`, `template_attached_hanging_sign_rot_${r}`, t)]),
        m(`${id}_wall`, "template_wall_hanging_sign", t)];
    }
  }
  // A Java model block is drawn by its block entity renderer; the block model only names the break particle.
  if (render === 4) return [{ name: id, json: { textures: { particle: particle ?? all } } }];
  // A project model (models/<name>.json or .obj) is the parent; the block's particle texture stays its own.
  if (render === 2 || render === 3) {
    const kind = render === 2 ? "json" : "obj";
    const custom = customModel(env, `block/${id}`, str(block.customModelName), kind);
    const own = particle ?? (str(block.texture) ? all : undefined);
    if (custom) {
      // Mapped slots override the model's textures; a child model's textures win over its parent's on every loader.
      const textures: Record<string, string> = {};
      for (const [slot] of mappedSlots(block.customModelTextures)) {
        const variable = customModelSlot(env, str(block.customModelName), kind, slot);
        if (variable) textures[variable] = `${env.modId}:block/${id}_model_${slotFile(slot)}`;
        else procedureBuild(env).warnings.push(`block/${id}: model texture "${slot}" is not a material of models/${str(block.customModelName)}.obj; it is left out`);
      }
      if (own) textures.particle = own;
      return [{ name: id, json: { parent: custom, ...(Object.keys(textures).length ? { textures } : {}) } }];
    }
  }
  if (render === 11) return [m(id, "cube_all", { all })];
  if (render === 110) return [m(id, "leaves", { all })];
  if (render === 12) return [m(id, "cross", { cross: all })];
  if (render === 120) return [m(id, "tinted_cross", { cross: all })];
  if (render === 13) return [m(id, "crop", { crop: all })];
  if (render === 15) return [m(id, "flower_pot_cross", { plant: all })];
  if (render === 150) return [m(id, "tinted_flower_pot_cross", { plant: all })];
  // Grass block: the left texture is the tinted side overlay.
  if (render === 14) return [m(id, "grass_block", { bottom: all, top, side: front, overlay: side("textureLeft"), particle: particle ?? all })];
  return [m(id, "cube", { down: all, up: top, north: front, east: side("textureLeft"), south: side("textureBack"), west: side("textureRight"), particle: particle ?? front })];
}

/** The block item model's `display` transforms (JSON text of the item display field), when it holds an object. */
function itemDisplay(block: Element): { display?: unknown } {
  const text = str(block.itemDisplay).trim();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? { display: value } : {};
  } catch {
    return {};
  }
}

function itemModelParent(block: Element, env: GenEnv): string {
  const id = `${env.modId}:block/${block.id}`;
  const base = str(block.blockBase);
  if (base === "Fence" || base === "Wall" || base === "Button") return `${id}_inventory`;
  if (base === "TrapDoor") return `${id}_bottom`;
  if (base === "Pane") return `${id}_post`;
  return id;
}

function blockstate(block: Element, env: GenEnv, rotation: number, tex: (s?: string) => string): unknown {
  const model = (suffix = "") => `${env.modId}:block/${block.id}${suffix}`;
  const v = (suffix: string, extra: Record<string, unknown> = {}) => ({ model: model(suffix), ...extra });
  const legacy = env.mc === "1.16.5";
  const HORIZONTAL: [string, number][] = [["north", 0], ["east", 90], ["south", 180], ["west", 270]];
  switch (str(block.blockBase)) {
    case "Stairs": {
      const variants: Record<string, unknown> = {};
      const yaw: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };
      for (const facing of ["east", "west", "south", "north"]) for (const half of ["bottom", "top"]) for (const shape of ["straight", "inner_left", "inner_right", "outer_left", "outer_right"]) {
        // Vanilla stairs: left shapes turn back a quarter at the bottom, right shapes a quarter forward on top.
        const left = shape.endsWith("left"), right = shape.endsWith("right");
        const y = (yaw[facing] + (half === "bottom" ? (left ? 270 : 0) : (right ? 90 : 0))) % 360;
        const suffix = shape === "straight" ? "" : shape.startsWith("inner") ? "_inner" : "_outer";
        variants[`facing=${facing},half=${half},shape=${shape}`] = v(suffix, { ...(half === "top" ? { x: 180 } : {}), ...(y ? { y } : {}), uvlock: true });
      }
      return { variants };
    }
    case "Slab":
      return { variants: { "type=bottom": v(""), "type=top": v("_top"), "type=double": v("_double") } };
    case "Fence":
      return { multipart: [{ apply: v("_post") }, ...HORIZONTAL.map(([d, y]) => ({ when: { [d]: "true" }, apply: v("_side", { y, uvlock: true }) }))] };
    case "Pane":
      return { multipart: [{ apply: v("_post") },
        { when: { north: "true" }, apply: v("_side") }, { when: { east: "true" }, apply: v("_side", { y: 90 }) },
        { when: { south: "true" }, apply: v("_side_alt") }, { when: { west: "true" }, apply: v("_side_alt", { y: 90 }) },
        { when: { north: "false" }, apply: v("_noside") }, { when: { east: "false" }, apply: v("_noside_alt") },
        { when: { south: "false" }, apply: v("_noside_alt", { y: 90 }) }, { when: { west: "false" }, apply: v("_noside", { y: 270 }) }] };
    case "Wall":
      return { multipart: [{ when: { up: "true" }, apply: v("_post") },
        ...HORIZONTAL.flatMap(([d, y]) => legacy
          ? [{ when: { [d]: "low" }, apply: v("_side", { y, uvlock: true }) }, { when: { [d]: "tall" }, apply: v("_side_tall", { y, uvlock: true }) }]
          : [{ when: { [d]: "low" }, apply: v("_side", { y, uvlock: true }) }, { when: { [d]: "tall" }, apply: v("_side_tall", { y, uvlock: true }) }])] };
    case "FenceGate": {
      const variants: Record<string, unknown> = {};
      const yaw: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };
      for (const [facing, y] of Object.entries(yaw)) for (const inWall of [false, true]) for (const open of [false, true]) {
        variants[`facing=${facing},in_wall=${inWall},open=${open}`] = v(`${inWall ? "_wall" : ""}${open ? "_open" : ""}`, { ...(y ? { y } : {}), uvlock: true });
      }
      return { variants };
    }
    case "Leaves":
      return { variants: { "": v("") } };
    case "DoublePlant":
      return { variants: { "half=lower": v("_bottom"), "half=upper": v("_top") } };
    case "Door": {
      const variants: Record<string, unknown> = {};
      const yaw: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };
      for (const [facing, y] of Object.entries(yaw)) for (const half of ["lower", "upper"]) for (const hinge of ["left", "right"]) for (const open of [false, true]) {
        const part = half === "lower" ? "bottom" : "top";
        // An open door turns a quarter towards its hinge side.
        const turn = (y + (open ? (hinge === "left" ? 90 : 270) : 0)) % 360;
        const suffix = legacy ? `_${part}${(hinge === "right") !== open ? "_hinge" : ""}` : `_${part}_${hinge}${open ? "_open" : ""}`;
        variants[`facing=${facing},half=${half},hinge=${hinge},open=${open}`] = v(suffix, turn ? { y: turn } : {});
      }
      return { variants };
    }
    case "TrapDoor": {
      const variants: Record<string, unknown> = {};
      const yaw: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
      for (const [facing, y] of Object.entries(yaw)) for (const half of ["bottom", "top"]) for (const open of [false, true]) {
        variants[`facing=${facing},half=${half},open=${open}`] = open ? v("_open", y ? { y } : {}) : v(`_${half}`);
      }
      return { variants };
    }
    case "Button": {
      const variants: Record<string, unknown> = {};
      for (const face of ["floor", "wall", "ceiling"] as const) for (const [facing, y] of Object.entries(PITCH_Y[face])) for (const powered of [false, true]) {
        const x = PITCH_X[face];
        variants[`face=${face},facing=${facing.toLowerCase()},powered=${powered}`] = v(powered ? "_pressed" : "", { ...(x ? { x } : {}), ...(y ? { y } : {}), ...(face === "wall" ? { uvlock: true } : {}) });
      }
      return { variants };
    }
    case "PressurePlate":
      return { variants: { "powered=false": v(""), "powered=true": v("_down") } };
    case "EndRod":
      return { variants: { "facing=up": v(""), "facing=down": v("", { x: 180 }), "facing=north": v("", { x: 90 }), "facing=east": v("", { x: 90, y: 90 }),
        "facing=south": v("", { x: 90, y: 180 }), "facing=west": v("", { x: 90, y: 270 }) } };
    case "Sign":
    case "HangingSign": {
      if (env.mc !== "26.3") return { variants: { "": v("") } };
      // 16 rotations: four modelled steps, turned by quarters.
      const variants: Record<string, unknown> = {};
      for (let r = 0; r < 16; r++) {
        const y = Math.floor(r / 4) * 90;
        const turn = y ? { y } : {};
        if (block.blockBase === "Sign") variants[`rotation=${r}`] = v(`_rot_${r % 4}`, turn);
        else for (const attached of [false, true]) variants[`attached=${attached},rotation=${r}`] = v(`${attached ? "_attached" : ""}_rot_${r % 4}`, turn);
      }
      return { variants };
    }
    case "FlowerPot":
      return { variants: { "": v("") } };
  }
  if (rotation === 5) return { variants: { "axis=y": v(""), "axis=z": v("", { x: 90 }), "axis=x": v("", { x: 90, y: 90 }) } };
  if ((rotation === 1 || rotation === 3) && block.enablePitch === true) {
    const variants: Record<string, unknown> = {};
    for (const face of ["floor", "wall", "ceiling"] as const) {
      const x = PITCH_X[face];
      for (const [facing, y] of Object.entries(PITCH_Y[face])) variants[`face=${face},facing=${facing.toLowerCase()}`] = v("", { ...(x ? { x } : {}), ...(y ? { y } : {}) });
    }
    return { variants };
  }
  if (rotation) {
    const variants: Record<string, unknown> = Object.fromEntries(HORIZONTAL.map(([d, y]) => [`facing=${d}`, v("", y ? { y } : {})]));
    if (rotation === 2 || rotation === 4) Object.assign(variants, { "facing=up": v("", { x: 270 }), "facing=down": v("", { x: 90 }) });
    return { variants };
  }
  return { variants: { "": v("") } };
}

function lootTable(block: Element, env: GenEnv, multi: boolean): string {
  const pot = block.blockBase === "FlowerPot";
  // A pot without an item form drops its plant, like vanilla potted plants.
  const drop = qualify(env, str(block.customDrop) || (pot && block.hasBlockItem !== true ? str(block.pottedPlant) : block.id));
  const amount = Number(block.dropAmount);
  const functions: unknown[] = [];
  if (amount !== 1) functions.push({ function: "minecraft:set_count", count: amount });
  if (block.blockBase === "Slab") {
    functions.push({ function: "minecraft:set_count", count: amount * 2, add: false, conditions: [{ condition: "minecraft:block_state_property", block: qualify(env, block.id), properties: { type: "double" } }] });
  }
  // A block without an item form drops nothing unless it names another drop.
  const dropsNothing = amount === 0 || (block.hasBlockItem !== true && !str(block.customDrop) && !pot);
  // Both door halves have this table; only the lower one drops.
  const lowerHalf = block.blockBase === "Door" || block.blockBase === "DoublePlant" ? { conditions: [{ condition: "minecraft:block_state_property", block: qualify(env, block.id), properties: { half: "lower" } }] }
    // Only the origin of a multi-block drops.
    : multi ? { conditions: [{ condition: "minecraft:block_state_property", block: qualify(env, block.id), properties: { [PART_PROPERTY]: "0" } }] } : {};
  const survives = [{ condition: "minecraft:survives_explosion" }];
  const pools = dropsNothing ? [] : [{
    rolls: 1,
    entries: [{ type: "minecraft:item", name: drop, ...(functions.length ? { functions } : {}), ...lowerHalf }],
    conditions: survives,
  }];
  if (pot) pools.unshift({ rolls: 1, entries: [{ type: "minecraft:item", name: "minecraft:flower_pot" }], conditions: survives });
  return JSON.stringify(lootJson(env, { type: "minecraft:block", pools }), null, 2);
}

const interfaceList = (names: string[]) => (names.some(Boolean) ? ` implements ${names.filter(Boolean).join(", ")}` : "");

export default {
  element,
  runtime: (blocks, env) => {
    const runtime = blockEntityRuntime(env, blocks);
    const sources = [...(runtime.sources ?? [])];
    if (blocks.some((b) => b.growablePlant === true)) sources.push(growablePlantBase(env));
    if (blocks.some((b) => b.multiBlock === true)) sources.push(multiBlockBase(env));
    return { ...runtime, sources };
  },
  global: (blocks: ElementContext[]): Context => ({
    blockModels: blocks.flatMap((b) => (b.models as { name: string; json: unknown }[]).map((m) => ({ id: m.name, json: JSON.stringify(m.json, null, 2) }))),
  }),
  files: (blocks: ElementContext[]): ResourceFile[] => {
    // NeoForge 26.x: axe stripping is appended to the vanilla axe block transformer through a data map.
    const strips = blocks.map((b) => b.strip as { block: string; into: string } | undefined).filter((s) => s !== undefined);
    if (!strips.length) return [];
    const values = Object.fromEntries(strips.map(({ block, into }) => [block, {
      transformer: "minecraft:axe",
      transform_data: {
        block_state_provider: { type: "minecraft:rule_based", rules: [{ if_true: { type: "minecraft:matching_blocks", blocks: block }, then: { type: "minecraft:copy_properties", source: { id: into } } }] },
        sound: "minecraft:item.axe.strip",
        item_damage_per_use: 1,
      },
    }]));
    return [{ path: "data/neoforge/data_maps/block/transformables.json", json: JSON.stringify({ values }, null, 2) }];
  },
} satisfies TypeModule;

/**
 * Overrides running the block's procedures. An update tick procedure runs on random ticks or on a schedule:
 * the block schedules its first tick when placed and the next one after each tick.
 */
function blockProcedureMembers(env: GenEnv, block: Element, openGui: string): string[] {
  const legacy = env.mc === "1.16.5";
  const random = block.tickRandomly === true;
  const rate = Number(block.tickRate) || 0;
  const ticks = typeof block.onTickUpdate === "string" && block.onTickUpdate !== "";
  const schedule = ticks && !random && rate > 0 ? (legacy ? `world.getBlockTicks().scheduleTick(pos, this, ${rate});` : `world.scheduleTick(pos, this, ${rate});`) : "";
  const { members, handled } = procedureMembers(env, "block", block, {
    onTickUpdate: random ? "random" : rate > 0 ? String(rate) : "",
    ...(schedule ? { onBlockAdded: schedule } : {}),
    ...(openGui ? { onRightClicked: openGui } : {}),
  });
  if (openGui && !handled.has("onRightClicked")) members.push(openGuiOverride(env, openGui));
  const S = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
  // Random ticks without an update procedure (a plant that always ticks).
  if (!handled.has("onTickUpdate")) {
    if (random) members.push(override(`${legacy ? "public" : "protected"} boolean isRandomlyTicking(${S} state)`, "return true;"));
    return members;
  }
  if (random) members.push(override(`${legacy ? "public" : "protected"} boolean isRandomlyTicking(${S} state)`, "return true;"));
  if (schedule && !handled.has("onBlockAdded")) {
    members.push(legacy
      ? override(`public void onPlace(${S} state, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, ${S} oldState, boolean moving)`, `super.onPlace(state, world, pos, oldState, moving);
        ${schedule}`)
      : override(`protected void onPlace(${S} state, net.minecraft.world.level.Level world, net.minecraft.core.BlockPos pos, ${S} oldState, boolean moving)`, `super.onPlace(state, world, pos, oldState, moving);
        ${schedule}`));
  }
  return members;
}
