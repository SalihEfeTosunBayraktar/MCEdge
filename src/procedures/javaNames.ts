/**
 * Minecraft class names per generation. Block code writes `j.Player` and gets the simple name; the compiler
 * collects the imports. 1.16.5 (Forge, official mappings) keeps the MCP class names while method names are
 * Mojang's, so most code is shared and only class names change.
 */
export type Gen = "1.16.5" | "1.21.5" | "26.3";

const MODERN: Record<string, string> = {
  Entity: "net.minecraft.world.entity.Entity",
  Animal: "net.minecraft.world.entity.animal.Animal",
  Monster: "net.minecraft.world.entity.monster.Monster",
  BlockEntity: "net.minecraft.world.level.block.entity.BlockEntity",
  LivingEntity: "net.minecraft.world.entity.LivingEntity",
  Mob: "net.minecraft.world.entity.Mob",
  TamableAnimal: "net.minecraft.world.entity.TamableAnimal",
  AgeableMob: "net.minecraft.world.entity.AgeableMob",
  Player: "net.minecraft.world.entity.player.Player",
  ServerPlayer: "net.minecraft.server.level.ServerPlayer",
  LevelAccessor: "net.minecraft.world.level.LevelAccessor",
  Level: "net.minecraft.world.level.Level",
  ServerLevel: "net.minecraft.server.level.ServerLevel",
  BlockPos: "net.minecraft.core.BlockPos",
  BlockState: "net.minecraft.world.level.block.state.BlockState",
  Block: "net.minecraft.world.level.block.Block",
  Blocks: "net.minecraft.world.level.block.Blocks",
  ItemStack: "net.minecraft.world.item.ItemStack",
  Item: "net.minecraft.world.item.Item",
  Items: "net.minecraft.world.item.Items",
  Direction: "net.minecraft.core.Direction",
  DamageSource: "net.minecraft.world.damagesource.DamageSource",
  InteractionResult: "net.minecraft.world.InteractionResult",
  InteractionHand: "net.minecraft.world.InteractionHand",
  EquipmentSlot: "net.minecraft.world.entity.EquipmentSlot",
  Vec3: "net.minecraft.world.phys.Vec3",
  AABB: "net.minecraft.world.phys.AABB",
  Component: "net.minecraft.network.chat.Component",
  Mth: "net.minecraft.util.Mth",
  MobEffectInstance: "net.minecraft.world.effect.MobEffectInstance",
  SoundSource: "net.minecraft.sounds.SoundSource",
  GameType: "net.minecraft.world.level.GameType",
  ItemEntity: "net.minecraft.world.entity.item.ItemEntity",
  ExperienceOrb: "net.minecraft.world.entity.ExperienceOrb",
  CompoundTag: "net.minecraft.nbt.CompoundTag",
  ParticleOptions: "net.minecraft.core.particles.ParticleOptions",
  SimpleParticleType: "net.minecraft.core.particles.SimpleParticleType",
  EntityType: "net.minecraft.world.entity.EntityType",
  BuiltInRegistries: "net.minecraft.core.registries.BuiltInRegistries",
  Registries: "net.minecraft.core.registries.Registries",
  ResourceKey: "net.minecraft.resources.ResourceKey",
  TagKey: "net.minecraft.tags.TagKey",
  Heightmap: "net.minecraft.world.level.levelgen.Heightmap",
  LightLayer: "net.minecraft.world.level.LightLayer",
  Difficulty: "net.minecraft.world.Difficulty",
  MinecraftServer: "net.minecraft.server.MinecraftServer",
  CommandSourceStack: "net.minecraft.commands.CommandSourceStack",
  Vec2: "net.minecraft.world.phys.Vec2",
  AbstractArrow: "net.minecraft.world.entity.projectile.AbstractArrow",
  Projectile: "net.minecraft.world.entity.projectile.Projectile",
  LightningBolt: "net.minecraft.world.entity.LightningBolt",
  Scoreboard: "net.minecraft.world.scores.Scoreboard",
  Objective: "net.minecraft.world.scores.Objective",
  AdvancementHolder: "net.minecraft.advancements.AdvancementHolder",
  AdvancementProgress: "net.minecraft.advancements.AdvancementProgress",
  BonemealableBlock: "net.minecraft.world.level.block.BonemealableBlock",
  Property: "net.minecraft.world.level.block.state.properties.Property",
  IntegerProperty: "net.minecraft.world.level.block.state.properties.IntegerProperty",
  BooleanProperty: "net.minecraft.world.level.block.state.properties.BooleanProperty",
  EnumProperty: "net.minecraft.world.level.block.state.properties.EnumProperty",
  DirectionProperty: "net.minecraft.world.level.block.state.properties.EnumProperty",
  StringRepresentable: "net.minecraft.util.StringRepresentable",
  Enchantment: "net.minecraft.world.item.enchantment.Enchantment",
  EnchantmentHelper: "net.minecraft.world.item.enchantment.EnchantmentHelper",
  DataComponents: "net.minecraft.core.component.DataComponents",
  CustomData: "net.minecraft.world.item.component.CustomData",
  Holder: "net.minecraft.core.Holder",
  DamageTypes: "net.minecraft.world.damagesource.DamageTypes",
  GameRules: "net.minecraft.world.level.GameRules",
  Explosion: "net.minecraft.world.level.Explosion",
  MobSpawnType: "net.minecraft.world.entity.EntitySpawnReason",
  EntitySpawnReason: "net.minecraft.world.entity.EntitySpawnReason",
  ClipContext: "net.minecraft.world.level.ClipContext",
  HitResult: "net.minecraft.world.phys.HitResult",
  BlockHitResult: "net.minecraft.world.phys.BlockHitResult",
  Minecraft: "net.minecraft.client.Minecraft",
  RandomSource: "net.minecraft.util.RandomSource",
  SoundEvent: "net.minecraft.sounds.SoundEvent",
  Biome: "net.minecraft.world.level.biome.Biome",
  ChatFormatting: "net.minecraft.ChatFormatting",
  ClientboundSetTitleTextPacket: "net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket",
  ClientboundSetSubtitleTextPacket: "net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket",
  FallingBlockEntity: "net.minecraft.world.entity.item.FallingBlockEntity",
  PrimedTnt: "net.minecraft.world.entity.item.PrimedTnt",
  Attributes: "net.minecraft.world.entity.ai.attributes.Attributes",
  Fluids: "net.minecraft.world.level.material.Fluids",
  FluidState: "net.minecraft.world.level.material.FluidState",
  BlockTags: "net.minecraft.tags.BlockTags",
  ItemTags: "net.minecraft.tags.ItemTags",
};

const LEGACY: Record<string, string> = {
  Entity: "net.minecraft.entity.Entity",
  Animal: "net.minecraft.entity.passive.AnimalEntity",
  Monster: "net.minecraft.entity.monster.MonsterEntity",
  BlockEntity: "net.minecraft.tileentity.TileEntity",
  LivingEntity: "net.minecraft.entity.LivingEntity",
  Mob: "net.minecraft.entity.MobEntity",
  TamableAnimal: "net.minecraft.entity.passive.TameableEntity",
  AgeableMob: "net.minecraft.entity.AgeableEntity",
  Player: "net.minecraft.entity.player.PlayerEntity",
  ServerPlayer: "net.minecraft.entity.player.ServerPlayerEntity",
  LevelAccessor: "net.minecraft.world.IWorld",
  Level: "net.minecraft.world.World",
  ServerLevel: "net.minecraft.world.server.ServerWorld",
  BlockPos: "net.minecraft.util.math.BlockPos",
  BlockState: "net.minecraft.block.BlockState",
  Block: "net.minecraft.block.Block",
  Blocks: "net.minecraft.block.Blocks",
  ItemStack: "net.minecraft.item.ItemStack",
  Item: "net.minecraft.item.Item",
  Items: "net.minecraft.item.Items",
  Direction: "net.minecraft.util.Direction",
  DamageSource: "net.minecraft.util.DamageSource",
  InteractionResult: "net.minecraft.util.ActionResultType",
  InteractionHand: "net.minecraft.util.Hand",
  EquipmentSlot: "net.minecraft.inventory.EquipmentSlotType",
  Vec3: "net.minecraft.util.math.vector.Vector3d",
  AABB: "net.minecraft.util.math.AxisAlignedBB",
  Component: "net.minecraft.util.text.ITextComponent",
  StringTextComponent: "net.minecraft.util.text.StringTextComponent",
  Mth: "net.minecraft.util.math.MathHelper",
  MobEffectInstance: "net.minecraft.potion.EffectInstance",
  SoundSource: "net.minecraft.util.SoundCategory",
  GameType: "net.minecraft.world.GameType",
  ItemEntity: "net.minecraft.entity.item.ItemEntity",
  ExperienceOrb: "net.minecraft.entity.item.ExperienceOrbEntity",
  CompoundTag: "net.minecraft.nbt.CompoundNBT",
  ParticleOptions: "net.minecraft.particles.IParticleData",
  SimpleParticleType: "net.minecraft.particles.BasicParticleType",
  EntityType: "net.minecraft.entity.EntityType",
  ForgeRegistries: "net.minecraftforge.registries.ForgeRegistries",
  ResourceKey: "net.minecraft.util.RegistryKey",
  Heightmap: "net.minecraft.world.gen.Heightmap",
  LightLayer: "net.minecraft.world.LightType",
  Difficulty: "net.minecraft.world.Difficulty",
  MinecraftServer: "net.minecraft.server.MinecraftServer",
  CommandSourceStack: "net.minecraft.command.CommandSource",
  Vec2: "net.minecraft.util.math.vector.Vector2f",
  AbstractArrow: "net.minecraft.entity.projectile.AbstractArrowEntity",
  Projectile: "net.minecraft.entity.projectile.ProjectileEntity",
  LightningBolt: "net.minecraft.entity.effect.LightningBoltEntity",
  Scoreboard: "net.minecraft.scoreboard.Scoreboard",
  Objective: "net.minecraft.scoreboard.ScoreObjective",
  Advancement: "net.minecraft.advancements.Advancement",
  AdvancementProgress: "net.minecraft.advancements.AdvancementProgress",
  BonemealableBlock: "net.minecraft.block.IGrowable",
  Property: "net.minecraft.state.Property",
  IntegerProperty: "net.minecraft.state.IntegerProperty",
  BooleanProperty: "net.minecraft.state.BooleanProperty",
  EnumProperty: "net.minecraft.state.EnumProperty",
  DirectionProperty: "net.minecraft.state.DirectionProperty",
  StringRepresentable: "net.minecraft.util.IStringSerializable",
  Enchantment: "net.minecraft.enchantment.Enchantment",
  EnchantmentHelper: "net.minecraft.enchantment.EnchantmentHelper",
  GameRules: "net.minecraft.world.GameRules",
  Explosion: "net.minecraft.world.Explosion",
  MobSpawnType: "net.minecraft.entity.SpawnReason",
  ClipContext: "net.minecraft.util.math.RayTraceContext",
  HitResult: "net.minecraft.util.math.RayTraceResult",
  BlockHitResult: "net.minecraft.util.math.BlockRayTraceResult",
  Minecraft: "net.minecraft.client.Minecraft",
  RandomSource: "java.util.Random",
  SoundEvent: "net.minecraft.util.SoundEvent",
  Biome: "net.minecraft.world.biome.Biome",
  ChatFormatting: "net.minecraft.util.text.TextFormatting",
  ClientboundSetTitleTextPacket: "net.minecraft.network.play.server.STitlePacket",
  FallingBlockEntity: "net.minecraft.entity.item.FallingBlockEntity",
  PrimedTnt: "net.minecraft.entity.item.TNTEntity",
  Attributes: "net.minecraft.entity.ai.attributes.Attributes",
  Fluids: "net.minecraft.fluid.Fluids",
  FluidState: "net.minecraft.fluid.FluidState",
  BlockTags: "net.minecraft.tags.BlockTags",
  ItemTags: "net.minecraft.tags.ItemTags",
  ITag: "net.minecraft.tags.ITag",
  RegistryKey: "net.minecraft.util.RegistryKey",
  Registry: "net.minecraft.util.registry.Registry",
};

const GEN_26: Record<string, string> = {
  // 26.x moved GameRules into its own package.
  GameRules: "net.minecraft.world.level.gamerules.GameRules",
  AbstractArrow: "net.minecraft.world.entity.projectile.arrow.AbstractArrow",
};

export function qualifiedName(gen: Gen, name: string): string | undefined {
  if (gen === "1.16.5") return LEGACY[name];
  return (gen === "26.3" ? GEN_26[name] : undefined) ?? MODERN[name];
}

/** Collects the imports a piece of generated code uses; `names.X` returns the simple class name. */
export class ImportSet {
  readonly used = new Map<string, string>();
  readonly gen: Gen;

  constructor(gen: Gen) {
    this.gen = gen;
  }

  /** Simple name of a known class, recorded as an import; unknown names are a bug in a block definition. */
  name(alias: string): string {
    const fqn = qualifiedName(this.gen, alias);
    if (!fqn) throw new Error(`no ${this.gen} class for "${alias}"`);
    const simple = fqn.slice(fqn.lastIndexOf(".") + 1);
    const known = this.used.get(simple);
    // Two classes with one simple name (Explosion.Mode vs a mod class) would clash; keep the first, qualify the rest.
    if (known && known !== fqn) return fqn;
    this.used.set(simple, fqn);
    return simple;
  }

  /** Simple name of any fully qualified class (a generated mod class), imported unless the name is taken. */
  qualified(fqn: string): string {
    const simple = fqn.slice(fqn.lastIndexOf(".") + 1);
    const known = this.used.get(simple);
    if (known && known !== fqn) return fqn;
    this.used.set(simple, fqn);
    return simple;
  }

  merge(other: ImportSet): void {
    for (const [simple, fqn] of other.used) if (!this.used.has(simple)) this.used.set(simple, fqn);
  }

  lines(): string {
    return [...new Set(this.used.values())].sort().map((fqn) => `import ${fqn};`).join("\n");
  }

  /** A proxy so code can write `j.Player`. */
  proxy(): Record<string, string> {
    return new Proxy({}, { get: (_t, key) => this.name(String(key)) }) as Record<string, string>;
  }
}
