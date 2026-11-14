import type { Element } from "../../elements/model.ts";
import { blockExpr, list, qualify, str } from "../java.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/**
 * Biomes: a worldgen biome file (1.16.5: with its own configured surface builder) with climate, colors, sounds,
 * particles, mob spawns, the chosen vanilla features and structures, and a tree feature (vanilla shapes or the
 * custom stem/leaves blocks). Biomes appear in this mod's dimensions, which also read their ground blocks and
 * generation parameters. Adding biomes to the vanilla overworld, caves or nether needs the noise-settings injection
 * MCreator uses and is not generated; custom tree vines and fruits need tree decorator classes and are not either.
 */

type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

/** Decoration steps (1.21+ has fluid springs between underground decoration and vegetal decoration). */
const STEPS_MODERN = ["raw_generation", "lakes", "local_modifications", "underground_structures", "surface_structures", "strongholds",
  "underground_ores", "underground_decoration", "fluid_springs", "vegetal_decoration", "top_layer_modification"];
const STEPS_1165 = STEPS_MODERN.filter((s) => s !== "fluid_springs");

/** Vanilla features of each default feature group, "step/feature"; carvers as "carvers/x". */
const DEFAULT_FEATURES: Record<string, string[]> = {
  Caves: ["carvers/cave", "carvers/cave_extra_underground", "carvers/canyon", "lakes/lake_lava_underground"],
  Ores: ["coal_upper", "coal_lower", "iron_upper", "iron_middle", "iron_small", "gold", "gold_lower", "redstone", "redstone_lower", "diamond",
    "diamond_medium", "diamond_large", "diamond_buried", "lapis", "lapis_buried", "copper"].map((o) => `underground_ores/ore_${o}`).concat("underground_ores/underwater_magma"),
  MonsterRooms: ["underground_structures/monster_room", "underground_structures/monster_room_deep"],
  FrozenTopLayer: ["top_layer_modification/freeze_top_layer"],
  ForestGrass: ["vegetal_decoration/patch_grass_forest"],
  ForestFlowers: ["vegetal_decoration/forest_flowers"],
  AmethystGeodes: ["local_modifications/amethyst_geode"],
  Bamboo: ["vegetal_decoration/bamboo_light"],
  DeadBushes: ["vegetal_decoration/patch_dead_bush_2"],
  DesertFeatures: ["surface_structures/desert_well"],
  Dripstone: ["local_modifications/large_dripstone", "underground_decoration/dripstone_cluster", "underground_decoration/pointed_dripstone"],
  ExtraEmeraldOre: ["underground_ores/ore_emerald"],
  ExtraGoldOre: ["underground_ores/ore_gold_extra"],
  Fossils: ["underground_structures/fossil_upper", "underground_structures/fossil_lower"],
  Icebergs: ["local_modifications/iceberg_packed", "local_modifications/iceberg_blue"],
  InfestedStone: ["underground_decoration/ore_infested"],
  JungleGrass: ["vegetal_decoration/patch_grass_jungle"],
  JungleTreeForest: ["vegetal_decoration/trees_jungle"],
  LushCavesDecoration: ["lush_caves_ceiling_vegetation", "cave_vines", "lush_caves_clay", "lush_caves_vegetation", "rooted_azalea_tree", "spore_blossom", "classic_vines_cave_feature"].map((f) => `vegetal_decoration/${f}`),
  MeadowVegetation: ["vegetal_decoration/patch_grass_plain", "vegetal_decoration/flower_meadow", "vegetal_decoration/trees_meadow"],
  PlainsTallGrass: ["vegetal_decoration/patch_tall_grass"],
  ReedsAndPumpkins: ["vegetal_decoration/patch_pumpkin", "vegetal_decoration/patch_sugar_cane"],
  SavannaTrees: ["vegetal_decoration/trees_savanna"],
  SwampVegetation: ["trees_swamp", "flower_swamp", "patch_grass_normal", "patch_dead_bush", "patch_waterlily", "brown_mushroom_swamp", "red_mushroom_swamp"].map((f) => `vegetal_decoration/${f}`),
  TaigaGrassAndMushrooms: ["vegetal_decoration/patch_grass_taiga_2", "vegetal_decoration/brown_mushroom_taiga", "vegetal_decoration/red_mushroom_taiga"],
  TaigaLargeFerns: ["vegetal_decoration/patch_large_fern"],
  TaigaRocks: ["local_modifications/forest_rock"],
  TallSeagrassLush: ["vegetal_decoration/seagrass_deep"],
};

/** The same groups as 1.16.5 configured features (groups missing there are left out). */
const DEFAULT_FEATURES_1165: Record<string, string[]> = {
  Caves: ["carvers/cave", "carvers/canyon", "lakes/lake_lava"],
  Ores: ["dirt", "gravel", "granite", "diorite", "andesite", "coal", "iron", "gold", "redstone", "diamond", "lapis"].map((o) => `underground_ores/ore_${o}`),
  MonsterRooms: ["underground_structures/monster_room"],
  FrozenTopLayer: ["top_layer_modification/freeze_top_layer"],
  ForestGrass: ["vegetal_decoration/patch_grass_forest"],
  ForestFlowers: ["vegetal_decoration/forest_flower_vegetation"],
  Bamboo: ["vegetal_decoration/bamboo_light"],
  DeadBushes: ["vegetal_decoration/patch_dead_bush_2"],
  DesertFeatures: ["surface_structures/desert_well"],
  ExtraEmeraldOre: ["underground_ores/ore_emerald"],
  ExtraGoldOre: ["underground_ores/ore_gold_extra"],
  Fossils: ["underground_structures/fossil"],
  Icebergs: ["local_modifications/iceberg_packed", "local_modifications/iceberg_blue"],
  InfestedStone: ["underground_decoration/ore_infested"],
  JungleGrass: ["vegetal_decoration/patch_grass_jungle"],
  JungleTreeForest: ["vegetal_decoration/trees_jungle"],
  PlainsTallGrass: ["vegetal_decoration/patch_tall_grass"],
  ReedsAndPumpkins: ["vegetal_decoration/patch_pumpkin", "vegetal_decoration/patch_sugar_cane"],
  SavannaTrees: ["vegetal_decoration/trees_savanna"],
  SwampVegetation: ["swamp_tree", "flower_swamp", "patch_grass_normal", "patch_dead_bush", "patch_waterlilly", "brown_mushroom_swamp", "red_mushroom_swamp"].map((f) => `vegetal_decoration/${f}`),
  TaigaGrassAndMushrooms: ["vegetal_decoration/patch_grass_taiga_2", "vegetal_decoration/brown_mushroom_taiga", "vegetal_decoration/red_mushroom_taiga"],
  TaigaLargeFerns: ["vegetal_decoration/patch_large_fern"],
  TaigaRocks: ["local_modifications/forest_rock"],
  TallSeagrassLush: ["vegetal_decoration/seagrass_deep"],
};

/** Features left out of nether biomes (MCreator does the same). */
const NOT_IN_NETHER = new Set(["Caves", "ExtraEmeraldOre", "ExtraGoldOre", "Ores", "MonsterRooms", "Fossils"]);

/** Structure flags -> 1.21+ has_structure tag names (1.16.5 structure feature ids differ where listed). */
const STRUCTURES: [string, string, string?][] = [
  ["spawnMineshaft", "mineshaft"], ["spawnMineshaftMesa", "mineshaft_mesa"], ["spawnStronghold", "stronghold"],
  ["spawnPillagerOutpost", "pillager_outpost"], ["spawnWoodlandMansion", "woodland_mansion", "mansion"],
  ["spawnJungleTemple", "jungle_temple", "jungle_pyramid"], ["spawnDesertPyramid", "desert_pyramid"], ["spawnSwampHut", "swamp_hut"],
  ["spawnIgloo", "igloo"], ["spawnOceanMonument", "ocean_monument", "monument"], ["spawnShipwreck", "shipwreck"],
  ["spawnShipwreckBeached", "shipwreck_beached"], ["spawnBuriedTreasure", "buried_treasure"], ["spawnNetherBridge", "nether_fortress", "fortress"],
  ["spawnNetherFossil", "nether_fossil"], ["spawnBastionRemnant", "bastion_remnant"], ["spawnEndCity", "end_city"],
];

/** MCEdge spawn type -> mob category. */
const SPAWN_CATEGORIES: Record<string, string> = {
  monster: "monster", creature: "creature", ambient: "ambient", axolotls: "axolotls", undergroundWaterCreature: "underground_water_creature",
  waterCreature: "water_creature", waterAmbient: "water_ambient", misc: "misc",
};

/** Vanilla tree shapes: minimum size, foliage placer, trunk placer, log and leaves. */
const TREES: Record<string, { size: number[]; foliage: unknown[]; trunk: [string, number, number, number]; log: string; leaves: string; v1165: string }> = {
  "Big trees": { size: [1, 1, 2], foliage: ["minecraft:jungle_foliage_placer", 2, 0, 2], trunk: ["minecraft:mega_jungle_trunk_placer", 10, 2, 19], log: "minecraft:jungle_log", leaves: "minecraft:jungle_leaves", v1165: "minecraft:mega_jungle_tree" },
  "Savanna trees": { size: [1, 0, 2], foliage: ["minecraft:acacia_foliage_placer", 2, 0], trunk: ["minecraft:forking_trunk_placer", 5, 2, 2], log: "minecraft:acacia_log", leaves: "minecraft:acacia_leaves", v1165: "minecraft:acacia" },
  "Mega pine trees": { size: [1, 1, 2], foliage: ["minecraft:mega_pine_foliage_placer", 0, 0, 3, 7], trunk: ["minecraft:giant_trunk_placer", 13, 2, 14], log: "minecraft:spruce_log", leaves: "minecraft:spruce_leaves", v1165: "minecraft:mega_pine" },
  "Mega spruce trees": { size: [1, 1, 2], foliage: ["minecraft:mega_pine_foliage_placer", 0, 0, 13, 17], trunk: ["minecraft:giant_trunk_placer", 13, 2, 14], log: "minecraft:spruce_log", leaves: "minecraft:spruce_leaves", v1165: "minecraft:mega_spruce" },
  "Birch trees": { size: [1, 0, 1], foliage: ["minecraft:blob_foliage_placer", 2, 0, 3], trunk: ["minecraft:straight_trunk_placer", 5, 2, 0], log: "minecraft:birch_log", leaves: "minecraft:birch_leaves", v1165: "minecraft:birch" },
  Default: { size: [1, 0, 1], foliage: ["minecraft:blob_foliage_placer", 2, 0, 3], trunk: ["minecraft:straight_trunk_placer", 4, 2, 0], log: "minecraft:oak_log", leaves: "minecraft:oak_leaves", v1165: "minecraft:oak" },
};

const color = (value: unknown, fallback?: number): number | undefined => {
  const hex = str(value).replace("#", "");
  return hex ? parseInt(hex, 16) : fallback;
};
const hexColor = (value: unknown) => `#${str(value).replace("#", "").toLowerCase()}`;

function spawners(env: GenEnv, biome: Element): Record<string, Json[]> {
  const out: Record<string, Json[]> = Object.fromEntries(Object.values(SPAWN_CATEGORIES).map((c) => [c, []]));
  for (const row of list<Row>(biome.spawnEntries)) {
    if (!str(row.entity)) continue;
    const category = SPAWN_CATEGORIES[str(row.spawnType)] ?? "monster";
    const min = Number(row.minGroup), max = Number(row.maxGroup);
    out[category].push(env.mc === "1.16.5"
      ? { type: qualify(env, str(row.entity)), weight: Number(row.weight), minCount: min, maxCount: max }
      : env.mc === "26.3"
        ? { type: qualify(env, str(row.entity)), weight: Number(row.weight), count: min === max ? min : { type: "minecraft:uniform", min_inclusive: min, max_inclusive: max } }
        : { type: qualify(env, str(row.entity)), weight: Number(row.weight), minCount: min, maxCount: max });
  }
  if (env.mc === "1.16.5") delete out.axolotls;
  if (env.mc === "1.16.5") delete out.underground_water_creature;
  return out;
}

/** Block state JSON: {Name} before 26.x, an id (or {id, properties}) on 26.x. */
const state = (env: GenEnv, id: string, props?: Record<string, string>) => env.mc === "26.3"
  ? (props ? { id, properties: props } : id)
  : (props ? { Name: id, Properties: props } : { Name: id });
/** Block state provider; 26.x registers providers, so a bare id would be a reference: inline states are objects. */
const provider = (env: GenEnv, id: string, props?: Record<string, string>) => env.mc === "26.3"
  ? { id, ...(props ? { properties: props } : {}) } : { type: "minecraft:simple_state_provider", state: state(env, id, props) };

function treeFeature(env: GenEnv, biome: Element): Json {
  const custom = Number(biome.treeType) === 1;
  const shape = TREES[str(biome.vanillaTreeType)] ?? TREES.Default;
  const [trunkType, base, a, b] = shape.trunk;
  const [foliageType, radius, offset, ...rest] = shape.foliage as [string, number, number, ...number[]];
  const log = custom ? qualify(env, str(biome.treeStem)) : shape.log;
  const leaves = custom ? qualify(env, str(biome.treeBranch)) : shape.leaves;
  const logProps = custom ? undefined : { axis: "y" };
  const leafProps = custom ? undefined : { distance: "7", persistent: "false", waterlogged: "false" };
  const foliage: Json = { type: foliageType, radius, offset };
  if (rest.length === 1) foliage.height = rest[0];
  if (rest.length === 2) foliage.crown_height = { type: "minecraft:uniform", min_inclusive: rest[0], max_inclusive: rest[1] };
  const config: Json = {
    ignore_vines: true,
    minimum_size: { type: "minecraft:two_layers_feature_size", limit: shape.size[0], lower_size: shape.size[1], upper_size: shape.size[2] },
    trunk_provider: provider(env, log, logProps),
    foliage_provider: provider(env, leaves, leafProps),
    trunk_placer: { type: trunkType, base_height: custom ? Math.min(Number(biome.minHeight), 32) : base, height_rand_a: a, height_rand_b: b },
    foliage_placer: foliage,
    decorators: [],
  };
  const dirt = qualify(env, str(biome.undergroundBlock) || "minecraft:dirt");
  if (env.mc === "26.3") {
    config.below_trunk_provider = { type: "minecraft:rule_based", rules: [{ if_true: { type: "minecraft:not", predicate: { type: "minecraft:matching_block_tag", tag: "minecraft:cannot_replace_below_tree_trunk" } }, then: provider(env, dirt) }] };
    return { type: "minecraft:tree", ...config };
  }
  return { type: "minecraft:tree", config: { force_dirt: false, dirt_provider: provider(env, dirt), ...config } };
}

function element(biome: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const nether = biome.spawnBiomeNether === true;
  const files: ResourceFile[] = [];
  const tags: TagEntry[] = [];
  const id = qualify(env, biome.id);
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const dir = `data/${env.modId}/worldgen`;

  const steps = legacy ? STEPS_1165 : STEPS_MODERN;
  const features: string[][] = steps.map(() => []);
  const carvers: string[] = [];
  for (const group of list<string>(biome.defaultFeatures)) {
    if (nether && NOT_IN_NETHER.has(group)) continue;
    for (const entry of (legacy ? DEFAULT_FEATURES_1165 : DEFAULT_FEATURES)[group] ?? []) {
      const [step, feature] = entry.split("/");
      if (step === "carvers") carvers.push(`minecraft:${feature}`);
      else features[steps.indexOf(step)].push(`minecraft:${feature}`);
    }
  }
  const trees = Number(biome.treesPerChunk);
  if (trees > 0) {
    const vegetal = features[steps.indexOf("vegetal_decoration")];
    const treeId = `${env.modId}:${biome.id}_tree`;
    if (legacy && Number(biome.treeType) === 1) {
      // 1.16.5 JSON block states need every property: custom trees are built in code (see runtime).
    } else if (legacy) {
      const inner = (TREES[str(biome.vanillaTreeType)] ?? TREES.Default).v1165;
      const decorated = (feature: unknown, type: string, config: Json = {}) => ({ type: "minecraft:decorated", config: { feature, decorator: { type, config } } });
      files.push({ path: `${dir}/configured_feature/${biome.id}_tree.json`, json: json(decorated(decorated(decorated(inner, "minecraft:heightmap", { heightmap: "MOTION_BLOCKING" }), "minecraft:square"), "minecraft:count", { count: trees })) });
    } else {
      files.push({ path: `${dir}/${env.mc === "26.3" ? "feature" : "configured_feature"}/${biome.id}_tree.json`, json: json(treeFeature(env, biome)) });
      files.push({ path: `${dir}/placed_feature/${biome.id}_tree.json`, json: json({
        feature: treeId,
        placement: [
          { type: "minecraft:count", count: trees }, { type: "minecraft:in_square" },
          { type: "minecraft:surface_water_depth_filter", max_water_depth: 0 }, { type: "minecraft:heightmap", heightmap: "OCEAN_FLOOR" },
          { type: "minecraft:biome" }, { type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:would_survive", state: state(env, "minecraft:oak_sapling") } },
        ],
      }) });
    }
    if (!(legacy && Number(biome.treeType) === 1)) vegetal.unshift(treeId);
  }

  // Structures: 1.21+ biome tags, 1.16.5 the biome's structure starts.
  const starts: string[] = [];
  const structure = (tag: string, start: string) => {
    if (legacy) starts.push(`minecraft:${start}`);
    else tags.push({ registry: "worldgen/biome", tag: `minecraft:has_structure/${tag}`, value: id });
  };
  for (const [flag, tag, start] of STRUCTURES) if (biome[flag] === true) structure(tag, start ?? tag);
  const village = str(biome.villageType);
  if (village && village !== "none") structure(`village_${village}`, `village_${village}`);
  const ruin = str(biome.oceanRuinType);
  if (ruin && ruin !== "NONE") structure(`ocean_ruin_${ruin.toLowerCase()}`, `ocean_ruin_${ruin.toLowerCase()}`);
  const portal = str(biome.spawnRuinedPortal);
  if (portal && portal !== "NONE") structure(`ruined_portal_${portal.toLowerCase()}`, portal === "STANDARD" ? "ruined_portal" : `ruined_portal_${portal.toLowerCase()}`);

  const sound = (key: string) => (str(biome[key]) ? qualify(env, str(biome[key])) : "");
  const music = sound("music"), ambient = sound("ambientSound"), mood = sound("moodSound"), additions = sound("additionsSound");
  const particle = biome.spawnParticles === true && str(biome.particleToSpawn) ? { type: qualify(env, str(biome.particleToSpawn)) } : undefined;
  const probability = Number(biome.particlesProbability) / 100;
  const rain = Number(biome.rainingPossibility);
  const base = { temperature: Number(biome.temperature), downfall: rain };
  let out: Json;
  if (env.mc === "26.3") {
    const attributes: Json = {};
    if (ambient || mood || additions) {
      attributes["minecraft:audio/ambient_sounds"] = {
        ...(ambient ? { loop: ambient } : {}),
        ...(mood ? { mood: { sound: mood, tick_delay: Number(biome.moodSoundDelay), block_search_extent: 8, offset: 2 } } : {}),
        ...(additions ? { additions: { sound: additions, tick_chance: 0.0111 } } : {}),
      };
    }
    if (music) attributes["minecraft:audio/background_music"] = { default: { sound: music, min_delay: 12000, max_delay: 24000, replace_current_music: true } };
    if (particle) attributes["minecraft:visual/ambient_particles"] = { modifier: "append", argument: [{ particle, probability }] };
    if (str(biome.airColor)) attributes["minecraft:visual/sky_color"] = hexColor(biome.airColor);
    if (str(biome.fogColor)) attributes["minecraft:visual/fog_color"] = hexColor(biome.fogColor);
    attributes["minecraft:visual/water_fog_color"] = str(biome.waterFogColor) ? hexColor(biome.waterFogColor) : "#050533";
    attributes["minecraft:gameplay/natural_mob_spawns"] = { modifier: "overlay", argument: { spawns_by_category: spawners(env, biome), spawn_costs: {} } };
    out = {
      has_precipitation: rain > 0, ...base,
      effects: {
        foliage_color: color(biome.foliageColor, 10387789), grass_color: color(biome.grassColor, 9470285), water_color: color(biome.waterColor, 4159204),
        ...(str(biome.dryFoliageColor) ? { dry_foliage_color: color(biome.dryFoliageColor) } : {}),
      },
      attributes,
      carvers,
      features,
    };
  } else {
    const effects: Json = {
      sky_color: color(biome.airColor, 7972607), fog_color: color(biome.fogColor, 12638463),
      water_color: color(biome.waterColor, 4159204), water_fog_color: color(biome.waterFogColor, 329011),
      ...(str(biome.grassColor) ? { grass_color: color(biome.grassColor) } : {}),
      ...(str(biome.foliageColor) ? { foliage_color: color(biome.foliageColor) } : {}),
      ...(!legacy && str(biome.dryFoliageColor) ? { dry_foliage_color: color(biome.dryFoliageColor) } : {}),
      ...(ambient ? { ambient_sound: ambient } : {}),
      ...(mood ? { mood_sound: { sound: mood, tick_delay: Number(biome.moodSoundDelay), block_search_extent: 8, offset: 2 } } : {}),
      ...(additions ? { additions_sound: { sound: additions, tick_chance: 0.0111 } } : {}),
      ...(particle ? { particle: { options: particle, probability } } : {}),
    };
    if (music) {
      const track = { sound: music, min_delay: 12000, max_delay: 24000, replace_current_music: true };
      effects.music = legacy ? track : [{ weight: 1, data: track }];
    }
    if (legacy) {
      // 1.16.5 JSON block states need every property: the surface builder with the biome's blocks is built in code
      // and set when the biome loads (see runtime); the file names a vanilla one until then.
      out = {
        precipitation: rain <= 0 ? "none" : Number(biome.temperature) < 0.15 ? "snow" : "rain",
        category: nether ? "nether" : "none", depth: 0.1, scale: 0.2, ...base, effects,
        surface_builder: nether ? "minecraft:nether" : "minecraft:grass", carvers: { air: carvers }, features, starts, spawners: spawners(env, biome), spawn_costs: {}, player_spawn_friendly: false,
      };
    } else {
      out = { has_precipitation: rain > 0, ...base, effects, spawners: spawners(env, biome), spawn_costs: {}, carvers, features };
    }
  }
  files.push({ path: `${dir}/biome/${biome.id}.json`, json: json(out) });
  return { files, tags };
}

/** 1.16.5: the biome's surface builder and custom tree, registered at common setup and added as biomes load. */
function runtime1165(env: GenEnv, biomes: ElementContext[]): { sources: JavaSourceFile[]; init: string[] } {
  if (!biomes.length) return { sources: [], init: [] };
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}Biomes`;
  const rl = (id: string) => `new net.minecraft.util.ResourceLocation(${JSON.stringify(id)})`;
  const state = (ref: unknown, fallback: string) => `${blockExpr(env, str(ref) || fallback)}.defaultBlockState()`;
  const fields: string[] = [];
  const setup: string[] = [];
  const load: string[] = [];
  for (const b of biomes) {
    const c = String(b.constant);
    const nether = b.spawnBiomeNether === true;
    fields.push(`    private static net.minecraft.world.gen.surfacebuilders.ConfiguredSurfaceBuilder<?> ${c}_SURFACE;`);
    setup.push(`${c}_SURFACE = net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_SURFACE_BUILDER, ${rl(`${env.modId}:${b.id}`)},
                    net.minecraft.world.gen.surfacebuilders.SurfaceBuilder.${nether ? "NETHER" : "DEFAULT"}.configured(new net.minecraft.world.gen.surfacebuilders.SurfaceBuilderConfig(${state(b.groundBlock, "minecraft:grass_block")}, ${state(b.undergroundBlock, "minecraft:dirt")}, ${state(b.underwaterBlock || b.undergroundBlock, "minecraft:gravel")})));`);
    const body = [`event.getGeneration().surfaceBuilder(${c}_SURFACE);`];
    const trees = Number(b.treesPerChunk);
    if (trees > 0 && Number(b.treeType) === 1) {
      fields.push(`    private static net.minecraft.world.gen.feature.ConfiguredFeature<?, ?> ${c}_TREE;`);
      const g = "net.minecraft.world.gen";
      setup.push(`${c}_TREE = net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_FEATURE, ${rl(`${env.modId}:${b.id}_tree`)},
                    ${g}.feature.Feature.TREE.configured(new ${g}.feature.BaseTreeFeatureConfig.Builder(new ${g}.blockstateprovider.SimpleBlockStateProvider(${state(b.treeStem, "minecraft:oak_log")}), new ${g}.blockstateprovider.SimpleBlockStateProvider(${state(b.treeBranch, "minecraft:oak_leaves")}),
                            new ${g}.foliageplacer.BlobFoliagePlacer(${g}.feature.FeatureSpread.fixed(2), ${g}.feature.FeatureSpread.fixed(0), 3), new ${g}.trunkplacer.StraightTrunkPlacer(${Math.min(Number(b.minHeight), 32)}, 2, 0), new ${g}.feature.TwoLayerFeature(1, 0, 1)).ignoreVines().build())
                            .decorated(${g}.feature.Features.Placements.HEIGHTMAP_SQUARE).count(${trees}));`);
      body.push(`event.getGeneration().addFeature(${g}.GenerationStage.Decoration.VEGETAL_DECORATION, ${c}_TREE);`);
    }
    load.push(`if (${rl(`${env.modId}:${b.id}`)}.equals(event.getName()) && ${c}_SURFACE != null) {
            ${body.join("\n            ")}
        }`);
  }
  const code = `package ${pkg}.init;

/** Generated by MCEdge. Biome parts that 1.16.5 JSON cannot describe without every block state property. */
public final class ${cls} {
    private ${cls}() {}

${fields.join("\n")}

    public static void setup(net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) {
        event.enqueueWork(() -> {
            ${setup.join("\n            ")}
        });
    }

    public static void load(net.minecraftforge.event.world.BiomeLoadingEvent event) {
        ${load.join("\n        ")}
    }
}
`;
  return {
    sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }],
    init: [`modBus.addListener(${pkg}.init.${cls}::setup);`, `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(${pkg}.init.${cls}::load);`],
  };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => (env.mc === "1.16.5" ? runtime1165(env, contexts) : {}),
} satisfies TypeModule;
