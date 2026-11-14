import type { Element } from "../elements/model.ts";
import { blockExpr, idExpr, jfloat, jstr, list, qualify, str } from "./java.ts";
import { procedureCall } from "./procedures.ts";
import type { GenEnv, JavaSourceFile, ResourceFile } from "./typeModule.ts";

/**
 * Plant parts of a block (plant elements are generated as blocks, see types/plant.ts): the vanilla plant class
 * and its arguments, soil, placing condition, bone meal, sapling trees and the world generation patch.
 * - Plant: FlowerBlock (suspicious stew effect, or none).
 * - DoublePlant: DoublePlantBlock (two halves, lower drops).
 * - Sapling: SaplingBlock with a tree grower made of the element's configured features.
 * - GrowablePlant: <Mod>GrowablePlant (generated once), which grows upward like sugar cane up to a height.
 */

export const PLANT_BASES = ["Plant", "DoublePlant", "Sapling", "GrowablePlant"];

export interface PlantParts {
  superClass: string;
  superArgs(chain: string): string;
  props: string[];
  fields: string[];
  defaults: string[];
  stateProps: string[];
  members: string[];
  interface: string;
  files: ResourceFile[];
  init: string[];
}

function names(env: GenEnv) {
  if (env.mc === "1.16.5") {
    return {
      blk: "net.minecraft.block", state: "net.minecraft.block.BlockState", getter: "net.minecraft.world.IBlockReader", reader: "net.minecraft.world.IWorldReader",
      accessor: "net.minecraft.world.IWorld", pos: "net.minecraft.util.math.BlockPos", level: "net.minecraft.world.World", server: "net.minecraft.world.server.ServerWorld",
      random: "java.util.Random",
    };
  }
  return {
    blk: "net.minecraft.world.level.block", state: "net.minecraft.world.level.block.state.BlockState", getter: "net.minecraft.world.level.BlockGetter",
    reader: "net.minecraft.world.level.LevelReader", accessor: "net.minecraft.world.level.LevelAccessor", pos: "net.minecraft.core.BlockPos",
    level: "net.minecraft.world.level.Level", server: "net.minecraft.server.level.ServerLevel", random: "net.minecraft.util.RandomSource",
  };
}

const growableClass = (env: GenEnv) => `${env.project.mod.package}.block.${modName(env)}GrowablePlant`;
const modName = (env: GenEnv) => env.modId.split(/[_-]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

/** Java test of a block state against block ids and #tags. */
function stateMatches(env: GenEnv, state: string, refs: string[]): string {
  const legacy = env.mc === "1.16.5";
  return refs.map((ref) => {
    if (!ref.startsWith("#")) return `${state}.is(${blockExpr(env, ref)})`;
    const tag = qualify(env, ref).slice(1);
    return legacy
      ? `${state}.is(net.minecraft.tags.BlockTags.createOptional(new net.minecraft.util.ResourceLocation(${jstr(tag)})))`
      : `${state}.is(net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.BLOCK, ${idExpr(env, tag)}))`;
  }).join(" || ");
}

/** Default soil of a growable plant by its spawn type (the block below must match). */
function soilOf(env: GenEnv, spawnType: string, state: string): string {
  const refs: Record<string, string[]> = env.mc === "1.16.5"
    ? {
      Plains: ["minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:podzol"],
      Desert: ["minecraft:sand", "minecraft:red_sand"], Beach: ["minecraft:sand", "minecraft:red_sand", "minecraft:gravel"],
      Cave: ["minecraft:stone", "minecraft:andesite", "minecraft:diorite", "minecraft:granite"],
      Nether: ["minecraft:soul_sand", "minecraft:soul_soil", "minecraft:netherrack", "minecraft:crimson_nylium", "minecraft:warped_nylium"],
      Crop: ["minecraft:farmland"],
    }
    : {
      Plains: ["#minecraft:dirt"], Desert: ["#minecraft:sand"], Beach: ["#minecraft:sand", "minecraft:gravel"],
      Cave: ["#minecraft:base_stone_overworld"], Nether: ["#minecraft:nylium", "minecraft:soul_sand", "minecraft:soul_soil", "minecraft:netherrack"],
      Crop: ["minecraft:farmland"],
    };
  if (spawnType === "Water") {
    return env.mc === "1.16.5" ? `${state}.getFluidState().is(net.minecraft.tags.FluidTags.WATER)` : `${state}.getFluidState().is(net.minecraft.tags.FluidTags.WATER)`;
  }
  return stateMatches(env, state, refs[spawnType] ?? refs.Plains);
}

export function plantParts(env: GenEnv, block: Element): PlantParts {
  const legacy = env.mc === "1.16.5";
  const n = names(env);
  const base = str(block.blockBase);
  const S = n.state;
  const parts: PlantParts = { superClass: "", superArgs: (chain) => chain, props: [], fields: [], defaults: [], stateProps: [], members: [], interface: "", files: [], init: [] };
  if (base === "Sapling" || base === "GrowablePlant") parts.props.push(".randomTicks()");

  // ---- Class
  if (base === "Plant") {
    parts.superClass = `${n.blk}.FlowerBlock`;
    const effect = str(block.suspiciousStewEffect);
    const ticks = Math.max(0, Number(block.suspiciousStewDuration) || 0);
    if (legacy) {
      parts.superArgs = (chain) => `net.minecraft.potion.Effects.SATURATION, ${Math.round(ticks / 20)}, ${chain}`;
      if (effect) {
        // Effects register after blocks on 1.16.5, so the stew effect is looked up when it is used.
        parts.members.push(`
    @Override
    public net.minecraft.potion.Effect getSuspiciousStewEffect() {
        return net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(new net.minecraft.util.ResourceLocation(${jstr(qualify(env, effect))}));
    }

    @Override
    public int getEffectDuration() {
        return ${ticks};
    }
`);
      }
    } else {
      const holder = `net.minecraft.core.registries.BuiltInRegistries.MOB_EFFECT.get(${idExpr(env, qualify(env, effect))}).orElseThrow()`;
      parts.superArgs = (chain) => effect ? `${holder}, ${jfloat(ticks / 20)}, ${chain}` : `net.minecraft.world.item.component.SuspiciousStewEffects.EMPTY, ${chain}`;
    }
  } else if (base === "DoublePlant") {
    parts.superClass = `${n.blk}.DoublePlantBlock`;
  } else if (base === "Sapling") {
    parts.superClass = `${n.blk}.SaplingBlock`;
    parts.superArgs = (chain) => `${treeGrower(env, block)}, ${chain}`;
  } else {
    parts.superClass = growableClass(env);
    const soil = list<Record<string, unknown>>(block.canBePlacedOn).map((r) => str(r.item)).filter(Boolean);
    const test = soil.length ? stateMatches(env, "soil", soil.map((r) => qualify(env, r))) : soilOf(env, str(block.growapableSpawnType), "soil");
    parts.superArgs = (chain) => `${Math.max(1, Number(block.growapableMaxHeight) || 1)}, soil -> ${test}, ${chain}`;
    parts.stateProps.push("AGE");
    parts.defaults.push(".setValue(AGE, 0)");
  }

  // ---- Soil of vegetation blocks
  const placedOn = list<Record<string, unknown>>(block.canBePlacedOn).map((r) => str(r.item)).filter(Boolean);
  if (placedOn.length && base !== "GrowablePlant") {
    parts.members.push(`
    @Override
    protected boolean mayPlaceOn(${S} state, ${n.getter} world, ${n.pos} pos) {
        return ${stateMatches(env, "state", placedOn.map((r) => qualify(env, r)))};
    }
`);
  }

  // ---- Placing condition
  const condition = procedureCall(env, "block", block, "placingCondition", { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: `(${n.accessor}) world`, blockstate: "state" });
  if (condition) {
    parts.members.push(`
    @Override
    ${legacy ? "public" : "protected"} boolean canSurvive(${S} state, ${n.reader} world, ${n.pos} pos) {
        return super.canSurvive(state, world, pos) && (!(world instanceof ${n.accessor}) || ${condition});
    }
`);
  }

  // ---- Bone meal (vanilla double plants and saplings keep their own)
  if (block.isBonemealable === true && (base === "Plant" || base === "GrowablePlant")) {
    parts.interface = legacy ? `${n.blk}.IGrowable` : `${n.blk}.BonemealableBlock`;
    const at = { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world", blockstate: "state" };
    const target = procedureCall(env, "block", block, "isBonemealTargetCondition", { ...at, world: `(${n.accessor}) world` });
    const success = procedureCall(env, "block", block, "bonemealSuccessCondition", at);
    const perform = procedureCall(env, "block", block, "onBonemealSuccess", at);
    const grow = base === "GrowablePlant" ? "this.grow(world, pos, state);" : "";
    const source = env.mc === "26.3" ? ", net.minecraft.world.level.block.BonemealSource source" : "";
    parts.members.push(legacy ? `
    @Override
    public boolean isValidBonemealTarget(${n.getter} world, ${n.pos} pos, ${S} state, boolean client) {
        return ${target ? `!(world instanceof ${n.accessor}) || ${target}` : "true"};
    }

    @Override
    public boolean isBonemealSuccess(${n.level} world, ${n.random} random, ${n.pos} pos, ${S} state) {
        return ${success ?? "true"};
    }

    @Override
    public void performBonemeal(${n.server} world, ${n.random} random, ${n.pos} pos, ${S} state) {
        ${perform ? `${perform};` : grow}
    }
` : `
    @Override
    public boolean isValidBonemealTarget(${n.reader} world, ${n.pos} pos, ${S} state${source}) {
        return ${target ? `!(world instanceof ${n.accessor}) || ${target}` : "true"};
    }

    @Override
    public boolean isBonemealSuccess(${n.level} world, ${n.random} random, ${n.pos} pos, ${S} state${source}) {
        return ${success ?? "true"};
    }

    @Override
    public void performBonemeal(${n.server} world, ${n.random} random, ${n.pos} pos, ${S} state${source}) {
        ${perform ? `${perform};` : grow}
    }
`);
  }

  // ---- Shape of a growable plant without its own boxes (sugar cane's)
  if (base === "GrowablePlant" && !list(block.boundingBoxes).length) {
    const shape = legacy ? "net.minecraft.util.math.shapes.VoxelShape" : "net.minecraft.world.phys.shapes.VoxelShape";
    const ctx = legacy ? "net.minecraft.util.math.shapes.ISelectionContext" : "net.minecraft.world.phys.shapes.CollisionContext";
    parts.members.push(`
    @Override
    public ${shape} getShape(${S} state, ${n.getter} world, ${n.pos} pos, ${ctx} context) {
        return ${n.blk}.Block.box(2, 0, 2, 14, 16, 14);
    }
`);
  }

  if (block.plantGenerate === true) {
    if (legacy) parts.members.push(patch1165(env, block));
    else parts.files.push(...patchFiles(env, block));
    if (legacy) {
      const owner = `${env.project.mod.package}.block.${pascal(block.id)}Block.Patch`;
      parts.init.push(`modBus.addListener(${owner}::register);`, `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(${owner}::addToBiome);`);
    } else if (env.loader === "fabric") {
      parts.init.push(fabricPatch(env, block));
    }
  }
  return parts;
}

const pascal = (id: string) => id.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");

/** Tree grower of a sapling from its configured feature ids (secondary trees by chance). */
function treeGrower(env: GenEnv, block: Element): string {
  const ids = (a: string, b: string) => [str(block[a]), str(block[b])].map((v) => (v ? qualify(env, v) : ""));
  const [t1, t2] = ids("trees1", "trees2");
  const [f1, f2] = ids("flowerTrees1", "flowerTrees2");
  const [m1, m2] = ids("megaTrees1", "megaTrees2");
  const chance = Math.max(0, Math.min(1, Number(block.secondaryTreeChance) || 0));
  const name = `${env.modId}_${block.id}`;
  if (env.mc === "1.16.5") {
    const feature = (id: string) => id
      ? `(net.minecraft.world.gen.feature.ConfiguredFeature<net.minecraft.world.gen.feature.BaseTreeFeatureConfig, ?>) net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_FEATURE.get(new net.minecraft.util.ResourceLocation(${jstr(id)}))`
      : "null";
    const pick = (a: string, b: string) => b ? `random.nextFloat() < ${jfloat(chance)} ? ${feature(b)} : ${feature(a)}` : feature(a);
    const normal = `flowers && ${!!f1} ? ${pick(f1, f2)} : ${pick(t1, t2)}`;
    const mega = m1 ? `

                @Override
                protected net.minecraft.world.gen.feature.ConfiguredFeature<net.minecraft.world.gen.feature.BaseTreeFeatureConfig, ?> getConfiguredMegaFeature(java.util.Random random) {
                    return ${pick(m1, m2)};
                }` : "";
    return `new net.minecraft.block.trees.${m1 ? "BigTree" : "Tree"}() {
                @Override
                @SuppressWarnings("unchecked")
                protected net.minecraft.world.gen.feature.ConfiguredFeature<net.minecraft.world.gen.feature.BaseTreeFeatureConfig, ?> getConfiguredFeature(java.util.Random random, boolean flowers) {
                    return ${normal};
                }${mega}
            }`;
  }
  if (env.mc === "1.21.5") {
    const key = (id: string) => id
      ? `java.util.Optional.of(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.CONFIGURED_FEATURE, ${idExpr(env, id)}))`
      : "java.util.Optional.empty()";
    return `new net.minecraft.world.level.block.grower.TreeGrower(${jstr(name)}, ${jfloat(chance)}, ${key(m1)}, ${key(m2)}, ${key(t1)}, ${key(t2)}, ${key(f1)}, ${key(f2)})`;
  }
  const K = "net.minecraft.resources.ResourceKey<net.minecraft.world.level.levelgen.feature.Feature>";
  const key = (id: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.FEATURE, ${idExpr(env, id)})`;
  const weighted = (a: string, b: string) => {
    if (!a && !b) return `net.minecraft.util.random.WeightedList.<${K}>of()`;
    if (!b) return `net.minecraft.util.random.WeightedList.<${K}>of(${key(a)})`;
    if (!a) return `net.minecraft.util.random.WeightedList.<${K}>of(${key(b)})`;
    const w2 = Math.max(1, Math.round(chance * 100)), w1 = Math.max(1, 100 - w2);
    return `net.minecraft.util.random.WeightedList.<${K}>of(new net.minecraft.util.random.Weighted<>(${key(a)}, ${w1}), new net.minecraft.util.random.Weighted<>(${key(b)}, ${w2}))`;
  };
  return `new net.minecraft.world.level.block.grower.TreeGrower(${jstr(name)}, ${weighted(t1, t2)}, ${weighted(m1, m2)}, ${weighted(f1, f2)}, ${t1 ? key(t1) : "null"})`;
}

function patchBiomes(env: GenEnv, block: Element) {
  const biomes = list<Record<string, unknown>>(block.restrictionBiomes).map((r) => str(r.biome)).filter(Boolean).map((ref) => qualify(env, ref));
  return { biomes, biomeTag: biomes.find((b) => b.startsWith("#")) };
}

/** 1.21.5 and 26.x: the plant patch as a configured (26.x: plain) feature, its placed feature and biome modifier. */
function patchFiles(env: GenEnv, block: Element): ResourceFile[] {
  const id = qualify(env, block.id);
  const tries = Math.max(1, Number(block.patchSize) || 1);
  const count = Math.max(1, Number(block.frequencyOnChunks) || 1);
  const height = block.generateAtAnyHeight === true
    ? { type: "minecraft:height_range", height: { type: "minecraft:uniform", min_inclusive: { above_bottom: 0 }, max_inclusive: { below_top: 0 } } }
    : { type: "minecraft:heightmap", heightmap: env.mc === "26.3" ? "WORLD_SURFACE_WG" : "MOTION_BLOCKING" };
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const dir = `data/${env.modId}/worldgen`;
  const name = `${block.id}_patch`;
  let feature: unknown;
  let placement: unknown[];
  if (env.mc === "26.3") {
    feature = { type: "minecraft:simple_block", to_place: { id } };
    const spread = (max: number) => ({ type: "minecraft:trapezoid", max, min: -max, plateau: 0 });
    placement = [
      { type: "minecraft:count", count }, { type: "minecraft:in_square" }, height, { type: "minecraft:biome" },
      { type: "minecraft:count", count: tries }, { type: "minecraft:offset", x: spread(7), y: spread(3), z: spread(7) },
      { type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:all_of", predicates: [
        { type: "minecraft:matching_block_tag", tag: "minecraft:air" }, { type: "minecraft:would_survive", state: id },
      ] } },
    ];
  } else {
    feature = { type: "minecraft:random_patch", config: {
      tries, xz_spread: 7, y_spread: 3,
      feature: {
        feature: { type: "minecraft:simple_block", config: { to_place: { type: "minecraft:simple_state_provider", state: { Name: id } } } },
        placement: [{ type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:all_of", predicates: [
          { type: "minecraft:matching_blocks", blocks: "minecraft:air" }, { type: "minecraft:would_survive", state: { Name: id } },
        ] } }],
      },
    } };
    placement = [{ type: "minecraft:count", count }, { type: "minecraft:in_square" }, height, { type: "minecraft:biome" }];
  }
  const files: ResourceFile[] = [
    { path: `${dir}/${env.mc === "26.3" ? "feature" : "configured_feature"}/${name}.json`, json: json(feature) },
    { path: `${dir}/placed_feature/${name}.json`, json: json({ feature: `${env.modId}:${name}`, placement }) },
  ];
  if (env.loader === "neoforge") {
    const { biomes, biomeTag } = patchBiomes(env, block);
    const set = biomeTag ?? (biomes.length ? biomes : "#minecraft:is_overworld");
    files.push({ path: `data/${env.modId}/neoforge/biome_modifier/${name}.json`, json: json({ type: "neoforge:add_features", biomes: set, features: `${env.modId}:${name}`, step: "vegetal_decoration" }) });
  }
  return files;
}

function fabricPatch(env: GenEnv, block: Element): string {
  const { biomes, biomeTag } = patchBiomes(env, block);
  const reg = "net.minecraft.core.registries.Registries";
  const selectors = "net.fabricmc.fabric.api.biome.v1.BiomeSelectors";
  const selector = biomeTag ? `${selectors}.tag(net.minecraft.tags.TagKey.create(${reg}.BIOME, ${idExpr(env, biomeTag.slice(1))}))`
    : biomes.length ? `${selectors}.includeByKey(${biomes.map((b) => `net.minecraft.resources.ResourceKey.create(${reg}.BIOME, ${idExpr(env, b)})`).join(", ")})`
      : `${selectors}.foundInOverworld()`;
  return `net.fabricmc.fabric.api.biome.v1.BiomeModifications.addFeature(${selector}, net.minecraft.world.level.levelgen.GenerationStep.Decoration.VEGETAL_DECORATION, net.minecraft.resources.ResourceKey.create(${reg}.PLACED_FEATURE, ${idExpr(env, `${env.modId}:${block.id}_patch`)}));`;
}

/** 1.16.5: the plant patch registered in code and added to biomes on load. */
function patch1165(env: GenEnv, block: Element): string {
  const { biomes } = patchBiomes(env, block);
  const rl = (id: string) => `new net.minecraft.util.ResourceLocation(${jstr(id)})`;
  const category = (name: string) => `event.getCategory() == net.minecraft.world.biome.Biome.Category.${name}`;
  const tests = biomes.map((b) => b === "#minecraft:is_nether" ? category("NETHER") : b === "#minecraft:is_end" ? category("THEEND")
    : b === "#minecraft:is_overworld" ? `!(${category("NETHER")} || ${category("THEEND")} || ${category("NONE")})`
      : b.startsWith("#") ? "false" : `${rl(b)}.equals(event.getName())`);
  const overworld = `!(${category("NETHER")} || ${category("THEEND")} || ${category("NONE")})`;
  const placer = block.blockBase === "DoublePlant" ? "net.minecraft.world.gen.blockplacer.DoublePlantBlockPlacer.INSTANCE" : "net.minecraft.world.gen.blockplacer.SimpleBlockPlacer.INSTANCE";
  const placement = block.generateAtAnyHeight === true
    ? "net.minecraft.world.gen.placement.Placement.RANGE.configured(new net.minecraft.world.gen.placement.TopSolidRangeConfig(0, 0, 256)).squared()"
    : "net.minecraft.world.gen.feature.Features.Placements.HEIGHTMAP_DOUBLE_SQUARE";
  return `
    /** Generates this plant in patches. */
    public static final class Patch {
        private static net.minecraft.world.gen.feature.ConfiguredFeature<?, ?> feature;

        public static void register(net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) {
            event.enqueueWork(() -> {
                feature = net.minecraft.world.gen.feature.Feature.RANDOM_PATCH.configured(new net.minecraft.world.gen.feature.BlockClusterFeatureConfig.Builder(
                        new net.minecraft.world.gen.blockstateprovider.SimpleBlockStateProvider(${blockExpr(env, block.id)}.defaultBlockState()), ${placer})
                        .tries(${Math.max(1, Number(block.patchSize) || 1)}).build())
                        .decorated(${placement})
                        .count(${Math.max(1, Number(block.frequencyOnChunks) || 1)});
                net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_FEATURE, ${rl(`${env.modId}:${block.id}_patch`)}, feature);
            });
        }

        public static void addToBiome(net.minecraftforge.event.world.BiomeLoadingEvent event) {
            if (feature != null && (${tests.length ? tests.join(" || ") : overworld})) {
                event.getGeneration().addFeature(net.minecraft.world.gen.GenerationStage.Decoration.VEGETAL_DECORATION, feature);
            }
        }
    }
`;
}

/** The growable plant base: grows a column up to a height on random ticks and breaks when it loses its soil. */
export function growablePlantBase(env: GenEnv): JavaSourceFile {
  const legacy = env.mc === "1.16.5";
  const n = names(env);
  const S = n.state;
  const cls = growableClass(env);
  const simple = cls.slice(cls.lastIndexOf(".") + 1);
  const age = legacy ? "net.minecraft.state.IntegerProperty" : "net.minecraft.world.level.block.state.properties.IntegerProperty";
  const props = legacy ? "net.minecraft.state.properties.BlockStateProperties" : "net.minecraft.world.level.block.state.properties.BlockStateProperties";
  const propsType = legacy ? "net.minecraft.block.AbstractBlock.Properties" : "net.minecraft.world.level.block.state.BlockBehaviour.Properties";
  const prot = legacy ? "public" : "protected";
  const updateShape = legacy
    ? `    @Override
    public ${S} updateShape(${S} state, net.minecraft.util.Direction facing, ${S} facingState, ${n.accessor} world, ${n.pos} pos, ${n.pos} facingPos) {
        if (!state.canSurvive(world, pos)) world.getBlockTicks().scheduleTick(pos, this, 1);
        return super.updateShape(state, facing, facingState, world, pos, facingPos);
    }`
    : `    @Override
    protected ${S} updateShape(${S} state, ${n.reader} world, net.minecraft.world.level.ScheduledTickAccess ticks, ${n.pos} pos, net.minecraft.core.Direction facing, ${n.pos} facingPos, ${S} facingState, ${n.random} random) {
        if (!state.canSurvive(world, pos)) ticks.scheduleTick(pos, this, 1);
        return super.updateShape(state, world, ticks, pos, facing, facingPos, facingState, random);
    }`;
  const code = `package ${env.project.mod.package}.block;

/** Generated by MCEdge: a plant growing upward like sugar cane. */
public abstract class ${simple} extends ${n.blk}.Block {
    public static final ${age} AGE = ${props}.AGE_15;

    private final int maxHeight;
    private final java.util.function.Predicate<${S}> soil;

    protected ${simple}(int maxHeight, java.util.function.Predicate<${S}> soil, ${propsType} properties) {
        super(properties);
        this.maxHeight = maxHeight;
        this.soil = soil;
    }

    @Override
    ${prot} void randomTick(${S} state, ${n.server} world, ${n.pos} pos, ${n.random} random) {
        super.randomTick(state, world, pos, random);
        if (world.isEmptyBlock(pos.above())) {
            int age = state.getValue(AGE);
            if (age < 15) world.setBlock(pos, state.setValue(AGE, age + 1), 4);
            else grow(world, pos, state);
        }
    }

    /** Adds a segment on top while the column is below its maximum height. */
    protected void grow(${n.server} world, ${n.pos} pos, ${S} state) {
        int height = 1;
        while (world.getBlockState(pos.below(height)).is(this)) height++;
        if (height < maxHeight && world.isEmptyBlock(pos.above())) {
            world.setBlockAndUpdate(pos.above(), this.defaultBlockState());
            world.setBlock(pos, state.setValue(AGE, 0), 4);
        }
    }

    @Override
    ${prot} void tick(${S} state, ${n.server} world, ${n.pos} pos, ${n.random} random) {
        super.tick(state, world, pos, random);
        if (!state.canSurvive(world, pos)) world.destroyBlock(pos, true);
    }

    @Override
    ${prot} boolean canSurvive(${S} state, ${n.reader} world, ${n.pos} pos) {
        ${S} below = world.getBlockState(pos.below());
        return below.is(this) || soil.test(below);
    }

${updateShape}
}
`;
  return { path: `${env.project.mod.package.replaceAll(".", "/")}/block/${simple}.java`, code };
}
