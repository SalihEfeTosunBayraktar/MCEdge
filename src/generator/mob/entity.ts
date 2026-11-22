import type { Element } from "../../elements/model.ts";
import { entityTypeValue } from "../entities.ts";
import { derivedConstant, idExpr, itemExpr, jfloat, jstr, list, literal, pascal, qualify, str } from "../java.ts";
import { buildWarning, procedureCall, procedureCallById, procedureReturnType } from "../procedures.ts";
import type { GenEnv, JavaSourceFile } from "../typeModule.ts";
import { openGuiCall } from "../types/gui.ts";
import { compileGoals, goalBlocks, type MobTraits } from "./ai.ts";
import { animationRows } from "./renderer.ts";

/**
 * The entity class of a living entity: base class (monster, creature, animal, tameable, raider or a vanilla mob's
 * AI), attributes, goals, synced data, inventory, taming, riding, flying and water movement, ranged attacks,
 * vibrations, sounds, damage immunities and the event procedures.
 */

export const TYPES = "Mobs";
export const legacyOf = (env: GenEnv) => env.mc === "1.16.5";

export function names(env: GenEnv) {
  if (legacyOf(env)) {
    return {
      world: "net.minecraft.world.World", server: "net.minecraft.world.server.ServerWorld", entity: "net.minecraft.entity.Entity",
      living: "net.minecraft.entity.LivingEntity", player: "net.minecraft.entity.player.PlayerEntity", serverPlayer: "net.minecraft.entity.player.ServerPlayerEntity",
      source: "net.minecraft.util.DamageSource", sound: "net.minecraft.util.SoundEvent", item: "net.minecraft.item",
      goal: "net.minecraft.entity.ai.goal", attrs: "net.minecraft.entity.ai.attributes.Attributes", slot: "net.minecraft.inventory.EquipmentSlotType",
      mob: "net.minecraft.entity.MobEntity", monster: "net.minecraft.entity.monster.MonsterEntity", creature: "net.minecraft.entity.CreatureEntity",
      animal: "net.minecraft.entity.passive.AnimalEntity", tamable: "net.minecraft.entity.passive.TameableEntity", raider: "net.minecraft.entity.monster.AbstractRaiderEntity",
      ranged: "net.minecraft.entity.IRangedAttackMob", pos: "net.minecraft.util.math.BlockPos", state: "net.minecraft.block.BlockState",
      vec: "net.minecraft.util.math.vector.Vector3d", hand: "net.minecraft.util.Hand", result: "net.minecraft.util.ActionResultType",
      container: "net.minecraft.inventory.IInventory", nbt: "net.minecraft.nbt.CompoundNBT", nonNull: "net.minecraft.util.NonNullList",
      entityType: "net.minecraft.entity.EntityType",
    };
  }
  const v26 = env.mc === "26.3";
  return {
    world: "net.minecraft.world.level.Level", server: "net.minecraft.server.level.ServerLevel", entity: "net.minecraft.world.entity.Entity",
    living: "net.minecraft.world.entity.LivingEntity", player: "net.minecraft.world.entity.player.Player", serverPlayer: "net.minecraft.server.level.ServerPlayer",
    source: "net.minecraft.world.damagesource.DamageSource", sound: "net.minecraft.sounds.SoundEvent", item: "net.minecraft.world.item",
    goal: "net.minecraft.world.entity.ai.goal", attrs: "net.minecraft.world.entity.ai.attributes.Attributes", slot: "net.minecraft.world.entity.EquipmentSlot",
    mob: "net.minecraft.world.entity.Mob", monster: "net.minecraft.world.entity.monster.Monster", creature: "net.minecraft.world.entity.PathfinderMob",
    animal: "net.minecraft.world.entity.animal.Animal", tamable: "net.minecraft.world.entity.TamableAnimal", raider: "net.minecraft.world.entity.raid.Raider",
    ranged: "net.minecraft.world.entity.monster.RangedAttackMob", pos: "net.minecraft.core.BlockPos", state: "net.minecraft.world.level.block.state.BlockState",
    vec: "net.minecraft.world.phys.Vec3", hand: "net.minecraft.world.InteractionHand", result: "net.minecraft.world.InteractionResult",
    container: "net.minecraft.world.Container", nbt: v26 ? "" : "net.minecraft.nbt.CompoundTag", nonNull: "net.minecraft.core.NonNullList",
    entityType: "net.minecraft.world.entity.EntityType",
  };
}

/** Vanilla mobs whose AI an element can copy: class per generation, whether it is a monster / path finder. */
const AI_BASES: Record<string, { legacy: string; m215: string; m263: string; monster: boolean; pathfinder: boolean; attrs?: string; offspring?: boolean }> = {
  Bat: { legacy: "passive.BatEntity", m215: "ambient.Bat", m263: "ambient.Bat", monster: false, pathfinder: false },
  Blaze: { legacy: "monster.BlazeEntity", m215: "monster.Blaze", m263: "monster.Blaze", monster: true, pathfinder: true },
  Chicken: { legacy: "passive.ChickenEntity", m215: "animal.Chicken", m263: "animal.chicken.Chicken", monster: false, pathfinder: true, offspring: true },
  Cow: { legacy: "passive.CowEntity", m215: "animal.Cow", m263: "animal.cow.Cow", monster: false, pathfinder: true, offspring: true },
  Creeper: { legacy: "monster.CreeperEntity", m215: "monster.Creeper", m263: "monster.Creeper", monster: true, pathfinder: true },
  Enderman: { legacy: "monster.EndermanEntity", m215: "monster.EnderMan", m263: "monster.Enderman", monster: true, pathfinder: true },
  Horse: { legacy: "passive.horse.HorseEntity", m215: "animal.horse.Horse", m263: "animal.equine.Horse", monster: false, pathfinder: true, attrs: "createBaseHorseAttributes", offspring: true },
  IronGolem: { legacy: "passive.IronGolemEntity", m215: "animal.IronGolem", m263: "animal.golem.IronGolem", monster: false, pathfinder: true },
  MagmaCube: { legacy: "monster.MagmaCubeEntity", m215: "monster.MagmaCube", m263: "monster.cubemob.MagmaCube", monster: false, pathfinder: false },
  Ocelot: { legacy: "passive.OcelotEntity", m215: "animal.Ocelot", m263: "animal.feline.Ocelot", monster: false, pathfinder: true, offspring: true },
  Pig: { legacy: "passive.PigEntity", m215: "animal.Pig", m263: "animal.pig.Pig", monster: false, pathfinder: true, offspring: true },
  Skeleton: { legacy: "monster.SkeletonEntity", m215: "monster.Skeleton", m263: "monster.skeleton.Skeleton", monster: true, pathfinder: true },
  Slime: { legacy: "monster.SlimeEntity", m215: "monster.Slime", m263: "monster.cubemob.Slime", monster: false, pathfinder: false, attrs: "createMobAttributes" },
  Spider: { legacy: "monster.SpiderEntity", m215: "monster.Spider", m263: "monster.spider.Spider", monster: true, pathfinder: true },
  Squid: { legacy: "passive.SquidEntity", m215: "animal.Squid", m263: "animal.squid.Squid", monster: false, pathfinder: true },
  Villager: { legacy: "merchant.villager.VillagerEntity", m215: "npc.Villager", m263: "npc.villager.Villager", monster: false, pathfinder: true, offspring: true },
  Witch: { legacy: "monster.WitchEntity", m215: "monster.Witch", m263: "monster.Witch", monster: true, pathfinder: true },
  Wolf: { legacy: "passive.WolfEntity", m215: "animal.wolf.Wolf", m263: "animal.wolf.Wolf", monster: false, pathfinder: true, offspring: true },
  Zombie: { legacy: "monster.ZombieEntity", m215: "monster.Zombie", m263: "monster.zombie.Zombie", monster: true, pathfinder: true },
};

export interface Base {
  cls: string;
  kind: "monster" | "creature" | "animal" | "tamable" | "raider" | "vanilla";
  monster: boolean;
  pathfinder: boolean;
  vanilla?: string;
}

export function baseOf(env: GenEnv, e: Element): Base {
  const n = names(env);
  if (e.breedable === true) return e.tameable === true ? { cls: n.tamable, kind: "tamable", monster: false, pathfinder: true } : { cls: n.animal, kind: "animal", monster: false, pathfinder: true };
  const ai = AI_BASES[str(e.aiBase)];
  if (ai) {
    const cls = legacyOf(env) ? `net.minecraft.entity.${ai.legacy}` : `net.minecraft.world.entity.${env.mc === "26.3" ? ai.m263 : ai.m215}`;
    return { cls, kind: "vanilla", monster: ai.monster, pathfinder: ai.pathfinder, vanilla: str(e.aiBase) };
  }
  if (e.mobBehaviourType === "Raider") return { cls: n.raider, kind: "raider", monster: true, pathfinder: true };
  if (e.mobBehaviourType === "Creature") return { cls: n.creature, kind: "creature", monster: false, pathfinder: true };
  return { cls: n.monster, kind: "monster", monster: true, pathfinder: true };
}

function soundExpr(env: GenEnv, sound: string): string {
  const id = idExpr(env, qualify(env, sound));
  return legacyOf(env)
    ? `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${id})`
    : `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${id})`;
}

/** Synced data entries: name, Java type and serializer. */
export function dataEntries(e: Element): { name: string; type: "number" | "logic" | "string"; value: string }[] {
  return list<Record<string, unknown>>(e.entityDataEntries)
    .filter((r) => /^[a-z0-9_]+$/.test(str(r.name)))
    .map((r) => {
      const type = (["number", "logic", "string"].includes(str(r.type)) ? str(r.type) : "number") as "number" | "logic" | "string";
      const raw = str(r.defaultValue);
      const value = type === "number" ? String(Math.trunc(Number(raw)) || 0) : type === "logic" ? String(raw === "true") : jstr(raw);
      return { name: str(r.name), type, value };
    });
}

function attributes(env: GenEnv, e: Element, base: Base, goals: Set<string>): string {
  const n = names(env);
  const a = n.attrs;
  let start: string;
  const ai = base.vanilla ? AI_BASES[base.vanilla] : undefined;
  if (ai) start = ai.attrs === "createMobAttributes" ? `${n.mob}.createMobAttributes()` : `${base.cls}.${ai.attrs ?? "createAttributes"}()`;
  else start = base.monster ? `${n.monster}.createMonsterAttributes()` : `${n.mob}.createMobAttributes()`;
  const speed = Number(e.movementSpeed) || 0;
  const add = [
    `.add(${a}.MOVEMENT_SPEED, ${speed})`,
    `.add(${a}.MAX_HEALTH, ${Number(e.health) || 1})`,
    `.add(${a}.ARMOR, ${Number(e.armorBaseValue) || 0})`,
    `.add(${a}.ATTACK_DAMAGE, ${Number(e.attackStrength) || 0})`,
    `.add(${a}.FOLLOW_RANGE, ${Number(e.followRange) || 16})`,
    `.add(${a}.KNOCKBACK_RESISTANCE, ${Number(e.knockbackResistance) || 0})`,
    `.add(${a}.ATTACK_KNOCKBACK, ${Number(e.attackKnockback) || 0})`,
    ...(legacyOf(env) ? [] : [`.add(${a}.STEP_HEIGHT, ${Number(e.stepHeight) || 0.6})`]),
    ...(e.flyingMob === true ? [`.add(${a}.FLYING_SPEED, ${speed})`] : []),
    ...(e.waterMob === true && env.loader === "neoforge" ? [`.add(net.neoforged.neoforge.common.NeoForgeMod.SWIM_SPEED, ${speed})`] : []),
    ...(e.waterMob === true && env.loader === "forge" ? [`.add(net.minecraftforge.common.ForgeMod.SWIM_SPEED.get(), ${speed})`] : []),
    ...(str(e.aiBase) === "Zombie" ? [`.add(${a}.SPAWN_REINFORCEMENTS_CHANCE)`] : []),
    // TemptGoal reads the tempt range since 1.21.
    ...(!legacyOf(env) && (goals.has("ai_tempt") || ["Chicken", "Cow", "Horse", "Ocelot", "Pig"].includes(str(e.aiBase))) ? [`.add(${a}.TEMPT_RANGE, 10.0)`] : []),
  ];
  return `${start}\n                ${add.join("\n                ")}`;
}

/** Default goals when the AI goals field is empty and no vanilla AI is copied. */
function defaultGoals(env: GenEnv, base: Base, e: Element): string[] {
  const legacy = legacyOf(env);
  const n = names(env);
  const g = n.goal;
  const lines = [`this.goalSelector.addGoal(0, new ${g}.${legacy ? "SwimGoal" : "FloatGoal"}(this));`];
  if (base.monster) {
    lines.push(`this.goalSelector.addGoal(2, new ${g}.MeleeAttackGoal(this, 1.2, false));`);
    lines.push(`this.targetSelector.addGoal(1, new ${legacy ? g : `${g}.target`}.HurtByTargetGoal(this));`);
    lines.push(`this.targetSelector.addGoal(2, new ${legacy ? g : `${g}.target`}.NearestAttackableTargetGoal<>(this, ${n.player}.class, true));`);
  } else {
    lines.push(`this.goalSelector.addGoal(1, new ${g}.PanicGoal(this, 1.2));`);
  }
  if (e.breedable === true) lines.push(`this.goalSelector.addGoal(2, new ${g}.BreedGoal(this, 1.0));`);
  lines.push(`this.goalSelector.addGoal(5, new ${g}.${legacy ? "RandomWalkingGoal" : "RandomStrollGoal"}(this, 1.0));`);
  lines.push(`this.goalSelector.addGoal(6, new ${g}.${legacy ? "LookAtGoal" : "LookAtPlayerGoal"}(this, ${n.player}.class, 8.0F));`);
  lines.push(`this.goalSelector.addGoal(7, new ${g}.${legacy ? "LookRandomlyGoal" : "RandomLookAroundGoal"}(this));`);
  return lines;
}

/** Damage the element is immune to, as Java conditions on `source`. */
function immunities(env: GenEnv, e: Element): string[] {
  const legacy = legacyOf(env);
  const type = (name: string) => legacy ? `source == ${names(env).source}.${name}` : `source.is(net.minecraft.world.damagesource.DamageTypes.${name})`;
  const tag = (name: string, legacyName: string) => legacy ? legacyName : `source.is(net.minecraft.tags.DamageTypeTags.${name})`;
  const out: string[] = [];
  if (e.immuneToArrows === true) out.push(`source.getDirectEntity() instanceof ${legacy ? "net.minecraft.entity.projectile.AbstractArrowEntity" : env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.AbstractArrow" : "net.minecraft.world.entity.projectile.AbstractArrow"}`);
  if (e.immuneToTrident === true) out.push(`source.getDirectEntity() instanceof ${legacy ? "net.minecraft.entity.projectile.TridentEntity" : env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.ThrownTrident" : "net.minecraft.world.entity.projectile.ThrownTrident"}`);
  if (e.immuneToPlayer === true) out.push(`source.getEntity() instanceof ${names(env).player}`);
  if (e.immuneToFallDamage === true) out.push(tag("IS_FALL", "source == net.minecraft.util.DamageSource.FALL"));
  if (e.immuneToCactus === true) out.push(type("CACTUS"));
  if (e.immuneToDrowning === true) out.push(tag("IS_DROWNING", "source == net.minecraft.util.DamageSource.DROWN"));
  if (e.immuneToLightning === true) out.push(tag("IS_LIGHTNING", "source == net.minecraft.util.DamageSource.LIGHTNING_BOLT"));
  if (e.immuneToPotions === true) out.push(legacy ? "source == net.minecraft.util.DamageSource.MAGIC || \"indirectMagic\".equals(source.getMsgId())" : `${type("MAGIC")} || ${type("INDIRECT_MAGIC")}`);
  if (e.immuneToExplosion === true) out.push(legacy ? "source.isExplosion()" : tag("IS_EXPLOSION", ""));
  if (e.immuneToAnvil === true) out.push(legacy ? "source == net.minecraft.util.DamageSource.ANVIL" : type("FALLING_ANVIL"));
  if (e.immuneToDragonBreath === true) out.push(legacy ? "source == net.minecraft.util.DamageSource.DRAGON_BREATH" : type("DRAGON_BREATH"));
  if (e.immuneToWither === true) out.push(legacy ? "source == net.minecraft.util.DamageSource.WITHER || \"witherSkull\".equals(source.getMsgId())" : `${type("WITHER")} || ${type("WITHER_SKULL")}`);
  return out;
}

export interface EntityOutput {
  source: JavaSourceFile;
  /** Ranged default-item projectile class, when the element shoots an item. */
  projectile?: JavaSourceFile;
  goals: Set<string>;
}

/** Simple class name of the default-item projectile a ranged mob shoots. */
export const projectileClass = (cls: string) => `${cls}Projectile`;

export function entityClass(env: GenEnv, e: Element, cls: string, constant: string, mobClass: (id: string) => string | undefined): EntityOutput {
  const legacy = legacyOf(env);
  const v26 = env.mc === "26.3";
  const n = names(env);
  const pkg = env.project.mod.package;
  const fqn = `${pkg}.entity.${cls}`;
  const base = baseOf(env, e);
  const level = legacy ? "this.level" : "this.level()";
  const at = { x: "this.getX()", y: "this.getY()", z: "this.getZ()", world: level, entity: "this" };
  const call = (field: string, deps: Record<string, string>) => procedureCall(env, "living_entity", e, field, deps);
  const logicCall = (field: string, deps: Record<string, string>) => procedureCallById(env, e[field], deps, `living_entity/${e.id}: ${field}`, "logic");
  const numberCall = (field: string, deps: Record<string, string>) => procedureCallById(env, e[field], deps, `living_entity/${e.id}: ${field}`, "number");
  const warn = (text: string) => buildWarning(env, `living_entity/${e.id}: ${text}`);
  const members: string[] = [];
  const fields: string[] = [];
  const ctor: string[] = [`this.xpReward = ${Number(e.xpAmount) || 0};`];
  const interfaces: string[] = [];
  const data = dataEntries(e);
  const flying = e.flyingMob === true;
  const water = e.waterMob === true && !flying;
  const tamable = base.kind === "tamable";
  const traits: MobTraits = { cls, fqn, pathfinder: base.pathfinder, tamable, animal: base.kind === "animal" || tamable, flying, water, mobClass };

  // ---- Constructor
  if (legacy) ctor.push(`this.maxUpStep = ${jfloat(e.stepHeight)};`);
  if (e.hasAI === false) ctor.push("this.setNoAi(true);");
  if (str(e.mobLabel)) ctor.push(`this.setCustomName(${literal(env, str(e.mobLabel))});`, "this.setCustomNameVisible(true);");
  if (e.doesDespawnWhenIdle === false) ctor.push("this.setPersistenceRequired();");
  const slots: [string, string][] = [["equipmentMainHand", "MAINHAND"], ["equipmentOffHand", "OFFHAND"], ["equipmentHelmet", "HEAD"], ["equipmentBody", "CHEST"], ["equipmentLeggings", "LEGS"], ["equipmentBoots", "FEET"]];
  for (const [key, slot] of slots) if (str(e[key])) ctor.push(`this.setItemSlot(${n.slot}.${slot}, new ${n.item}.ItemStack(${itemExpr(env, str(e[key]))}));`);
  if (flying) ctor.push(legacy ? "this.moveControl = new net.minecraft.entity.ai.controller.FlyingMovementController(this, 10, true);" : "this.moveControl = new net.minecraft.world.entity.ai.control.FlyingMoveControl(this, 10, true);");
  if (water) ctor.push(...waterMovement(env, cls));
  const boxScale = Number(e.boundingBoxScale) || 1;
  const boxProc = numberCall("boundingBoxScaleProcedure", at);
  if (boxScale !== 1 && !boxProc) ctor.push("this.refreshDimensions();");

  // ---- Synced data
  const serializer = (t: string) => legacy
    ? `net.minecraft.network.datasync.DataSerializers.${t === "number" ? "INT" : t === "logic" ? "BOOLEAN" : "STRING"}`
    : `net.minecraft.network.syncher.EntityDataSerializers.${t === "number" ? "INT" : t === "logic" ? "BOOLEAN" : "STRING"}`;
  const boxed = (t: string) => (t === "number" ? "Integer" : t === "logic" ? "Boolean" : "String");
  for (const d of data) {
    fields.push(legacy
      ? `    public static final net.minecraft.network.datasync.DataParameter<${boxed(d.type)}> DATA_${d.name} = net.minecraft.network.datasync.EntityDataManager.defineId(${cls}.class, ${serializer(d.type)});`
      : `    public static final net.minecraft.network.syncher.EntityDataAccessor<${boxed(d.type)}> DATA_${d.name} = net.minecraft.network.syncher.SynchedEntityData.defineId(${cls}.class, ${serializer(d.type)});`);
  }
  if (data.length) {
    members.push(legacy
      ? `    @Override\n    protected void defineSynchedData() {\n        super.defineSynchedData();\n${data.map((d) => `        this.entityData.define(DATA_${d.name}, ${d.value});`).join("\n")}\n    }`
      : `    @Override\n    protected void defineSynchedData(net.minecraft.network.syncher.SynchedEntityData.Builder builder) {\n        super.defineSynchedData(builder);\n${data.map((d) => `        builder.define(DATA_${d.name}, ${d.value});`).join("\n")}\n    }`);
  }

  // ---- Navigation
  if (flying || water) {
    const nav = legacy
      ? `net.minecraft.pathfinding.${flying ? "FlyingPathNavigator" : "SwimmerPathNavigator"}`
      : `net.minecraft.world.entity.ai.navigation.${flying ? "FlyingPathNavigation" : "WaterBoundPathNavigation"}`;
    members.push(`    @Override\n    protected ${legacy ? "net.minecraft.pathfinding.PathNavigator" : "net.minecraft.world.entity.ai.navigation.PathNavigation"} createNavigation(${n.world} world) {\n        return new ${nav}(this, world);\n    }`);
  }

  // ---- Goals
  const unmodifiable = ["Bat", "MagmaCube", "Slime"].includes(base.vanilla ?? "");
  const goals = compileGoals(env, e, traits);
  if (unmodifiable && goals.lines.length) warn(`the ${base.vanilla} AI cannot take extra goals; the AI goal blocks are left out`);
  const ranged = e.ranged === true;
  if (ranged && !base.pathfinder) warn("ranged attacks need a path finding mob; left out");
  const goalLines = unmodifiable ? [] : goalBlocks(e).length ? goals.lines : base.vanilla ? [] : defaultGoals(env, base, e);
  if (ranged && base.pathfinder) interfaces.push(n.ranged);
  if (ranged && base.pathfinder && !unmodifiable) {
    goalLines.push(`this.goalSelector.addGoal(1, new ${n.goal}.RangedAttackGoal(this, 1.25, ${Math.max(1, Math.round(Number(e.rangedAttackInterval) || 20))}, ${jfloat(Number(e.rangedAttackRadius) || 10)}) {
            @Override
            public boolean canContinueToUse() {
                return this.canUse();
            }
        });`);
  }
  if (e.hasAI !== false) {
    members.push(`    @Override\n    protected void registerGoals() {\n        super.registerGoals();\n${goalLines.map((l) => `        ${l}`).join("\n")}\n    }`);
  }
  if (e.doesDespawnWhenIdle === false) members.push("    @Override\n    public boolean removeWhenFarAway(double distance) {\n        return false;\n    }");

  // ---- Riding position
  const mounted = Number(e.mountedYOffset) || 0;
  if (!legacy) {
    const model = str(e.mobModelName) || "Biped";
    if (model === "Biped" || model === "Silverfish") {
      members.push(`    @Override\n    public ${n.vec} getPassengerRidingPosition(${n.entity} entity) {\n        return super.getPassengerRidingPosition(entity).add(0, ${model === "Biped" ? "-0.35F" : "0.1F"}, 0);\n    }`);
    }
    if (mounted) members.push(`    @Override\n    protected ${n.vec} getPassengerAttachmentPoint(${n.entity} entity, net.minecraft.world.entity.EntityDimensions dimensions, float scale) {\n        return super.getPassengerAttachmentPoint(entity, dimensions, scale).add(0, ${jfloat(mounted)}, 0);\n    }`);
  } else if (mounted) {
    members.push(`    @Override\n    public double getPassengersRidingOffset() {\n        return super.getPassengersRidingOffset() + ${mounted};\n    }`);
  }

  // ---- Sounds
  const sound = (key: string) => str(e[key]);
  if (sound("livingSound")) members.push(`    @Override\n    public ${n.sound} getAmbientSound() {\n        return ${soundExpr(env, sound("livingSound"))};\n    }`);
  if (sound("hurtSound")) members.push(`    @Override\n    public ${n.sound} getHurtSound(${n.source} source) {\n        return ${soundExpr(env, sound("hurtSound"))};\n    }`);
  if (sound("deathSound")) members.push(`    @Override\n    public ${n.sound} getDeathSound() {\n        return ${soundExpr(env, sound("deathSound"))};\n    }`);
  if (sound("stepSound")) members.push(`    @Override\n    protected void playStepSound(${n.pos} pos, ${n.state} state) {\n        this.playSound(${soundExpr(env, sound("stepSound"))}, 0.15F, 1.0F);\n    }`);
  if (base.kind === "raider") {
    const celebrate = sound("raidCelebrationSound") ? soundExpr(env, sound("raidCelebrationSound")) : legacy ? "net.minecraft.util.SoundEvents.PILLAGER_CELEBRATE" : "net.minecraft.sounds.SoundEvents.PILLAGER_CELEBRATE";
    members.push(`    @Override\n    public ${n.sound} getCelebrateSound() {\n        return ${celebrate};\n    }`);
    members.push(legacy
      ? "    @Override\n    public void applyRaidBuffs(int wave, boolean captain) {\n    }"
      : `    @Override\n    public void applyRaidBuffs(${n.server} world, int wave, boolean captain) {\n    }`);
  }

  // ---- Damage
  const immune = immunities(env, e).filter(Boolean);
  const hurt = call("whenMobIsHurt", { ...at, sourceentity: "source.getEntity()", immediatesourceentity: "source.getDirectEntity()", damagesource: "source", amount: "amount" });
  if (immune.length || hurt) {
    // A logic procedure decides: false cancels the damage before vanilla handles it; any other return type only runs.
    const hurtLine = hurt ? (procedureReturnType(env, e.whenMobIsHurt) === "logic" ? `        if (!${hurt}) return false;\n` : `        ${hurt};\n`) : "";
    const body = `${immune.length ? `        if (${immune.join(" || ")}) return false;\n` : ""}${hurtLine}`;
    members.push(legacy
      ? `    @Override\n    public boolean hurt(${n.source} source, float amount) {\n${body}        return super.hurt(source, amount);\n    }`
      : `    @Override\n    public boolean hurtServer(${n.server} world, ${n.source} source, float amount) {\n${body}        return super.hurtServer(world, source, amount);\n    }`);
  }
  if (e.immuneToExplosion === true && !legacy) members.push(`    @Override\n    public boolean ignoreExplosion(net.minecraft.world.level.Explosion explosion) {\n        return true;\n    }`);

  // ---- Events
  const dies = call("whenMobDies", { ...at, sourceentity: "source.getEntity()", immediatesourceentity: "source.getDirectEntity()", damagesource: "source" });
  if (dies) members.push(`    @Override\n    public void die(${n.source} source) {\n        super.die(source);\n        ${dies};\n    }`);
  const spawned = call("onInitialSpawn", { ...at, world: "world" });
  if (spawned) {
    members.push(legacy
      ? `    @Override\n    public net.minecraft.entity.ILivingEntityData finalizeSpawn(net.minecraft.world.IServerWorld world, net.minecraft.world.DifficultyInstance difficulty, net.minecraft.entity.SpawnReason reason, net.minecraft.entity.ILivingEntityData data, net.minecraft.nbt.CompoundNBT tag) {\n        net.minecraft.entity.ILivingEntityData result = super.finalizeSpawn(world, difficulty, reason, data, tag);\n        ${spawned};\n        return result;\n    }`
      : `    @Override\n    public net.minecraft.world.entity.SpawnGroupData finalizeSpawn(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.DifficultyInstance difficulty, net.minecraft.world.entity.EntitySpawnReason reason, net.minecraft.world.entity.SpawnGroupData data) {\n        net.minecraft.world.entity.SpawnGroupData result = super.finalizeSpawn(world, difficulty, reason, data);\n        ${spawned};\n        return result;\n    }`);
  }
  const tick = call("onMobTickUpdate", at);
  if (tick || boxProc) members.push(`    @Override\n    public void baseTick() {\n        super.baseTick();${tick ? `\n        ${tick};` : ""}${boxProc ? "\n        this.refreshDimensions();" : ""}\n    }`);
  const touch = call("onPlayerCollidesWith", { ...at, sourceentity: "player" });
  if (touch) members.push(`    @Override\n    public void playerTouch(${n.player} player) {\n        super.playerTouch(player);\n        ${touch};\n    }`);
  const lightning = call("onStruckByLightning", at);
  if (lightning) {
    const bolt = legacy ? "net.minecraft.entity.effect.LightningBoltEntity" : "net.minecraft.world.entity.LightningBolt";
    members.push(`    @Override\n    public void thunderHit(${n.server} world, ${bolt} bolt) {\n        super.thunderHit(world, bolt);\n        ${lightning};\n    }`);
  }
  const kills = call("whenThisMobKillsAnother", { ...at, sourceentity: "this", entity: "victim", damagesource: "source" });
  if (kills) {
    members.push(legacy
      ? `    @Override\n    public void killed(${n.server} world, ${n.living} victim) {\n        super.killed(world, victim);\n        ${procedureCall(env, "living_entity", e, "whenThisMobKillsAnother", { ...at, sourceentity: "this", entity: "victim" })};\n    }`
      : `    @Override\n    public void awardKillScore(${n.entity} victim, ${n.source} source) {\n        super.awardKillScore(victim, source);\n        ${kills};\n    }`);
  }
  const falls = call("whenMobFalls", { ...at, distance: "distance" });
  if (falls || flying) {
    const result = flying ? "false" : legacy ? "super.causeFallDamage(distance, multiplier)" : "super.causeFallDamage(distance, multiplier, source)";
    members.push(legacy
      ? `    @Override\n    public boolean causeFallDamage(float distance, float multiplier) {\n${falls ? `        ${falls};\n` : ""}        return ${result};\n    }`
      : `    @Override\n    public boolean causeFallDamage(double distance, float multiplier, ${n.source} source) {\n${falls ? `        ${falls};\n` : ""}        return ${result};\n    }`);
  }

  // ---- Inventory (bound GUI)
  const gui = str(e.guiBoundTo);
  const guiOk = !!gui && (env.generated.gui ?? []).some((g) => g.id === gui);
  if (gui && !guiOk) warn(`bound GUI "${gui}" is not generated`);
  const invSize = Math.max(1, Math.round(Number(e.inventorySize) || 9));
  if (guiOk) {
    fields.push(`    /** Inventory slots 0..${invSize - 1}, then main hand, off hand, feet, legs, chest and head. */\n    public final Inventory inventory = new Inventory(this, ${invSize}, ${Math.max(1, Math.round(Number(e.inventoryStackSize) || 99))});`);
    members.push(inventoryClass(env, cls));
    const drop = legacy
      ? `    @Override\n    protected void dropEquipment() {\n        super.dropEquipment();\n        for (int i = 0; i < this.inventory.items.size(); i++) {\n            ${n.item}.ItemStack stack = this.inventory.items.get(i);\n            if (!stack.isEmpty() && !net.minecraft.enchantment.EnchantmentHelper.hasVanishingCurse(stack)) this.spawnAtLocation(stack);\n        }\n    }`
      : `    @Override\n    protected void dropEquipment(${n.server} world) {\n        super.dropEquipment(world);\n        for (int i = 0; i < this.inventory.items.size(); i++) {\n            ${n.item}.ItemStack stack = this.inventory.items.get(i);\n            if (!stack.isEmpty() && !net.minecraft.world.item.enchantment.EnchantmentHelper.has(stack, net.minecraft.world.item.enchantment.EnchantmentEffectComponents.PREVENT_EQUIPMENT_DROP)) this.spawnAtLocation(world, stack);\n        }\n    }`;
    members.push(drop);
  }

  // ---- Vibrations (game events came with 1.17)
  const vibrations = e.sensitiveToVibration === true && !legacy;
  if (e.sensitiveToVibration === true && legacy) warn("vibrations (game events) came with 1.17; left out on 1.16.5");
  if (vibrations) {
    interfaces.push("net.minecraft.world.level.gameevent.vibrations.VibrationSystem");
    fields.push("    private final net.minecraft.world.level.gameevent.DynamicGameEventListener<net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Listener> dynamicGameEventListener = new net.minecraft.world.level.gameevent.DynamicGameEventListener<>(new net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Listener(this));");
    fields.push("    private final net.minecraft.world.level.gameevent.vibrations.VibrationSystem.User vibrationUser = new VibrationUser();");
    fields.push("    private net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data vibrationData = new net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data();");
    members.push(vibrationMembers(env, e, cls));
  }

  // ---- Saved data
  const save: string[] = []; const load: string[] = [];
  for (const d of data) {
    const put = d.type === "number" ? "putInt" : d.type === "logic" ? "putBoolean" : "putString";
    save.push(`tag.${put}("Data${d.name}", this.entityData.get(DATA_${d.name}));`);
    if (legacy) {
      const get = d.type === "number" ? "getInt" : d.type === "logic" ? "getBoolean" : "getString";
      load.push(`if (tag.contains("Data${d.name}")) this.entityData.set(DATA_${d.name}, tag.${get}("Data${d.name}"));`);
    } else {
      const get = d.type === "number" ? "getIntOr" : d.type === "logic" ? "getBooleanOr" : "getStringOr";
      load.push(`this.entityData.set(DATA_${d.name}, tag.${get}("Data${d.name}", ${d.value}));`);
    }
  }
  if (guiOk) {
    if (legacy) {
      save.push("tag.put(\"InventoryCustom\", net.minecraft.inventory.ItemStackHelper.saveAllItems(new net.minecraft.nbt.CompoundNBT(), this.inventory.items));");
      load.push("net.minecraft.inventory.ItemStackHelper.loadAllItems(tag.getCompound(\"InventoryCustom\"), this.inventory.items);");
    } else if (v26) {
      save.push("net.minecraft.world.ContainerHelper.saveAllItems(tag.child(\"InventoryCustom\"), this.inventory.items);");
      load.push("tag.child(\"InventoryCustom\").ifPresent(child -> net.minecraft.world.ContainerHelper.loadAllItems(child, this.inventory.items));");
    } else {
      save.push("tag.put(\"InventoryCustom\", net.minecraft.world.ContainerHelper.saveAllItems(new net.minecraft.nbt.CompoundTag(), this.inventory.items, this.registryAccess()));");
      load.push("tag.getCompound(\"InventoryCustom\").ifPresent(child -> net.minecraft.world.ContainerHelper.loadAllItems(child, this.inventory.items, this.registryAccess()));");
    }
  }
  if (vibrations) {
    if (v26) {
      save.push("tag.store(\"listener\", net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data.CODEC, this.vibrationData);");
      load.push("this.vibrationData = tag.read(\"listener\", net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data.CODEC).orElseGet(net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data::new);");
    } else {
      const ops = "this.registryAccess().createSerializationContext(net.minecraft.nbt.NbtOps.INSTANCE)";
      save.push(`tag.store("listener", net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data.CODEC, ${ops}, this.vibrationData);`);
      load.push(`this.vibrationData = tag.read("listener", net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data.CODEC, ${ops}).orElseGet(net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Data::new);`);
    }
  }
  // Loading resets the custom name when the tag has none (/summon too), so the label is applied again.
  if (str(e.mobLabel)) load.push(`if (!this.hasCustomName()) {\n            this.setCustomName(${literal(env, str(e.mobLabel))});\n            this.setCustomNameVisible(true);\n        }`);
  if (save.length || load.length) {
    const [outT, inT, mod] = legacy ? ["net.minecraft.nbt.CompoundNBT", "net.minecraft.nbt.CompoundNBT", "public"] : v26
      ? ["net.minecraft.world.level.storage.ValueOutput", "net.minecraft.world.level.storage.ValueInput", "protected"] : ["net.minecraft.nbt.CompoundTag", "net.minecraft.nbt.CompoundTag", "public"];
    if (save.length) members.push(`    @Override\n    ${mod} void addAdditionalSaveData(${outT} tag) {\n        super.addAdditionalSaveData(tag);\n${save.map((l) => `        ${l}`).join("\n")}\n    }`);
    members.push(`    @Override\n    ${mod} void readAdditionalSaveData(${inT} tag) {\n        super.readAdditionalSaveData(tag);\n${load.map((l) => `        ${l}`).join("\n")}\n    }`);
  }

  // ---- Right click: GUI, taming, riding, procedure
  const clicked = call("onRightClickedOn", { ...at, sourceentity: "player", itemstack: "player.getItemInHand(hand)" });
  const ridable = e.ridable === true;
  if (clicked || ridable || tamable || guiOk) {
    const R = n.result;
    const lines: string[] = [`${n.item}.ItemStack itemstack = player.getItemInHand(hand);`, `${R} result = ${R}.SUCCESS;`];
    if (guiOk) {
      const open = `if (player instanceof ${n.serverPlayer}) ${openGuiCall(env, gui, `(${n.serverPlayer}) player`, "this.blockPosition()", "this.inventory")}`;
      lines.push(ridable ? `if (player.isSecondaryUseActive()) {\n    ${open}\n    return ${R}.SUCCESS;\n}` : open);
    }
    if (tamable) lines.push(...tameCode(env));
    else lines.push("super.mobInteract(player, hand);");
    if (ridable) lines.push("player.startRiding(this);");
    if (clicked) lines.push(`${clicked};`);
    lines.push("return result;");
    members.push(`    @Override\n    public ${R} mobInteract(${n.player} player, ${n.hand} hand) {\n${lines.join("\n").split("\n").map((l) => `        ${l}`).join("\n")}\n    }`);
  }

  // ---- Client tick: vibration ticker and animation timers
  const anims = animationRows(env, e, warn).filter((a) => a.row.walking !== true);
  const animLines: string[] = [];
  if (anims.length) {
    fields.push(`    /** Client: tick each non-walking animation started at, or -1 while its condition is off. */\n    public final int[] mcedgeAnimationStart = new int[] {${list(e.animations).map(() => "-1").join(", ")}};`);
    const entityAt = { x: "this.getX()", y: "this.getY()", z: "this.getZ()", world: level, entity: "this" };
    for (const { row, slot } of anims) {
      const dataName = str(row.syncedDataCondition);
      const cond = dataName
        ? (data.some((d) => d.name === dataName && d.type === "logic") ? `this.entityData.get(DATA_${dataName})` : (warn(`animation condition "${dataName}" is not a logic entity data entry`), "false"))
        : procedureCallById(env, row.condition, entityAt, `living_entity/${e.id}: animation ${str(row.animation)}`, "logic") ?? "true";
      animLines.push(`if (${cond}) { if (this.mcedgeAnimationStart[${slot}] < 0) this.mcedgeAnimationStart[${slot}] = this.tickCount; } else this.mcedgeAnimationStart[${slot}] = -1;`);
    }
  } else if (list(e.animations).length) {
    fields.push(`    public final int[] mcedgeAnimationStart = new int[] {${list(e.animations).map(() => "-1").join(", ")}};`);
  }
  if (vibrations || animLines.length) {
    members.push(`    @Override\n    public void tick() {\n        super.tick();${vibrations ? `\n        if (this.level() instanceof ${n.server} serverLevel) net.minecraft.world.level.gameevent.vibrations.VibrationSystem.Ticker.tick(serverLevel, this.vibrationData, this.vibrationUser);` : ""}${animLines.length ? `\n        if (${level}.isClientSide()) {\n${animLines.map((l) => `            ${l}`).join("\n")}\n        }` : ""}\n    }`);
  }

  // ---- Ranged attack
  if (ranged && base.pathfinder) members.push(rangedAttack(env, e, cls, constant));

  // ---- Breeding
  const typeExpr = entityTypeValue(env, TYPES, constant);
  const create = legacy ? `${typeExpr}.create(world)` : `${typeExpr}.create(world, net.minecraft.world.entity.EntitySpawnReason.BREEDING)`;
  if (e.breedable === true) {
    const food = list<Record<string, unknown>>(e.breedTriggerItems).map((r) => str(r.item)).filter(Boolean);
    members.push(legacy
      ? `    @Override\n    public net.minecraft.entity.AgeableEntity getBreedOffspring(${n.server} world, net.minecraft.entity.AgeableEntity mate) {\n        return ${create};\n    }`
      : `    @Override\n    public net.minecraft.world.entity.AgeableMob getBreedOffspring(${n.server} world, net.minecraft.world.entity.AgeableMob mate) {\n        return ${create};\n    }`);
    const test = food.map((f) => f.startsWith("#") ? (legacy ? `stack.getItem().is(net.minecraft.tags.ItemTags.createOptional(${idExpr(env, qualify(env, f).slice(1))}))` : `stack.is(net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, qualify(env, f).slice(1))}))`) : `stack.getItem() == ${itemExpr(env, f)}`);
    members.push(`    @Override\n    public boolean isFood(${n.item}.ItemStack stack) {\n        return ${test.length ? test.join(" || ") : "false"};\n    }`);
  } else if (base.vanilla && AI_BASES[base.vanilla].offspring) {
    // A copied vanilla animal would breed vanilla young; breed this type instead.
    members.push(`    @Override\n    public ${base.cls} getBreedOffspring(${n.server} world, ${legacy ? "net.minecraft.entity.AgeableEntity" : "net.minecraft.world.entity.AgeableMob"} mate) {\n        ${cls} young = ${create};${base.vanilla === "Wolf" ? `\n        if (young != null && this.isTame()) {\n            ${legacy ? "young.setOwnerUUID(this.getOwnerUUID());\n            young.setTame(true);" : "young.setOwnerReference(this.getOwnerReference());\n            young.setTame(true, true);"}\n        }` : ""}\n        return young;\n    }`);
  }

  // ---- Water, fluids, collisions
  if (water) members.push(`    @Override\n    public boolean checkSpawnObstruction(${legacy ? "net.minecraft.world.IWorldReader" : "net.minecraft.world.level.LevelReader"} world) {\n        return world.isUnobstructed(this);\n    }`);
  // 1.21.5 made canBreatheUnderwater final (an entity type tag, see living_entity.ts); NeoForge asks per fluid
  // type there, Fabric through a mixin hook.
  const breatheProc = logicCall("breatheUnderwaterProcedure", at);
  const breathe = breatheProc ?? (e.breatheUnderwater === true ? "true" : undefined);
  if (breathe && env.mc !== "1.21.5") members.push(`    @Override\n    public boolean canBreatheUnderwater() {\n        return ${breathe};\n    }`);
  else if (breatheProc && env.loader === "neoforge") {
    members.push(`    @Override\n    public boolean canDrownInFluidType(net.neoforged.neoforge.fluids.FluidType type) {\n        if (type == net.neoforged.neoforge.common.NeoForgeMod.WATER_TYPE.value()) return !(${breatheProc});\n        return super.canDrownInFluidType(type);\n    }`);
  } else if (breatheProc) {
    interfaces.push(`${pkg}.entity.UnderwaterBreather`);
    members.push(`    @Override\n    public boolean mcedgeCanBreatheUnderwater() {\n        return ${breatheProc};\n    }`);
  }
  const pushed = logicCall("pushedByFluidsProcedure", at) ?? (e.pushedByFluids === false ? "false" : undefined);
  if (pushed) members.push(`    @Override\n    public boolean isPushedByFluid() {\n        return ${pushed};\n    }`);
  if (e.disableCollisions === true) {
    members.push("    @Override\n    public boolean isPushable() {\n        return false;\n    }");
    members.push(`    @Override\n    protected void doPush(${n.entity} entity) {\n    }`);
    members.push("    @Override\n    protected void pushEntities() {\n    }");
  }
  const solid = logicCall("solidBoundingBoxProcedure", at) ?? (e.solidBoundingBox === true ? "true" : undefined);
  if (solid) {
    members.push(`    @Override\n    public boolean canCollideWith(${n.entity} entity) {\n        return true;\n    }`);
    members.push(v26
      ? `    @Override\n    public boolean canBeCollidedWith(${n.entity} other) {\n        return ${solid};\n    }`
      : `    @Override\n    public boolean canBeCollidedWith() {\n        return ${solid};\n    }`);
  }
  if (boxProc || boxScale !== 1) {
    const scale = boxProc ? `(float) (${boxProc})` : jfloat(boxScale);
    members.push(legacy
      ? `    @Override\n    public net.minecraft.entity.EntitySize getDimensions(net.minecraft.entity.Pose pose) {\n        return super.getDimensions(pose).scale(${scale});\n    }`
      : `    @Override\n    protected net.minecraft.world.entity.EntityDimensions getDefaultDimensions(net.minecraft.world.entity.Pose pose) {\n        return super.getDefaultDimensions(pose).scale(${scale});\n    }`);
  }

  // ---- Flying
  if (flying) {
    members.push(`    @Override\n    protected void checkFallDamage(double y, boolean onGround, ${n.state} state, ${n.pos} pos) {\n    }`);
    members.push("    @Override\n    public void setNoGravity(boolean ignored) {\n        super.setNoGravity(true);\n    }");
    members.push("    @Override\n    public void aiStep() {\n        super.aiStep();\n        this.setNoGravity(true);\n    }");
    if (!legacy) members.push(`    @Override\n    protected float getFlyingSpeed() {\n        return (float) this.getAttributeValue(${n.attrs}.FLYING_SPEED);\n    }`);
  }

  // ---- Riding control
  if (ridable && (e.canControlForward === true || e.canControlStrafe === true)) members.push(travel(env, e));

  // ---- 1.16.5 creature type and spawn packet
  if (legacy && str(e.mobCreatureType) && str(e.mobCreatureType) !== "UNDEFINED") {
    members.push(`    @Override\n    public net.minecraft.entity.CreatureAttribute getMobType() {\n        return net.minecraft.entity.CreatureAttribute.${str(e.mobCreatureType)};\n    }`);
  }
  if (legacy) members.push(`    @Override\n    public net.minecraft.network.IPacket<?> getAddEntityPacket() {\n        return net.minecraftforge.fml.network.NetworkHooks.getEntitySpawningPacket(this);\n    }`);

  // ---- Boss bar
  if (e.isBoss === true) {
    const event = legacy ? "net.minecraft.world.server.ServerBossInfo" : "net.minecraft.server.level.ServerBossEvent";
    const info = legacy ? "net.minecraft.world.BossInfo" : "net.minecraft.world.BossEvent";
    const overlay = ["PROGRESS", "NOTCHED_6", "NOTCHED_10", "NOTCHED_12", "NOTCHED_20"].includes(str(e.bossBarType)) ? str(e.bossBarType) : "PROGRESS";
    fields.push(`    private final ${event} bossInfo = new ${event}(${v26 ? "java.util.UUID.randomUUID(), " : ""}this.getDisplayName(), ${info}.${legacy ? "Color" : "BossBarColor"}.${str(e.bossBarColor) || "PINK"}, ${info}.${legacy ? "Overlay" : "BossBarOverlay"}.${overlay});`);
    members.push(`    @Override\n    public void startSeenByPlayer(${n.serverPlayer} player) {\n        super.startSeenByPlayer(player);\n        this.bossInfo.addPlayer(player);\n    }`);
    members.push(`    @Override\n    public void stopSeenByPlayer(${n.serverPlayer} player) {\n        super.stopSeenByPlayer(player);\n        this.bossInfo.removePlayer(player);\n    }`);
    members.push(legacy
      ? "    @Override\n    protected void customServerAiStep() {\n        super.customServerAiStep();\n        this.bossInfo.setPercent(this.getHealth() / this.getMaxHealth());\n    }"
      : `    @Override\n    protected void customServerAiStep(${n.server} world) {\n        super.customServerAiStep(world);\n        this.bossInfo.setProgress(this.getHealth() / this.getMaxHealth());\n    }`);
  }

  members.unshift(`    public static ${legacy ? "net.minecraft.entity.ai.attributes.AttributeModifierMap.MutableAttribute" : "net.minecraft.world.entity.ai.attributes.AttributeSupplier.Builder"} createAttributes() {\n        return ${attributes(env, e, base, goals.blocks)};\n    }`);

  const typeParam = `${n.entityType}<? extends ${base.cls}>`;
  const code = `package ${pkg}.entity;

/** Generated by MCEdge. */
public class ${cls} extends ${base.cls}${interfaces.length ? ` implements ${interfaces.join(", ")}` : ""} {
${fields.join("\n")}${fields.length ? "\n\n" : ""}    public ${cls}(${typeParam} type, ${n.world} world) {
        super(type, world);
${ctor.map((l) => `        ${l}`).join("\n")}
    }

${members.join("\n\n")}
}
`;
  return {
    source: { path: `${pkg.replaceAll(".", "/")}/entity/${cls}.java`, code },
    projectile: ranged && base.pathfinder && str(e.rangedItemType || "Default item") === "Default item" && str(e.rangedAttackItem) ? projectileSource(env, e, cls) : undefined,
    goals: goals.blocks,
  };
}

/** Move control of water mobs: swims toward the path target in three dimensions. */
function waterMovement(env: GenEnv, cls: string): string[] {
  const legacy = legacyOf(env);
  const n = names(env);
  const M = legacy ? "net.minecraft.entity.ai.controller.MovementController" : "net.minecraft.world.entity.ai.control.MoveControl";
  const self = `${cls}.this`;
  const yRot = legacy ? `${self}.yRot` : `${self}.getYRot()`;
  const xRot = legacy ? `${self}.xRot` : `${self}.getXRot()`;
  const setY = (v: string) => (legacy ? `${self}.yRot = ${v};` : `${self}.setYRot(${v});`);
  const setX = (v: string) => (legacy ? `${self}.xRot = ${v};` : `${self}.setXRot(${v});`);
  const Mth = legacy ? "net.minecraft.util.math.MathHelper" : "net.minecraft.util.Mth";
  return [
    `this.setPathfindingMalus(${legacy ? "net.minecraft.pathfinding.PathNodeType" : "net.minecraft.world.level.pathfinder.PathType"}.WATER, 0.0F);`,
    `this.moveControl = new ${M}(this) {
            @Override
            public void tick() {
                if (${self}.isInWater()) ${self}.setDeltaMovement(${self}.getDeltaMovement().add(0.0, 0.005, 0.0));
                if (this.operation == ${M}.${legacy ? "Action" : "Operation"}.MOVE_TO && !${self}.getNavigation().isDone()) {
                    double dx = this.wantedX - ${self}.getX();
                    double dy = this.wantedY - ${self}.getY();
                    double dz = this.wantedZ - ${self}.getZ();
                    float yaw = (float) (${Mth}.atan2(dz, dx) * (180.0 / Math.PI)) - 90.0F;
                    float speed = (float) (this.speedModifier * ${self}.getAttribute(${n.attrs}.MOVEMENT_SPEED).getValue());
                    ${setY(`this.rotlerp(${yRot}, yaw, 10.0F)`)}
                    ${self}.yBodyRot = ${yRot};
                    ${self}.yHeadRot = ${yRot};
                    if (${self}.isInWater()) {
                        ${self}.setSpeed((float) ${self}.getAttribute(${n.attrs}.MOVEMENT_SPEED).getValue());
                        float pitch = ${Mth}.clamp(${Mth}.wrapDegrees(-(float) (${Mth}.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * (180.0 / Math.PI))), -85.0F, 85.0F);
                        ${setX(`this.rotlerp(${xRot}, pitch, 5.0F)`)}
                        float cos = ${Mth}.cos(${xRot} * (float) (Math.PI / 180.0));
                        ${self}.setZza(cos * speed);
                        ${self}.setYya((float) (speed * dy));
                    } else {
                        ${self}.setSpeed(speed * 0.05F);
                    }
                } else {
                    ${self}.setSpeed(0.0F);
                    ${self}.setYya(0.0F);
                    ${self}.setZza(0.0F);
                }
            }
        };`,
  ];
}

function tameCode(env: GenEnv): string[] {
  const legacy = legacyOf(env);
  const n = names(env);
  const R = n.result;
  const level = legacy ? "this.level" : "this.level()";
  const use = legacy ? "this.usePlayerItem(player, itemstack);" : "this.usePlayerItem(player, hand, itemstack);";
  const nutrition = legacy
    ? "itemstack.getItem().getFoodProperties() != null ? (float) itemstack.getItem().getFoodProperties().getNutrition() : 1.0F"
    : "itemstack.get(net.minecraft.core.component.DataComponents.FOOD) != null ? (float) itemstack.get(net.minecraft.core.component.DataComponents.FOOD).nutrition() : 1.0F";
  const vetoed = env.loader === "forge" ? "net.minecraftforge.event.ForgeEventFactory.onAnimalTame(this, player)"
    : env.loader === "neoforge" ? "net.neoforged.neoforge.event.EventHooks.onAnimalTame(this, player)" : "false";
  return `if (itemstack.getItem() instanceof ${n.item}.SpawnEggItem) {
    result = super.mobInteract(player, hand);
} else if (${level}.isClientSide()) {
    result = (this.isTame() && this.isOwnedBy(player)) || this.isFood(itemstack) ? ${R}.SUCCESS : ${R}.PASS;
} else if (this.isTame()) {
    if (this.isOwnedBy(player) && this.isFood(itemstack) && this.getHealth() < this.getMaxHealth()) {
        ${use}
        this.heal(${nutrition});
        result = ${R}.SUCCESS;
    } else {
        result = super.mobInteract(player, hand);
    }
} else if (this.isFood(itemstack)) {
    ${use}
    if (this.random.nextInt(3) == 0 && !${vetoed}) {
        this.tame(player);
        ${level}.broadcastEntityEvent(this, (byte) 7);
    } else {
        ${level}.broadcastEntityEvent(this, (byte) 6);
    }
    this.setPersistenceRequired();
    result = ${R}.SUCCESS;
} else {
    result = super.mobInteract(player, hand);
    if (result == ${R}.SUCCESS || result == ${R}.CONSUME) this.setPersistenceRequired();
}`.split("\n");
}

function travel(env: GenEnv, e: Element): string {
  const legacy = legacyOf(env);
  const n = names(env);
  const fwd = e.canControlForward === true; const side = e.canControlStrafe === true;
  if (legacy) {
    return `    @Override
    public void travel(${n.vec} direction) {
        ${n.entity} rider = this.getPassengers().isEmpty() ? null : this.getPassengers().get(0);
        if (this.isVehicle() && rider instanceof ${n.living}) {
            this.yRot = rider.yRot;
            this.yRotO = this.yRot;
            this.xRot = rider.xRot * 0.5F;
            this.setRot(this.yRot, this.xRot);
            this.yBodyRot = rider.yRot;
            this.yHeadRot = rider.yRot;
            this.setSpeed((float) this.getAttributeValue(${n.attrs}.MOVEMENT_SPEED));
            float forward = ${fwd ? `((${n.living}) rider).zza` : "0.0F"};
            float strafe = ${side ? `((${n.living}) rider).xxa` : "0.0F"};
            super.travel(new ${n.vec}(strafe, 0.0, forward));
            this.calculateEntityAnimation(this, false);
            return;
        }
        super.travel(direction);
    }`;
  }
  return `    @Override
    public void travel(${n.vec} direction) {
        ${n.entity} rider = this.getPassengers().isEmpty() ? null : this.getPassengers().get(0);
        if (this.isVehicle() && rider != null) {
            this.setYRot(rider.getYRot());
            this.yRotO = this.getYRot();
            this.setXRot(rider.getXRot() * 0.5F);
            this.setRot(this.getYRot(), this.getXRot());
            this.yBodyRot = rider.getYRot();
            this.yHeadRot = rider.getYRot();
            if (rider instanceof ${n.serverPlayer} passenger) {
                this.setSpeed((float) this.getAttributeValue(${n.attrs}.MOVEMENT_SPEED));
                float forward = ${fwd ? "passenger.getLastClientInput().forward() == passenger.getLastClientInput().backward() ? 0.0F : (passenger.getLastClientInput().forward() ? 1.0F : -1.0F)" : "0.0F"};
                float strafe = ${side ? "passenger.getLastClientInput().left() == passenger.getLastClientInput().right() ? 0.0F : (passenger.getLastClientInput().left() ? 1.0F : -1.0F)" : "0.0F"};
                super.travel(new ${n.vec}(strafe, 0.0, forward));
            }
            this.calculateEntityAnimation(true);
            return;
        }
        super.travel(direction);
    }`;
}

function rangedAttack(env: GenEnv, e: Element, cls: string, constant: string): string {
  const legacy = legacyOf(env);
  const n = names(env);
  const level = legacy ? "this.level" : "this.level()";
  const kind = str(e.rangedItemType) || "Default item";
  let body: string;
  if (kind !== "Default item") {
    const projectiles = env.generated.projectile ?? [];
    if (projectiles.some((p) => p.id === kind)) body = `${env.project.mod.package}.entity.${pascal(kind)}Projectile.shoot(this, target);`;
    else {
      buildWarning(env, `living_entity/${e.id}: ranged projectile "${kind}" is not generated; arrows are shot`);
      body = arrow();
    }
  } else body = arrow();
  function arrow(): string {
    const create = str(e.rangedAttackItem)
      ? `${projectileClass(cls)} projectile = new ${projectileClass(cls)}(${entityTypeValue(env, TYPES, derivedConstant(constant, "Projectile"))}, this, ${level});`
      : legacy ? `net.minecraft.entity.projectile.ArrowEntity projectile = new net.minecraft.entity.projectile.ArrowEntity(${level}, this);`
        : `${env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.Arrow" : "net.minecraft.world.entity.projectile.Arrow"} projectile = new ${env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.Arrow" : "net.minecraft.world.entity.projectile.Arrow"}(${level}, this, new ${n.item}.ItemStack(${n.item}.Items.ARROW), null);`;
    return `${create}
        double dy = target.getY() + target.getEyeHeight() - 1.1;
        double dx = target.getX() - this.getX();
        double dz = target.getZ() - this.getZ();
        projectile.shoot(dx, dy - projectile.getY() + Math.sqrt(dx * dx + dz * dz) * 0.2F, dz, 1.6F, 12.0F);
        ${level}.addFreshEntity(projectile);`;
  }
  return `    @Override\n    public void performRangedAttack(${n.living} target, float power) {\n        ${body}\n    }`;
}

/** The arrow a ranged mob shoots when its ranged item is a plain item: drawn as that item. */
function projectileSource(env: GenEnv, e: Element, cls: string): JavaSourceFile {
  const legacy = legacyOf(env);
  const pkg = env.project.mod.package;
  const name = projectileClass(cls);
  const base = legacy ? "net.minecraft.entity.projectile.AbstractArrowEntity" : env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.AbstractArrow" : "net.minecraft.world.entity.projectile.AbstractArrow";
  const supplier = legacy ? "net.minecraft.entity.IRendersAsItem" : "net.minecraft.world.entity.projectile.ItemSupplier";
  const n = names(env);
  const stack = `new ${n.item}.ItemStack(${itemExpr(env, str(e.rangedAttackItem))})`;
  const type = `${n.entityType}<? extends ${name}>`;
  const code = `package ${pkg}.entity;

/** Generated by MCEdge: the item ${cls} shoots. */${legacy ? "\n@net.minecraftforge.api.distmarker.OnlyIn(value = net.minecraftforge.api.distmarker.Dist.CLIENT, _interface = net.minecraft.entity.IRendersAsItem.class)" : ""}
public class ${name} extends ${base} implements ${supplier} {
    public ${name}(${type} type, ${n.world} world) {
        super(type, world);
    }

    public ${name}(${type} type, ${n.living} shooter, ${n.world} world) {
        super(type, ${legacy ? "shooter, world" : "world"});
        ${legacy ? "" : "this.setOwner(shooter);\n        this.setPos(shooter.getX(), shooter.getEyeY() - 0.1, shooter.getZ());"}
    }

    @Override
    public ${n.item}.ItemStack getItem() {
        return ${stack};
    }

    @Override
    protected ${n.item}.ItemStack ${legacy ? "getPickupItem" : "getDefaultPickupItem"}() {
        return ${stack};
    }

    @Override
    public void tick() {
        super.tick();
        if (${legacy ? "this.inGround" : "this.isInGround()"}) this.${legacy ? "remove" : "discard"}();
    }
${legacy ? `
    @Override
    public net.minecraft.network.IPacket<?> getAddEntityPacket() {
        return net.minecraftforge.fml.network.NetworkHooks.getEntitySpawningPacket(this);
    }
` : ""}}
`;
  return { path: `${pkg.replaceAll(".", "/")}/entity/${name}.java`, code };
}

/** Inventory of a mob with a bound GUI: its own slots plus its hands and armor. */
function inventoryClass(env: GenEnv, cls: string): string {
  const n = names(env);
  const S = `${n.item}.ItemStack`;
  const slots = ["MAINHAND", "OFFHAND", "FEET", "LEGS", "CHEST", "HEAD"].map((s) => `${n.slot}.${s}`).join(", ");
  return `    public static class Inventory implements ${n.container} {
        private static final ${n.slot}[] EQUIPMENT = {${slots}};
        private final ${cls} mob;
        private final int maxStack;
        public final ${n.nonNull}<${S}> items;

        public Inventory(${cls} mob, int size, int maxStack) {
            this.mob = mob;
            this.maxStack = maxStack;
            this.items = ${n.nonNull}.withSize(size, ${S}.EMPTY);
        }

        @Override
        public int getContainerSize() {
            return this.items.size() + EQUIPMENT.length;
        }

        @Override
        public boolean isEmpty() {
            for (int i = 0; i < this.getContainerSize(); i++) if (!this.getItem(i).isEmpty()) return false;
            return true;
        }

        @Override
        public ${S} getItem(int slot) {
            if (slot < 0 || slot >= this.getContainerSize()) return ${S}.EMPTY;
            return slot < this.items.size() ? this.items.get(slot) : this.mob.getItemBySlot(EQUIPMENT[slot - this.items.size()]);
        }

        @Override
        public ${S} removeItem(int slot, int count) {
            ${S} stack = this.getItem(slot);
            if (stack.isEmpty() || count <= 0) return ${S}.EMPTY;
            ${S} taken = stack.split(count);
            this.setChanged();
            return taken;
        }

        @Override
        public ${S} removeItemNoUpdate(int slot) {
            ${S} stack = this.getItem(slot);
            this.setItem(slot, ${S}.EMPTY);
            return stack;
        }

        @Override
        public void setItem(int slot, ${S} stack) {
            if (slot < 0 || slot >= this.getContainerSize()) return;
            if (slot < this.items.size()) this.items.set(slot, stack);
            else this.mob.setItemSlot(EQUIPMENT[slot - this.items.size()], stack);
            this.setChanged();
        }

        @Override
        public int getMaxStackSize() {
            return this.maxStack;
        }

        @Override
        public void setChanged() {
        }

        @Override
        public boolean stillValid(${n.player} player) {
            return this.mob.isAlive() && player.distanceToSqr(this.mob) < 64.0;
        }

        @Override
        public void clearContent() {
            for (int i = 0; i < this.items.size(); i++) this.items.set(i, ${S}.EMPTY);
        }
    }`;
}

function vibrationMembers(env: GenEnv, e: Element, cls: string): string {
  const n = names(env);
  const V = "net.minecraft.world.level.gameevent.vibrations.VibrationSystem";
  const GE = "net.minecraft.world.level.gameevent.GameEvent";
  const at = { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "entity.level()", entity: "entity" };
  const radiusProc = procedureCallById(env, e.vibrationSensitivityRadiusProcedure, at, `living_entity/${e.id}: vibrationSensitivityRadiusProcedure`, "number");
  const vib = { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "world", entity: "entity", vibrationX: "vibrationPos.getX()", vibrationY: "vibrationPos.getY()", vibrationZ: "vibrationPos.getZ()" } as Record<string, string>;
  const can = procedureCallById(env, e.canReceiveVibrationCondition, { ...vib, sourceentity: "context.sourceEntity()" }, `living_entity/${e.id}: canReceiveVibrationCondition`, "logic");
  const received = procedureCall(env, "living_entity", e, "onReceivedVibration", { ...vib, sourceentity: "source", immediatesourceentity: "projectileOwner", distance: "distance" });
  const events = list<Record<string, unknown>>(e.vibrationalEvents).map((r) => str(r.event)).filter(Boolean);
  return `    @Override
    public void updateDynamicGameEventListener(java.util.function.BiConsumer<net.minecraft.world.level.gameevent.DynamicGameEventListener<?>, ${n.server}> consumer) {
        if (this.level() instanceof ${n.server} serverLevel) consumer.accept(this.dynamicGameEventListener, serverLevel);
    }

    @Override
    public ${V}.Data getVibrationData() {
        return this.vibrationData;
    }

    @Override
    public ${V}.User getVibrationUser() {
        return this.vibrationUser;
    }

    private class VibrationUser implements ${V}.User {
        private final ${cls} entity = ${cls}.this;
        private final net.minecraft.world.level.gameevent.PositionSource positionSource = new net.minecraft.world.level.gameevent.EntityPositionSource(${cls}.this, ${cls}.this.getEyeHeight());

        @Override
        public net.minecraft.world.level.gameevent.PositionSource getPositionSource() {
            return this.positionSource;
        }
${events.length ? `
        @Override
        public net.minecraft.tags.TagKey<${GE}> getListenableEvents() {
            return net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.GAME_EVENT, ${idExpr(env, `${env.modId}:${e.id}_can_listen`)});
        }
` : ""}
        @Override
        public int getListenerRadius() {
            return ${radiusProc ? `(int) (${radiusProc})` : Math.round(Number(e.vibrationSensitivityRadius) || 7)};
        }

        @Override
        public boolean canReceiveVibration(${n.server} world, ${n.pos} vibrationPos, net.minecraft.core.Holder<${GE}> event, ${GE}.Context context) {
            return ${can ?? "true"};
        }

        @Override
        public void onReceiveVibration(${n.server} world, ${n.pos} vibrationPos, net.minecraft.core.Holder<${GE}> event, ${n.entity} source, ${n.entity} projectileOwner, float distance) {
            ${received ? `${received};` : ""}
        }
    }`;
}
