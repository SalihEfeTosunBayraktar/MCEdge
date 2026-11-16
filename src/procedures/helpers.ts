import type { CodeKey, Loader } from "./blockTypes.ts";
import type { Gen } from "./javaNames.ts";

/**
 * Static Java helpers of generated procedures, emitted into <pkg>.procedures.ProcedureHelpers (or the client-only
 * ProcedureClientHelpers) when a block uses them. They keep block code to one expression per block and hold the
 * version differences that would otherwise repeat in many blocks. `j` gives imported class names; the helper
 * source is one static method (or a few overloads).
 */
export interface HelperDef {
  /** Uses client-only classes: goes into ProcedureClientHelpers. */
  client?: boolean;
  /** Other helpers this one calls. */
  uses?: string[];
  code: Partial<Record<CodeKey, ((j: Record<string, string>) => string) | null>>;
}

type HelperFn = (j: Record<string, string>) => string;
/** 1.16.5 and 1.21.5+ variants; a third one overrides 26.3 (null: not available there). */
const legacyModern = (legacy: HelperFn, modern: HelperFn, v26?: HelperFn | null): HelperDef["code"] =>
  ({ "1.16.5": legacy, modern, ...(v26 !== undefined ? { "26.3": v26 } : {}) });
const all = (fn: (j: Record<string, string>) => string): HelperDef["code"] => ({ all: fn });

/** Cached gameRuleId (Q215): rule name as a procedure gives it -> registered id. */
const ruleIdCache = (j: Record<string, string>) => `private static final java.util.Map<String, String> RULE_IDS = new java.util.concurrent.ConcurrentHashMap<>();
static String gameRuleId(${j.LevelAccessor} world, String rule) {
String id = RULE_IDS.get(rule);
if (id != null) return id;
id = findGameRuleId(world, rule);
if (id != null) RULE_IDS.put(rule, id);
return id;
}`;

/** Types of block data (values procedures keep at a block position): Java type, NBT accessor name, value without data. */
const BLOCK_DATA = {
  number: { name: "Number", java: "double", api: "Double", missing: "-1.0", empty: "0.0" },
  logic: { name: "Logic", java: "boolean", api: "Boolean", missing: "false", empty: "false" },
  text: { name: "Text", java: "String", api: "String", missing: '""', empty: '""' },
};

export function helperCode(def: HelperDef, gen: Gen, loader: Loader): ((j: Record<string, string>) => string) | undefined {
  const keys: CodeKey[] = [`${loader}-${gen}`, loader, gen, ...(gen === "1.16.5" ? [] : ["modern" as const]), "all"];
  for (const key of keys) if (key in def.code) return def.code[key] ?? undefined;
  return undefined;
}

const ID = (gen: "legacy" | "modern" | "26") => (gen === "legacy" ? "new net.minecraft.util.ResourceLocation(id)" : gen === "26" ? "net.minecraft.resources.Identifier.parse(id)" : "net.minecraft.resources.ResourceLocation.parse(id)");

/** placeKeeping from 1.21.5 on: block states list their properties; `load` puts the saved data into the new block entity. */
const placeKeepingModern = (load: string): HelperFn => (j) => `static void placeKeeping(${j.LevelAccessor} world, double x, double y, double z, String id, boolean keepData) {
${j.BlockPos} pos = pos(x, y, z);
${j.BlockState} state = block(id).defaultBlockState();
${j.BlockState} old = world.getBlockState(pos);
for (net.minecraft.world.level.block.state.properties.Property<?> source : old.getProperties()) {
net.minecraft.world.level.block.state.properties.Property property = state.getBlock().getStateDefinition().getProperty(source.getName());
if (property != null && state.getValue(property) != null) {
try {
state = (${j.BlockState}) state.setValue(property, (Comparable) old.getValue(source));
} catch (Exception e) {
}
}
}
${j.BlockEntity} entity = keepData ? world.getBlockEntity(pos) : null;
${j.CompoundTag} data = null;
if (entity != null) {
data = entity.saveWithFullMetadata(world.registryAccess());
entity.setRemoved();
}
world.setBlock(pos, state, 3);
if (data != null) {
${j.BlockEntity} placed = world.getBlockEntity(pos);
if (placed != null) {
try {
${load}
} catch (Exception e) {
}
}
}
}`;

export const HELPERS: Record<string, HelperDef> = {
  // ---- world access ----
  level: {
    code: all((j) => `static ${j.Level} level(${j.LevelAccessor} world) {
return world instanceof ${j.Level} ? (${j.Level}) world : null;
}`),
  },
  serverLevel: {
    code: all((j) => `static ${j.ServerLevel} serverLevel(${j.LevelAccessor} world) {
return world instanceof ${j.ServerLevel} ? (${j.ServerLevel}) world : null;
}`),
  },
  server: {
    code: legacyModern(
      (j) => `static ${j.MinecraftServer} server(${j.LevelAccessor} world) {
return world instanceof ${j.Level} ? ((${j.Level}) world).getServer() : null;
}`,
      (j) => `static ${j.MinecraftServer} server(${j.LevelAccessor} world) {
return world == null ? null : world.getServer();
}`),
  },
  entityLevel: {
    code: legacyModern(
      (j) => `static ${j.Level} entityLevel(${j.Entity} entity) {
return entity == null ? null : entity.level;
}`,
      (j) => `static ${j.Level} entityLevel(${j.Entity} entity) {
return entity == null ? null : entity.level();
}`),
  },
  pos: {
    code: legacyModern(
      (j) => `static ${j.BlockPos} pos(double x, double y, double z) {
return new ${j.BlockPos}(x, y, z);
}`,
      (j) => `static ${j.BlockPos} pos(double x, double y, double z) {
return ${j.BlockPos}.containing(x, y, z);
}`),
  },
  rl: {
    code: { "1.16.5": () => `static net.minecraft.util.ResourceLocation rl(String id) {\nreturn ${ID("legacy")};\n}`, "1.21.5": () => `static net.minecraft.resources.ResourceLocation rl(String id) {\nreturn ${ID("modern")};\n}`, "26.3": () => `static net.minecraft.resources.Identifier rl(String id) {\nreturn ${ID("26")};\n}` },
  },
  component: {
    code: legacyModern(
      (j) => `static ${j.Component} component(String text) {
return new ${j.StringTextComponent}(text);
}`,
      (j) => `static ${j.Component} component(String text) {
return ${j.Component}.literal(text);
}`),
  },
  log: {
    code: legacyModern(
      () => `private static final org.apache.logging.log4j.Logger LOGGER = org.apache.logging.log4j.LogManager.getLogger("procedures");
static void log(String text) {
LOGGER.info(text);
}`,
      () => `private static final org.slf4j.Logger LOGGER = org.slf4j.LoggerFactory.getLogger("procedures");
static void log(String text) {
LOGGER.info(text);
}`),
  },
  numberText: {
    code: all(() => `static String numberText(double value) {
return value == Math.rint(value) && Math.abs(value) < 1e15 ? Long.toString((long) value) : Double.toString(value);
}`),
  },
  textNumber: {
    code: all(() => `static double textNumber(String text) {
try {
return Double.parseDouble(text.trim());
} catch (Exception e) {
return 0;
}
}`),
  },
  randomBetween: {
    code: all(() => `static double randomBetween(double min, double max, boolean whole) {
if (whole) return Math.floor(min + Math.random() * (Math.floor(max) - Math.ceil(min) + 1));
return min + Math.random() * (max - min);
}`),
  },
  // ---- registries ----
  item: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.Item} item(String id) {
${j.Item} item = net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(rl(id));
return item == null ? ${j.Items}.AIR : item;
}`,
      (j) => `static ${j.Item} item(String id) {
return ${j.BuiltInRegistries}.ITEM.getValue(rl(id));
}`),
  },
  block: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.Block} block(String id) {
${j.Block} block = net.minecraftforge.registries.ForgeRegistries.BLOCKS.getValue(rl(id));
return block == null ? ${j.Blocks}.AIR : block;
}`,
      (j) => `static ${j.Block} block(String id) {
return ${j.BuiltInRegistries}.BLOCK.getValue(rl(id));
}`),
  },
  entityType: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.EntityType}<?> entityType(String id) {
return net.minecraftforge.registries.ForgeRegistries.ENTITIES.getValue(rl(id));
}`,
      (j) => `static ${j.EntityType}<?> entityType(String id) {
return ${j.BuiltInRegistries}.ENTITY_TYPE.getValue(rl(id));
}`),
  },
  sound: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.SoundEvent} sound(String id) {
return net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(rl(id));
}`,
      (j) => `static ${j.SoundEvent} sound(String id) {
return ${j.BuiltInRegistries}.SOUND_EVENT.getValue(rl(id));
}`),
  },
  particle: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.ParticleOptions} particle(String id) {
Object type = net.minecraftforge.registries.ForgeRegistries.PARTICLE_TYPES.getValue(rl(id));
return type instanceof ${j.ParticleOptions} ? (${j.ParticleOptions}) type : net.minecraft.particles.ParticleTypes.POOF;
}`,
      (j) => `static ${j.ParticleOptions} particle(String id) {
Object type = ${j.BuiltInRegistries}.PARTICLE_TYPE.getValue(rl(id));
return type instanceof ${j.ParticleOptions} options ? options : net.minecraft.core.particles.ParticleTypes.POOF;
}`),
  },
  itemId: {
    code: legacyModern(
      (j) => `static String itemId(${j.ItemStack} stack) {
return String.valueOf(stack.getItem().getRegistryName());
}`,
      (j) => `static String itemId(${j.ItemStack} stack) {
return ${j.BuiltInRegistries}.ITEM.getKey(stack.getItem()).toString();
}`),
  },
  blockId: {
    code: legacyModern(
      (j) => `static String blockId(${j.BlockState} state) {
return String.valueOf(state.getBlock().getRegistryName());
}`,
      (j) => `static String blockId(${j.BlockState} state) {
return ${j.BuiltInRegistries}.BLOCK.getKey(state.getBlock()).toString();
}`),
  },
  entityId: {
    code: legacyModern(
      (j) => `static String entityId(${j.Entity} entity) {
return entity == null ? "" : String.valueOf(entity.getType().getRegistryName());
}`,
      (j) => `static String entityId(${j.Entity} entity) {
return entity == null ? "" : ${j.EntityType}.getKey(entity.getType()).toString();
}`),
  },
  // ---- tags ----
  blockInTag: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static boolean blockInTag(${j.BlockState} state, String tag) {
return ${j.BlockTags}.getAllTags().getTagOrEmpty(rl(tag)).contains(state.getBlock());
}`,
      (j) => `static boolean blockInTag(${j.BlockState} state, String tag) {
return state.is(${j.TagKey}.create(${j.Registries}.BLOCK, rl(tag)));
}`),
  },
  itemInTag: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static boolean itemInTag(${j.ItemStack} stack, String tag) {
return ${j.ItemTags}.getAllTags().getTagOrEmpty(rl(tag)).contains(stack.getItem());
}`,
      (j) => `static boolean itemInTag(${j.ItemStack} stack, String tag) {
return stack.is(${j.TagKey}.create(${j.Registries}.ITEM, rl(tag)));
}`),
  },
  entityInTag: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static boolean entityInTag(${j.Entity} entity, String tag) {
return entity != null && net.minecraft.tags.EntityTypeTags.getAllTags().getTagOrEmpty(rl(tag)).contains(entity.getType());
}`,
      (j) => `static boolean entityInTag(${j.Entity} entity, String tag) {
return entity != null && entity.getType().builtInRegistryHolder().is(${j.TagKey}.create(${j.Registries}.ENTITY_TYPE, rl(tag)));
}`),
  },
  // ---- chat and text ----
  chat: {
    uses: ["component", "entityLevel"],
    code: {
      all: (j) => `static void chat(${j.Entity} entity, String text, boolean actionbar) {
if (entity instanceof ${j.Player} && !entityLevel(entity).isClientSide()) ((${j.Player}) entity).displayClientMessage(component(text), actionbar);
}`,
      "26.3": (j) => `static void chat(${j.Entity} entity, String text, boolean actionbar) {
if (!(entity instanceof ${j.Player} player) || entityLevel(entity).isClientSide()) return;
if (actionbar) player.sendOverlayMessage(component(text));
else player.sendSystemMessage(component(text));
}`,
    },
  },
  // A translatable component for the client: key and arguments travel in the message, the player's game looks the key up in its own language files.
  translatable: {
    uses: ["numberText"],
    code: legacyModern(
      (j) => `static ${j.Component} translatable(String key, java.util.List<Object> args) {
Object[] values = new Object[args.size()];
for (int i = 0; i < values.length; i++) {
Object value = args.get(i);
values[i] = value instanceof Double ? numberText((Double) value) : value instanceof String || value instanceof ${j.Component} ? value : String.valueOf(value);
}
return new net.minecraft.util.text.TranslationTextComponent(key, values);
}`,
      (j) => `static ${j.Component} translatable(String key, java.util.List<Object> args) {
Object[] values = new Object[args.size()];
for (int i = 0; i < values.length; i++) {
Object value = args.get(i);
values[i] = value instanceof Double d ? numberText(d) : value instanceof String || value instanceof ${j.Component} ? value : String.valueOf(value);
}
return ${j.Component}.translatable(key, values);
}`),
  },
  chatTranslated: {
    uses: ["translatable", "entityLevel"],
    code: {
      all: (j) => `static void chatTranslated(${j.Entity} entity, String key, java.util.List<Object> args, boolean actionbar) {
if (entity instanceof ${j.Player} && !entityLevel(entity).isClientSide()) ((${j.Player}) entity).displayClientMessage(translatable(key, args), actionbar);
}`,
      "26.3": (j) => `static void chatTranslated(${j.Entity} entity, String key, java.util.List<Object> args, boolean actionbar) {
if (!(entity instanceof ${j.Player} player) || entityLevel(entity).isClientSide()) return;
if (actionbar) player.sendOverlayMessage(translatable(key, args));
else player.sendSystemMessage(translatable(key, args));
}`,
    },
  },
  isOp: {
    code: {
      all: (j) => `static boolean isOp(${j.Entity} entity) {
return entity instanceof ${j.Player} && ((${j.Player}) entity).hasPermissions(2);
}`,
      "26.3": (j) => `static boolean isOp(${j.Entity} entity) {
return entity instanceof ${j.Player} player && player.permissions().hasPermission(net.minecraft.server.permissions.Permissions.COMMANDS_GAMEMASTER);
}`,
    },
  },
  raining: {
    uses: ["level"],
    code: all((j) => `static boolean raining(${j.LevelAccessor} world, boolean thunder) {
${j.Level} level = level(world);
return level != null && (thunder ? level.isThundering() : level.isRaining());
}`),
  },
  broadcast: {
    uses: ["server", "component"],
    code: legacyModern(
      (j) => `static void broadcast(${j.LevelAccessor} world, String text) {
${j.MinecraftServer} server = server(world);
if (server != null) server.getPlayerList().broadcastMessage(component(text), net.minecraft.util.text.ChatType.SYSTEM, net.minecraft.util.Util.NIL_UUID);
}`,
      (j) => `static void broadcast(${j.LevelAccessor} world, String text) {
${j.MinecraftServer} server = server(world);
if (server != null) server.getPlayerList().broadcastSystemMessage(component(text), false);
}`),
  },
  title: {
    uses: ["component"],
    code: legacyModern(
      (j) => `static void title(${j.Entity} entity, String title, String subtitle) {
if (!(entity instanceof ${j.ServerPlayer})) return;
${j.ServerPlayer} player = (${j.ServerPlayer}) entity;
player.connection.send(new ${j.ClientboundSetTitleTextPacket}(${j.ClientboundSetTitleTextPacket}.Type.SUBTITLE, component(subtitle)));
player.connection.send(new ${j.ClientboundSetTitleTextPacket}(${j.ClientboundSetTitleTextPacket}.Type.TITLE, component(title)));
}`,
      (j) => `static void title(${j.Entity} entity, String title, String subtitle) {
if (!(entity instanceof ${j.ServerPlayer} player)) return;
player.connection.send(new ${j.ClientboundSetSubtitleTextPacket}(component(subtitle)));
player.connection.send(new ${j.ClientboundSetTitleTextPacket}(component(title)));
}`),
  },
  // ---- commands ----
  runCommand: {
    uses: ["serverLevel", "component"],
    code: legacyModern(
      (j) => `static void runCommand(${j.LevelAccessor} world, double x, double y, double z, String command) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
${j.CommandSourceStack} source = new ${j.CommandSourceStack}(net.minecraft.command.ICommandSource.NULL, new ${j.Vec3}(x, y, z), ${j.Vec2}.ZERO, level, 4, "", component(""), level.getServer(), null).withSuppressedOutput();
level.getServer().getCommands().performCommand(source, command);
}`,
      (j) => `static void runCommand(${j.LevelAccessor} world, double x, double y, double z, String command) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
${j.CommandSourceStack} source = level.getServer().createCommandSourceStack().withPosition(new ${j.Vec3}(x, y, z)).withLevel(level).withSuppressedOutput();
level.getServer().getCommands().performPrefixedCommand(source, command);
}`),
  },
  runCommandAs: {
    uses: ["entityLevel"],
    code: legacyModern(
      (j) => `static void runCommandAs(${j.Entity} entity, String command) {
if (entity == null || entity.level.isClientSide() || entity.getServer() == null) return;
entity.getServer().getCommands().performCommand(entity.createCommandSourceStack().withSuppressedOutput().withPermission(4), command);
}`,
      (j) => `static void runCommandAs(${j.Entity} entity, String command) {
if (entity == null || !(entity.level() instanceof ${j.ServerLevel} level)) return;
level.getServer().getCommands().performPrefixedCommand(entity.createCommandSourceStackForNameResolution(level).withSuppressedOutput().withPermission(4), command);
}`, (j) => `static void runCommandAs(${j.Entity} entity, String command) {
if (entity == null || !(entity.level() instanceof ${j.ServerLevel} level)) return;
level.getServer().getCommands().performPrefixedCommand(entity.createCommandSourceStackForNameResolution(level).withSuppressedOutput().withPermission(net.minecraft.server.permissions.LevelBasedPermissionSet.OWNER), command);
}`),
  },
  // ---- world ----
  setTime: {
    uses: ["serverLevel", "runCommand"],
    code: legacyModern(
      (j) => `static void setTime(${j.LevelAccessor} world, double time) {
${j.ServerLevel} level = serverLevel(world);
if (level != null) level.setDayTime((long) time);
}`,
      (j) => `static void setTime(${j.LevelAccessor} world, double time) {
${j.ServerLevel} level = serverLevel(world);
if (level != null) level.setDayTime((long) time);
}`,
      (j) => `static void setTime(${j.LevelAccessor} world, double time) {
runCommand(world, 0, 0, 0, "time set " + (long) time);
}`),
  },
  totalDayTime: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static double totalDayTime(${j.LevelAccessor} world) {
return world.dayTime();
}`,
      (j) => `static double totalDayTime(${j.LevelAccessor} world) {
return world.dayTime();
}`,
      (j) => `static double totalDayTime(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level == null ? 0 : level.getOverworldClockTime();
}`),
  },
  dayTime: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static double dayTime(${j.LevelAccessor} world) {
return world.dayTime() % 24000L;
}`,
      (j) => `static double dayTime(${j.LevelAccessor} world) {
return world.dayTime() % 24000L;
}`,
      (j) => `static double dayTime(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level == null ? 0 : level.getOverworldClockTime() % 24000L;
}`),
  },
  isDay: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static boolean isDay(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level != null && level.isDay();
}`,
      (j) => `static boolean isDay(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level != null && level.isBrightOutside();
}`),
  },
  setWeather: {
    uses: ["serverLevel", "runCommand"],
    code: legacyModern(
      (j) => `static void setWeather(${j.LevelAccessor} world, String kind, double seconds) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
int ticks = (int) (seconds * 20);
if (kind.equals("clear")) level.setWeatherParameters(ticks, 0, false, false);
else level.setWeatherParameters(0, ticks, true, kind.equals("thunder"));
}`,
      (j) => `static void setWeather(${j.LevelAccessor} world, String kind, double seconds) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
int ticks = (int) (seconds * 20);
if (kind.equals("clear")) level.setWeatherParameters(ticks, 0, false, false);
else level.setWeatherParameters(0, ticks, true, kind.equals("thunder"));
}`,
      (j) => `static void setWeather(${j.LevelAccessor} world, String kind, double seconds) {
runCommand(world, 0, 0, 0, "weather " + kind + " " + Math.max(1, (int) seconds));
}`),
  },
  explode: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static void explode(${j.LevelAccessor} world, double x, double y, double z, double power, String mode) {
${j.Level} level = level(world);
if (level == null || level.isClientSide()) return;
level.explode(null, x, y, z, (float) power, mode.equals("none") ? ${j.Explosion}.Mode.NONE : mode.equals("destroy") ? ${j.Explosion}.Mode.DESTROY : ${j.Explosion}.Mode.BREAK);
}`,
      (j) => `static void explode(${j.LevelAccessor} world, double x, double y, double z, double power, String mode) {
${j.Level} level = level(world);
if (level == null || level.isClientSide()) return;
level.explode(null, x, y, z, (float) power, mode.equals("none") ? ${j.Level}.ExplosionInteraction.NONE : mode.equals("destroy") ? ${j.Level}.ExplosionInteraction.TNT : ${j.Level}.ExplosionInteraction.BLOCK);
}`),
  },
  lightning: {
    uses: ["serverLevel"],
    code: legacyModern(
      (j) => `static void lightning(${j.LevelAccessor} world, double x, double y, double z, boolean visualOnly) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
${j.LightningBolt} bolt = ${j.EntityType}.LIGHTNING_BOLT.create(level);
if (bolt == null) return;
bolt.moveTo(x, y, z);
bolt.setVisualOnly(visualOnly);
level.addFreshEntity(bolt);
}`,
      (j) => `static void lightning(${j.LevelAccessor} world, double x, double y, double z, boolean visualOnly) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
${j.LightningBolt} bolt = ${j.EntityType}.LIGHTNING_BOLT.create(level, ${j.EntitySpawnReason}.TRIGGERED);
if (bolt == null) return;
bolt.snapTo(x, y, z);
bolt.setVisualOnly(visualOnly);
level.addFreshEntity(bolt);
}`,
      (j) => `static void lightning(${j.LevelAccessor} world, double x, double y, double z, boolean visualOnly) {
${j.ServerLevel} level = serverLevel(world);
if (level == null) return;
${j.LightningBolt} bolt = net.minecraft.world.entity.EntityTypes.LIGHTNING_BOLT.create(level, ${j.EntitySpawnReason}.TRIGGERED);
if (bolt == null) return;
bolt.snapTo(x, y, z);
bolt.setVisualOnly(visualOnly);
level.addFreshEntity(bolt);
}`),
  },
  spawnEntity: {
    uses: ["serverLevel", "entityType"],
    code: legacyModern(
      (j) => `static ${j.Entity} spawnEntity(${j.LevelAccessor} world, String type, double x, double y, double z, double yaw) {
${j.ServerLevel} level = serverLevel(world);
${j.EntityType}<?> entityType = entityType(type);
if (level == null || entityType == null) return null;
${j.Entity} entity = entityType.create(level);
if (entity == null) return null;
entity.moveTo(x, y, z, (float) yaw, 0);
entity.setYHeadRot((float) yaw);
if (entity instanceof ${j.Mob}) ((${j.Mob}) entity).finalizeSpawn(level, level.getCurrentDifficultyAt(entity.blockPosition()), ${j.MobSpawnType}.MOB_SUMMONED, null, null);
level.addFreshEntity(entity);
return entity;
}`,
      (j) => `static ${j.Entity} spawnEntity(${j.LevelAccessor} world, String type, double x, double y, double z, double yaw) {
${j.ServerLevel} level = serverLevel(world);
${j.EntityType}<?> entityType = entityType(type);
if (level == null || entityType == null) return null;
${j.Entity} entity = entityType.create(level, ${j.EntitySpawnReason}.MOB_SUMMONED);
if (entity == null) return null;
entity.snapTo(x, y, z, (float) yaw, 0);
entity.setYHeadRot((float) yaw);
if (entity instanceof ${j.Mob} mob) mob.finalizeSpawn(level, level.getCurrentDifficultyAt(entity.blockPosition()), ${j.EntitySpawnReason}.MOB_SUMMONED, null);
level.addFreshEntity(entity);
return entity;
}`),
  },
  dropItem: {
    uses: ["level"],
    code: all((j) => `static void dropItem(${j.LevelAccessor} world, double x, double y, double z, ${j.ItemStack} stack) {
${j.Level} level = level(world);
if (level == null || level.isClientSide() || stack.isEmpty()) return;
${j.ItemEntity} entity = new ${j.ItemEntity}(level, x, y, z, stack.copy());
entity.setPickUpDelay(10);
level.addFreshEntity(entity);
}`),
  },
  spawnXp: {
    uses: ["level"],
    code: all((j) => `static void spawnXp(${j.LevelAccessor} world, double x, double y, double z, double amount) {
${j.Level} level = level(world);
if (level == null || level.isClientSide()) return;
level.addFreshEntity(new ${j.ExperienceOrb}(level, x, y, z, (int) amount));
}`),
  },
  dimensionId: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static String dimensionId(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level == null ? "" : level.dimension().location().toString();
}`,
      (j) => `static String dimensionId(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level == null ? "" : level.dimension().location().toString();
}`,
      (j) => `static String dimensionId(${j.LevelAccessor} world) {
${j.Level} level = level(world);
return level == null ? "" : level.dimension().identifier().toString();
}`),
  },
  biomeIs: {
    uses: ["pos", "rl"],
    code: legacyModern(
      (j) => `static boolean biomeIs(${j.LevelAccessor} world, double x, double y, double z, String id) {
return rl(id).equals(world.getBiome(pos(x, y, z)).getRegistryName());
}`,
      (j) => `static boolean biomeIs(${j.LevelAccessor} world, double x, double y, double z, String id) {
return world.getBiome(pos(x, y, z)).is(rl(id));
}`),
  },
  // The registered id of a game rule a procedure names in camelCase, snake_case or by the element's ruleName: an exact match wins,
  // else the names are compared without underscores and case (KUYRUK 51). Null when no rule matches. A found id is kept per
  // name (rules are registered once, at startup), so procedures reading a rule every tick do not walk all rules (Q215).
  gameRuleId: {
    uses: ["level"],
    code: legacyModern(
      (j) => `${ruleIdCache(j)}
static String findGameRuleId(${j.LevelAccessor} world, String rule) {
final String[] result = {null};
final String loose = rule.replace("_", "");
${j.GameRules}.visitGameRuleTypes(new ${j.GameRules}.IRuleEntryVisitor() {
@Override
public <T extends ${j.GameRules}.RuleValue<T>> void visit(${j.GameRules}.RuleKey<T> key, ${j.GameRules}.RuleType<T> type) {
String id = key.getId();
if (id.equals(rule) || (result[0] == null && id.replace("_", "").equalsIgnoreCase(loose))) result[0] = id;
}
});
return result[0];
}`,
      (j) => `${ruleIdCache(j)}
static String findGameRuleId(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return null;
final String[] result = {null};
final String loose = rule.replace("_", "");
level.getGameRules().visitGameRuleTypes(new ${j.GameRules}.GameRuleTypeVisitor() {
@Override
public void visitBoolean(${j.GameRules}.Key<${j.GameRules}.BooleanValue> key, ${j.GameRules}.Type<${j.GameRules}.BooleanValue> type) {
String id = key.getId();
if (id.equals(rule) || (result[0] == null && id.replace("_", "").equalsIgnoreCase(loose))) result[0] = id;
}
@Override
public void visitInteger(${j.GameRules}.Key<${j.GameRules}.IntegerValue> key, ${j.GameRules}.Type<${j.GameRules}.IntegerValue> type) {
String id = key.getId();
if (id.equals(rule) || (result[0] == null && id.replace("_", "").equalsIgnoreCase(loose))) result[0] = id;
}
});
return result[0];
}`,
      // 26.x keeps rules in a registry: the id path (or the full identifier) matches exactly, else without underscores and case.
      (j) => `${ruleIdCache(j)}
static String findGameRuleId(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return null;
final String loose = rule.replace("_", "");
java.util.List<String> paths = level.getGameRules().availableRules().map(r -> r.getIdentifier().getPath()).toList();
for (String path : paths) if (path.equals(rule)) return path;
for (String path : paths) if (path.replace("_", "").equalsIgnoreCase(loose)) return path;
return level.getGameRules().availableRules().filter(r -> r.getIdentifier().toString().equals(rule)).map(r -> r.getIdentifier().getPath()).findFirst().orElse(null);
}`),
  },
  // The key of a registered rule id, kept per id (Q215); null when the id is not a rule. 26.x reads rules from its registry instead.
  gameRuleKey: {
    code: legacyModern(
      (j) => `private static final java.util.Map<String, ${j.GameRules}.RuleKey<?>> RULE_KEYS = new java.util.concurrent.ConcurrentHashMap<>();
static ${j.GameRules}.RuleKey<?> gameRuleKey(String id) {
${j.GameRules}.RuleKey<?> cached = RULE_KEYS.get(id);
if (cached != null) return cached;
final ${j.GameRules}.RuleKey<?>[] result = {null};
${j.GameRules}.visitGameRuleTypes(new ${j.GameRules}.IRuleEntryVisitor() {
@Override
public <T extends ${j.GameRules}.RuleValue<T>> void visit(${j.GameRules}.RuleKey<T> key, ${j.GameRules}.RuleType<T> type) {
if (key.getId().equals(id)) result[0] = key;
}
});
if (result[0] != null) RULE_KEYS.put(id, result[0]);
return result[0];
}`,
      (j) => `private static final java.util.Map<String, ${j.GameRules}.Key<?>> RULE_KEYS = new java.util.concurrent.ConcurrentHashMap<>();
static ${j.GameRules}.Key<?> gameRuleKey(${j.ServerLevel} level, String id) {
${j.GameRules}.Key<?> cached = RULE_KEYS.get(id);
if (cached != null) return cached;
final ${j.GameRules}.Key<?>[] result = {null};
level.getGameRules().visitGameRuleTypes(new ${j.GameRules}.GameRuleTypeVisitor() {
@Override
public void visitBoolean(${j.GameRules}.Key<${j.GameRules}.BooleanValue> key, ${j.GameRules}.Type<${j.GameRules}.BooleanValue> type) {
if (key.getId().equals(id)) result[0] = key;
}
@Override
public void visitInteger(${j.GameRules}.Key<${j.GameRules}.IntegerValue> key, ${j.GameRules}.Type<${j.GameRules}.IntegerValue> type) {
if (key.getId().equals(id)) result[0] = key;
}
});
if (result[0] != null) RULE_KEYS.put(id, result[0]);
return result[0];
}`,
      (j) => `static String gameRuleKey(String id) {
return id;
}`),
  },
  gameRuleLogic: {
    uses: ["level", "runCommand", "gameRuleId", "gameRuleKey"],
    code: legacyModern(
      (j) => `static boolean gameRuleLogic(${j.LevelAccessor} world, String rule) {
${j.Level} level = level(world);
if (level == null) return false;
String id = gameRuleId(world, rule);
if (id == null) return false;
${j.GameRules}.RuleKey key = gameRuleKey(id);
Object value = key == null ? null : level.getGameRules().getRule(key);
return value instanceof ${j.GameRules}.BooleanValue && ((${j.GameRules}.BooleanValue) value).get();
}`,
      (j) => `static boolean gameRuleLogic(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return false;
String id = gameRuleId(world, rule);
if (id == null) return false;
${j.GameRules}.Key key = gameRuleKey(level, id);
Object value = key == null ? null : level.getGameRules().getRule(key);
return value instanceof ${j.GameRules}.BooleanValue && ((${j.GameRules}.BooleanValue) value).get();
}`,
      // 26.x keeps rules in a registry under snake_case ids, so doDaylightCycle-style names match without underscores.
      (j) => `static boolean gameRuleLogic(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return false;
String id = gameRuleId(world, rule);
if (id == null) return false;
return level.getGameRules().availableRules().filter(r -> r.valueClass() == Boolean.class && r.getIdentifier().getPath().equals(id)).findFirst().map(r -> (Boolean) level.getGameRules().get(r)).orElse(false);
}`),
  },
  gameRuleNumber: {
    uses: ["level", "gameRuleId", "gameRuleKey"],
    code: legacyModern(
      (j) => `static double gameRuleNumber(${j.LevelAccessor} world, String rule) {
${j.Level} level = level(world);
if (level == null) return 0;
String id = gameRuleId(world, rule);
if (id == null) return 0;
${j.GameRules}.RuleKey key = gameRuleKey(id);
Object value = key == null ? null : level.getGameRules().getRule(key);
return value instanceof ${j.GameRules}.IntegerValue ? ((${j.GameRules}.IntegerValue) value).get() : 0;
}`,
      (j) => `static double gameRuleNumber(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return 0;
String id = gameRuleId(world, rule);
if (id == null) return 0;
${j.GameRules}.Key key = gameRuleKey(level, id);
Object value = key == null ? null : level.getGameRules().getRule(key);
return value instanceof ${j.GameRules}.IntegerValue ? ((${j.GameRules}.IntegerValue) value).get() : 0;
}`,
      (j) => `static double gameRuleNumber(${j.LevelAccessor} world, String rule) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return 0.0;
String id = gameRuleId(world, rule);
if (id == null) return 0.0;
return level.getGameRules().availableRules().filter(r -> r.valueClass() == Integer.class && r.getIdentifier().getPath().equals(id)).findFirst().map(r -> (double) (Integer) level.getGameRules().get(r)).orElse(0.0);
}`),
  },
  queue: {
    code: all((j) => `private static final java.util.List<Object[]> QUEUE = new java.util.ArrayList<>();
/** Runs work on the server after the given number of ticks (Wait block). */
static void queue(${j.LevelAccessor} world, int ticks, Runnable work) {
if (world == null || world.isClientSide()) return;
synchronized (QUEUE) {
QUEUE.add(new Object[] {Math.max(1, ticks), work});
}
}
/** Called every server tick by the generated procedure registrations. */
public static void tickQueue() {
java.util.List<Runnable> due = new java.util.ArrayList<>();
synchronized (QUEUE) {
java.util.Iterator<Object[]> it = QUEUE.iterator();
while (it.hasNext()) {
Object[] entry = it.next();
int left = (Integer) entry[0] - 1;
if (left <= 0) {
due.add((Runnable) entry[1]);
it.remove();
} else entry[0] = left;
}
}
for (Runnable work : due) work.run();
}`),
  },
  // ---- blocks ----
  blockState: {
    uses: ["block"],
    code: all((j) => `static ${j.BlockState} blockState(String id) {
return block(id).defaultBlockState();
}`),
  },
  bonemeal: {
    uses: ["level", "pos"],
    code: legacyModern(
      (j) => `static boolean bonemeal(${j.LevelAccessor} world, double x, double y, double z) {
if (!(world instanceof ${j.ServerLevel})) return false;
${j.ServerLevel} level = (${j.ServerLevel}) world;
return net.minecraft.item.BoneMealItem.applyBonemeal(new ${j.ItemStack}(${j.Items}.BONE_MEAL), level, pos(x, y, z), net.minecraftforge.common.util.FakePlayerFactory.getMinecraft(level));
}`,
      (j) => `static boolean bonemeal(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
if (level == null) return false;
return net.minecraft.world.item.BoneMealItem.growCrop(new ${j.ItemStack}(${j.Items}.BONE_MEAL), level, pos(x, y, z));
}`),
  },
  scheduleTick: {
    uses: ["pos"],
    code: legacyModern(
      (j) => `static void scheduleTick(${j.LevelAccessor} world, double x, double y, double z, double ticks) {
${j.BlockPos} pos = pos(x, y, z);
world.getBlockTicks().scheduleTick(pos, world.getBlockState(pos).getBlock(), (int) ticks);
}`,
      (j) => `static void scheduleTick(${j.LevelAccessor} world, double x, double y, double z, double ticks) {
${j.BlockPos} pos = pos(x, y, z);
world.scheduleTick(pos, world.getBlockState(pos).getBlock(), (int) ticks);
}`),
  },
  stateNumber: {
    code: all((j) => `static double stateNumber(${j.BlockState} state, String name) {
for (${j.Property}<?> property : state.getProperties()) {
if (property.getName().equals(name) && property instanceof ${j.IntegerProperty}) return state.getValue((${j.IntegerProperty}) property);
}
return -1;
}`),
  },
  stateLogic: {
    code: all((j) => `static boolean stateLogic(${j.BlockState} state, String name) {
for (${j.Property}<?> property : state.getProperties()) {
if (property.getName().equals(name) && property instanceof ${j.BooleanProperty}) return state.getValue((${j.BooleanProperty}) property);
}
return false;
}`),
  },
  stateText: {
    code: legacyModern(
      (j) => `static String stateText(${j.BlockState} state, String name) {
for (${j.Property}<?> property : state.getProperties()) {
if (property.getName().equals(name)) return valueName(state, property);
}
return "";
}
private static <T extends Comparable<T>> String valueName(${j.BlockState} state, ${j.Property}<T> property) {
return property.getName(state.getValue(property));
}`,
      (j) => `static String stateText(${j.BlockState} state, String name) {
for (${j.Property}<?> property : state.getProperties()) {
if (property.getName().equals(name)) return valueName(state, property);
}
return "";
}
private static <T extends Comparable<T>> String valueName(${j.BlockState} state, ${j.Property}<T> property) {
return property.getName(state.getValue(property));
}`),
  },
  stateWith: {
    code: all((j) => `static ${j.BlockState} stateWith(${j.BlockState} state, String name, String value) {
for (${j.Property}<?> property : state.getProperties()) {
if (property.getName().equals(name)) return withValue(state, property, value);
}
return state;
}
private static <T extends Comparable<T>> ${j.BlockState} withValue(${j.BlockState} state, ${j.Property}<T> property, String value) {
java.util.Optional<T> parsed = property.getValue(value);
return parsed.isPresent() ? state.setValue(property, parsed.get()) : state;
}`),
  },
  // ---- entities ----
  living: {
    code: all((j) => `static ${j.LivingEntity} living(${j.Entity} entity) {
return entity instanceof ${j.LivingEntity} ? (${j.LivingEntity}) entity : null;
}`),
  },
  health: {
    code: all((j) => `static double health(${j.Entity} entity) {
return entity instanceof ${j.LivingEntity} ? ((${j.LivingEntity}) entity).getHealth() : -1;
}`),
  },
  maxHealth: {
    code: all((j) => `static double maxHealth(${j.Entity} entity) {
return entity instanceof ${j.LivingEntity} ? ((${j.LivingEntity}) entity).getMaxHealth() : -1;
}`),
  },
  setHealth: {
    code: all((j) => `static void setHealth(${j.Entity} entity, double health) {
if (entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).setHealth((float) health);
}`),
  },
  heal: {
    code: all((j) => `static void heal(${j.Entity} entity, double amount) {
if (entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).heal((float) amount);
}`),
  },
  onGround: {
    code: legacyModern(
      (j) => `static boolean onGround(${j.Entity} entity) {
return entity != null && entity.isOnGround();
}`,
      (j) => `static boolean onGround(${j.Entity} entity) {
return entity != null && entity.onGround();
}`),
  },
  setFire: {
    code: legacyModern(
      (j) => `static void setFire(${j.Entity} entity, double seconds) {
if (entity != null) entity.setSecondsOnFire((int) seconds);
}`,
      (j) => `static void setFire(${j.Entity} entity, double seconds) {
if (entity != null) entity.igniteForSeconds((float) seconds);
}`),
  },
  kill: {
    code: legacyModern(
      (j) => `static void kill(${j.Entity} entity) {
if (entity != null && !entity.level.isClientSide()) entity.kill();
}`,
      (j) => `static void kill(${j.Entity} entity) {
if (entity != null && entity.level() instanceof ${j.ServerLevel} level) entity.kill(level);
}`),
  },
  despawn: {
    code: legacyModern(
      (j) => `static void despawn(${j.Entity} entity) {
if (entity != null && !entity.level.isClientSide() && !(entity instanceof ${j.Player})) entity.remove();
}`,
      (j) => `static void despawn(${j.Entity} entity) {
if (entity != null && !entity.level().isClientSide() && !(entity instanceof ${j.Player})) entity.discard();
}`),
  },
  hurt: {
    uses: ["damageSource"],
    code: legacyModern(
      (j) => `static void hurt(${j.Entity} entity, String type, double amount) {
if (entity != null && !entity.level.isClientSide()) entity.hurt(damageSource(entity.level, type), (float) amount);
}`,
      (j) => `static void hurt(${j.Entity} entity, String type, double amount) {
if (entity != null && entity.level() instanceof ${j.ServerLevel} level) entity.hurtServer(level, damageSource(level, type), (float) amount);
}`),
  },
  hurtWith: {
    code: legacyModern(
      (j) => `static void hurtWith(${j.Entity} entity, ${j.DamageSource} source, double amount) {
if (entity != null && source != null && !entity.level.isClientSide()) entity.hurt(source, (float) amount);
}`,
      (j) => `static void hurtWith(${j.Entity} entity, ${j.DamageSource} source, double amount) {
if (entity != null && source != null && entity.level() instanceof ${j.ServerLevel} level) entity.hurtServer(level, source, (float) amount);
}`),
  },
  damageSource: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static ${j.DamageSource} damageSource(${j.LevelAccessor} world, String type) {
switch (type) {
case "magic": return ${j.DamageSource}.MAGIC;
case "fall": return ${j.DamageSource}.FALL;
case "in_fire": return ${j.DamageSource}.IN_FIRE;
case "on_fire": return ${j.DamageSource}.ON_FIRE;
case "lava": return ${j.DamageSource}.LAVA;
case "drown": return ${j.DamageSource}.DROWN;
case "starve": return ${j.DamageSource}.STARVE;
case "cactus": return ${j.DamageSource}.CACTUS;
case "out_of_world": return ${j.DamageSource}.OUT_OF_WORLD;
case "wither": return ${j.DamageSource}.WITHER;
case "lightning_bolt": return ${j.DamageSource}.LIGHTNING_BOLT;
case "in_wall": return ${j.DamageSource}.IN_WALL;
case "cramming": return ${j.DamageSource}.CRAMMING;
case "hot_floor": return ${j.DamageSource}.HOT_FLOOR;
case "sweet_berry_bush": return ${j.DamageSource}.SWEET_BERRY_BUSH;
case "fly_into_wall": return ${j.DamageSource}.FLY_INTO_WALL;
case "dragon_breath": return ${j.DamageSource}.DRAGON_BREATH;
default: return ${j.DamageSource}.GENERIC;
}
}`,
      (j) => `static ${j.DamageSource} damageSource(${j.LevelAccessor} world, String type) {
${j.Level} level = level(world);
if (level == null) return null;
return level.damageSources().source(${j.ResourceKey}.create(${j.Registries}.DAMAGE_TYPE, ${type26("modern")}.withDefaultNamespace(type)));
}`,
      (j) => `static ${j.DamageSource} damageSource(${j.LevelAccessor} world, String type) {
${j.Level} level = level(world);
if (level == null) return null;
return level.damageSources().source(${j.ResourceKey}.create(${j.Registries}.DAMAGE_TYPE, ${type26("26")}.withDefaultNamespace(type)));
}`),
  },
  sourceEntity: {
    code: legacyModern(
      (j) => `static ${j.Entity} sourceEntity(${j.DamageSource} source, boolean direct) {
return source == null ? null : direct ? source.getDirectEntity() : source.getEntity();
}`,
      (j) => `static ${j.Entity} sourceEntity(${j.DamageSource} source, boolean direct) {
return source == null ? null : direct ? source.getDirectEntity() : source.getEntity();
}`),
  },
  damageTypeIs: {
    code: legacyModern(
      (j) => `static boolean damageTypeIs(${j.DamageSource} source, String type) {
return source != null && source.getMsgId().equalsIgnoreCase(type.replace("_", ""));
}`,
      (j) => `static boolean damageTypeIs(${j.DamageSource} source, String type) {
return source != null && source.typeHolder().unwrapKey().map(key -> key.location().getPath().equals(type)).orElse(false);
}`,
      (j) => `static boolean damageTypeIs(${j.DamageSource} source, String type) {
return source != null && source.typeHolder().unwrapKey().map(key -> key.identifier().getPath().equals(type)).orElse(false);
}`),
  },
  yaw: {
    code: legacyModern(
      (j) => `static double yaw(${j.Entity} entity) {
return entity == null ? 0 : entity.yRot;
}`,
      (j) => `static double yaw(${j.Entity} entity) {
return entity == null ? 0 : entity.getYRot();
}`),
  },
  pitch: {
    code: legacyModern(
      (j) => `static double pitch(${j.Entity} entity) {
return entity == null ? 0 : entity.xRot;
}`,
      (j) => `static double pitch(${j.Entity} entity) {
return entity == null ? 0 : entity.getXRot();
}`),
  },
  setRotation: {
    code: legacyModern(
      (j) => `static void setRotation(${j.Entity} entity, double yaw, double pitch) {
if (entity == null) return;
entity.yRot = (float) yaw;
entity.xRot = (float) pitch;
entity.setYHeadRot((float) yaw);
}`,
      (j) => `static void setRotation(${j.Entity} entity, double yaw, double pitch) {
if (entity == null) return;
entity.setYRot((float) yaw);
entity.setXRot((float) pitch);
entity.setYHeadRot((float) yaw);
}`),
  },
  teleport: {
    code: legacyModern(
      (j) => `static void teleport(${j.Entity} entity, double x, double y, double z) {
if (entity == null) return;
if (entity instanceof ${j.ServerPlayer}) ((${j.ServerPlayer}) entity).connection.teleport(x, y, z, entity.yRot, entity.xRot);
else entity.teleportTo(x, y, z);
}`,
      (j) => `static void teleport(${j.Entity} entity, double x, double y, double z) {
if (entity != null) entity.teleportTo(x, y, z);
}`),
  },
  addEffect: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static void addEffect(${j.Entity} entity, String id, double seconds, double level, boolean ambient, boolean particles) {
net.minecraft.potion.Effect effect = net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(rl(id));
if (effect != null && entity instanceof ${j.LivingEntity} && !entity.level.isClientSide()) ((${j.LivingEntity}) entity).addEffect(new ${j.MobEffectInstance}(effect, (int) (seconds * 20), Math.max(0, (int) level - 1), ambient, particles));
}`,
      (j) => `static void addEffect(${j.Entity} entity, String id, double seconds, double level, boolean ambient, boolean particles) {
if (entity instanceof ${j.LivingEntity} living && !entity.level().isClientSide()) ${j.BuiltInRegistries}.MOB_EFFECT.get(rl(id)).ifPresent(effect -> living.addEffect(new ${j.MobEffectInstance}(effect, (int) (seconds * 20), Math.max(0, (int) level - 1), ambient, particles)));
}`),
  },
  removeEffect: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static void removeEffect(${j.Entity} entity, String id) {
net.minecraft.potion.Effect effect = net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(rl(id));
if (effect != null && entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).removeEffect(effect);
}`,
      (j) => `static void removeEffect(${j.Entity} entity, String id) {
if (entity instanceof ${j.LivingEntity} living) ${j.BuiltInRegistries}.MOB_EFFECT.get(rl(id)).ifPresent(living::removeEffect);
}`),
  },
  clearEffects: {
    code: all((j) => `static void clearEffects(${j.Entity} entity) {
if (entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).removeAllEffects();
}`),
  },
  effectInstance: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.MobEffectInstance} effectInstance(${j.Entity} entity, String id) {
net.minecraft.potion.Effect effect = net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(rl(id));
return effect != null && entity instanceof ${j.LivingEntity} ? ((${j.LivingEntity}) entity).getEffect(effect) : null;
}`,
      (j) => `static ${j.MobEffectInstance} effectInstance(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.LivingEntity} living)) return null;
return ${j.BuiltInRegistries}.MOB_EFFECT.get(rl(id)).map(living::getEffect).orElse(null);
}`),
  },
  hasEffect: {
    uses: ["effectInstance"],
    code: all((j) => `static boolean hasEffect(${j.Entity} entity, String id) {
return effectInstance(entity, id) != null;
}`),
  },
  effectLevel: {
    uses: ["effectInstance"],
    code: all((j) => `static double effectLevel(${j.Entity} entity, String id) {
${j.MobEffectInstance} instance = effectInstance(entity, id);
return instance == null ? 0 : instance.getAmplifier() + 1;
}`),
  },
  effectSeconds: {
    uses: ["effectInstance"],
    code: all((j) => `static double effectSeconds(${j.Entity} entity, String id) {
${j.MobEffectInstance} instance = effectInstance(entity, id);
return instance == null ? 0 : instance.getDuration() / 20.0;
}`),
  },
  target: {
    code: all((j) => `static ${j.Entity} target(${j.Entity} entity) {
return entity instanceof ${j.Mob} ? ((${j.Mob}) entity).getTarget() : null;
}`),
  },
  setTarget: {
    code: all((j) => `static void setTarget(${j.Entity} entity, ${j.Entity} target) {
if (entity instanceof ${j.Mob}) ((${j.Mob}) entity).setTarget(target instanceof ${j.LivingEntity} ? (${j.LivingEntity}) target : null);
}`),
  },
  isBaby: {
    code: all((j) => `static boolean isBaby(${j.Entity} entity) {
return entity instanceof ${j.LivingEntity} && ((${j.LivingEntity}) entity).isBaby();
}`),
  },
  isTamed: {
    code: all((j) => `static boolean isTamed(${j.Entity} entity) {
return entity instanceof ${j.TamableAnimal} && ((${j.TamableAnimal}) entity).isTame();
}`),
  },
  tame: {
    code: all((j) => `static void tame(${j.Entity} entity, ${j.Entity} owner) {
if (entity instanceof ${j.TamableAnimal} && owner instanceof ${j.Player}) ((${j.TamableAnimal}) entity).tame((${j.Player}) owner);
}`),
  },
  entitiesInRange: {
    uses: ["level"],
    code: all((j) => `static java.util.List<${j.Entity}> entitiesInRange(${j.LevelAccessor} world, double x, double y, double z, double range) {
${j.Level} level = level(world);
if (level == null) return new java.util.ArrayList<>();
java.util.List<${j.Entity}> list = level.getEntities((${j.Entity}) null, new ${j.AABB}(x - range, y - range, z - range, x + range, y + range, z + range), e -> e.distanceToSqr(x, y, z) <= range * range);
list.sort(java.util.Comparator.comparingDouble(e -> e.distanceToSqr(x, y, z)));
return list;
}`),
  },
  players: {
    code: all((j) => `static java.util.List<${j.Entity}> players(${j.LevelAccessor} world) {
return new java.util.ArrayList<${j.Entity}>(world.players());
}`),
  },
  // Every online player in every dimension; none on a client (no server).
  serverPlayers: {
    uses: ["server"],
    code: all((j) => `static java.util.List<${j.Entity}> serverPlayers(${j.LevelAccessor} world) {
${j.MinecraftServer} server = server(world);
return server == null ? new java.util.ArrayList<>() : new java.util.ArrayList<${j.Entity}>(server.getPlayerList().getPlayers());
}`),
  },
  playerByName: {
    uses: ["server"],
    code: all((j) => `static ${j.Entity} playerByName(${j.LevelAccessor} world, String name) {
${j.MinecraftServer} server = server(world);
return server == null ? null : server.getPlayerList().getPlayerByName(name);
}`),
  },
  nearestEntity: {
    uses: ["entitiesInRange"],
    code: all((j) => `static ${j.Entity} nearestEntity(${j.LevelAccessor} world, double x, double y, double z, double range, ${j.Entity} except) {
for (${j.Entity} entity : entitiesInRange(world, x, y, z, range)) if (entity != except) return entity;
return null;
}`),
  },
  shoot: {
    uses: ["entityType", "entityLevel"],
    code: legacyModern(
      (j) => `static void shoot(${j.Entity} shooter, String type, double power, double inaccuracy) {
if (shooter == null || shooter.level.isClientSide()) return;
${j.EntityType}<?> entityType = entityType(type);
${j.Entity} entity = entityType == null ? null : entityType.create(shooter.level);
if (!(entity instanceof ${j.Projectile})) return;
${j.Projectile} projectile = (${j.Projectile}) entity;
projectile.setOwner(shooter);
projectile.setPos(shooter.getX(), shooter.getEyeY() - 0.1, shooter.getZ());
projectile.shootFromRotation(shooter, shooter.xRot, shooter.yRot, 0, (float) power, (float) inaccuracy);
if (projectile instanceof ${j.AbstractArrow}) ((${j.AbstractArrow}) projectile).pickup = ${j.AbstractArrow}.PickupStatus.CREATIVE_ONLY;
shooter.level.addFreshEntity(projectile);
}`,
      (j) => `static void shoot(${j.Entity} shooter, String type, double power, double inaccuracy) {
if (shooter == null || !(shooter.level() instanceof ${j.ServerLevel} level)) return;
${j.EntityType}<?> entityType = entityType(type);
${j.Entity} entity = entityType == null ? null : entityType.create(level, ${j.EntitySpawnReason}.TRIGGERED);
if (!(entity instanceof ${j.Projectile} projectile)) return;
projectile.setOwner(shooter);
projectile.setPos(shooter.getX(), shooter.getEyeY() - 0.1, shooter.getZ());
projectile.shootFromRotation(shooter, shooter.getXRot(), shooter.getYRot(), 0, (float) power, (float) inaccuracy);
if (projectile instanceof ${j.AbstractArrow} arrow) arrow.pickup = ${j.AbstractArrow}.Pickup.CREATIVE_ONLY;
level.addFreshEntity(projectile);
}`),
  },
  // ---- players ----
  player: {
    code: all((j) => `static ${j.Player} player(${j.Entity} entity) {
return entity instanceof ${j.Player} ? (${j.Player}) entity : null;
}`),
  },
  giveItem: {
    code: legacyModern(
      (j) => `static void giveItem(${j.Entity} entity, ${j.ItemStack} stack) {
if (!(entity instanceof ${j.Player}) || stack.isEmpty()) return;
${j.Player} player = (${j.Player}) entity;
${j.ItemStack} copy = stack.copy();
if (!player.inventory.add(copy)) player.drop(copy, false);
}`,
      (j) => `static void giveItem(${j.Entity} entity, ${j.ItemStack} stack) {
if (!(entity instanceof ${j.Player} player) || stack.isEmpty()) return;
${j.ItemStack} copy = stack.copy();
if (!player.getInventory().add(copy)) player.drop(copy, false);
}`,
      (j) => `static void giveItem(${j.Entity} entity, ${j.ItemStack} stack) {
if (!(entity instanceof ${j.Player} player) || stack.isEmpty()) return;
${j.ItemStack} copy = stack.copy();
if (!player.getInventory().add(copy)) player.drop(copy, false, net.minecraft.util.Prediction.SERVER_ONLY);
}`),
  },
  countItem: {
    uses: ["item"],
    code: legacyModern(
      (j) => `static double countItem(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.Player})) return 0;
${j.Item} item = item(id);
int count = 0;
for (int i = 0; i < ((${j.Player}) entity).inventory.getContainerSize(); i++) {
${j.ItemStack} stack = ((${j.Player}) entity).inventory.getItem(i);
if (stack.getItem() == item) count += stack.getCount();
}
return count;
}`,
      (j) => `static double countItem(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.Player} player)) return 0;
${j.Item} item = item(id);
int count = 0;
for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
${j.ItemStack} stack = player.getInventory().getItem(i);
if (stack.getItem() == item) count += stack.getCount();
}
return count;
}`),
  },
  removeItem: {
    uses: ["item"],
    code: legacyModern(
      (j) => `static void removeItem(${j.Entity} entity, String id, double amount) {
if (!(entity instanceof ${j.Player})) return;
${j.Player} player = (${j.Player}) entity;
${j.Item} item = item(id);
int left = (int) amount;
for (int i = 0; i < player.inventory.getContainerSize() && left > 0; i++) {
${j.ItemStack} stack = player.inventory.getItem(i);
if (stack.getItem() != item) continue;
int taken = Math.min(left, stack.getCount());
stack.shrink(taken);
left -= taken;
}
}`,
      (j) => `static void removeItem(${j.Entity} entity, String id, double amount) {
if (!(entity instanceof ${j.Player} player)) return;
${j.Item} item = item(id);
int left = (int) amount;
for (int i = 0; i < player.getInventory().getContainerSize() && left > 0; i++) {
${j.ItemStack} stack = player.getInventory().getItem(i);
if (stack.getItem() != item) continue;
int taken = Math.min(left, stack.getCount());
stack.shrink(taken);
left -= taken;
}
}`),
  },
  clearInventory: {
    code: legacyModern(
      (j) => `static void clearInventory(${j.Entity} entity) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).inventory.clearContent();
}`,
      (j) => `static void clearInventory(${j.Entity} entity) {
if (entity instanceof ${j.Player} player) player.getInventory().clearContent();
}`),
  },
  handItem: {
    code: all((j) => `static ${j.ItemStack} handItem(${j.Entity} entity, boolean main) {
if (!(entity instanceof ${j.LivingEntity})) return ${j.ItemStack}.EMPTY;
return main ? ((${j.LivingEntity}) entity).getMainHandItem() : ((${j.LivingEntity}) entity).getOffhandItem();
}`),
  },
  setHandItem: {
    code: all((j) => `static void setHandItem(${j.Entity} entity, boolean main, ${j.ItemStack} stack) {
if (entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).setItemInHand(main ? ${j.InteractionHand}.MAIN_HAND : ${j.InteractionHand}.OFF_HAND, stack.copy());
}`),
  },
  slotItem: {
    code: all((j) => `static ${j.ItemStack} slotItem(${j.Entity} entity, String slot) {
if (!(entity instanceof ${j.LivingEntity})) return ${j.ItemStack}.EMPTY;
return ((${j.LivingEntity}) entity).getItemBySlot(${j.EquipmentSlot}.byName(slot));
}`),
  },
  setSlotItem: {
    code: all((j) => `static void setSlotItem(${j.Entity} entity, String slot, ${j.ItemStack} stack) {
if (entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).setItemSlot(${j.EquipmentSlot}.byName(slot), stack.copy());
}`),
  },
  gameMode: {
    code: legacyModern(
      (j) => `static String gameMode(${j.Entity} entity) {
if (entity instanceof ${j.ServerPlayer}) return ((${j.ServerPlayer}) entity).gameMode.getGameModeForPlayer().getName();
return "";
}`,
      (j) => `static String gameMode(${j.Entity} entity) {
if (entity instanceof ${j.ServerPlayer} player) return player.gameMode.getGameModeForPlayer().getName();
return "";
}`),
  },
  setGameMode: {
    code: legacyModern(
      (j) => `static void setGameMode(${j.Entity} entity, String mode) {
if (entity instanceof ${j.ServerPlayer}) ((${j.ServerPlayer}) entity).setGameMode(${j.GameType}.byName(mode, ${j.GameType}.SURVIVAL));
}`,
      (j) => `static void setGameMode(${j.Entity} entity, String mode) {
if (entity instanceof ${j.ServerPlayer} player) player.setGameMode(${j.GameType}.byName(mode, ${j.GameType}.SURVIVAL));
}`),
  },
  xpLevel: {
    code: all((j) => `static double xpLevel(${j.Entity} entity) {
return entity instanceof ${j.Player} ? ((${j.Player}) entity).experienceLevel : 0;
}`),
  },
  addXpLevels: {
    code: all((j) => `static void addXpLevels(${j.Entity} entity, double levels) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).giveExperienceLevels((int) levels);
}`),
  },
  addXp: {
    code: all((j) => `static void addXp(${j.Entity} entity, double points) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).giveExperiencePoints((int) points);
}`),
  },
  food: {
    code: all((j) => `static double food(${j.Entity} entity) {
return entity instanceof ${j.Player} ? ((${j.Player}) entity).getFoodData().getFoodLevel() : 0;
}`),
  },
  setFood: {
    code: all((j) => `static void setFood(${j.Entity} entity, double food) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).getFoodData().setFoodLevel((int) food);
}`),
  },
  setSaturation: {
    code: all((j) => `static void setSaturation(${j.Entity} entity, double saturation) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).getFoodData().setSaturation((float) saturation);
}`),
  },
  isCreative: {
    code: all((j) => `static boolean isCreative(${j.Entity} entity) {
return entity instanceof ${j.Player} && ((${j.Player}) entity).isCreative();
}`),
  },
  setFlying: {
    code: legacyModern(
      (j) => `static void setFlying(${j.Entity} entity, boolean allowed) {
if (!(entity instanceof ${j.Player})) return;
${j.Player} player = (${j.Player}) entity;
player.abilities.mayfly = allowed;
if (!allowed) player.abilities.flying = false;
player.onUpdateAbilities();
}`,
      (j) => `static void setFlying(${j.Entity} entity, boolean allowed) {
if (!(entity instanceof ${j.Player} player)) return;
player.getAbilities().mayfly = allowed;
if (!allowed) player.getAbilities().flying = false;
player.onUpdateAbilities();
}`),
  },
  commandParam: {
    code: all(() => `static String commandParam(String command, int index) {
String[] words = command.trim().split("\\\\s+");
return index >= 0 && index + 1 < words.length ? words[index + 1] : "";
}`),
  },
  commandParamNumber: {
    uses: ["commandParam"],
    code: all(() => `static double commandParamNumber(String command, int index) {
try {
return Double.parseDouble(commandParam(command, index));
} catch (NumberFormatException e) {
return 0;
}
}`),
  },
  closeScreen: {
    code: all((j) => `static void closeScreen(${j.Entity} entity) {
if (entity instanceof ${j.ServerPlayer}) ((${j.ServerPlayer}) entity).closeContainer();
}`),
  },
  advancement: {
    code: legacyModern(
      (j) => `static void advancement(${j.Entity} entity, String id, boolean grant) {
if (!(entity instanceof ${j.ServerPlayer})) return;
${j.ServerPlayer} player = (${j.ServerPlayer}) entity;
${j.Advancement} advancement = player.server.getAdvancements().getAdvancement(new net.minecraft.util.ResourceLocation(id));
if (advancement == null) return;
${j.AdvancementProgress} progress = player.getAdvancements().getOrStartProgress(advancement);
for (String criterion : grant ? progress.getRemainingCriteria() : progress.getCompletedCriteria()) {
if (grant) player.getAdvancements().award(advancement, criterion);
else player.getAdvancements().revoke(advancement, criterion);
}
}`,
      (j) => `static void advancement(${j.Entity} entity, String id, boolean grant) {
if (!(entity instanceof ${j.ServerPlayer} player) || !(player.level() instanceof ${j.ServerLevel} level)) return;
${j.AdvancementHolder} advancement = level.getServer().getAdvancements().get(${type26("modern")}.parse(id));
if (advancement == null) return;
${j.AdvancementProgress} progress = player.getAdvancements().getOrStartProgress(advancement);
for (String criterion : grant ? progress.getRemainingCriteria() : progress.getCompletedCriteria()) {
if (grant) player.getAdvancements().award(advancement, criterion);
else player.getAdvancements().revoke(advancement, criterion);
}
}`,
      (j) => `static void advancement(${j.Entity} entity, String id, boolean grant) {
if (!(entity instanceof ${j.ServerPlayer} player) || !(player.level() instanceof ${j.ServerLevel} level)) return;
${j.AdvancementHolder} advancement = level.getServer().getAdvancements().get(${type26("26")}.parse(id));
if (advancement == null) return;
${j.AdvancementProgress} progress = player.getAdvancements().getOrStartProgress(advancement);
for (String criterion : grant ? progress.getRemainingCriteria() : progress.getCompletedCriteria()) {
if (grant) player.getAdvancements().award(advancement, criterion);
else player.getAdvancements().revoke(advancement, criterion);
}
}`),
  },
  hasAdvancement: {
    code: legacyModern(
      (j) => `static boolean hasAdvancement(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.ServerPlayer})) return false;
${j.ServerPlayer} player = (${j.ServerPlayer}) entity;
${j.Advancement} advancement = player.server.getAdvancements().getAdvancement(new net.minecraft.util.ResourceLocation(id));
return advancement != null && player.getAdvancements().getOrStartProgress(advancement).isDone();
}`,
      (j) => `static boolean hasAdvancement(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.ServerPlayer} player) || !(player.level() instanceof ${j.ServerLevel} level)) return false;
${j.AdvancementHolder} advancement = level.getServer().getAdvancements().get(${type26("modern")}.parse(id));
return advancement != null && player.getAdvancements().getOrStartProgress(advancement).isDone();
}`,
      (j) => `static boolean hasAdvancement(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.ServerPlayer} player) || !(player.level() instanceof ${j.ServerLevel} level)) return false;
${j.AdvancementHolder} advancement = level.getServer().getAdvancements().get(${type26("26")}.parse(id));
return advancement != null && player.getAdvancements().getOrStartProgress(advancement).isDone();
}`),
  },
  // ---- scoreboard ----
  score: {
    uses: ["entityLevel"],
    code: legacyModern(
      (j) => `static double score(${j.Entity} entity, String objective) {
if (entity == null) return 0;
${j.Scoreboard} board = entity.level.getScoreboard();
${j.Objective} obj = board.getObjective(objective);
return obj == null ? 0 : board.getOrCreatePlayerScore(entity.getScoreboardName(), obj).getScore();
}`,
      (j) => `static double score(${j.Entity} entity, String objective) {
if (entity == null) return 0;
${j.Scoreboard} board = entity.level().getScoreboard();
${j.Objective} obj = board.getObjective(objective);
return obj == null ? 0 : board.getOrCreatePlayerScore(entity, obj).get();
}`),
  },
  setScore: {
    code: legacyModern(
      (j) => `static void setScore(${j.Entity} entity, String objective, double value, boolean add) {
if (entity == null) return;
${j.Scoreboard} board = entity.level.getScoreboard();
${j.Objective} obj = board.getObjective(objective);
if (obj == null) return;
net.minecraft.scoreboard.Score score = board.getOrCreatePlayerScore(entity.getScoreboardName(), obj);
score.setScore(add ? score.getScore() + (int) value : (int) value);
}`,
      (j) => `static void setScore(${j.Entity} entity, String objective, double value, boolean add) {
if (entity == null) return;
${j.Scoreboard} board = entity.level().getScoreboard();
${j.Objective} obj = board.getObjective(objective);
if (obj == null) return;
net.minecraft.world.scores.ScoreAccess score = board.getOrCreatePlayerScore(entity, obj);
score.set(add ? score.get() + (int) value : (int) value);
}`),
  },
  // ---- items ----
  stack: {
    uses: ["item"],
    code: all((j) => `static ${j.ItemStack} stack(String id, double count) {
return new ${j.ItemStack}(item(id), Math.max(1, (int) count));
}`),
  },
  stackName: {
    code: all((j) => `static String stackName(${j.ItemStack} stack) {
return stack.getHoverName().getString();
}`),
  },
  setStackName: {
    uses: ["component"],
    code: legacyModern(
      (j) => `static void setStackName(${j.ItemStack} stack, String name) {
stack.setHoverName(component(name));
}`,
      (j) => `static void setStackName(${j.ItemStack} stack, String name) {
stack.set(${j.DataComponents}.CUSTOM_NAME, component(name));
}`),
  },
  damageStack: {
    code: legacyModern(
      (j) => `static void damageStack(${j.ItemStack} stack, double amount, ${j.LevelAccessor} world) {
if (!stack.isDamageableItem()) return;
if (stack.hurt((int) amount, new java.util.Random(), null)) {
stack.shrink(1);
stack.setDamageValue(0);
}
}`,
      (j) => `static void damageStack(${j.ItemStack} stack, double amount, ${j.LevelAccessor} world) {
if (world instanceof ${j.ServerLevel} level && stack.isDamageableItem()) stack.hurtAndBreak((int) amount, level, null, broken -> {});
}`),
  },
  enchantment: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.Enchantment} enchantment(${j.LevelAccessor} world, String id) {
return net.minecraftforge.registries.ForgeRegistries.ENCHANTMENTS.getValue(rl(id));
}`,
      (j) => `static ${j.Holder}<${j.Enchantment}> enchantment(${j.LevelAccessor} world, String id) {
if (world == null) return null;
return world.registryAccess().lookupOrThrow(${j.Registries}.ENCHANTMENT).get(${j.ResourceKey}.create(${j.Registries}.ENCHANTMENT, rl(id))).orElse(null);
}`),
  },
  enchant: {
    uses: ["enchantment"],
    code: legacyModern(
      (j) => `static void enchant(${j.LevelAccessor} world, ${j.ItemStack} stack, String id, double level) {
${j.Enchantment} enchantment = enchantment(world, id);
if (enchantment != null) stack.enchant(enchantment, (int) level);
}`,
      (j) => `static void enchant(${j.LevelAccessor} world, ${j.ItemStack} stack, String id, double level) {
${j.Holder}<${j.Enchantment}> enchantment = enchantment(world, id);
if (enchantment != null) stack.enchant(enchantment, (int) level);
}`),
  },
  enchantLevel: {
    uses: ["enchantment"],
    code: legacyModern(
      (j) => `static double enchantLevel(${j.LevelAccessor} world, ${j.ItemStack} stack, String id) {
${j.Enchantment} enchantment = enchantment(world, id);
return enchantment == null ? 0 : ${j.EnchantmentHelper}.getItemEnchantmentLevel(enchantment, stack);
}`,
      (j) => `static double enchantLevel(${j.LevelAccessor} world, ${j.ItemStack} stack, String id) {
${j.Holder}<${j.Enchantment}> enchantment = enchantment(world, id);
return enchantment == null ? 0 : ${j.EnchantmentHelper}.getItemEnchantmentLevel(enchantment, stack);
}`),
  },
  cooldown: {
    code: legacyModern(
      (j) => `static void cooldown(${j.Entity} entity, ${j.ItemStack} stack, double ticks) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).getCooldowns().addCooldown(stack.getItem(), (int) ticks);
}`,
      (j) => `static void cooldown(${j.Entity} entity, ${j.ItemStack} stack, double ticks) {
if (entity instanceof ${j.Player} player) player.getCooldowns().addCooldown(stack, (int) ticks);
}`),
  },
  onCooldown: {
    code: legacyModern(
      (j) => `static boolean onCooldown(${j.Entity} entity, ${j.ItemStack} stack) {
return entity instanceof ${j.Player} && ((${j.Player}) entity).getCooldowns().isOnCooldown(stack.getItem());
}`,
      (j) => `static boolean onCooldown(${j.Entity} entity, ${j.ItemStack} stack) {
return entity instanceof ${j.Player} player && player.getCooldowns().isOnCooldown(stack);
}`),
  },
  stackData: {
    code: legacyModern(
      (j) => `static ${j.CompoundTag} stackData(${j.ItemStack} stack) {
return stack.getOrCreateTag();
}`,
      (j) => `static ${j.CompoundTag} stackData(${j.ItemStack} stack) {
return stack.getOrDefault(${j.DataComponents}.CUSTOM_DATA, ${j.CustomData}.EMPTY).copyTag();
}`),
  },
  stackDataNumber: {
    uses: ["stackData"],
    code: legacyModern(
      (j) => `static double stackDataNumber(${j.ItemStack} stack, String key) {
return stackData(stack).getDouble(key);
}`,
      (j) => `static double stackDataNumber(${j.ItemStack} stack, String key) {
return stackData(stack).getDoubleOr(key, 0);
}`),
  },
  stackDataText: {
    uses: ["stackData"],
    code: legacyModern(
      (j) => `static String stackDataText(${j.ItemStack} stack, String key) {
return stackData(stack).getString(key);
}`,
      (j) => `static String stackDataText(${j.ItemStack} stack, String key) {
return stackData(stack).getStringOr(key, "");
}`),
  },
  stackDataLogic: {
    uses: ["stackData"],
    code: legacyModern(
      (j) => `static boolean stackDataLogic(${j.ItemStack} stack, String key) {
return stackData(stack).getBoolean(key);
}`,
      (j) => `static boolean stackDataLogic(${j.ItemStack} stack, String key) {
return stackData(stack).getBooleanOr(key, false);
}`),
  },
  setStackData: {
    code: legacyModern(
      (j) => `static void setStackData(${j.ItemStack} stack, String key, Object value) {
${j.CompoundTag} tag = stack.getOrCreateTag();
if (value instanceof Double) tag.putDouble(key, (Double) value);
else if (value instanceof Boolean) tag.putBoolean(key, (Boolean) value);
else tag.putString(key, String.valueOf(value));
}`,
      (j) => `static void setStackData(${j.ItemStack} stack, String key, Object value) {
${j.CustomData}.update(${j.DataComponents}.CUSTOM_DATA, stack, tag -> {
if (value instanceof Double d) tag.putDouble(key, d);
else if (value instanceof Boolean b) tag.putBoolean(key, b);
else tag.putString(key, String.valueOf(value));
});
}`),
  },
  // ---- particles and sounds ----
  serverParticles: {
    uses: ["serverLevel", "particle"],
    code: all((j) => `static void serverParticles(${j.LevelAccessor} world, String id, double x, double y, double z, double count, double dx, double dy, double dz, double speed) {
${j.ServerLevel} level = serverLevel(world);
if (level != null) level.sendParticles(particle(id), x, y, z, (int) count, dx, dy, dz, speed);
}`),
  },
  clientParticle: {
    uses: ["particle"],
    code: all((j) => `static void clientParticle(${j.LevelAccessor} world, String id, double x, double y, double z, double dx, double dy, double dz) {
if (world != null) world.addParticle(particle(id), x, y, z, dx, dy, dz);
}`),
  },
  playSound: {
    uses: ["level", "sound", "pos"],
    code: legacyModern(
      (j) => `static void playSound(${j.LevelAccessor} world, double x, double y, double z, String id, double volume, double pitch) {
${j.Level} level = level(world);
${j.SoundEvent} sound = sound(id);
if (level == null || level.isClientSide() || sound == null) return;
level.playSound(null, pos(x, y, z), sound, ${j.SoundSource}.NEUTRAL, (float) volume, (float) pitch);
}`,
      (j) => `static void playSound(${j.LevelAccessor} world, double x, double y, double z, String id, double volume, double pitch) {
${j.Level} level = level(world);
${j.SoundEvent} sound = sound(id);
if (level == null || level.isClientSide() || sound == null) return;
level.playSound(null, pos(x, y, z), sound, ${j.SoundSource}.NEUTRAL, (float) volume, (float) pitch);
}`),
  },
  playLocalSound: {
    uses: ["level", "sound"],
    code: all((j) => `static void playLocalSound(${j.LevelAccessor} world, double x, double y, double z, String id, double volume, double pitch) {
${j.Level} level = level(world);
${j.SoundEvent} sound = sound(id);
if (level != null && sound != null) level.playLocalSound(x, y, z, sound, ${j.SoundSource}.NEUTRAL, (float) volume, (float) pitch, false);
}`),
  },
  cancelEvent: {
    code: all(() => `private static boolean cancelled;
/** Cancel event block: the trigger that runs the procedure cancels its event afterwards. */
static void cancelEvent() {
cancelled = true;
}
/** Read and reset by generated triggers. */
public static boolean takeCancel() {
boolean result = cancelled;
cancelled = false;
return result;
}`),
  },
  substring: {
    code: all(() => `static String substring(String text, double from, double to) {
int start = Math.max(0, Math.min(text.length(), (int) from));
int end = Math.max(start, Math.min(text.length(), (int) to));
return text.substring(start, end);
}`),
  },
  listSet: {
    code: all(() => `static void listSet(java.util.List<Object> list, double index, Object value) {
int i = (int) index;
if (i >= 0 && i < list.size()) list.set(i, value);
}`),
  },
  listRemove: {
    code: all(() => `static void listRemove(java.util.List<Object> list, double index) {
int i = (int) index;
if (i >= 0 && i < list.size()) list.remove(i);
}`),
  },
  listGet: {
    code: all(() => `static Object listGet(java.util.List<Object> list, double index) {
int i = (int) index;
return i >= 0 && i < list.size() ? list.get(i) : null;
}`),
  },
  listNumber: {
    uses: ["listGet"],
    code: all(() => `static double listNumber(java.util.List<Object> list, double index) {
Object value = listGet(list, index);
return value instanceof Number ? ((Number) value).doubleValue() : 0;
}`),
  },
  listText: {
    uses: ["listGet"],
    code: all(() => `static String listText(java.util.List<Object> list, double index) {
Object value = listGet(list, index);
return value == null ? "" : String.valueOf(value);
}`),
  },
  listLogic: {
    uses: ["listGet"],
    code: all(() => `static boolean listLogic(java.util.List<Object> list, double index) {
return Boolean.TRUE.equals(listGet(list, index));
}`),
  },
  listEntity: {
    uses: ["listGet"],
    code: all((j) => `static ${j.Entity} listEntity(java.util.List<Object> list, double index) {
Object value = listGet(list, index);
return value instanceof ${j.Entity} ? (${j.Entity}) value : null;
}`),
  },
  listItemstack: {
    uses: ["listGet"],
    code: all((j) => `static ${j.ItemStack} listItemstack(java.util.List<Object> list, double index) {
Object value = listGet(list, index);
return value instanceof ${j.ItemStack} ? (${j.ItemStack}) value : ${j.ItemStack}.EMPTY;
}`),
  },
  redstone: {
    uses: ["level", "pos"],
    code: all((j) => `static double redstone(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? 0 : level.getBestNeighborSignal(pos(x, y, z));
}`),
  },
  hardness: {
    uses: ["pos"],
    code: all((j) => `static double hardness(${j.LevelAccessor} world, double x, double y, double z) {
${j.BlockPos} pos = pos(x, y, z);
return world.getBlockState(pos).getDestroySpeed(world, pos);
}`),
  },
  // ---- client only ----
  clientPlayer: {
    client: true,
    code: all((j) => `static ${j.Entity} clientPlayer() {
return ${j.Minecraft}.getInstance().player;
}`),
  },
  clientLevel: {
    client: true,
    code: all((j) => `static ${j.LevelAccessor} clientLevel() {
return ${j.Minecraft}.getInstance().level;
}`),
  },
  clientMessage: {
    client: true,
    uses: ["component"],
    code: {
      all: (j) => `static void clientMessage(String text, boolean actionbar) {
${j.Minecraft} minecraft = ${j.Minecraft}.getInstance();
if (actionbar) minecraft.gui.setOverlayMessage(ProcedureHelpers.component(text), false);
else minecraft.gui.getChat().addMessage(ProcedureHelpers.component(text));
}`,
      "26.3": (j) => `static void clientMessage(String text, boolean actionbar) {
${j.Minecraft} minecraft = ${j.Minecraft}.getInstance();
if (minecraft.player == null) return;
if (actionbar) minecraft.player.sendOverlayMessage(ProcedureHelpers.component(text));
else minecraft.player.sendSystemMessage(ProcedureHelpers.component(text));
}`,
    },
  },
  // ---- text ----
  translate: {
    code: legacyModern(
      (j) => `static String translate(String key) {
return new net.minecraft.util.text.TranslationTextComponent(key).getString();
}`,
      (j) => `static String translate(String key) {
return ${j.Component}.translatable(key).getString();
}`),
  },
  // ---- block data ----
  // Values a procedure keeps at a block position. 1.16.5 stores them in the block entity's Forge data, as MCreator
  // procedures do; later versions keep them in the block entity generated for blocks with an inventory.
  ...Object.fromEntries(Object.entries(BLOCK_DATA).flatMap(([type, d]) => [
    [`blockData${d.name}`, {
      uses: ["pos"],
      code: legacyModern(
        (j) => `static ${d.java} blockData${d.name}(${j.LevelAccessor} world, double x, double y, double z, String key) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
return entity != null ? entity.getTileData().get${d.api}(key) : ${d.missing};
}`,
        (j) => `static ${d.java} blockData${d.name}(${j.LevelAccessor} world, double x, double y, double z, String key) {
return world.getBlockEntity(pos(x, y, z)) instanceof BlockDataHolder holder ? holder.blockData().get${d.api}Or(key, ${d.empty}) : ${d.missing};
}`),
    }],
    [`setBlockData${d.name}`, {
      uses: ["pos"],
      code: legacyModern(
        (j) => `static void setBlockData${d.name}(${j.LevelAccessor} world, double x, double y, double z, String key, ${d.java} value) {
if (world.isClientSide()) return;
${j.BlockPos} pos = pos(x, y, z);
${j.BlockEntity} entity = world.getBlockEntity(pos);
${j.BlockState} state = world.getBlockState(pos);
if (entity != null) entity.getTileData().put${d.api}(key, value);
if (world instanceof ${j.Level}) ((${j.Level}) world).sendBlockUpdated(pos, state, state, 3);
}`,
        (j) => `static void setBlockData${d.name}(${j.LevelAccessor} world, double x, double y, double z, String key, ${d.java} value) {
if (world.isClientSide()) return;
${j.BlockPos} pos = pos(x, y, z);
${j.BlockState} state = world.getBlockState(pos);
if (world.getBlockEntity(pos) instanceof BlockDataHolder holder) {
holder.blockData().put${d.api}(key, value);
((${j.BlockEntity}) holder).setChanged();
}
if (world instanceof ${j.Level} level) level.sendBlockUpdated(pos, state, state, 3);
}`),
    }],
  ])),
  // ---- open GUI ----
  // The slots of a GUI menu by id: menus generated by MCEdge give them through java.util.function.Supplier.
  guiSlot: {
    code: legacyModern(
      (j) => `static net.minecraft.inventory.container.Slot guiSlot(${j.Entity} entity, double slot) {
if (!(entity instanceof ${j.Player})) return null;
Object menu = ((${j.Player}) entity).containerMenu;
if (!(menu instanceof java.util.function.Supplier)) return null;
Object slots = ((java.util.function.Supplier<?>) menu).get();
Object found = slots instanceof java.util.Map ? ((java.util.Map<?, ?>) slots).get((int) slot) : null;
return found instanceof net.minecraft.inventory.container.Slot ? (net.minecraft.inventory.container.Slot) found : null;
}`,
      (j) => `static net.minecraft.world.inventory.Slot guiSlot(${j.Entity} entity, double slot) {
if (!(entity instanceof ${j.Player} player) || !(player.containerMenu instanceof java.util.function.Supplier<?> menu)) return null;
return menu.get() instanceof java.util.Map<?, ?> slots && slots.get((int) slot) instanceof net.minecraft.world.inventory.Slot found ? found : null;
}`),
  },
  guiSlotItem: {
    uses: ["guiSlot"],
    code: all((j) => `static ${j.ItemStack} guiSlotItem(${j.Entity} entity, double slot) {
return guiSlot(entity, slot) == null ? ${j.ItemStack}.EMPTY : guiSlot(entity, slot).getItem();
}`),
  },
  setGuiSlotItem: {
    uses: ["guiSlot"],
    code: all((j) => `static void setGuiSlotItem(${j.Entity} entity, double slot, ${j.ItemStack} stack) {
if (guiSlot(entity, slot) == null) return;
guiSlot(entity, slot).set(stack);
((${j.Player}) entity).containerMenu.broadcastChanges();
}`),
  },
  // Another block in place of the one at a position, keeping the properties both have and the block entity's data.
  placeKeeping: {
    uses: ["pos", "block"],
    code: {
      "1.16.5": (j) => `static void placeKeeping(${j.LevelAccessor} world, double x, double y, double z, String id, boolean keepData) {
${j.BlockPos} pos = pos(x, y, z);
${j.BlockState} state = block(id).defaultBlockState();
${j.BlockState} old = world.getBlockState(pos);
for (java.util.Map.Entry<net.minecraft.state.Property<?>, Comparable<?>> entry : old.getValues().entrySet()) {
net.minecraft.state.Property property = state.getBlock().getStateDefinition().getProperty(entry.getKey().getName());
if (property != null && state.getValue(property) != null) {
try {
state = (${j.BlockState}) state.setValue(property, (Comparable) entry.getValue());
} catch (Exception e) {
}
}
}
${j.BlockEntity} entity = keepData ? world.getBlockEntity(pos) : null;
net.minecraft.nbt.CompoundNBT data = null;
if (entity != null) {
data = entity.save(new net.minecraft.nbt.CompoundNBT());
entity.setRemoved();
}
world.setBlock(pos, state, 3);
if (data != null) {
${j.BlockEntity} placed = world.getBlockEntity(pos);
if (placed != null) {
try {
placed.load(old, data);
} catch (Exception e) {
}
}
}
}`,
      "1.21.5": placeKeepingModern("placed.loadWithComponents(data, world.registryAccess());"),
      "26.3": placeKeepingModern("placed.loadWithComponents(net.minecraft.world.level.storage.TagValueInput.create(net.minecraft.util.ProblemReporter.DISCARDING, world.registryAccess(), data));"),
    },
  },
  // A random item of an item tag, one of it as a stack (air when the tag is empty).
  randomItemInTag: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.ItemStack} randomItemInTag(String tag) {
net.minecraft.tags.ITag<${j.Item}> items = ${j.ItemTags}.getAllTags().getTagOrEmpty(rl(tag));
return new ${j.ItemStack}(items.getValues().isEmpty() ? ${j.Items}.AIR : items.getRandomElement(java.util.concurrent.ThreadLocalRandom.current()));
}`,
      (j) => `static ${j.ItemStack} randomItemInTag(String tag) {
java.util.List<${j.Item}> items = new java.util.ArrayList<>();
for (${j.Holder}<${j.Item}> holder : ${j.BuiltInRegistries}.ITEM.getTagOrEmpty(${j.TagKey}.create(${j.Registries}.ITEM, rl(tag)))) items.add(holder.value());
return new ${j.ItemStack}(items.isEmpty() ? ${j.Items}.AIR : items.get(java.util.concurrent.ThreadLocalRandom.current().nextInt(items.size())));
}`),
  },
  // Whether a player has at least a command permission level (1 moderator .. 4 owner).
  hasPermission: {
    code: {
      all: (j) => `static boolean hasPermission(${j.Entity} entity, double level) {
return entity instanceof ${j.Player} && ((${j.Player}) entity).hasPermissions((int) level);
}`,
      "26.3": (j) => `static boolean hasPermission(${j.Entity} entity, double level) {
if (!(entity instanceof ${j.Player} player)) return false;
net.minecraft.server.permissions.Permission needed = level >= 4 ? net.minecraft.server.permissions.Permissions.COMMANDS_OWNER : level >= 3 ? net.minecraft.server.permissions.Permissions.COMMANDS_ADMIN : level >= 2 ? net.minecraft.server.permissions.Permissions.COMMANDS_GAMEMASTER : net.minecraft.server.permissions.Permissions.COMMANDS_MODERATOR;
return level <= 0 || player.permissions().hasPermission(needed);
}`,
    },
  },
  // Breaks a block after dropping what its loot table gives (what MCreator does for "break block, drop items").
  breakDropping: {
    uses: ["pos"],
    code: all((j) => `static void breakDropping(${j.LevelAccessor} world, double x, double y, double z) {
if (!(world instanceof ${j.Level})) return;
${j.BlockPos} pos = pos(x, y, z);
${j.Block}.dropResources(world.getBlockState(pos), (${j.Level}) world, pos);
world.destroyBlock(pos, false);
}`),
  },
  // ---- looking, nearby entities ----
  // The block a ray from the entity's eyes along its view, `distance` blocks long, ends in (X, Y or Z of its position).
  lookBlock: {
    code: legacyModern(
      (j) => `static double lookBlock(${j.Entity} entity, double distance, String axis, boolean outline) {
${j.Vec3} eye = entity.getEyePosition(1.0F);
${j.Vec3} view = entity.getViewVector(1.0F);
${j.BlockPos} hit = entity.level.clip(new ${j.ClipContext}(eye, eye.add(view.x * distance, view.y * distance, view.z * distance), outline ? ${j.ClipContext}.BlockMode.OUTLINE : ${j.ClipContext}.BlockMode.COLLIDER, ${j.ClipContext}.FluidMode.NONE, entity)).getBlockPos();
return axis.equals("X") ? hit.getX() : axis.equals("Y") ? hit.getY() : hit.getZ();
}`,
      (j) => `static double lookBlock(${j.Entity} entity, double distance, String axis, boolean outline) {
${j.Vec3} eye = entity.getEyePosition(1.0F);
${j.Vec3} view = entity.getViewVector(1.0F);
${j.BlockPos} hit = entity.level().clip(new ${j.ClipContext}(eye, eye.add(view.x * distance, view.y * distance, view.z * distance), outline ? ${j.ClipContext}.Block.OUTLINE : ${j.ClipContext}.Block.COLLIDER, ${j.ClipContext}.Fluid.NONE, entity)).getBlockPos();
return axis.equals("X") ? hit.getX() : axis.equals("Y") ? hit.getY() : hit.getZ();
}`),
  },
  // The entity of a kind (player, server_player, item) inside a box that is nearest to a point; null when there is none.
  nearestInBox: {
    code: all((j) => `static ${j.Entity} nearestInBox(${j.LevelAccessor} world, String kind, double x1, double y1, double z1, double x2, double y2, double z2, double x, double y, double z) {
Class<? extends ${j.Entity}> type = kind.equals("item") ? ${j.ItemEntity}.class : kind.equals("server_player") ? ${j.ServerPlayer}.class : ${j.Player}.class;
${j.Entity} best = null;
double bestDistance = 0;
for (${j.Entity} found : world.getEntitiesOfClass(type, new ${j.AABB}(x1, y1, z1, x2, y2, z2))) {
double distance = found.distanceToSqr(x, y, z);
if (best == null || distance < bestDistance) {
best = found;
bestDistance = distance;
}
}
return best;
}`),
  },
  // A sound with its category: heard by everyone near from the server, played locally on a client.
  playSoundIn: {
    uses: ["sound", "pos"],
    code: legacyModern(
      (j) => `static void playSoundIn(${j.LevelAccessor} world, double x, double y, double z, String id, String category, double volume, double pitch) {
if (!(world instanceof ${j.Level})) return;
${j.Level} level = (${j.Level}) world;
${j.SoundEvent} sound = sound(id);
${j.SoundSource} source = ${j.SoundSource}.valueOf(category);
if (!level.isClientSide()) level.playSound(null, pos(x, y, z), sound, source, (float) volume, (float) pitch);
else level.playLocalSound(x, y, z, sound, source, (float) volume, (float) pitch, false);
}`,
      (j) => `static void playSoundIn(${j.LevelAccessor} world, double x, double y, double z, String id, String category, double volume, double pitch) {
if (!(world instanceof ${j.Level} level)) return;
${j.SoundEvent} sound = sound(id);
${j.SoundSource} source = ${j.SoundSource}.valueOf(category);
if (!level.isClientSide()) level.playSound(null, pos(x, y, z), sound, source, (float) volume, (float) pitch);
else level.playLocalSound(x, y, z, sound, source, (float) volume, (float) pitch, false);
}`),
  },
  // An effect for a number of ticks, as MCreator adds it: nothing checks the side.
  addEffectTicks: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static void addEffectTicks(${j.Entity} entity, String id, double ticks, double amplifier, boolean ambient, boolean particles) {
net.minecraft.potion.Effect effect = net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(rl(id));
if (effect != null && entity instanceof ${j.LivingEntity}) ((${j.LivingEntity}) entity).addEffect(new ${j.MobEffectInstance}(effect, (int) ticks, (int) amplifier, ambient, particles));
}`,
      (j) => `static void addEffectTicks(${j.Entity} entity, String id, double ticks, double amplifier, boolean ambient, boolean particles) {
if (entity instanceof ${j.LivingEntity} living) ${j.BuiltInRegistries}.MOB_EFFECT.get(rl(id)).ifPresent(effect -> living.addEffect(new ${j.MobEffectInstance}(effect, (int) ticks, (int) amplifier, ambient, particles)));
}`),
  },
  // An item entity in the world with a pickup delay.
  spawnItem: {
    uses: ["level"],
    code: all((j) => `static void spawnItem(${j.LevelAccessor} world, double x, double y, double z, ${j.ItemStack} stack, double pickUpDelay, boolean persistent) {
${j.Level} level = level(world);
if (level == null) return;
${j.ItemEntity} entity = new ${j.ItemEntity}(level, x, y, z, stack);
entity.setPickUpDelay((int) pickUpDelay);
if (persistent) entity.setExtendedLifetime();
level.addFreshEntity(entity);
}`),
  },
  // ---- energy (block energy storage is generated for 1.16.5 only) ----
  // Energy of a block: the Forge and NeoForge capabilities reach any mod's block; Fabric API has no energy, so Fabric
  // reaches blocks of this mod. 26.3 moves energy inside transactions.
  energyHandler: {
    uses: ["pos", "level"],
    code: {
      "neoforge-1.21.5": (j) => `static net.neoforged.neoforge.energy.IEnergyStorage energyHandler(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? null : level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.EnergyStorage.BLOCK, pos(x, y, z), null);
}`,
      "neoforge-26.3": (j) => `static net.neoforged.neoforge.transfer.energy.EnergyHandler energyHandler(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? null : level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.Energy.BLOCK, pos(x, y, z), null);
}`,
    },
  },
  energyStored: {
    uses: ["pos", "energyHandler"],
    code: {
      "1.16.5": (j) => `static double energyStored(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
final int[] result = {0};
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.energy.CapabilityEnergy.ENERGY, null).ifPresent(energy -> result[0] = capacity ? energy.getMaxEnergyStored() : energy.getEnergyStored());
return result[0];
}`,
      "neoforge-1.21.5": (j) => `static double energyStored(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
var energy = energyHandler(world, x, y, z);
return energy == null ? 0 : capacity ? energy.getMaxEnergyStored() : energy.getEnergyStored();
}`,
      "neoforge-26.3": (j) => `static double energyStored(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
var energy = energyHandler(world, x, y, z);
return energy == null ? 0 : capacity ? energy.getCapacityAsInt() : energy.getAmountAsInt();
}`,
      fabric: (j) => `static double energyStored(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
return world.getBlockEntity(pos(x, y, z)) instanceof BlockDataHolder holder ? holder.energy(capacity) : 0;
}`,
    },
  },
  extractEnergy: {
    uses: ["pos", "energyHandler"],
    code: {
      "1.16.5": (j) => `static void extractEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.energy.CapabilityEnergy.ENERGY, null).ifPresent(energy -> energy.extractEnergy((int) amount, false));
}`,
      "neoforge-1.21.5": (j) => `static void extractEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var energy = energyHandler(world, x, y, z);
if (energy != null) energy.extractEnergy((int) amount, false);
}`,
      "neoforge-26.3": (j) => `static void extractEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var energy = energyHandler(world, x, y, z);
if (energy == null) return;
try (var transaction = net.neoforged.neoforge.transfer.transaction.Transaction.openRoot()) {
energy.extract((int) amount, transaction);
transaction.commit();
}
}`,
      fabric: (j) => `static void extractEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
if (world.getBlockEntity(pos(x, y, z)) instanceof BlockDataHolder holder) holder.extractEnergy((int) amount);
}`,
    },
  },
  receiveEnergy: {
    uses: ["pos", "energyHandler"],
    code: {
      "1.16.5": (j) => `static void receiveEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.energy.CapabilityEnergy.ENERGY, null).ifPresent(energy -> energy.receiveEnergy((int) amount, false));
}`,
      "neoforge-1.21.5": (j) => `static void receiveEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var energy = energyHandler(world, x, y, z);
if (energy == null) return;
if (amount < 0) {
// Negatif miktar enerjiyi düşürür (MCreator davranışı); çekme sınırı tur başına uygulanır, tekrar çekilir.
// A negative amount drains (MCreator behaviour); extract is limited per call, so it repeats.
int left = (int) -amount;
while (left > 0) {
int moved = energy.extractEnergy(left, false);
if (moved <= 0) break;
left -= moved;
}
return;
}
energy.receiveEnergy((int) amount, false);
}`,
      "neoforge-26.3": (j) => `static void receiveEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var energy = energyHandler(world, x, y, z);
if (energy == null) return;
try (var transaction = net.neoforged.neoforge.transfer.transaction.Transaction.openRoot()) {
if (amount < 0) {
// insert negatif miktarda istisna atar; negatif miktar, sınır tur başına olduğundan tekrarlanan çekmedir.
// insert throws on a negative amount; a negative amount drains, repeating because extract is limited per call.
int left = (int) -amount;
while (left > 0) {
int moved = energy.extract(left, transaction);
if (moved <= 0) break;
left -= moved;
}
} else {
energy.insert((int) amount, transaction);
}
transaction.commit();
}
}`,
      fabric: (j) => `static void receiveEnergy(${j.LevelAccessor} world, double x, double y, double z, double amount) {
if (!(world.getBlockEntity(pos(x, y, z)) instanceof BlockDataHolder holder)) return;
if (amount < 0) {
// Negatif miktar enerjiyi düşürür; çekme sınırı tur başına olduğundan tekrarlanır.
// A negative amount drains; extract is limited per call, so it repeats.
int left = (int) -amount;
while (left > 0) {
int moved = holder.extractEnergy(left);
if (moved <= 0) break;
left -= moved;
}
return;
}
holder.receiveEnergy((int) amount);
}`,
    },
  },
  // Fluid in a block's first tank, in millibuckets (Fabric counts 81 droplets to one).
  fluidHandler: {
    uses: ["pos", "level"],
    code: {
      "neoforge-1.21.5": (j) => `static net.neoforged.neoforge.fluids.capability.IFluidHandler fluidHandler(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? null : level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.FluidHandler.BLOCK, pos(x, y, z), null);
}`,
      "neoforge-26.3": (j) => `static net.neoforged.neoforge.transfer.ResourceHandler<net.neoforged.neoforge.transfer.fluid.FluidResource> fluidHandler(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? null : level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.Fluid.BLOCK, pos(x, y, z), null);
}`,
      fabric: (j) => `static net.fabricmc.fabric.api.transfer.v1.storage.Storage<net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariant> fluidHandler(${j.LevelAccessor} world, double x, double y, double z) {
${j.Level} level = level(world);
return level == null ? null : net.fabricmc.fabric.api.transfer.v1.fluid.FluidStorage.SIDED.find(level, pos(x, y, z), null);
}`,
    },
  },
  fluidAmount: {
    uses: ["pos", "fluidHandler"],
    code: {
      "1.16.5": (j) => `static double fluidAmount(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
final int[] result = {0};
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.fluids.capability.CapabilityFluidHandler.FLUID_HANDLER_CAPABILITY, null).ifPresent(tank -> result[0] = capacity ? tank.getTankCapacity(0) : tank.getFluidInTank(0).getAmount());
return result[0];
}`,
      "neoforge-1.21.5": (j) => `static double fluidAmount(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
var tank = fluidHandler(world, x, y, z);
return tank == null ? 0 : capacity ? tank.getTankCapacity(0) : tank.getFluidInTank(0).getAmount();
}`,
      "neoforge-26.3": (j) => `static double fluidAmount(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
var tank = fluidHandler(world, x, y, z);
return tank == null ? 0 : capacity ? tank.getCapacityAsInt(0, tank.getResource(0)) : tank.getAmountAsInt(0);
}`,
      fabric: (j) => `static double fluidAmount(${j.LevelAccessor} world, double x, double y, double z, boolean capacity) {
var tank = fluidHandler(world, x, y, z);
if (tank == null) return 0;
for (var view : tank) return (capacity ? view.getCapacity() : view.getAmount()) / 81.0;
return 0;
}`,
    },
  },
  fluidId: {
    uses: ["pos", "fluidHandler"],
    code: {
      "1.16.5": (j) => `static String fluidId(${j.LevelAccessor} world, double x, double y, double z) {
final String[] result = {""};
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.fluids.capability.CapabilityFluidHandler.FLUID_HANDLER_CAPABILITY, null).ifPresent(tank -> {
if (!tank.getFluidInTank(0).isEmpty()) result[0] = String.valueOf(tank.getFluidInTank(0).getFluid().getRegistryName());
});
return result[0];
}`,
      "neoforge-1.21.5": (j) => `static String fluidId(${j.LevelAccessor} world, double x, double y, double z) {
var tank = fluidHandler(world, x, y, z);
return tank == null || tank.getFluidInTank(0).isEmpty() ? "" : ${j.BuiltInRegistries}.FLUID.getKey(tank.getFluidInTank(0).getFluid()).toString();
}`,
      "neoforge-26.3": (j) => `static String fluidId(${j.LevelAccessor} world, double x, double y, double z) {
var tank = fluidHandler(world, x, y, z);
return tank == null || tank.getResource(0).isEmpty() ? "" : ${j.BuiltInRegistries}.FLUID.getKey(tank.getResource(0).getFluid()).toString();
}`,
      fabric: (j) => `static String fluidId(${j.LevelAccessor} world, double x, double y, double z) {
var tank = fluidHandler(world, x, y, z);
if (tank == null) return "";
for (var view : tank) return view.isResourceBlank() ? "" : ${j.BuiltInRegistries}.FLUID.getKey(view.getResource().getFluid()).toString();
return "";
}`,
    },
  },
  fillFluid: {
    uses: ["pos", "rl", "fluidHandler"],
    code: {
      "1.16.5": (j) => `static void fillFluid(${j.LevelAccessor} world, double x, double y, double z, String id, double amount) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.fluids.capability.CapabilityFluidHandler.FLUID_HANDLER_CAPABILITY, null).ifPresent(tank -> tank.fill(new net.minecraftforge.fluids.FluidStack(net.minecraftforge.registries.ForgeRegistries.FLUIDS.getValue(rl(id)), (int) amount), net.minecraftforge.fluids.capability.IFluidHandler.FluidAction.EXECUTE));
}`,
      "neoforge-1.21.5": (j) => `static void fillFluid(${j.LevelAccessor} world, double x, double y, double z, String id, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank != null) tank.fill(new net.neoforged.neoforge.fluids.FluidStack(${j.BuiltInRegistries}.FLUID.getValue(rl(id)), (int) amount), net.neoforged.neoforge.fluids.capability.IFluidHandler.FluidAction.EXECUTE);
}`,
      "neoforge-26.3": (j) => `static void fillFluid(${j.LevelAccessor} world, double x, double y, double z, String id, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank == null) return;
try (var transaction = net.neoforged.neoforge.transfer.transaction.Transaction.openRoot()) {
tank.insert(net.neoforged.neoforge.transfer.fluid.FluidResource.of(${j.BuiltInRegistries}.FLUID.getValue(rl(id))), (int) amount, transaction);
transaction.commit();
}
}`,
      fabric: (j) => `static void fillFluid(${j.LevelAccessor} world, double x, double y, double z, String id, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank == null) return;
try (var transaction = net.fabricmc.fabric.api.transfer.v1.transaction.Transaction.openOuter()) {
tank.insert(net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariant.of(${j.BuiltInRegistries}.FLUID.getValue(rl(id))), (long) amount * 81L, transaction);
transaction.commit();
}
}`,
    },
  },
  drainFluid: {
    uses: ["pos", "fluidHandler"],
    code: {
      "1.16.5": (j) => `static void drainFluid(${j.LevelAccessor} world, double x, double y, double z, double amount) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.fluids.capability.CapabilityFluidHandler.FLUID_HANDLER_CAPABILITY, null).ifPresent(tank -> tank.drain((int) amount, net.minecraftforge.fluids.capability.IFluidHandler.FluidAction.EXECUTE));
}`,
      "neoforge-1.21.5": (j) => `static void drainFluid(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank != null) tank.drain((int) amount, net.neoforged.neoforge.fluids.capability.IFluidHandler.FluidAction.EXECUTE);
}`,
      "neoforge-26.3": (j) => `static void drainFluid(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank == null || tank.getResource(0).isEmpty()) return;
try (var transaction = net.neoforged.neoforge.transfer.transaction.Transaction.openRoot()) {
tank.extract(tank.getResource(0), (int) amount, transaction);
transaction.commit();
}
}`,
      fabric: (j) => `static void drainFluid(${j.LevelAccessor} world, double x, double y, double z, double amount) {
var tank = fluidHandler(world, x, y, z);
if (tank == null) return;
try (var transaction = net.fabricmc.fabric.api.transfer.v1.transaction.Transaction.openOuter()) {
for (var view : tank) {
if (!view.isResourceBlank()) view.extract(view.getResource(), (long) amount * 81L, transaction);
break;
}
transaction.commit();
}
}`,
    },
  },
  // Sets an integer property of the block at a position when the block has it and allows the value.
  setBlockProperty: {
    uses: ["pos"],
    code: all((j) => `static void setBlockProperty(${j.LevelAccessor} world, double x, double y, double z, String name, double value) {
${j.BlockPos} pos = pos(x, y, z);
${j.BlockState} state = world.getBlockState(pos);
${j.Property}<?> property = state.getBlock().getStateDefinition().getProperty(name);
if (property instanceof ${j.IntegerProperty} && property.getPossibleValues().contains((int) value)) world.setBlock(pos, state.setValue((${j.IntegerProperty}) property, (int) value), 3);
}`),
  },
  setBlockPropertyLogic: {
    uses: ["pos"],
    code: all((j) => `static void setBlockPropertyLogic(${j.LevelAccessor} world, double x, double y, double z, String name, boolean value) {
${j.BlockPos} pos = pos(x, y, z);
${j.BlockState} state = world.getBlockState(pos);
${j.Property}<?> property = state.getBlock().getStateDefinition().getProperty(name);
if (property instanceof ${j.BooleanProperty}) world.setBlock(pos, state.setValue((${j.BooleanProperty}) property, value), 3);
}`),
  },
  // Damages a stack as a tool is damaged (unbreaking applies); when that breaks it, one is taken and the next starts undamaged.
  hurtBreak: {
    uses: ["level"],
    code: {
      "1.16.5": (j) => `static void hurtBreak(${j.ItemStack} stack, double amount) {
if (stack.hurt((int) amount, java.util.concurrent.ThreadLocalRandom.current(), null)) {
stack.shrink(1);
stack.setDamageValue(0);
}
}`,
      // 1.21.2 replaced ItemStack.hurt by hurtAndBreak, which takes the level; unbreaking needs it, so this runs on the server.
      modern: (j) => `static void hurtBreak(${j.LevelAccessor} world, ${j.ItemStack} stack, double amount) {
if (level(world) instanceof ${j.ServerLevel} level) stack.hurtAndBreak((int) amount, level, null, broken -> stack.setDamageValue(0));
}`,
    },
  },
  removeGuiSlotItem: {
    uses: ["guiSlot"],
    code: all((j) => `static void removeGuiSlotItem(${j.Entity} entity, double slot, double amount) {
if (guiSlot(entity, slot) == null) return;
guiSlot(entity, slot).remove((int) amount);
((${j.Player}) entity).containerMenu.broadcastChanges();
}`),
  },
  effectTicksLeft: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static double effectTicksLeft(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.LivingEntity})) return 0;
for (net.minecraft.potion.EffectInstance active : ((${j.LivingEntity}) entity).getActiveEffects()) {
if (active.getEffect() == net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(rl(id))) return active.getDuration();
}
return 0;
}`,
      (j) => `static double effectTicksLeft(${j.Entity} entity, String id) {
if (!(entity instanceof ${j.LivingEntity} living)) return 0;
return ${j.BuiltInRegistries}.MOB_EFFECT.get(rl(id)).map(effect -> living.getEffect(effect)).map(active -> active.getDuration()).orElse(0);
}`),
  },
  commandEntity: {
    code: legacyModern(
      (j) => `static ${j.Entity} commandEntity(com.mojang.brigadier.context.CommandContext<${j.CommandSourceStack}> context, String name) {
try {
return net.minecraft.command.arguments.EntityArgument.getEntity(context, name);
} catch (com.mojang.brigadier.exceptions.CommandSyntaxException e) {
return null;
}
}`,
      (j) => `static ${j.Entity} commandEntity(com.mojang.brigadier.context.CommandContext<${j.CommandSourceStack}> context, String name) {
try {
return net.minecraft.commands.arguments.EntityArgument.getEntity(context, name);
} catch (com.mojang.brigadier.exceptions.CommandSyntaxException e) {
return null;
}
}`),
  },
  // ---- last imported shapes ----
  // `gamerule <rule> <value>` through the server's command handler, as the MCreator block does (26.x names rules by identifier).
  setGameRule: {
    uses: ["runCommand", "level", "gameRuleId"],
    code: legacyModern(
      (j) => `static void setGameRule(${j.LevelAccessor} world, String rule, double value) {
String id = gameRuleId(world, rule);
if (id != null) runCommand(world, 0, 0, 0, "gamerule " + id + " " + (int) value);
}`,
      // Set directly: a command run from a command waits for the outer one on modern versions, so a read after it sees the old value.
      (j) => `static void setGameRule(${j.LevelAccessor} world, String rule, double value) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return;
String id = gameRuleId(world, rule);
if (id == null) return;
level.getGameRules().visitGameRuleTypes(new ${j.GameRules}.GameRuleTypeVisitor() {
@Override
public void visitInteger(${j.GameRules}.Key<${j.GameRules}.IntegerValue> key, ${j.GameRules}.Type<${j.GameRules}.IntegerValue> type) {
if (key.getId().equals(id)) level.getGameRules().getRule(key).set((int) value, level.getServer());
}
});
}`,
      (j) => `static void setGameRule(${j.LevelAccessor} world, String rule, double value) {
if (!(level(world) instanceof ${j.ServerLevel} level)) return;
String id = gameRuleId(world, rule);
if (id == null) return;
level.getGameRules().availableRules().filter(r -> r.valueClass() == Integer.class && r.getIdentifier().getPath().equals(id)).findFirst()
.ifPresent(r -> level.getGameRules().set((net.minecraft.world.level.gamerules.GameRule<Integer>) r, (int) value, level.getServer()));
}`),
  },
  // The weather flag of the world data: raining now, without the fade the rain level has.
  rainingFlag: {
    uses: ["level"],
    code: legacyModern(
      (j) => `static boolean rainingFlag(${j.LevelAccessor} world) {
return world.getLevelData().isRaining();
}`,
      (j) => `static boolean rainingFlag(${j.LevelAccessor} world) {
return world.getLevelData().isRaining();
}`,
      (j) => `static boolean rainingFlag(${j.LevelAccessor} world) {
if (level(world) instanceof ${j.ServerLevel} server) return server.getWeatherData().isRaining();
return level(world) != null && level(world).isRaining();
}`),
  },
  itemActivation: {
    client: true,
    code: legacyModern(
      (j) => `static void itemActivation(${j.ItemStack} stack) {
${j.Minecraft}.getInstance().gameRenderer.displayItemActivation(stack);
}`,
      (j) => `static void itemActivation(${j.ItemStack} stack) {
${j.Minecraft}.getInstance().gameRenderer.displayItemActivation(stack);
}`,
      (j) => `static void itemActivation(${j.ItemStack} stack) {
${j.Minecraft} minecraft = ${j.Minecraft}.getInstance();
if (minecraft.player != null) minecraft.player.displayItemActivation(stack);
}`),
  },
  // Removes up to `amount` of the items of a stack's kind from a player's inventory, crafting grid and cursor included.
  clearMatching: {
    code: legacyModern(
      (j) => `static void clearMatching(${j.Entity} entity, ${j.ItemStack} stack, double amount) {
if (entity instanceof ${j.Player}) ((${j.Player}) entity).inventory.clearOrCountMatchingItems(p -> stack.getItem() == p.getItem(), (int) amount, ((${j.Player}) entity).inventoryMenu.getCraftSlots());
}`,
      (j) => `static void clearMatching(${j.Entity} entity, ${j.ItemStack} stack, double amount) {
if (entity instanceof ${j.Player} player) player.getInventory().clearOrCountMatchingItems(p -> stack.getItem() == p.getItem(), (int) amount, player.inventoryMenu.getCraftSlots());
}`,
      (j) => `static void clearMatching(${j.Entity} entity, ${j.ItemStack} stack, double amount) {
if (entity instanceof ${j.Player} player) player.getInventory().clearOrCountMatchingItems(p -> stack.getItem() == p.getItem(), false, (int) amount, player.inventoryMenu.getCraftSlots());
}`),
  },
  // Whether any slot of a player's inventory (hotbar, armor, offhand too) holds the stack's kind of item.
  hasStack: {
    code: legacyModern(
      (j) => `static boolean hasStack(${j.Entity} entity, ${j.ItemStack} stack) {
if (!(entity instanceof ${j.Player})) return false;
for (int i = 0; i < ((${j.Player}) entity).inventory.getContainerSize(); i++) {
${j.ItemStack} slot = ((${j.Player}) entity).inventory.getItem(i);
if (!slot.isEmpty() && slot.getItem() == stack.getItem()) return true;
}
return false;
}`,
      (j) => `static boolean hasStack(${j.Entity} entity, ${j.ItemStack} stack) {
if (!(entity instanceof ${j.Player} player)) return false;
for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
${j.ItemStack} slot = player.getInventory().getItem(i);
if (!slot.isEmpty() && slot.getItem() == stack.getItem()) return true;
}
return false;
}`),
  },
  // How many items of the stack's kind an entity's inventory holds. 1.16.5 asks the item handler capability as MCreator does;
  // later versions count a player's inventory (other entities hold none).
  countLike: {
    code: legacyModern(
      (j) => `static double countLike(${j.Entity} entity, ${j.ItemStack} stack) {
final java.util.concurrent.atomic.AtomicReference<net.minecraftforge.items.IItemHandler> handler = new java.util.concurrent.atomic.AtomicReference<>();
entity.getCapability(net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY, null).ifPresent(found -> handler.set(found));
double total = 0;
if (handler.get() != null) {
for (int i = 0; i < handler.get().getSlots(); i++) {
${j.ItemStack} slot = handler.get().getStackInSlot(i).copy();
if (stack.getItem() == slot.getItem()) total += slot.getCount();
}
}
return total;
}`,
      (j) => `static double countLike(${j.Entity} entity, ${j.ItemStack} stack) {
double total = 0;
if (entity instanceof ${j.Player} player) {
for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
${j.ItemStack} slot = player.getInventory().getItem(i);
if (stack.getItem() == slot.getItem()) total += slot.getCount();
}
}
return total;
}`),
  },
  // Right-clicks a block as the player with an empty hand aimed nowhere, as MCreator's "use block" does.
  useBlock: {
    uses: ["pos"],
    code: legacyModern(
      (j) => `static void useBlock(${j.Entity} entity, double x, double y, double z) {
${j.BlockPos} pos = pos(x, y, z);
((${j.Player}) entity).level.getBlockState(pos).getBlock().use(entity.level.getBlockState(pos), entity.level, pos, (${j.Player}) entity, ${j.InteractionHand}.MAIN_HAND,
${j.BlockHitResult}.miss(new ${j.Vec3}(pos.getX(), pos.getY(), pos.getZ()), ${j.Direction}.UP, pos));
}`,
      (j) => `static void useBlock(${j.Entity} entity, double x, double y, double z) {
${j.BlockPos} pos = pos(x, y, z);
${j.Player} player = (${j.Player}) entity;
player.level().getBlockState(pos).useWithoutItem(player.level(), player, ${j.BlockHitResult}.miss(new ${j.Vec3}(pos.getX(), pos.getY(), pos.getZ()), ${j.Direction}.UP, pos));
}`),
  },
  dimensionLevel: {
    uses: ["rl"],
    code: legacyModern(
      (j) => `static ${j.LevelAccessor} dimensionLevel(${j.LevelAccessor} world, String id) {
if (!(world instanceof ${j.ServerLevel})) return null;
return ((${j.ServerLevel}) world).getServer().getLevel(${j.ResourceKey}.create(${j.Registry}.DIMENSION_REGISTRY, rl(id)));
}`,
      (j) => `static ${j.LevelAccessor} dimensionLevel(${j.LevelAccessor} world, String id) {
if (!(world instanceof ${j.ServerLevel} level)) return null;
return level.getServer().getLevel(${j.ResourceKey}.create(${j.Registries}.DIMENSION, rl(id)));
}`),
  },
  // ---- block inventory ----
  // 1.16.5 asks the item handler capability without a side, as MCreator procedures do; later versions read the
  // block entity's container.
  blockSlotItem: {
    uses: ["pos"],
    code: legacyModern(
      (j) => `static ${j.ItemStack} blockSlotItem(${j.LevelAccessor} world, double x, double y, double z, double slot) {
java.util.concurrent.atomic.AtomicReference<${j.ItemStack}> result = new java.util.concurrent.atomic.AtomicReference<>(${j.ItemStack}.EMPTY);
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY, null).ifPresent(handler -> result.set(handler.getStackInSlot((int) slot).copy()));
return result.get();
}`,
      (j) => `static ${j.ItemStack} blockSlotItem(${j.LevelAccessor} world, double x, double y, double z, double slot) {
if (!(world.getBlockEntity(pos(x, y, z)) instanceof net.minecraft.world.Container container) || (int) slot < 0 || (int) slot >= container.getContainerSize()) return ${j.ItemStack}.EMPTY;
return container.getItem((int) slot).copy();
}`),
  },
  setBlockSlotItem: {
    uses: ["pos"],
    code: legacyModern(
      (j) => `static void setBlockSlotItem(${j.LevelAccessor} world, double x, double y, double z, double slot, ${j.ItemStack} stack) {
${j.BlockEntity} entity = world.getBlockEntity(pos(x, y, z));
if (entity != null) entity.getCapability(net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY, null).ifPresent(handler -> {
if (handler instanceof net.minecraftforge.items.IItemHandlerModifiable) ((net.minecraftforge.items.IItemHandlerModifiable) handler).setStackInSlot((int) slot, stack);
});
}`,
      (j) => `static void setBlockSlotItem(${j.LevelAccessor} world, double x, double y, double z, double slot, ${j.ItemStack} stack) {
if (world.getBlockEntity(pos(x, y, z)) instanceof net.minecraft.world.Container container && (int) slot >= 0 && (int) slot < container.getContainerSize()) container.setItem((int) slot, stack);
}`),
  },
};

/** Fully qualified resource id class per generation. */
function type26(gen: "modern" | "26"): string {
  return gen === "26" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation";
}
