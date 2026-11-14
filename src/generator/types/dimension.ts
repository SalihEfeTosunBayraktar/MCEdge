import type { Element } from "../../elements/model.ts";
import ROUTERS from "../data/noise-routers.json" with { type: "json" };
import { idExpr, list, qualify, str } from "../java.ts";
import { procedureCall } from "../procedures.ts";
import type { ElementContext, GenEnv, ResourceFile, TypeModule } from "../typeModule.ts";

/**
 * Dimensions: a dimension type and a dimension whose noise generator uses this mod's noise settings (filler and
 * fluid blocks, sea level, aquifers and ore veins, terrain shaped like the overworld, nether or end with the vanilla
 * noise router, or void) and a multi-noise biome source over the chosen biomes. Biomes of this mod lay their
 * ground, underground and underwater blocks through the dimension's surface rule and place themselves with their
 * generation parameters. Entering and leaving run their procedures.
 *
 * Not generated: portals, the igniter item and their procedures (portal blocks and teleporters), custom skybox and
 * sun/moon textures, and before 26.x the custom sky effects (they need client sky renderers; those dimensions use
 * the overworld effects). 26.x describes sky, fog and clouds with environment attributes and timelines; its fixed
 * time needs a custom timeline and is not generated.
 */

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
const routers = ROUTERS as Record<string, Record<string, Json>>;

const KIND: Record<string, "overworld" | "nether" | "end" | "void"> = {
  "Normal world gen": "overworld", "Nether like gen": "nether", "End like gen": "end", "Void gen": "void",
};

interface BiomeRef {
  id: string;
  element?: Element;
}

function biomeRefs(env: GenEnv, rows: unknown): BiomeRef[] {
  return list<Row>(rows).map((r) => str(r.biome)).filter(Boolean).map((ref) => {
    const id = qualify(env, ref);
    const element = (env.project.elements.biome ?? []).find((b) => `${env.modId}:${b.id}` === id);
    return { id, element };
  });
}

const range = (value: unknown) => {
  const r = (value ?? {}) as { min?: number; max?: number };
  return [Number(r.min ?? 0), Number(r.max ?? 0)];
};

/** 1.21+ multi-noise parameters: a mod biome's ranges (only meaningful with several biomes), else zero. */
function parameters(b: BiomeRef, single: boolean, cave: boolean): Json {
  const zero = { temperature: 0, humidity: 0, continentalness: 0, erosion: 0, weirdness: 0, depth: cave ? [0.2, 0.9] : 0, offset: 0 };
  if (single || !b.element) return zero;
  const e = b.element;
  return {
    temperature: range(e.genTemperature), humidity: range(e.genHumidity), continentalness: range(e.genContinentalness),
    erosion: range(e.genErosion), weirdness: range(e.genWeirdness), depth: cave ? range(e.genDepth) : 0, offset: 0,
  };
}

const mid = (value: unknown) => { const [a, b] = range(value); return Math.round(((a + b) / 2) * 1000) / 1000; };

/** Surface rule laying a mod biome's ground, underground and underwater blocks. */
function biomeSurface(env: GenEnv, b: BiomeRef, anyDepth: boolean): Json {
  const e = b.element!;
  const mc26 = env.mc === "26.3";
  const block = (key: string, fallback: string) => {
    const id = qualify(env, str(e[key]) || fallback);
    return { type: "minecraft:block", result_state: mc26 ? id : { Name: id } };
  };
  const ground = block("groundBlock", "minecraft:grass_block");
  const under = block("undergroundBlock", "minecraft:dirt");
  const underwater = block("underwaterBlock", str(e.undergroundBlock) || "minecraft:dirt");
  const onFloor = mc26 ? "minecraft:on_floor" : { type: "minecraft:stone_depth", offset: 0, surface_type: "floor", add_surface_depth: false, secondary_depth_range: 0 };
  const underFloor = mc26 ? "minecraft:under_floor" : { type: "minecraft:stone_depth", offset: 0, surface_type: "floor", add_surface_depth: true, secondary_depth_range: 0 };
  const dry = mc26 ? "minecraft:not_underwater" : { type: "minecraft:water", offset: -1, surface_depth_multiplier: 0, add_stone_depth: false };
  const rule = {
    type: "minecraft:sequence",
    sequence: [
      { type: "minecraft:condition", if_true: onFloor, then_run: { type: "minecraft:sequence", sequence: [{ type: "minecraft:condition", if_true: dry, then_run: ground }, underwater] } },
      { type: "minecraft:condition", if_true: underFloor, then_run: under },
    ],
  };
  const inBiome = { type: "minecraft:condition", if_true: { type: "minecraft:biome", biome_is: [b.id] }, then_run: rule };
  return anyDepth ? inBiome : { type: "minecraft:condition", if_true: { type: "minecraft:above_preliminary_surface" }, then_run: inBiome };
}

function bedrock(env: GenEnv, roof: boolean): Json {
  const block = { type: "minecraft:block", result_state: env.mc === "26.3" ? "minecraft:bedrock" : { Name: "minecraft:bedrock" } };
  return {
    type: "minecraft:condition",
    if_true: roof
      ? { type: "minecraft:not", invert: { type: "minecraft:vertical_gradient", random_name: "minecraft:bedrock_roof", true_at_and_below: { below_top: 5 }, false_at_and_above: { below_top: 0 } } }
      : { type: "minecraft:vertical_gradient", random_name: "minecraft:bedrock_floor", true_at_and_below: { above_bottom: 0 }, false_at_and_above: { above_bottom: 5 } },
    then_run: block,
  };
}

/** Router with every field zero (void dimensions). */
const zeroRouter = (shape: Json) => Object.fromEntries(Object.keys(shape).map((k) => [k, 0]));

function modern(dim: Element, env: GenEnv, kind: string, files: ResourceFile[]): void {
  const mc26 = env.mc === "26.3";
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const id = qualify(env, dim.id);
  const surface = biomeRefs(env, dim.biomesInDimension);
  const caves = kind === "overworld" ? biomeRefs(env, dim.biomesInDimensionCaves) : [];
  const single = surface.length + caves.length === 1;
  const own = [...surface, ...caves].filter((b) => b.element);
  const height = kind === "overworld" ? { min_y: -64, height: 384 } : { min_y: 0, height: 256 };

  // Surface rule: bedrock, ore veins, this mod's biome blocks, then the vanilla rule where 26.x can reference it.
  const anyDepth = kind !== "overworld";
  const sequence: unknown[] = [];
  if (kind !== "void") sequence.push(mc26 ? "minecraft:bedrock_floor" : bedrock(env, false));
  if (kind === "nether") sequence.push(mc26 ? "minecraft:bedrock_roof" : bedrock(env, true));
  if (mc26 && kind === "overworld" && dim.generateOreVeins === true) sequence.push("minecraft:overworld/copper_ore_vein", "minecraft:overworld/iron_ore_vein");
  sequence.push(...own.map((b) => biomeSurface(env, b, anyDepth)));
  if (mc26 && kind !== "void") {
    sequence.push(kind === "overworld" ? { type: "minecraft:condition", if_true: { type: "minecraft:above_preliminary_surface" }, then_run: "minecraft:overworld/surface" } : `minecraft:${kind}`);
    if (kind === "overworld") sequence.push("minecraft:overworld/underground");
  }
  const rule = { type: "minecraft:sequence", sequence };

  const router = kind === "void" ? zeroRouter(routers[env.mc].end) : routers[env.mc][kind];
  const filler = kind === "void" ? "minecraft:air" : qualify(env, str(dim.mainFillerBlock));
  const fluid = qualify(env, str(dim.fluidBlock));
  let settings: Json;
  if (mc26) {
    files.push({ path: `data/${env.modId}/worldgen/material_rule/${dim.id}.json`, json: json(rule) });
    settings = {
      sea_level: Number(dim.seaLevel), legacy_random_source: kind !== "overworld", disable_mob_generation: kind === "end",
      ...(kind === "overworld" && dim.generateAquifers === true ? { aquifers: {
        barrier: { type: "minecraft:noise", noise: "minecraft:aquifer_barrier", xz_scale: 1, y_scale: 0.5 },
        fluid_level_floodedness: { type: "minecraft:noise", noise: "minecraft:aquifer_fluid_level_floodedness", xz_scale: 1, y_scale: 0.67 },
        fluid_level_spread: { type: "minecraft:noise", noise: "minecraft:aquifer_fluid_level_spread", xz_scale: 1, y_scale: 0.7142857142857143 },
        lava: { type: "minecraft:noise", noise: "minecraft:aquifer_lava", xz_scale: 1, y_scale: 1 },
        exclusion: { type: "minecraft:min", left: { type: "minecraft:sub", left: -0.225, right: "minecraft:overworld/erosion" }, right: { type: "minecraft:max", left: { type: "minecraft:sub", left: "minecraft:overworld/depth", right: 0.9 }, right: 0 } },
        surface_level: "minecraft:overworld/preliminary_surface_level",
      } } : {}),
      default_block: filler, default_fluid: fluid, spawn_target: [], noise: height, noise_router: router, material_rule: id,
    };
  } else {
    settings = {
      sea_level: Number(dim.seaLevel), disable_mob_generation: kind === "end", legacy_random_source: kind !== "overworld",
      aquifers_enabled: kind === "overworld" && dim.generateAquifers === true, ore_veins_enabled: kind === "overworld" && dim.generateOreVeins === true,
      default_block: { Name: filler }, default_fluid: { Name: fluid },
      noise: { ...height, size_horizontal: Number(dim.horizontalNoiseSize), size_vertical: Number(dim.verticalNoiseSize) },
      noise_router: router, spawn_target: [], surface_rule: rule,
    };
  }
  files.push({ path: `data/${env.modId}/worldgen/noise_settings/${dim.id}.json`, json: json(settings) });
  files.push({ path: `data/${env.modId}/dimension/${dim.id}.json`, json: json({
    type: id,
    generator: {
      type: "minecraft:noise",
      settings: id,
      biome_source: {
        type: "minecraft:multi_noise",
        biomes: [...surface.map((b) => ({ biome: b.id, parameters: parameters(b, single, false) })), ...caves.map((b) => ({ biome: b.id, parameters: parameters(b, single, true) }))],
      },
    },
  }) });

  const light = Number(dim.minMonsterSpawnLightLimit) === Number(dim.maxMonsterSpawnLightLimit)
    ? Number(dim.minMonsterSpawnLightLimit)
    : { type: "minecraft:uniform", min_inclusive: Number(dim.minMonsterSpawnLightLimit), max_inclusive: Number(dim.maxMonsterSpawnLightLimit) };
  const infiniburn = `#${str(dim.infiniburnTag).replace(/^#/, "")}`;
  const typeHeight = { min_y: height.min_y, height: height.height, logical_height: height.height };
  let type: Json;
  if (mc26) {
    const attributes: Json = {
      "minecraft:audio/background_music": {
        creative: { max_delay: 24000, min_delay: 12000, sound: "minecraft:music.creative" },
        default: { max_delay: 24000, min_delay: 12000, sound: "minecraft:music.game" },
      },
    };
    if (dim.imitateOverworldBehaviour === true) Object.assign(attributes, { "minecraft:gameplay/eyeblossom_open": true, "minecraft:gameplay/creaking_active": true });
    if (dim.piglinSafe === true) attributes["minecraft:gameplay/piglins_zombify"] = false;
    if (dim.doesWaterVaporize === true) Object.assign(attributes, { "minecraft:gameplay/water_evaporates": true, "minecraft:gameplay/fast_lava": true });
    if (dim.bedWorks !== true) attributes["minecraft:gameplay/bed_rule"] = { can_set_spawn: "never", can_sleep: "never", destroy_on_use: true };
    if (dim.hasClouds === true) Object.assign(attributes, { "minecraft:visual/cloud_height": Math.max(-2032, Math.min(2031, Math.floor((Number(dim.cloudHeight) + 8) / 16) * 16)), "minecraft:visual/cloud_color": "#ccffffff" });
    const custom = dim.useCustomEffects === true;
    const effects = custom ? "custom" : str(dim.defaultEffects);
    if (custom) {
      const air = str(dim.airColor);
      if (air) Object.assign(attributes, { "minecraft:visual/fog_color": air.toLowerCase(), "minecraft:visual/sky_color": air.toLowerCase() });
      if (dim.hasFog === true) Object.assign(attributes, { "minecraft:visual/fog_start_distance": 5, "minecraft:visual/fog_end_distance": 40 });
      if (dim.sunHeightAffectsFog !== true) attributes["minecraft:visual/sunrise_sunset_color"] = { modifier: "override", argument: 0 };
    } else if (effects === "overworld") {
      Object.assign(attributes, { "minecraft:visual/fog_color": "#c0d8ff", "minecraft:visual/sky_color": "#78a7ff" });
    } else if (effects === "the_nether") {
      Object.assign(attributes, { "minecraft:visual/fog_start_distance": 10, "minecraft:visual/fog_end_distance": 96, "minecraft:visual/sky_light_color": "#7a7aff", "minecraft:visual/sky_light_factor": 0, "minecraft:gameplay/sky_light_level": 4.0 });
    } else {
      Object.assign(attributes, { "minecraft:visual/fog_color": "#181318", "minecraft:visual/sky_color": "#000000", "minecraft:visual/sky_light_color": "#ac60cd", "minecraft:visual/sky_light_factor": 0 });
    }
    Object.assign(attributes, { "minecraft:gameplay/can_start_raid": dim.hasRaids === true, "minecraft:gameplay/respawn_anchor_works": dim.canRespawnHere === true });
    const sky = str(dim.skyType);
    const timelines = custom
      ? (sky === "NORMAL" ? { timelines: "#minecraft:in_overworld", default_clock: "minecraft:overworld" } : { timelines: "#minecraft:universal" })
      : effects === "the_end" ? { has_fixed_time: true, timelines: "#minecraft:in_end" }
        : effects === "the_nether" ? { has_fixed_time: true, timelines: "#minecraft:in_nether", cardinal_light: "nether" }
          : { timelines: "#minecraft:in_overworld", default_clock: "minecraft:overworld" };
    type = {
      attributes, has_skylight: dim.hasSkyLight === true, has_ceiling: kind === "nether", has_ender_dragon_fight: false,
      coordinate_scale: Number(dim.coordinateScale), ambient_light: Number(dim.ambientLight), infiniburn, ...timelines, ...typeHeight,
      monster_spawn_light_level: light, monster_spawn_block_light_limit: Number(dim.monsterSpawnBlockLightLimit),
      skybox: sky === "NORMAL" ? "overworld" : sky.toLowerCase(),
    };
  } else {
    type = {
      ultrawarm: dim.doesWaterVaporize === true, natural: dim.imitateOverworldBehaviour === true, coordinate_scale: Number(dim.coordinateScale),
      has_skylight: dim.hasSkyLight === true, has_ceiling: kind === "nether", ambient_light: Number(dim.ambientLight),
      ...(dim.hasFixedTime === true && str(dim.skyType) === "NORMAL" ? { fixed_time: Number(dim.fixedTimeValue) } : {}),
      monster_spawn_light_level: light, monster_spawn_block_light_limit: Number(dim.monsterSpawnBlockLightLimit),
      piglin_safe: dim.piglinSafe === true, bed_works: dim.bedWorks === true, respawn_anchor_works: dim.canRespawnHere === true, has_raids: dim.hasRaids === true,
      ...typeHeight, infiniburn, effects: dim.useCustomEffects === true ? "minecraft:overworld" : `minecraft:${str(dim.defaultEffects)}`,
    };
  }
  files.push({ path: `data/${env.modId}/dimension_type/${dim.id}.json`, json: json(type) });
}

/** 1.16.5 noise shapes of the vanilla overworld, nether and end settings. */
const NOISE_1165: Record<string, Json> = {
  overworld: { height: 256, sampling: { xz_scale: 0.9999999814507745, y_scale: 0.9999999814507745, xz_factor: 80.0, y_factor: 160.0 }, top_slide: { target: -10, size: 3, offset: 0 }, bottom_slide: { target: -30, size: 0, offset: 0 }, density_factor: 1.0, density_offset: -0.46875, simplex_surface_noise: true, random_density_offset: true },
  nether: { height: 128, sampling: { xz_scale: 1.0, y_scale: 3.0, xz_factor: 80.0, y_factor: 60.0 }, top_slide: { target: 120, size: 3, offset: 0 }, bottom_slide: { target: 320, size: 4, offset: -1 }, density_factor: 0.0, density_offset: 0.019921875, simplex_surface_noise: false },
  end: { height: 128, sampling: { xz_scale: 2.0, y_scale: 1.0, xz_factor: 80.0, y_factor: 160.0 }, top_slide: { target: -3000, size: 64, offset: -46 }, bottom_slide: { target: -30, size: 7, offset: 1 }, density_factor: 0.0, density_offset: 0.0, simplex_surface_noise: true, island_noise_override: true },
};

function seed(id: string): number {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function legacy(dim: Element, env: GenEnv, kind: string, files: ResourceFile[]): void {
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const id = qualify(env, dim.id);
  const biomes = biomeRefs(env, dim.biomesInDimension);
  const s = seed(id);
  const noise = (n: number) => ({ firstOctave: n, amplitudes: [1.0, 1.0] });
  const generator = kind === "void"
    ? { type: "minecraft:flat", settings: { layers: [], biome: biomes[0]?.id ?? "minecraft:the_void", structures: { structures: {} } } }
    : {
      type: "minecraft:noise",
      seed: s,
      settings: {
        bedrock_roof_position: kind === "nether" ? 0 : -10, bedrock_floor_position: kind === "end" ? -10 : 0,
        sea_level: Number(dim.seaLevel), disable_mob_generation: kind === "end",
        default_block: { Name: qualify(env, str(dim.mainFillerBlock)), Properties: {} }, default_fluid: { Name: qualify(env, str(dim.fluidBlock)), Properties: { level: "0" } },
        structures: { structures: {} },
        noise: { ...NOISE_1165[kind], size_horizontal: Number(dim.horizontalNoiseSize), size_vertical: Number(dim.verticalNoiseSize) },
      },
      biome_source: {
        type: "minecraft:multi_noise", seed: s,
        altitude_noise: noise(-7), temperature_noise: noise(-7), humidity_noise: noise(-7), weirdness_noise: noise(-7),
        biomes: biomes.map((b) => ({
          biome: b.id,
          parameters: b.element && biomes.length > 1
            ? { temperature: mid(b.element.genTemperature), humidity: mid(b.element.genHumidity), altitude: mid(b.element.genContinentalness), weirdness: mid(b.element.genWeirdness), offset: 0 }
            : { temperature: 0, humidity: 0, altitude: 0, weirdness: 0, offset: 0 },
        })),
      },
    };
  files.push({ path: `data/${env.modId}/dimension/${dim.id}.json`, json: json({ type: id, generator }) });
  files.push({ path: `data/${env.modId}/dimension_type/${dim.id}.json`, json: json({
    ultrawarm: dim.doesWaterVaporize === true, natural: dim.imitateOverworldBehaviour === true, coordinate_scale: Number(dim.coordinateScale),
    piglin_safe: dim.piglinSafe === true, respawn_anchor_works: dim.canRespawnHere === true, bed_works: dim.bedWorks === true, has_raids: dim.hasRaids === true,
    has_skylight: dim.hasSkyLight === true, has_ceiling: kind === "nether", ambient_light: Number(dim.ambientLight), logical_height: 256,
    ...(dim.hasFixedTime === true && str(dim.skyType) === "NORMAL" ? { fixed_time: Number(dim.fixedTimeValue) } : {}),
    infiniburn: str(dim.infiniburnTag).replace(/^#/, ""),
    effects: dim.useCustomEffects === true ? "minecraft:overworld" : `minecraft:${str(dim.defaultEffects)}`,
  }) });
}

/** Enter and leave procedures, run when a player changes dimension. */
function travel(dim: Element, env: GenEnv): string[] {
  const legacyGen = env.mc === "1.16.5";
  const deps = { x: "player.getX()", y: "player.getY()", z: "player.getZ()", world: legacyGen ? "player.level" : "player.level()", entity: "player" };
  const enter = procedureCall(env, "dimension", dim, "onPlayerEntersDimension", deps);
  const leave = procedureCall(env, "dimension", dim, "onPlayerLeavesDimension", deps);
  if (!enter && !leave) return [];
  const key = idExpr(env, qualify(env, dim.id));
  const loc = env.mc === "26.3" ? "identifier()" : "location()";
  const body = (to: string, from: string) => [enter ? `if (${to}.${loc}.equals(${key})) ${enter};` : "", leave ? `if (${from}.${loc}.equals(${key})) ${leave};` : ""].filter(Boolean).join("\n            ");
  if (env.loader === "fabric") {
    const events = env.mc === "26.3" ? "ServerEntityLevelChangeEvents.AFTER_PLAYER_CHANGE_LEVEL" : "ServerEntityWorldChangeEvents.AFTER_PLAYER_CHANGE_WORLD";
    return [`net.fabricmc.fabric.api.entity.event.v1.${events}.register((player, origin, destination) -> {
            ${body("destination.dimension()", "origin.dimension()")}
        });`];
  }
  if (legacyGen) {
    return [`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.entity.player.PlayerEvent.PlayerChangedDimensionEvent.class, event -> {
            net.minecraft.entity.player.PlayerEntity player = event.getPlayer();
            ${body("event.getTo()", "event.getFrom()")}
        });`];
  }
  return [`net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerChangedDimensionEvent.class, event -> {
            net.minecraft.world.entity.player.Player player = event.getEntity();
            ${body("event.getTo()", "event.getFrom()")}
        });`];
}

function element(dim: Element, env: GenEnv): ElementContext {
  const kind = KIND[str(dim.worldGenType)] ?? "overworld";
  const files: ResourceFile[] = [];
  if (env.mc === "1.16.5") legacy(dim, env, kind, files);
  else modern(dim, env, kind, files);
  return { files, init: travel(dim, env) };
}

export default { element } satisfies TypeModule;
