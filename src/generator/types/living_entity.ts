import type { Element } from "../../elements/model.ts";
import { entityTypeClass, entityTypeValue, rendererRegistration } from "../entities.ts";
import { derivedConstant, idExpr, jstr, list, pascal, qualify, str, vanillaTab1165 } from "../java.ts";
import { buildWarning, procedureCallById } from "../procedures.ts";
import { modClassName, registeredValue, registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TypeModule } from "../typeModule.ts";
import { baseOf, dataEntries, entityClass, legacyOf, names, projectileClass, TYPES } from "../mob/entity.ts";
import { modelOutputs } from "../mob/models.ts";
import { layerTextures, rendererSource } from "../mob/renderer.ts";

/**
 * Living entities: the entity class (src/generator/mob/entity.ts: base class or copied vanilla AI, AI goal blocks,
 * synced data, inventory, taming, riding, flying and water movement, ranged attacks, vibrations, raids), its
 * renderer (mob/renderer.ts: vanilla or project models, render layers, animations) and registration: entity type,
 * attributes, spawn egg, natural spawning with placement rules and conditions, dungeon spawners and raid waves.
 * Vibrations need game events (1.17), so 1.16.5 leaves them out (layer.json).
 */

const EGGS = "SpawnEggs";

const CATEGORIES: Record<string, string> = {
  monster: "MONSTER", creature: "CREATURE", ambient: "AMBIENT", waterCreature: "WATER_CREATURE", waterAmbient: "WATER_AMBIENT",
  undergroundWaterCreature: "UNDERGROUND_WATER_CREATURE", axolotls: "AXOLOTLS", misc: "MISC",
};
function category(env: GenEnv, e: Element): string {
  const c = CATEGORIES[str(e.mobSpawningType)] ?? "MONSTER";
  if (legacyOf(env) && (c === "UNDERGROUND_WATER_CREATURE" || c === "AXOLOTLS")) return "WATER_CREATURE";
  return c;
}

const color = (hex: unknown) => parseInt(str(hex).replace("#", ""), 16) || 0;
const className = (id: string) => `${pascal(id)}LivingEntity`;

function element(e: Element, env: GenEnv): ElementContext {
  const id = String(e.id);
  const name = str(e.mobName) || id;
  const textures: NonNullable<ElementContext["textures"]> = [];
  if (str(e.mobModelTexture)) textures.push({ from: str(e.mobModelTexture), to: `entity/${id}` });
  textures.push(...layerTextures(e));
  const egg = e.hasSpawnEgg === true;
  const files: ResourceFile[] = [];
  if (egg) {
    if (legacyOf(env)) {
      files.push({ path: `assets/${env.modId}/models/item/${id}_spawn_egg.json`, json: JSON.stringify({ parent: "minecraft:item/template_spawn_egg" }, null, 2) });
    } else {
      if (str(e.spawnEggTexture)) textures.push({ from: str(e.spawnEggTexture), to: `item/${id}_spawn_egg` });
      const layer = str(e.spawnEggTexture) ? `${env.modId}:item/${id}_spawn_egg` : "minecraft:item/zombie_spawn_egg";
      files.push({ path: `assets/${env.modId}/models/item/${id}_spawn_egg.json`, json: JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: layer } }, null, 2) });
      files.push({ path: `assets/${env.modId}/items/${id}_spawn_egg.json`, json: JSON.stringify({ model: { type: "minecraft:model", model: `${env.modId}:item/${id}_spawn_egg` } }, null, 2) });
    }
  }
  const drop = str(e.mobDrop);
  const lootDir = legacyOf(env) ? "loot_tables" : "loot_table";
  const pool = drop ? [{ rolls: 1, entries: [{ type: "minecraft:item", name: qualify(env, drop) }] }] : [];
  files.push({ path: `data/${env.modId}/${lootDir}/entities/${id}.json`, json: JSON.stringify({ type: "minecraft:entity", pools: pool }, null, 2) });
  files.push(...spawnFiles(env, e));
  const tags: NonNullable<ElementContext["tags"]> = [];
  const self = `${env.modId}:${id}`;
  const creatureTag: Record<string, string> = { UNDEAD: "minecraft:undead", ARTHROPOD: "minecraft:arthropod", ILLAGER: "minecraft:illager", WATER: "minecraft:aquatic" };
  if (!legacyOf(env) && creatureTag[str(e.mobCreatureType)]) tags.push({ registry: "entity_type", tag: creatureTag[str(e.mobCreatureType)], value: self });
  if (baseOf(env, e).kind === "raider") tags.push({ registry: "entity_type", tag: "minecraft:raiders", value: self });
  if (e.sensitiveToVibration === true && !legacyOf(env)) {
    for (const ev of list<Record<string, unknown>>(e.vibrationalEvents).map((r) => str(r.event)).filter(Boolean)) tags.push({ registry: "game_event", tag: `${env.modId}:${id}_can_listen`, value: qualify(env, ev).includes(":") ? qualify(env, ev) : `minecraft:${ev}` });
  }
  if (env.mc === "1.21.5" && e.breatheUnderwater === true && !str(e.breatheUnderwaterProcedure)) tags.push({ registry: "entity_type", tag: "minecraft:can_breathe_under_water", value: self });
  const mixins: NonNullable<ElementContext["mixins"]> = [];
  if (env.mc === "1.21.5" && env.loader === "fabric" && str(e.breatheUnderwaterProcedure)) mixins.push({ id: "UnderwaterBreathMixin", code: breathMixin(env) });
  if (env.loader === "fabric" && e.spawnInDungeons === true) mixins.push({ id: "MonsterRoomMixin", code: dungeonMixin(env) });
  if (env.loader === "fabric" && baseOf(env, e).kind === "raider") mixins.push({ id: "RaidMixin", code: raidMixin(env) });
  return {
    lang: { [`entity.${env.modId}.${id}`]: name, ...(egg ? { [`item.${env.modId}.${id}_spawn_egg`]: `${name} Spawn Egg` } : {}) },
    textures,
    files,
    tags,
    mixins,
    tabItems: egg ? [registeredValue(env, EGGS, derivedConstant(id.toUpperCase(), "SpawnEgg"))] : [],
  };
}

// ---- Spawning

function spawnBiomes(env: GenEnv, e: Element) {
  const biomes = list<Record<string, unknown>>(e.restrictionBiomes).map((r) => str(r.biome)).filter(Boolean).map((b) => qualify(env, b));
  return { biomes, biomeTag: biomes.find((b) => b.startsWith("#")) };
}

function spawnFiles(env: GenEnv, e: Element): ResourceFile[] {
  if (e.spawnThisMob !== true || env.loader !== "neoforge") return [];
  const { biomes, biomeTag } = spawnBiomes(env, e);
  const weight = Number(e.spawningProbability) || 1, min = Number(e.minNumberOfMobsPerGroup) || 1, max = Math.max(min, Number(e.maxNumberOfMobsPerGroup) || 1);
  const spawner = env.mc === "26.3"
    ? [{ type: `${env.modId}:${e.id}`, count: { type: "minecraft:uniform", min_inclusive: min, max_inclusive: max }, weight }]
    : { type: `${env.modId}:${e.id}`, weight, minCount: min, maxCount: max };
  return [{
    path: `data/${env.modId}/neoforge/biome_modifier/${e.id}_spawns.json`,
    json: JSON.stringify({ type: "neoforge:add_spawns", biomes: biomeTag ?? (biomes.length ? biomes : "#minecraft:is_overworld"), spawners: spawner }, null, 2),
  }];
}

/** Placement type and spawn rule of a spawn category, as MCreator places them; the condition procedure replaces the rule. */
function placement(env: GenEnv, e: Element): { type: string; rule: string } {
  const legacy = legacyOf(env);
  const n = names(env);
  const kind = str(e.mobSpawningType) || "monster";
  const P = legacy ? "net.minecraft.entity.EntitySpawnPlacementRegistry.PlacementType" : "net.minecraft.world.entity.SpawnPlacementTypes";
  const deps = { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world" };
  const cond = procedureCallById(env, e.spawningCondition, deps, `living_entity/${e.id}: spawningCondition`, "logic");
  const lambda = (body: string) => `(entityType, world, reason, pos, random) -> ${body}`;
  const water = `world.getBlockState(pos).is(${legacy ? "net.minecraft.block.Blocks" : "net.minecraft.world.level.block.Blocks"}.WATER) && world.getBlockState(pos.above()).is(${legacy ? "net.minecraft.block.Blocks" : "net.minecraft.world.level.block.Blocks"}.WATER)`;
  let type: string; let rule: string;
  if (kind === "creature") {
    type = `${P}.ON_GROUND`;
    rule = lambda(legacy ? "world.getBlockState(pos.below()).is(net.minecraft.block.Blocks.GRASS_BLOCK) && world.getRawBrightness(pos, 0) > 8"
      : "world.getBlockState(pos.below()).is(net.minecraft.tags.BlockTags.ANIMALS_SPAWNABLE_ON) && world.getRawBrightness(pos, 0) > 8");
  } else if (kind === "ambient" || kind === "misc") {
    type = `${P}.NO_RESTRICTIONS`;
    rule = `${n.mob}::checkMobSpawnRules`;
  } else if (kind === "waterCreature" || kind === "waterAmbient" || (legacy && (kind === "undergroundWaterCreature" || kind === "axolotls"))) {
    type = `${P}.IN_WATER`;
    rule = lambda(water);
  } else if (kind === "undergroundWaterCreature" || kind === "axolotls") {
    type = `${P}.IN_WATER`;
    rule = `${env.mc === "26.3" ? "net.minecraft.world.entity.animal.squid.GlowSquid" : "net.minecraft.world.entity.GlowSquid"}::checkGlowSquidSpawnRules`;
  } else {
    type = `${P}.ON_GROUND`;
    const peaceful = legacy ? "net.minecraft.world.Difficulty.PEACEFUL" : "net.minecraft.world.Difficulty.PEACEFUL";
    rule = lambda(`world.getDifficulty() != ${peaceful} && ${n.monster}.isDarkEnoughToSpawn(world, pos, random) && ${n.mob}.checkMobSpawnRules(entityType, world, reason, pos, random)`);
  }
  return { type, rule: cond ? lambda(cond) : rule };
}

// ---- Fabric mixins: dungeons and raids have no Fabric API

function dungeonMixin(env: GenEnv): string {
  const m = "org.spongepowered.asm.mixin";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Lets dungeon spawners pick this mod's mobs, weighted like the vanilla ones (100 each). */
@${m}.Mixin(net.minecraft.world.level.levelgen.feature.MonsterRoomFeature.class)
public abstract class MonsterRoomMixin {
    @${m}.injection.Inject(method = "randomEntityId", at = @${m}.injection.At("HEAD"), cancellable = true)
    private void ${env.modId}$modMobs(net.minecraft.util.RandomSource random, ${m}.injection.callback.CallbackInfoReturnable<net.minecraft.world.entity.EntityType<?>> result) {
        net.minecraft.world.entity.EntityType<?> mob = ${env.project.mod.package}.init.${modClassName(env)}Dungeons.pick(random);
        if (mob != null) result.setReturnValue(mob);
    }
}
`;
}

/** 1.21.5 decides underwater breathing in a final method; mobs with a breathing procedure answer through a hook. */
function breathMixin(env: GenEnv): string {
  const m = "org.spongepowered.asm.mixin";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Lets mobs with a breathing procedure decide whether they breathe under water. */
@${m}.Mixin(net.minecraft.world.entity.LivingEntity.class)
public abstract class UnderwaterBreathMixin {
    @${m}.injection.Inject(method = "canBreatheUnderwater", at = @${m}.injection.At("HEAD"), cancellable = true)
    private void ${env.modId}$breathe(${m}.injection.callback.CallbackInfoReturnable<Boolean> result) {
        if ((Object) this instanceof ${env.project.mod.package}.entity.UnderwaterBreather breather) result.setReturnValue(breather.mcedgeCanBreatheUnderwater());
    }
}
`;
}

function raidMixin(env: GenEnv): string {
  const m = "org.spongepowered.asm.mixin";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Adds this mod's raiders to every raid wave, after the vanilla ones. */
@${m}.Mixin(net.minecraft.world.entity.raid.Raid.class)
public abstract class RaidMixin {
    @${m}.Shadow private int groupsSpawned;
    @${m}.Shadow @${m}.Final private int numGroups;

    @${m}.Shadow protected abstract boolean shouldSpawnBonusGroup();

    @${m}.injection.Inject(method = "spawnGroup", at = @${m}.injection.At(value = "FIELD", target = "Lnet/minecraft/world/entity/raid/Raid;waveSpawnPos:Ljava/util/Optional;", opcode = org.objectweb.asm.Opcodes.PUTFIELD))
    private void ${env.modId}$modRaiders(net.minecraft.server.level.ServerLevel level, net.minecraft.core.BlockPos pos, ${m}.injection.callback.CallbackInfo info) {
        int wave = this.groupsSpawned + 1;
        ${env.project.mod.package}.init.${modClassName(env)}Raiders.spawn((net.minecraft.world.entity.raid.Raid) (Object) this, level, pos, wave, this.shouldSpawnBonusGroup() ? this.numGroups : wave);
    }
}
`;
}

const waves = (e: Element) => [0, ...[1, 2, 3, 4, 5, 6, 7].map((i) => Math.max(0, Math.round(Number(e[`raidSpawnsWave${i}`]) || 0)))];

/** Raid waves: Forge's extensible enum, NeoForge's enum extension, a Fabric mixin hook. */
function raiders(env: GenEnv, contexts: ElementContext[], typeOf: (ctx: ElementContext) => string): { sources: JavaSourceFile[]; init: string[]; files: ResourceFile[] } {
  const list = contexts.filter((ctx) => baseOf(env, ctx as unknown as Element).kind === "raider");
  if (!list.length) return { sources: [], init: [], files: [] };
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}Raiders`;
  const constant = (ctx: ElementContext) => `${env.modId.toUpperCase()}_${String(ctx.constant)}`;
  if (env.mc === "1.16.5") {
    return {
      sources: [],
      init: [`modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> {
${list.map((ctx) => `            net.minecraft.world.raid.Raid.WaveMember.create(${jstr(constant(ctx))}, ${typeOf(ctx)}, new int[] {${waves(ctx as unknown as Element).join(", ")}});`).join("\n")}
        }));`],
      files: [],
    };
  }
  if (env.loader === "neoforge") {
    const R = "net.minecraft.world.entity.raid";
    const code = `package ${pkg}.init;

/** Generated by MCEdge: raid wave members, added to Raid.RaiderType by NeoForge's enum extension (META-INF/enumextensions.json). */
public final class ${cls} {
    private ${cls}() {}

${list.map((ctx) => `    @SuppressWarnings("unchecked")
    public static final net.neoforged.fml.common.asm.enumextension.EnumProxy<${R}.Raid.RaiderType> ${String(ctx.constant)} = new net.neoforged.fml.common.asm.enumextension.EnumProxy<>(${R}.Raid.RaiderType.class,
            (java.util.function.Supplier<net.minecraft.world.entity.EntityType<? extends ${R}.Raider>>) () -> ${typeOf(ctx)}, new int[] {${waves(ctx as unknown as Element).join(", ")}});`).join("\n\n")}
}
`;
    const json = { entries: list.map((ctx) => ({ enum: "net/minecraft/world/entity/raid/Raid$RaiderType", name: constant(ctx), constructor: "(Ljava/util/function/Supplier;[I)V", parameters: { class: `${pkg.replaceAll(".", "/")}/init/${cls}`, field: String(ctx.constant) } })) };
    return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }], init: [], files: [{ path: "META-INF/enumextensions.json", json: JSON.stringify(json, null, 2) }] };
  }
  const code = `package ${pkg}.init;

/** Generated by MCEdge: spawns this mod's raiders into a raid wave (called from RaidMixin). */
public final class ${cls} {
    private ${cls}() {}

    public static void spawn(net.minecraft.world.entity.raid.Raid raid, net.minecraft.server.level.ServerLevel level, net.minecraft.core.BlockPos pos, int wave, int countIndex) {
${list.map((ctx) => `        spawn(raid, level, pos, wave, ${typeOf(ctx)}, new int[] {${waves(ctx as unknown as Element).join(", ")}}[Math.min(7, Math.max(0, countIndex))]);`).join("\n")}
    }

    private static void spawn(net.minecraft.world.entity.raid.Raid raid, net.minecraft.server.level.ServerLevel level, net.minecraft.core.BlockPos pos, int wave, net.minecraft.world.entity.EntityType<? extends net.minecraft.world.entity.raid.Raider> type, int count) {
        for (int i = 0; i < count; i++) {
            net.minecraft.world.entity.raid.Raider raider = type.create(level, net.minecraft.world.entity.EntitySpawnReason.EVENT);
            if (raider == null) return;
            raid.joinRaid(level, wave, raider, pos, false);
        }
    }
}
`;
  return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }], init: [], files: [] };
}

/** Dungeon spawners: Forge DungeonHooks, NeoForge data map, a Fabric mixin hook. */
function dungeons(env: GenEnv, contexts: ElementContext[], typeOf: (ctx: ElementContext) => string): { sources: JavaSourceFile[]; init: string[]; files: ResourceFile[] } {
  const list = contexts.filter((ctx) => ctx.spawnInDungeons === true);
  if (!list.length) return { sources: [], init: [], files: [] };
  if (env.mc === "1.16.5") {
    return { sources: [], files: [], init: [`modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> {
${list.map((ctx) => `            net.minecraftforge.common.DungeonHooks.addDungeonMob(${typeOf(ctx)}, 100);`).join("\n")}
        }));`] };
  }
  if (env.loader === "neoforge") {
    const values = Object.fromEntries(list.map((ctx) => [`${env.modId}:${ctx.id}`, { weight: 100 }]));
    return { sources: [], init: [], files: [{ path: "data/neoforge/data_maps/entity_type/monster_room_mobs.json", json: JSON.stringify({ values }, null, 2) }] };
  }
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}Dungeons`;
  const code = `package ${pkg}.init;

/** Generated by MCEdge: this mod's dungeon mobs, each weighted 100 against the vanilla 400 (called from MonsterRoomMixin). */
public final class ${cls} {
    private ${cls}() {}

    public static net.minecraft.world.entity.EntityType<?> pick(net.minecraft.util.RandomSource random) {
        int pick = random.nextInt(${4 + list.length}) - 4;
        switch (pick) {
${list.map((ctx, i) => `            case ${i}: return ${typeOf(ctx)};`).join("\n")}
            default: return null;
        }
    }
}
`;
  return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }], init: [], files: [] };
}

// ---- Registration

export default {
  element,
  global(contexts, env) {
    // NeoForge reads enum extensions from a file named in neoforge.mods.toml.
    return { enumExtensions: env.loader === "neoforge" && env.mc !== "1.16.5" && contexts.some((ctx) => baseOf(env, ctx as unknown as Element).kind === "raider") };
  },
  runtime(contexts, env) {
    if (!contexts.length) return {};
    const legacy = legacyOf(env);
    const pkg = env.project.mod.package;
    const own = new Map(contexts.map((ctx) => [`${env.modId}:${ctx.id}`, `${pkg}.entity.${className(String(ctx.id))}`]));
    const mobClass = (id: string) => own.get(id);
    const outputs = contexts.map((ctx) => entityClass(env, ctx as unknown as Element, className(String(ctx.id)), String(ctx.constant), mobClass));
    const shooters = contexts.filter((_, i) => outputs[i].projectile);
    const types = entityTypeClass(env, TYPES, [
      ...contexts.map((ctx) => ({
        constant: String(ctx.constant),
        id: String(ctx.id),
        entityClass: `${pkg}.entity.${className(String(ctx.id))}`,
        category: category(env, ctx as unknown as Element),
        width: Number(ctx.modelWidth) || 0.6,
        height: Number(ctx.modelHeight) || 1.8,
        trackingRange: Math.max(1, Math.ceil((Number(ctx.trackingRange) || 64) / 16)),
        updateInterval: 3,
        fireImmune: ctx.immuneToFire === true,
      })),
      ...shooters.map((ctx) => ({
        constant: derivedConstant(String(ctx.constant), "Projectile"), id: `${ctx.id}_projectile`, entityClass: `${pkg}.entity.${projectileClass(className(String(ctx.id)))}`,
        category: "MISC", width: 0.5, height: 0.5, trackingRange: 4, updateInterval: 20,
      })),
    ]);
    const typeOf = (ctx: ElementContext) => entityTypeValue(env, TYPES, String(ctx.constant));
    const init: string[] = [types.init];
    const sources: JavaSourceFile[] = [types.source];

    // Spawn eggs
    const eggs = contexts.filter((ctx) => ctx.hasSpawnEgg === true);
    if (eggs.length) {
      const egg = registryClass(env, {
        name: EGGS,
        valueType: legacy ? "net.minecraft.item.Item" : "net.minecraft.world.item.Item",
        forge: "net.minecraftforge.registries.ForgeRegistries.ITEMS",
        key: "ITEM",
        entries: eggs.map((ctx) => {
          const id = `${ctx.id}_spawn_egg`;
          const props = legacy ? "new net.minecraft.item.Item.Properties()" : `new net.minecraft.world.item.Item.Properties().setId(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, `${env.modId}:${id}`)}))`;
          const tab = legacy ? vanillaTab1165(env, ctx.creativeTabs) : "";
          const factory = legacy
            ? `new net.minecraftforge.common.ForgeSpawnEggItem(() -> ${typeOf(ctx)}, ${color(ctx.spawnEggBaseColor)}, ${color(ctx.spawnEggDotColor)}, ${props}${tab ? `.tab(${tab})` : ""})`
            : env.mc === "26.3"
              ? `new net.minecraft.world.item.SpawnEggItem(${props}.spawnEgg(${typeOf(ctx)}))`
              : `new net.minecraft.world.item.SpawnEggItem(${typeOf(ctx)}, ${props})`;
          return { constant: derivedConstant(String(ctx.constant), "SpawnEgg"), id, factory };
        }),
      });
      sources.push(egg.source);
      init.push(egg.init);
    }

    // Attributes
    const attrs = contexts.map((ctx) => ({ type: typeOf(ctx), builder: `${pkg}.entity.${className(String(ctx.id))}.createAttributes()` }));
    if (env.loader === "fabric") {
      init.push(...attrs.map((a) => `net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry.register(${a.type}, ${a.builder});`));
    } else {
      const event = legacy ? "net.minecraftforge.event.entity.EntityAttributeCreationEvent" : "net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent";
      const listen = legacy ? `modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, ${event}.class, event -> {` : `modBus.addListener(${event}.class, event -> {`;
      init.push(`${listen}
${attrs.map((a) => `            event.put(${a.type}, ${a.builder}.build());`).join("\n")}
        });`);
    }

    // Natural spawning: placement rules and biomes
    const spawning = contexts.filter((ctx) => ctx.spawnThisMob === true);
    if (spawning.length) {
      const heightmap = legacy ? "net.minecraft.world.gen.Heightmap.Type.MOTION_BLOCKING_NO_LEAVES" : "net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES";
      const place = (ctx: ElementContext) => placement(env, ctx as unknown as Element);
      if (legacy) {
        init.push(`modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> {
${spawning.map((ctx) => `            net.minecraft.entity.EntitySpawnPlacementRegistry.register(${typeOf(ctx)}, ${place(ctx).type}, ${heightmap}, ${place(ctx).rule});`).join("\n")}
        }));`);
        init.push(`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.world.BiomeLoadingEvent.class, event -> {
${spawning.map((ctx) => {
  const e = ctx as unknown as Element;
  const { biomes } = spawnBiomes(env, e);
  const cat = (name: string) => `event.getCategory() == net.minecraft.world.biome.Biome.Category.${name}`;
  const overworld = `!(${cat("NETHER")} || ${cat("THEEND")} || ${cat("NONE")})`;
  const tests = biomes.map((b) => b === "#minecraft:is_nether" ? cat("NETHER") : b === "#minecraft:is_end" ? cat("THEEND") : b === "#minecraft:is_overworld" ? overworld
    : b.startsWith("#") ? "false" : `new net.minecraft.util.ResourceLocation(${jstr(b)}).equals(event.getName())`);
  return `            if (${tests.length ? tests.join(" || ") : overworld}) event.getSpawns().getSpawner(net.minecraft.entity.EntityClassification.${category(env, e)}).add(new net.minecraft.world.biome.MobSpawnInfo.Spawners(${typeOf(ctx)}, ${Number(e.spawningProbability) || 1}, ${Number(e.minNumberOfMobsPerGroup) || 1}, ${Number(e.maxNumberOfMobsPerGroup) || 1}));`;
}).join("\n")}
        });`);
      } else if (env.loader === "neoforge") {
        init.push(`modBus.addListener(net.neoforged.neoforge.event.entity.RegisterSpawnPlacementsEvent.class, event -> {
${spawning.map((ctx) => `            event.register(${typeOf(ctx)}, ${place(ctx).type}, ${heightmap}, ${place(ctx).rule}, net.neoforged.neoforge.event.entity.RegisterSpawnPlacementsEvent.Operation.REPLACE);`).join("\n")}
        });`);
      } else {
        const reg = "net.minecraft.core.registries.Registries";
        const selectors = "net.fabricmc.fabric.api.biome.v1.BiomeSelectors";
        init.push(...spawning.map((ctx) => `net.minecraft.world.entity.SpawnPlacements.register(${typeOf(ctx)}, ${place(ctx).type}, ${heightmap}, ${place(ctx).rule});`));
        init.push(...spawning.map((ctx) => {
          const e = ctx as unknown as Element;
          const { biomes, biomeTag } = spawnBiomes(env, e);
          const selector = biomeTag ? `${selectors}.tag(net.minecraft.tags.TagKey.create(${reg}.BIOME, ${idExpr(env, biomeTag.slice(1))}))`
            : biomes.length ? `${selectors}.includeByKey(${biomes.map((b) => `net.minecraft.resources.ResourceKey.create(${reg}.BIOME, ${idExpr(env, b)})`).join(", ")})`
              : `${selectors}.foundInOverworld()`;
          return `net.fabricmc.fabric.api.biome.v1.BiomeModifications.addSpawn(${selector}, net.minecraft.world.entity.MobCategory.${category(env, e)}, ${typeOf(ctx)}, ${Number(e.spawningProbability) || 1}, ${Number(e.minNumberOfMobsPerGroup) || 1}, ${Number(e.maxNumberOfMobsPerGroup) || 1});`;
        }));
      }
    }

    for (const extra of [raiders(env, contexts, typeOf), dungeons(env, contexts, typeOf)]) {
      sources.push(...extra.sources);
      init.push(...extra.init);
    }

    if (env.mc === "1.21.5" && env.loader === "fabric" && contexts.some((ctx) => str(ctx.breatheUnderwaterProcedure))) {
      sources.push({ path: `${pkg.replaceAll(".", "/")}/entity/UnderwaterBreather.java`, code: `package ${pkg}.entity;

/** Generated by MCEdge: mobs whose underwater breathing a procedure decides (see UnderwaterBreathMixin). */
public interface UnderwaterBreather {
    boolean mcedgeCanBreatheUnderwater();
}
` });
    }

    // Entity classes, renderers and project models
    sources.push(...outputs.map((o) => o.source), ...outputs.flatMap((o) => (o.projectile ? [o.projectile] : [])));
    const warn = (ctx: ElementContext) => (text: string) => buildWarning(env, `living_entity/${ctx.id}: ${text}`);
    const logicData = (ctx: ElementContext) => new Set(dataEntries(ctx as unknown as Element).filter((d) => d.type === "logic").map((d) => d.name));
    sources.push(...contexts.map((ctx) => {
      const e = ctx as unknown as Element;
      const entity = `${pkg}.entity.${className(String(ctx.id))}`;
      const deps = (v: string) => ({ x: `${v}.getX()`, y: `${v}.getY()`, z: `${v}.getZ()`, world: legacy ? `${v}.level` : `${v}.level()`, entity: v });
      return rendererSource(env, {
        e, entity, cls: `${className(String(ctx.id))}Renderer`,
        condition: (field, v, row) => procedureCallById(env, (row ?? e)[field], deps(v), `living_entity/${ctx.id}: ${field}`, "logic"),
        number: (field, v) => procedureCallById(env, e[field], deps(v), `living_entity/${ctx.id}: ${field}`, "number"),
        logicData: logicData(ctx),
        warn: warn(ctx),
      });
    }));
    const models = modelOutputs(env, "living_entity");
    sources.push(...models.sources);

    const renderers = [
      ...contexts.map((ctx) => ({ type: typeOf(ctx), factory: `${pkg}.client.${className(String(ctx.id))}Renderer::new` })),
      ...shooters.map((ctx) => ({
        type: entityTypeValue(env, TYPES, derivedConstant(String(ctx.constant), "Projectile")),
        factory: legacy ? "manager -> new net.minecraft.client.renderer.entity.SpriteRenderer<>(manager, net.minecraft.client.Minecraft.getInstance().getItemRenderer())" : "net.minecraft.client.renderer.entity.ThrownItemRenderer::new",
      })),
    ];
    const clientInit = [...models.clientInit, rendererRegistration(env, renderers)].filter(Boolean);
    return { sources, init, clientInit };
  },
  files(contexts, env) {
    if (!contexts.length) return [];
    // Raid enum extension (NeoForge) and dungeon data map: built once from all elements.
    const typeOf = (ctx: ElementContext) => entityTypeValue(env, TYPES, String(ctx.constant));
    return [...raiders(env, contexts, typeOf).files, ...dungeons(env, contexts, typeOf).files];
  },
} satisfies TypeModule;
