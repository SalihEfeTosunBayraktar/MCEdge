import type { CodeKey, Loader } from "./blockTypes.ts";
import type { Gen } from "./javaNames.ts";
import type { Dependency } from "./model.ts";

/**
 * What runs procedures: global triggers (game events, the procedure element's "Global trigger") and element
 * triggers (an element field such as an item's right-click procedure, generated as an override in the
 * element's class). Each lists the dependencies it provides and its Java per engine; an engine without code
 * for a trigger does not generate procedures using it.
 */

type Deps = Partial<Record<Dependency, string>>;

export interface TriggerCtx {
  /** Statements calling the procedure with the given dependency expressions; `cancel` runs when it cancelled. */
  run: (deps: Deps, cancel?: string) => string;
}

export interface GlobalTrigger {
  id: string;
  side: "server" | "client";
  deps: Dependency[];
  /** Registration statements in the generated <Mod>Procedures.init. */
  code: Partial<Record<CodeKey, ((t: TriggerCtx) => string) | null>>;
}

export function triggerCode<T>(code: Partial<Record<CodeKey, T | null>>, gen: Gen, loader: Loader): T | undefined {
  const keys: CodeKey[] = [`${loader}-${gen}`, loader, gen, ...(gen === "1.16.5" ? [] : ["modern" as const]), "all"];
  for (const key of keys) if (key in code) return code[key] ?? undefined;
  return undefined;
}

const NF = "net.neoforged.neoforge.event";
const FG = "net.minecraftforge.event";
const FAB = "net.fabricmc.fabric.api";
/** List the Fabric block place trigger adds to; a registration that names it needs the place mixin. */
export const BLOCK_PLACE_LISTENERS = "BlockPlaceEvents.LISTENERS";
/** List the Fabric hoe use trigger adds to; a registration that names it needs the hoe mixin. */
export const HOE_USE_LISTENERS = "HoeUseEvents.LISTENERS";
/** Listeners of the radial menu runtime (Q227); a registration that names it needs that runtime. */
export const RADIAL_LISTENERS = "RadialMenus.LISTENERS";

/** NeoForge game-bus listener. */
const nf = (event: string, body: string) => `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(${event}.class, event -> {\n${body}\n});`;
/** Forge 1.16.5 game-bus listener. */
const fg = (event: string, body: string) => `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, ${event}.class, event -> {\n${body}\n});`;

/** Dependencies of an entity: its position, world and itself. */
const at = (e: string, level: string): Deps => ({ x: `${e}.getX()`, y: `${e}.getY()`, z: `${e}.getZ()`, world: level, entity: e });
const atPos = (pos: string, level: string): Deps => ({ x: `${pos}.getX()`, y: `${pos}.getY()`, z: `${pos}.getZ()`, world: level });
const MODERN_LEVEL = (e: string) => `${e}.level()`;
const LEGACY_LEVEL = (e: string) => `${e}.level`;

const PLAYER_DEPS: Dependency[] = ["x", "y", "z", "world", "entity"];

/*
 * Sides and hands (KUYRUK 46, P2). MCreator 1.16.5 posts every global trigger on both logical sides and, for the click
 * triggers, only when `event.getHand() == player.getUsedItemHand()`: the hand of the item in use, which is the main hand
 * unless the player is using an offhand item. The click triggers here use the same test. Procedures run on the server
 * only; what the MCreator procedure did on the client (it can only change client copies, which the server's next sync
 * overwrites) is done by the segments a procedure sends to the client, so no trigger is dispatched on the client.
 */
export const GLOBAL_TRIGGERS: GlobalTrigger[] = [
  {
    id: "no_ext_trigger", side: "server", deps: [],
    code: { all: () => "" },
  },
  {
    id: "mod_load", side: "server", deps: [],
    code: { all: (t) => t.run({}) },
  },
  {
    id: "mod_serverload", side: "server", deps: ["world"],
    code: {
      neoforge: (t) => nf(`${NF}.server.ServerStartedEvent`, t.run({ world: "event.getServer().overworld()" })),
      forge: (t) => fg("net.minecraftforge.fml.event.server.FMLServerStartedEvent", t.run({ world: "event.getServer().overworld()" })),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerLifecycleEvents.SERVER_STARTED.register(server -> {\n${t.run({ world: "server.overworld()" })}\n});`,
    },
  },
  {
    id: "world_load", side: "server", deps: ["world"],
    code: {
      neoforge: (t) => nf(`${NF}.level.LevelEvent.Load`, `if (event.getLevel().isClientSide()) return;\n${t.run({ world: "event.getLevel()" })}`),
      forge: (t) => fg(`${FG}.world.WorldEvent.Load`, `if (event.getWorld().isClientSide()) return;\n${t.run({ world: "event.getWorld()" })}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerWorldEvents.LOAD.register((server, world) -> {\n${t.run({ world: "world" })}\n});`,
      "fabric-26.3": (t) => `${FAB}.event.lifecycle.v1.ServerLevelEvents.LOAD.register((server, world) -> {\n${t.run({ world: "world" })}\n});`,
    },
  },
  {
    id: "world_unload", side: "server", deps: ["world"],
    code: {
      neoforge: (t) => nf(`${NF}.level.LevelEvent.Unload`, `if (event.getLevel().isClientSide()) return;\n${t.run({ world: "event.getLevel()" })}`),
      forge: (t) => fg(`${FG}.world.WorldEvent.Unload`, `if (event.getWorld().isClientSide()) return;\n${t.run({ world: "event.getWorld()" })}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerWorldEvents.UNLOAD.register((server, world) -> {\n${t.run({ world: "world" })}\n});`,
      "fabric-26.3": (t) => `${FAB}.event.lifecycle.v1.ServerLevelEvents.UNLOAD.register((server, world) -> {\n${t.run({ world: "world" })}\n});`,
    },
  },
  {
    id: "player_log_in", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerEvent.PlayerLoggedInEvent`, `net.minecraft.world.entity.player.Player player = event.getEntity();\n${t.run(at("player", MODERN_LEVEL("player")))}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerEvent.PlayerLoggedInEvent`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\n${t.run(at("player", LEGACY_LEVEL("player")))}`),
      fabric: (t) => `${FAB}.networking.v1.ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {\nnet.minecraft.server.level.ServerPlayer player = handler.player;\n${t.run(at("player", MODERN_LEVEL("player")))}\n});`,
    },
  },
  {
    id: "player_log_out", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerEvent.PlayerLoggedOutEvent`, `net.minecraft.world.entity.player.Player player = event.getEntity();\n${t.run(at("player", MODERN_LEVEL("player")))}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerEvent.PlayerLoggedOutEvent`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\n${t.run(at("player", LEGACY_LEVEL("player")))}`),
      fabric: (t) => `${FAB}.networking.v1.ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {\nnet.minecraft.server.level.ServerPlayer player = handler.player;\n${t.run(at("player", MODERN_LEVEL("player")))}\n});`,
    },
  },
  {
    id: "player_respawn", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerEvent.PlayerRespawnEvent`, `net.minecraft.world.entity.player.Player player = event.getEntity();\n${t.run(at("player", MODERN_LEVEL("player")))}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerEvent.PlayerRespawnEvent`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\n${t.run(at("player", LEGACY_LEVEL("player")))}`),
      fabric: (t) => `${FAB}.entity.event.v1.ServerPlayerEvents.AFTER_RESPAWN.register((oldPlayer, player, alive) -> {\n${t.run(at("player", MODERN_LEVEL("player")))}\n});`,
    },
  },
  {
    id: "player_ticks", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.tick.PlayerTickEvent.Post`, `net.minecraft.world.entity.player.Player player = event.getEntity();\nif (player.level().isClientSide()) return;\n${t.run(at("player", MODERN_LEVEL("player")))}`),
      forge: (t) => fg(`${FG}.TickEvent.PlayerTickEvent`, `if (event.phase != ${FG}.TickEvent.Phase.END || event.player.level.isClientSide()) return;\nnet.minecraft.entity.player.PlayerEntity player = event.player;\n${t.run(at("player", LEGACY_LEVEL("player")))}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {\nfor (net.minecraft.server.level.ServerPlayer player : new java.util.ArrayList<>(server.getPlayerList().getPlayers())) {\n${t.run(at("player", MODERN_LEVEL("player")))}\n}\n});`,
    },
  },
  {
    id: "world_ticks", side: "server", deps: ["world"],
    code: {
      neoforge: (t) => nf(`${NF}.tick.LevelTickEvent.Post`, `if (event.getLevel().isClientSide()) return;\n${t.run({ world: "event.getLevel()" })}`),
      forge: (t) => fg(`${FG}.TickEvent.WorldTickEvent`, `if (event.phase != ${FG}.TickEvent.Phase.END || event.world.isClientSide()) return;\n${t.run({ world: "event.world" })}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {\nfor (net.minecraft.server.level.ServerLevel level : server.getAllLevels()) {\n${t.run({ world: "level" })}\n}\n});`,
    },
  },
  {
    // Once per server tick, after the worlds ticked (world_ticks runs once per dimension); world is the overworld.
    id: "server_ticks", side: "server", deps: ["world"],
    code: {
      neoforge: (t) => nf(`${NF}.tick.ServerTickEvent.Post`, `net.minecraft.server.level.ServerLevel level = event.getServer().overworld();\n${t.run({ world: "level" })}`),
      forge: (t) => fg(`${FG}.TickEvent.ServerTickEvent`, `if (event.phase != ${FG}.TickEvent.Phase.END) return;\nnet.minecraft.server.MinecraftServer server = net.minecraftforge.fml.server.ServerLifecycleHooks.getCurrentServer();\nif (server == null) return;\nnet.minecraft.world.server.ServerWorld level = server.overworld();\n${t.run({ world: "level" })}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {\nnet.minecraft.server.level.ServerLevel level = server.overworld();\n${t.run({ world: "level" })}\n});`,
    },
  },
  {
    id: "block_break", side: "server", deps: ["x", "y", "z", "world", "entity", "blockstate"],
    code: {
      "neoforge-1.21.5": (t) => nf(`${NF}.level.BlockEvent.BreakEvent`, t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getPlayer()", blockstate: "event.getState()" }, "event.setCanceled(true);")),
      "neoforge-26.3": (t) => nf(`${NF}.level.block.BreakBlockEvent`, t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getPlayer()", blockstate: "event.getState()" }, "event.setCanceled(true);")),
      forge: (t) => fg(`${FG}.world.BlockEvent.BreakEvent`, t.run({ ...atPos("event.getPos()", "event.getWorld()"), entity: "event.getPlayer()", blockstate: "event.getState()" }, "event.setCanceled(true);")),
      fabric: (t) => `${FAB}.event.player.PlayerBlockBreakEvents.BEFORE.register((level, player, pos, state, blockEntity) -> {\n${t.run({ ...atPos("pos", "level"), entity: "player", blockstate: "state" }, "return false;")}\nreturn true;\n});`,
    },
  },
  {
    id: "block_place", side: "server", deps: ["x", "y", "z", "world", "entity", "blockstate"],
    code: {
      neoforge: (t) => nf(`${NF}.level.BlockEvent.EntityPlaceEvent`, t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getEntity()", blockstate: "event.getPlacedBlock()" }, "event.setCanceled(true);")),
      forge: (t) => fg(`${FG}.world.BlockEvent.EntityPlaceEvent`, t.run({ ...atPos("event.getPos()", "event.getWorld()"), entity: "event.getEntity()", blockstate: "event.getPlacedBlock()" }, "event.setCanceled(true);")),
      // Fabric API has no place event; a generated mixin on BlockItem calls these listeners (see generator/procedures.ts).
      fabric: (t) => `${BLOCK_PLACE_LISTENERS}.add((world, pos, state, entity) -> {
boolean[] cancelled = {false};
${t.run({ ...atPos("pos", "world"), entity: "entity", blockstate: "state" }, "cancelled[0] = true;")}
return cancelled[0];
});`,
    },
  },
  {
    id: "player_right_click_block", side: "server", deps: ["x", "y", "z", "world", "entity", "direction", "blockstate"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerInteractEvent.RightClickBlock`, `if (event.getLevel().isClientSide() || event.getHand() != event.getEntity().getUsedItemHand()) return;\n${t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getEntity()", direction: "event.getFace()", blockstate: "event.getLevel().getBlockState(event.getPos())" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerInteractEvent.RightClickBlock`, `if (event.getWorld().isClientSide() || event.getHand() != event.getPlayer().getUsedItemHand()) return;\n${t.run({ ...atPos("event.getPos()", "event.getWorld()"), entity: "event.getPlayer()", direction: "event.getFace()", blockstate: "event.getWorld().getBlockState(event.getPos())" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.event.player.UseBlockCallback.EVENT.register((player, level, hand, hit) -> {\nif (level.isClientSide() || hand != player.getUsedItemHand()) return net.minecraft.world.InteractionResult.PASS;\n${t.run({ ...atPos("hit.getBlockPos()", "level"), entity: "player", direction: "hit.getDirection()", blockstate: "level.getBlockState(hit.getBlockPos())" }, "return net.minecraft.world.InteractionResult.FAIL;")}\nreturn net.minecraft.world.InteractionResult.PASS;\n});`,
    },
  },
  {
    id: "player_right_click_item", side: "server", deps: ["x", "y", "z", "world", "entity", "itemstack"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerInteractEvent.RightClickItem`, `if (event.getLevel().isClientSide()) return;\nnet.minecraft.world.entity.player.Player player = event.getEntity();\n${t.run({ ...at("player", "event.getLevel()"), itemstack: "event.getItemStack()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerInteractEvent.RightClickItem`, `if (event.getWorld().isClientSide()) return;\nnet.minecraft.entity.player.PlayerEntity player = event.getPlayer();\n${t.run({ ...at("player", "event.getWorld()"), itemstack: "event.getItemStack()" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.event.player.UseItemCallback.EVENT.register((player, level, hand) -> {\nif (level.isClientSide()) return net.minecraft.world.InteractionResult.PASS;\n${t.run({ ...at("player", "level"), itemstack: "player.getItemInHand(hand)" }, "return net.minecraft.world.InteractionResult.FAIL;")}\nreturn net.minecraft.world.InteractionResult.PASS;\n});`,
    },
  },
  {
    id: "player_left_click_block", side: "server", deps: ["x", "y", "z", "world", "entity", "direction", "blockstate"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerInteractEvent.LeftClickBlock`, `if (event.getLevel().isClientSide()) return;\n${t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getEntity()", direction: "event.getFace()", blockstate: "event.getLevel().getBlockState(event.getPos())" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerInteractEvent.LeftClickBlock`, `if (event.getWorld().isClientSide()) return;\n${t.run({ ...atPos("event.getPos()", "event.getWorld()"), entity: "event.getPlayer()", direction: "event.getFace()", blockstate: "event.getWorld().getBlockState(event.getPos())" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.event.player.AttackBlockCallback.EVENT.register((player, level, hand, pos, direction) -> {\nif (level.isClientSide()) return net.minecraft.world.InteractionResult.PASS;\n${t.run({ ...atPos("pos", "level"), entity: "player", direction: "direction", blockstate: "level.getBlockState(pos)" }, "return net.minecraft.world.InteractionResult.FAIL;")}\nreturn net.minecraft.world.InteractionResult.PASS;\n});`,
    },
  },
  {
    // MCreator's UseHoeEvent: the hoe's own use on a block (after the block's use did not take the click), main or off hand.
    id: "player_use_hoe", side: "server", deps: ["x", "y", "z", "world", "entity", "blockstate"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.UseItemOnBlockEvent`, `if (event.getUsePhase() != ${NF}.entity.player.UseItemOnBlockEvent.UsePhase.ITEM_AFTER_BLOCK || event.getLevel().isClientSide() || event.getPlayer() == null || !event.getItemStack().is(net.minecraft.tags.ItemTags.HOES)) return;\n${t.run({ ...atPos("event.getPos()", "event.getLevel()"), entity: "event.getPlayer()", blockstate: "event.getLevel().getBlockState(event.getPos())" }, "event.cancelWithResult(net.minecraft.world.InteractionResult.FAIL);")}`),
      forge: (t) => fg(`${FG}.entity.player.UseHoeEvent`, `if (event.getPlayer() == null || event.getPlayer().level.isClientSide()) return;\n${t.run({ ...atPos("event.getContext().getClickedPos()", "event.getPlayer().level"), entity: "event.getPlayer()", blockstate: "event.getPlayer().level.getBlockState(event.getContext().getClickedPos())" }, "event.setCanceled(true);")}`),
      // Fabric API has no such event; a generated mixin on ItemStack.useOn (reached only when the block's use passed) calls these listeners.
      fabric: (t) => `${HOE_USE_LISTENERS}.add((world, pos, state, player) -> {\nboolean[] cancelled = {false};\n${t.run({ ...atPos("pos", "world"), entity: "player", blockstate: "state" }, "cancelled[0] = true;")}\nreturn cancelled[0];\n});`,
    },
  },
  {
    id: "player_right_click_entity", side: "server", deps: ["x", "y", "z", "world", "entity", "sourceentity", "itemstack"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerInteractEvent.EntityInteract`, `if (event.getLevel().isClientSide() || event.getHand() != event.getEntity().getUsedItemHand()) return;\n${t.run({ ...at("event.getTarget()", "event.getLevel()"), sourceentity: "event.getEntity()", itemstack: "event.getItemStack()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerInteractEvent.EntityInteract`, `if (event.getWorld().isClientSide() || event.getHand() != event.getPlayer().getUsedItemHand()) return;\n${t.run({ ...at("event.getTarget()", "event.getWorld()"), sourceentity: "event.getPlayer()", itemstack: "event.getItemStack()" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.event.player.UseEntityCallback.EVENT.register((player, level, hand, target, hit) -> {\nif (level.isClientSide() || hand != player.getUsedItemHand()) return net.minecraft.world.InteractionResult.PASS;\n${t.run({ ...at("target", "level"), sourceentity: "player", itemstack: "player.getItemInHand(hand)" }, "return net.minecraft.world.InteractionResult.FAIL;")}\nreturn net.minecraft.world.InteractionResult.PASS;\n});`,
    },
  },
  {
    id: "entity_dies", side: "server", deps: ["x", "y", "z", "world", "entity", "sourceentity", "immediatesourceentity", "damagesource"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.living.LivingDeathEvent`, `net.minecraft.world.entity.LivingEntity living = event.getEntity();\nif (living.level().isClientSide()) return;\n${t.run({ ...at("living", MODERN_LEVEL("living")), sourceentity: "event.getSource().getEntity()", immediatesourceentity: "event.getSource().getDirectEntity()", damagesource: "event.getSource()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.living.LivingDeathEvent`, `net.minecraft.entity.LivingEntity living = event.getEntityLiving();\nif (living.level.isClientSide()) return;\n${t.run({ ...at("living", LEGACY_LEVEL("living")), sourceentity: "event.getSource().getEntity()", immediatesourceentity: "event.getSource().getDirectEntity()", damagesource: "event.getSource()" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register((living, source) -> {\n${t.run({ ...at("living", MODERN_LEVEL("living")), sourceentity: "source.getEntity()", immediatesourceentity: "source.getDirectEntity()", damagesource: "source" })}\n});`,
    },
  },
  {
    id: "entity_attacked", side: "server", deps: ["x", "y", "z", "world", "entity", "sourceentity", "immediatesourceentity", "damagesource", "amount"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.living.LivingIncomingDamageEvent`, `net.minecraft.world.entity.LivingEntity living = event.getEntity();\nif (living.level().isClientSide()) return;\n${t.run({ ...at("living", MODERN_LEVEL("living")), sourceentity: "event.getSource().getEntity()", immediatesourceentity: "event.getSource().getDirectEntity()", damagesource: "event.getSource()", amount: "event.getAmount()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.living.LivingAttackEvent`, `net.minecraft.entity.LivingEntity living = event.getEntityLiving();\nif (living.level.isClientSide()) return;\n${t.run({ ...at("living", LEGACY_LEVEL("living")), sourceentity: "event.getSource().getEntity()", immediatesourceentity: "event.getSource().getDirectEntity()", damagesource: "event.getSource()", amount: "event.getAmount()" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.entity.event.v1.ServerLivingEntityEvents.ALLOW_DAMAGE.register((living, source, amount) -> {\n${t.run({ ...at("living", MODERN_LEVEL("living")), sourceentity: "source.getEntity()", immediatesourceentity: "source.getDirectEntity()", damagesource: "source", amount: "amount" }, "return false;")}\nreturn true;\n});`,
    },
  },
  {
    id: "entity_joins_world", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.entity.EntityJoinLevelEvent`, `if (event.getLevel().isClientSide()) return;\n${t.run(at("event.getEntity()", "event.getLevel()"), "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.EntityJoinWorldEvent`, `if (event.getWorld().isClientSide()) return;\n${t.run(at("event.getEntity()", "event.getWorld()"), "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.event.lifecycle.v1.ServerEntityEvents.ENTITY_LOAD.register((entity, level) -> {\n${t.run(at("entity", "level"))}\n});`,
    },
  },
  {
    id: "chat_sent", side: "server", deps: [...PLAYER_DEPS, "text"],
    code: {
      neoforge: (t) => nf(`${NF}.ServerChatEvent`, `net.minecraft.server.level.ServerPlayer player = event.getPlayer();\n${t.run({ ...at("player", MODERN_LEVEL("player")), text: "event.getRawText()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.ServerChatEvent`, `net.minecraft.entity.player.ServerPlayerEntity player = event.getPlayer();\n${t.run({ ...at("player", LEGACY_LEVEL("player")), text: "event.getMessage()" }, "event.setCanceled(true);")}`),
      fabric: (t) => `${FAB}.message.v1.ServerMessageEvents.ALLOW_CHAT_MESSAGE.register((message, player, params) -> {\n${t.run({ ...at("player", MODERN_LEVEL("player")), text: "message.signedContent()" }, "return false;")}\nreturn true;\n});`,
    },
  },
  {
    id: "player_xp_level_change", side: "server", deps: [...PLAYER_DEPS, "amount"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerXpEvent.LevelChange`, `net.minecraft.world.entity.player.Player player = event.getEntity();\nif (player.level().isClientSide()) return;\n${t.run({ ...at("player", MODERN_LEVEL("player")), amount: "event.getLevels()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerXpEvent.LevelChange`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\nif (player.level.isClientSide()) return;\n${t.run({ ...at("player", LEGACY_LEVEL("player")), amount: "event.getLevels()" }, "event.setCanceled(true);")}`),
      fabric: null,
    },
  },
  {
    id: "item_crafted", side: "server", deps: [...PLAYER_DEPS, "itemstack"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerEvent.ItemCraftedEvent`, `net.minecraft.world.entity.player.Player player = event.getEntity();\nif (player.level().isClientSide()) return;\n${t.run({ ...at("player", MODERN_LEVEL("player")), itemstack: "event.getCrafting()" })}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerEvent.ItemCraftedEvent`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\nif (player.level.isClientSide()) return;\n${t.run({ ...at("player", LEGACY_LEVEL("player")), itemstack: "event.getCrafting()" })}`),
      fabric: null,
    },
  },
  {
    id: "item_smelted", side: "server", deps: [...PLAYER_DEPS, "itemstack"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.player.PlayerEvent.ItemSmeltedEvent`, `net.minecraft.world.entity.player.Player player = event.getEntity();\nif (player.level().isClientSide()) return;\n${t.run({ ...at("player", MODERN_LEVEL("player")), itemstack: "event.getSmelting()" })}`),
      forge: (t) => fg(`${FG}.entity.player.PlayerEvent.ItemSmeltedEvent`, `net.minecraft.entity.player.PlayerEntity player = event.getPlayer();\nif (player.level.isClientSide()) return;\n${t.run({ ...at("player", LEGACY_LEVEL("player")), itemstack: "event.getSmelting()" })}`),
      fabric: null,
    },
  },
  {
    id: "entity_falls", side: "server", deps: [...PLAYER_DEPS, "distance"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.living.LivingFallEvent`, `net.minecraft.world.entity.LivingEntity living = event.getEntity();\nif (living.level().isClientSide()) return;\n${t.run({ ...at("living", MODERN_LEVEL("living")), distance: "event.getDistance()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.living.LivingFallEvent`, `net.minecraft.entity.LivingEntity living = event.getEntityLiving();\nif (living.level.isClientSide()) return;\n${t.run({ ...at("living", LEGACY_LEVEL("living")), distance: "event.getDistance()" }, "event.setCanceled(true);")}`),
      fabric: null,
    },
  },
  {
    id: "entity_jumps", side: "server", deps: PLAYER_DEPS,
    code: {
      neoforge: (t) => nf(`${NF}.entity.living.LivingEvent.LivingJumpEvent`, `net.minecraft.world.entity.LivingEntity living = event.getEntity();\nif (living.level().isClientSide()) return;\n${t.run(at("living", MODERN_LEVEL("living")))}`),
      forge: (t) => fg(`${FG}.entity.living.LivingEvent.LivingJumpEvent`, `net.minecraft.entity.LivingEntity living = event.getEntityLiving();\nif (living.level.isClientSide()) return;\n${t.run(at("living", LEGACY_LEVEL("living")))}`),
      fabric: null,
    },
  },
  {
    id: "entity_healed", side: "server", deps: [...PLAYER_DEPS, "amount"],
    code: {
      neoforge: (t) => nf(`${NF}.entity.living.LivingHealEvent`, `net.minecraft.world.entity.LivingEntity living = event.getEntity();\nif (living.level().isClientSide()) return;\n${t.run({ ...at("living", MODERN_LEVEL("living")), amount: "event.getAmount()" }, "event.setCanceled(true);")}`),
      forge: (t) => fg(`${FG}.entity.living.LivingHealEvent`, `net.minecraft.entity.LivingEntity living = event.getEntityLiving();\nif (living.level.isClientSide()) return;\n${t.run({ ...at("living", LEGACY_LEVEL("living")), amount: "event.getAmount()" }, "event.setCanceled(true);")}`),
      fabric: null,
    },
  },
  {
    // Radial menus (Q227): the shared runtime (src/generator/radial.ts) calls its listeners after a slice's action ran.
    id: "radial_slice_chosen", side: "server", deps: [...PLAYER_DEPS, "menu", "tab", "slice"],
    code: {
      "1.16.5": (t) => `${RADIAL_LISTENERS}.add((player, menu, tab, slice) -> {\n${t.run({ ...at("player", LEGACY_LEVEL("player")), menu: "menu", tab: "tab", slice: "slice" })}\n});`,
      modern: (t) => `${RADIAL_LISTENERS}.add((player, menu, tab, slice) -> {\n${t.run({ ...at("player", MODERN_LEVEL("player")), menu: "menu", tab: "tab", slice: "slice" })}\n});`,
    },
  },
];

export const GLOBAL_TRIGGERS_BY_ID: ReadonlyMap<string, GlobalTrigger> = new Map(GLOBAL_TRIGGERS.map((t) => [t.id, t]));

/**
 * Element triggers: a procedure field of a generated element type becomes an override in the element's class.
 * `call(deps)` is the call expression of the field's procedure; `returns` is set when the procedure returns a
 * value the override uses.
 */
export interface ElementTriggerCtx {
  call: (deps: Deps) => string;
  /** Java type returned by the procedure, when it returns one. */
  returns?: string;
  /** Extra statements of the element's own behaviour that this override must keep (start using, ...). */
  extra?: string;
}

export interface ElementTrigger {
  id: string;
  side: "server" | "client";
  /** One overriding method (Java class member). */
  member: Partial<Record<CodeKey, ((t: ElementTriggerCtx) => string) | null>>;
}

const ov = (signature: string, body: string) => `\n    @Override\n    ${signature} {\n${body.split("\n").map((l) => `        ${l}`).join("\n")}\n    }\n`;
const ML = "net.minecraft.world.level.Level";
const MI = "net.minecraft.world.item";
const LI = "net.minecraft.item";
const ACTIONS = { legacy: "net.minecraft.util.ActionResultType", modern: "net.minecraft.world.InteractionResult" };
const clientEntity = (gen: "legacy" | "modern") => void gen;
void clientEntity;
const CLIENT_HELPERS = (pkg: string) => `${pkg}.procedures.client.ProcedureClientHelpers`;

/** Modern finishUsingItem override of an item with a finish procedure; `back` is the extra argument 26.x gives placeItemBackInInventory. */
function finishUsing(t: ElementTriggerCtx, back: string): string {
  const stack = `${MI}.ItemStack`;
  return ov(`public ${stack} finishUsingItem(${stack} itemstack, ${ML} world, net.minecraft.world.entity.LivingEntity entity)`,
    `${t.extra ? `${stack} remainder = ${t.extra};\n` : ""}${stack} retval = super.finishUsingItem(itemstack, world, entity);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack" })};${t.extra ? `\nif (retval.isEmpty()) return remainder;\nif (entity instanceof net.minecraft.world.entity.player.Player player && !player.getAbilities().instabuild) {\n    player.getInventory().placeItemBackInInventory(remainder${back});\n}` : ""}\nreturn retval;`);
}

/** Element triggers need the mod package for the client helpers; filled in by elementTriggers(). */
export function elementTriggers(pkg: string): ElementTrigger[] {
  const ch = CLIENT_HELPERS(pkg);
  return [
    {
      id: "item_right_clicked", side: "server",
      member: {
        "1.16.5": (t) => ov(`public net.minecraft.util.ActionResult<${LI}.ItemStack> use(net.minecraft.world.World world, net.minecraft.entity.player.PlayerEntity entity, net.minecraft.util.Hand hand)`,
          `net.minecraft.util.ActionResult<${LI}.ItemStack> result = super.use(world, entity, hand);${t.extra ? `\n${t.extra}\nresult = net.minecraft.util.ActionResult.consume(entity.getItemInHand(hand));` : ""}\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "entity.getItemInHand(hand)" })};\nreturn result;`),
        modern: (t) => ov(`public net.minecraft.world.InteractionResult use(${ML} world, net.minecraft.world.entity.player.Player entity, net.minecraft.world.InteractionHand hand)`,
          `net.minecraft.world.InteractionResult result = super.use(world, entity, hand);${t.extra ? `\n${t.extra}\nresult = net.minecraft.world.InteractionResult.CONSUME;` : ""}\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "entity.getItemInHand(hand)" })};\nreturn result;`),
      },
    },
    {
      id: "item_right_clicked_block", side: "server",
      // MCreator's onItemUseFirst: runs before the clicked block's own use, so a machine that consumes the click still sees the item.
      member: {
        "1.16.5": (t) => ov(`public ${ACTIONS.legacy} onItemUseFirst(${LI}.ItemStack stack, net.minecraft.item.ItemUseContext context)`,
          `${ACTIONS.legacy} result = super.onItemUseFirst(stack, context);\nnet.minecraft.world.World world = context.getLevel();\nnet.minecraft.util.math.BlockPos pos = context.getClickedPos();\nif (world.isClientSide()) return result;\n${t.returns ? "return " : ""}${t.call({ ...atPos("pos", "world"), entity: "context.getPlayer()", itemstack: "context.getItemInHand()", direction: "context.getClickedFace()", blockstate: "world.getBlockState(pos)" })};${t.returns ? "" : "\nreturn result;"}`),
        modern: (t) => ov(`public ${ACTIONS.modern} onItemUseFirst(${MI}.ItemStack stack, ${MI}.context.UseOnContext context)`,
          `${ACTIONS.modern} result = super.onItemUseFirst(stack, context);\n${ML} world = context.getLevel();\nnet.minecraft.core.BlockPos pos = context.getClickedPos();\nif (world.isClientSide()) return result;\n${t.returns ? "return " : ""}${t.call({ ...atPos("pos", "world"), entity: "context.getPlayer()", itemstack: "context.getItemInHand()", direction: "context.getClickedFace()", blockstate: "world.getBlockState(pos)" })};${t.returns ? "" : "\nreturn result;"}`),
        // Fabric has no item hook before the block's use: a callback registered by the item instance does the same (UseBlockCallback runs first).
        fabric: (t) => `\n    {\n        ${FAB}.event.player.UseBlockCallback.EVENT.register((player, world, hand, hit) -> {\n            ${MI}.ItemStack itemstack = player.getItemInHand(hand);\n            if (itemstack.getItem() != this || world.isClientSide()) return ${ACTIONS.modern}.PASS;\n            net.minecraft.core.BlockPos pos = hit.getBlockPos();\n            ${t.returns ? "return " : ""}${t.call({ ...atPos("pos", "world"), entity: "player", itemstack: "itemstack", direction: "hit.getDirection()", blockstate: "world.getBlockState(pos)" })};${t.returns ? "" : `\n            return ${ACTIONS.modern}.PASS;`}\n        });\n    }\n`,
      },
    },
    {
      id: "item_crafted", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void onCraftedBy(${LI}.ItemStack itemstack, net.minecraft.world.World world, net.minecraft.entity.player.PlayerEntity entity)`,
          `super.onCraftedBy(itemstack, world, entity);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack" })};`),
        modern: (t) => ov(`public void onCraftedBy(${MI}.ItemStack itemstack, net.minecraft.world.entity.player.Player entity)`,
          `super.onCraftedBy(itemstack, entity);\nif (!entity.level().isClientSide()) ${t.call({ ...at("entity", "entity.level()"), itemstack: "itemstack" })};`),
      },
    },
    {
      id: "item_entity_hit", side: "server",
      member: {
        "1.16.5": (t) => ov(`public boolean hurtEnemy(${LI}.ItemStack itemstack, net.minecraft.entity.LivingEntity entity, net.minecraft.entity.LivingEntity sourceentity)`,
          `boolean result = super.hurtEnemy(itemstack, entity, sourceentity);\nif (!entity.level.isClientSide()) ${t.call({ ...at("entity", "entity.level"), sourceentity: "sourceentity", itemstack: "itemstack" })};\nreturn result;`),
        modern: (t) => ov(`public void hurtEnemy(${MI}.ItemStack itemstack, net.minecraft.world.entity.LivingEntity entity, net.minecraft.world.entity.LivingEntity sourceentity)`,
          `super.hurtEnemy(itemstack, entity, sourceentity);\nif (!entity.level().isClientSide()) ${t.call({ ...at("entity", "entity.level()"), sourceentity: "sourceentity", itemstack: "itemstack" })};`),
      },
    },
    {
      id: "item_inventory_tick", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void inventoryTick(${LI}.ItemStack itemstack, net.minecraft.world.World world, net.minecraft.entity.Entity entity, int slot, boolean selected)`,
          `super.inventoryTick(itemstack, world, entity, slot, selected);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack", slot: "slot" })};`),
        modern: (t) => ov(`public void inventoryTick(${MI}.ItemStack itemstack, net.minecraft.server.level.ServerLevel world, net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.EquipmentSlot slot)`,
          `super.inventoryTick(itemstack, world, entity, slot);\n${t.call({ ...at("entity", "world"), itemstack: "itemstack", slot: "slot == null ? -1 : slot.getIndex()" })};`),
      },
    },
    {
      // The item finished being eaten or drunk. `extra` is the stack expression of the item left behind (eatResultItem):
      // it replaces the used-up stack, or goes back to the player, after the procedure ran (as MCreator did).
      id: "item_finish_using", side: "server",
      member: {
        "1.16.5": (t) => ov(`public ${LI}.ItemStack finishUsingItem(${LI}.ItemStack itemstack, net.minecraft.world.World world, net.minecraft.entity.LivingEntity entity)`,
          `${t.extra ? `${LI}.ItemStack remainder = ${t.extra};\n` : ""}${LI}.ItemStack retval = super.finishUsingItem(itemstack, world, entity);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack" })};${t.extra ? `\nif (retval.isEmpty()) return remainder;\nif (entity instanceof net.minecraft.entity.player.PlayerEntity && !((net.minecraft.entity.player.PlayerEntity) entity).abilities.instabuild) {\n    net.minecraft.entity.player.PlayerEntity player = (net.minecraft.entity.player.PlayerEntity) entity;\n    if (!player.inventory.add(remainder)) player.drop(remainder, false);\n}` : ""}\nreturn retval;`),
        modern: (t) => finishUsing(t, ""),
        "26.3": (t) => finishUsing(t, ", net.minecraft.util.Prediction.SERVER_ONLY"),
      },
    },
    {
      id: "item_stopped_using", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void releaseUsing(${LI}.ItemStack itemstack, net.minecraft.world.World world, net.minecraft.entity.LivingEntity entity, int time)`,
          `super.releaseUsing(itemstack, world, entity, time);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack", time: "time" })};`),
        modern: (t) => ov(`public boolean releaseUsing(${MI}.ItemStack itemstack, ${ML} world, net.minecraft.world.entity.LivingEntity entity, int time)`,
          `boolean result = super.releaseUsing(itemstack, world, entity, time);\nif (!world.isClientSide()) ${t.call({ ...at("entity", "world"), itemstack: "itemstack", time: "time" })};\nreturn result;`),
      },
    },
    {
      id: "tool_block_destroyed", side: "server",
      member: {
        "1.16.5": (t) => ov(`public boolean mineBlock(${LI}.ItemStack itemstack, net.minecraft.world.World world, net.minecraft.block.BlockState blockstate, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.LivingEntity entity)`,
          `boolean result = super.mineBlock(itemstack, world, blockstate, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", itemstack: "itemstack", blockstate: "blockstate" })};\nreturn result;`),
        modern: (t) => ov(`public boolean mineBlock(${MI}.ItemStack itemstack, ${ML} world, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.LivingEntity entity)`,
          `boolean result = super.mineBlock(itemstack, world, blockstate, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", itemstack: "itemstack", blockstate: "blockstate" })};\nreturn result;`),
      },
    },
    {
      // The procedure returns the tooltip text; each line becomes a tooltip line.
      id: "item_tooltip", side: "client",
      member: {
        "1.16.5": (t) => ov(`public void appendHoverText(${LI}.ItemStack itemstack, net.minecraft.world.World world, java.util.List<net.minecraft.util.text.ITextComponent> tooltip, net.minecraft.client.util.ITooltipFlag flag)`,
          `super.appendHoverText(itemstack, world, tooltip, flag);\nnet.minecraft.entity.Entity entity = ${ch}.clientPlayer();\nif (entity == null) return;\nfor (String line : String.valueOf(${t.call({ ...at("entity", `${ch}.clientLevel()`), itemstack: "itemstack" })}).split("\\n")) tooltip.add(new net.minecraft.util.text.StringTextComponent(line));`),
        modern: (t) => ov(`public void appendHoverText(${MI}.ItemStack itemstack, ${MI}.Item.TooltipContext context, ${MI}.component.TooltipDisplay display, java.util.function.Consumer<net.minecraft.network.chat.Component> tooltip, ${MI}.TooltipFlag flag)`,
          `super.appendHoverText(itemstack, context, display, tooltip, flag);\nnet.minecraft.world.entity.Entity entity = ${ch}.clientPlayer();\nif (entity == null) return;\nfor (String line : String.valueOf(${t.call({ ...at("entity", `${ch}.clientLevel()`), itemstack: "itemstack" })}).split("\\n")) tooltip.accept(net.minecraft.network.chat.Component.literal(line));`),
      },
    },
    {
      id: "item_glow", side: "client",
      member: {
        "1.16.5": (t) => ov(`public boolean isFoil(${LI}.ItemStack itemstack)`,
          `net.minecraft.entity.Entity entity = ${ch}.clientPlayer();\nif (entity == null) return super.isFoil(itemstack);\nreturn ${t.call({ ...at("entity", `${ch}.clientLevel()`), itemstack: "itemstack" })};`),
        modern: (t) => ov(`public boolean isFoil(${MI}.ItemStack itemstack)`,
          `net.minecraft.world.entity.Entity entity = ${ch}.clientPlayer();\nif (entity == null) return super.isFoil(itemstack);\nreturn ${t.call({ ...at("entity", `${ch}.clientLevel()`), itemstack: "itemstack" })};`),
      },
    },
    {
      id: "block_right_clicked", side: "server",
      member: {
        "1.16.5": (t) => ov(`public ${ACTIONS.legacy} use(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.player.PlayerEntity entity, net.minecraft.util.Hand hand, net.minecraft.util.math.BlockRayTraceResult hit)`,
          `if (world.isClientSide() || hand != net.minecraft.util.Hand.MAIN_HAND) return ${ACTIONS.legacy}.SUCCESS;${t.extra ? `\n${t.extra}` : ""}\n${t.returns ? "return " : ""}${t.call({ ...atPos("pos", "world"), entity: "entity", direction: "hit.getDirection()", blockstate: "blockstate", hitX: "hit.getLocation().x", hitY: "hit.getLocation().y", hitZ: "hit.getLocation().z" })};${t.returns ? "" : `\nreturn ${ACTIONS.legacy}.SUCCESS;`}`),
        modern: (t) => ov(`protected ${ACTIONS.modern} useWithoutItem(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.player.Player entity, net.minecraft.world.phys.BlockHitResult hit)`,
          `if (world.isClientSide()) return ${ACTIONS.modern}.SUCCESS;${t.extra ? `\n${t.extra}` : ""}\n${t.returns ? "return " : ""}${t.call({ ...atPos("pos", "world"), entity: "entity", direction: "hit.getDirection()", blockstate: "blockstate", hitX: "hit.getLocation().x", hitY: "hit.getLocation().y", hitZ: "hit.getLocation().z" })};${t.returns ? "" : `\nreturn ${ACTIONS.modern}.SUCCESS;`}`),
      },
    },
    {
      id: "block_added", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void onPlace(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState oldState, boolean moving)`,
          `super.onPlace(blockstate, world, pos, oldState, moving);${t.extra ? `\n${t.extra}` : ""}\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), blockstate: "blockstate", oldState: "oldState", moving: "moving" })};`),
        modern: (t) => ov(`protected void onPlace(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState oldState, boolean moving)`,
          `super.onPlace(blockstate, world, pos, oldState, moving);${t.extra ? `\n${t.extra}` : ""}\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), blockstate: "blockstate", oldState: "oldState", moving: "moving" })};`),
      },
    },
    {
      id: "block_neighbour_changed", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void neighborChanged(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.block.Block neighbor, net.minecraft.util.math.BlockPos fromPos, boolean moving)`,
          `super.neighborChanged(blockstate, world, pos, neighbor, fromPos, moving);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), blockstate: "blockstate" })};`),
        modern: (t) => ov(`protected void neighborChanged(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.Block neighbor, net.minecraft.world.level.redstone.Orientation orientation, boolean moving)`,
          `super.neighborChanged(blockstate, world, pos, neighbor, orientation, moving);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), blockstate: "blockstate" })};`),
      },
    },
    {
      id: "block_tick", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void ${t.extra === "random" ? "randomTick" : "tick"}(net.minecraft.block.BlockState blockstate, net.minecraft.world.server.ServerWorld world, net.minecraft.util.math.BlockPos pos, java.util.Random random)`,
          `super.${t.extra === "random" ? "randomTick" : "tick"}(blockstate, world, pos, random);\n${t.call({ ...atPos("pos", "world"), blockstate: "blockstate" })};${t.extra && t.extra !== "random" ? `\nworld.getBlockTicks().scheduleTick(pos, this, ${t.extra});` : ""}`),
        modern: (t) => ov(`protected void ${t.extra === "random" ? "randomTick" : "tick"}(net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.server.level.ServerLevel world, net.minecraft.core.BlockPos pos, net.minecraft.util.RandomSource random)`,
          `super.${t.extra === "random" ? "randomTick" : "tick"}(blockstate, world, pos, random);\n${t.call({ ...atPos("pos", "world"), blockstate: "blockstate" })};${t.extra && t.extra !== "random" ? `\nworld.scheduleTick(pos, this, ${t.extra});` : ""}`),
      },
    },
    {
      id: "block_display_tick", side: "client",
      member: {
        "1.16.5": (t) => ov(`public void animateTick(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, java.util.Random random)`,
          `super.animateTick(blockstate, world, pos, random);\n${t.call({ ...atPos("pos", "world"), entity: `${ch}.clientPlayer()`, blockstate: "blockstate" })};`),
        modern: (t) => ov(`public void animateTick(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.util.RandomSource random)`,
          `super.animateTick(blockstate, world, pos, random);\n${t.call({ ...atPos("pos", "world"), entity: `${ch}.clientPlayer()`, blockstate: "blockstate" })};`),
      },
    },
    {
      id: "block_destroyed_by_player", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void playerWillDestroy(net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState blockstate, net.minecraft.entity.player.PlayerEntity entity)`,
          `super.playerWillDestroy(world, pos, blockstate, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
        modern: (t) => ov(`public net.minecraft.world.level.block.state.BlockState playerWillDestroy(${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.world.entity.player.Player entity)`,
          `net.minecraft.world.level.block.state.BlockState result = super.playerWillDestroy(world, pos, blockstate, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};\nreturn result;`),
      },
    },
    {
      // A player starts breaking the block (left click).
      id: "block_start_destroy", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void attack(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.player.PlayerEntity entity)`,
          `super.attack(blockstate, world, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
        modern: (t) => ov(`protected void attack(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.player.Player entity)`,
          `super.attack(blockstate, world, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
      },
    },
    {
      // entity = the projectile; hitX/Y/Z = where it hit.
      id: "block_hit_by_projectile", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void onProjectileHit(net.minecraft.world.World world, net.minecraft.block.BlockState blockstate, net.minecraft.util.math.BlockRayTraceResult hit, net.minecraft.entity.projectile.ProjectileEntity entity)`,
          `super.onProjectileHit(world, blockstate, hit, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("hit.getBlockPos()", "world"), entity: "entity", blockstate: "blockstate", direction: "hit.getDirection()", hitX: "hit.getLocation().x", hitY: "hit.getLocation().y", hitZ: "hit.getLocation().z" })};`),
        modern: (t) => ov(`protected void onProjectileHit(${ML} world, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.world.phys.BlockHitResult hit, net.minecraft.world.entity.projectile.Projectile entity)`,
          `super.onProjectileHit(world, blockstate, hit, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("hit.getBlockPos()", "world"), entity: "entity", blockstate: "blockstate", direction: "hit.getDirection()", hitX: "hit.getLocation().x", hitY: "hit.getLocation().y", hitZ: "hit.getLocation().z" })};`),
      },
    },
    {
      id: "block_entity_falls_on", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void fallOn(net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.Entity entity, float distance)`,
          `super.fallOn(world, pos, entity, distance);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "world.getBlockState(pos)", distance: "distance" })};`),
        modern: (t) => ov(`public void fallOn(${ML} world, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.Entity entity, double distance)`,
          `super.fallOn(world, blockstate, pos, entity, distance);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate", distance: "distance" })};`),
      },
    },
    {
      id: "block_entity_collides", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void entityInside(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.Entity entity)`,
          `super.entityInside(blockstate, world, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
        "1.21.5": (t) => ov(`protected void entityInside(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.InsideBlockEffectApplier effects)`,
          `super.entityInside(blockstate, world, pos, entity, effects);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
        "26.3": (t) => ov(`protected void entityInside(net.minecraft.world.level.block.state.BlockState blockstate, ${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.InsideBlockEffectApplier effects, boolean intersects)`,
          `super.entityInside(blockstate, world, pos, entity, effects, intersects);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
      },
    },
    {
      id: "block_entity_walks_on", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void stepOn(net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.Entity entity)`,
          `super.stepOn(world, pos, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "world.getBlockState(pos)" })};`),
        modern: (t) => ov(`public void stepOn(${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.world.entity.Entity entity)`,
          `super.stepOn(world, pos, blockstate, entity);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", blockstate: "blockstate" })};`),
      },
    },
    {
      id: "block_placed_by", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void setPlacedBy(net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState blockstate, net.minecraft.entity.LivingEntity entity, ${LI}.ItemStack itemstack)`,
          `super.setPlacedBy(world, pos, blockstate, entity, itemstack);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", itemstack: "itemstack", blockstate: "blockstate" })};`),
        modern: (t) => ov(`public void setPlacedBy(${ML} world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.world.entity.LivingEntity entity, ${MI}.ItemStack itemstack)`,
          `super.setPlacedBy(world, pos, blockstate, entity, itemstack);\nif (!world.isClientSide()) ${t.call({ ...atPos("pos", "world"), entity: "entity", itemstack: "itemstack", blockstate: "blockstate" })};`),
      },
    },
    {
      id: "block_destroyed_by_explosion", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void wasExploded(net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.world.Explosion explosion)`,
          `super.wasExploded(world, pos, explosion);\nif (!world.isClientSide()) ${t.call(atPos("pos", "world"))};`),
        modern: (t) => ov(`public void wasExploded(net.minecraft.server.level.ServerLevel world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.Explosion explosion)`,
          `super.wasExploded(world, pos, explosion);\n${t.call(atPos("pos", "world"))};`),
      },
    },
    // Mob effects (potion_effect elements); `extra` is "instant" for instant effects.
    {
      id: "effect_started", side: "server",
      member: {
        // 1.16.5 has no start hook of its own; lines after the mode in `extra` (the added sound) run there too.
        "1.16.5": (t) => {
          const [mode, ...pre] = (t.extra ?? "").split("\n");
          const body = `if (!entity.level.isClientSide()) {\n${[...pre, `${t.call(at("entity", "entity.level"))};`].join("\n")}\n}`;
          return mode === "instant"
            ? ov(`public void applyInstantenousEffect(net.minecraft.entity.Entity source, net.minecraft.entity.Entity indirectSource, net.minecraft.entity.LivingEntity entity, int amplifier, double health)`,
              `super.applyInstantenousEffect(source, indirectSource, entity, amplifier, health);\n${body}`)
            : ov(`public void addAttributeModifiers(net.minecraft.entity.LivingEntity entity, net.minecraft.entity.ai.attributes.AttributeModifierManager attributes, int amplifier)`,
              `super.addAttributeModifiers(entity, attributes, amplifier);\n${body}`);
        },
        "1.21.5": (t) => t.extra?.startsWith("instant")
          ? ov(`public void applyInstantenousEffect(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.Entity source, net.minecraft.world.entity.Entity indirectSource, net.minecraft.world.entity.LivingEntity entity, int amplifier, double health)`,
            `super.applyInstantenousEffect(level, source, indirectSource, entity, amplifier, health);\n${t.call(at("entity", "level"))};`)
          : ov(`public void onEffectStarted(net.minecraft.world.entity.LivingEntity entity, int amplifier)`,
            `super.onEffectStarted(entity, amplifier);\nif (!entity.level().isClientSide()) ${t.call(at("entity", "entity.level()"))};`),
        "26.3": (t) => t.extra?.startsWith("instant")
          ? ov(`public void applyInstantaneousEffect(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.Entity source, net.minecraft.world.entity.Entity indirectSource, net.minecraft.world.entity.LivingEntity entity, int amplifier, double health)`,
            `super.applyInstantaneousEffect(level, source, indirectSource, entity, amplifier, health);\n${t.call(at("entity", "level"))};`)
          : ov(`public void onEffectStarted(net.minecraft.world.entity.LivingEntity entity, int amplifier)`,
            `super.onEffectStarted(entity, amplifier);\nif (!entity.level().isClientSide()) ${t.call(at("entity", "entity.level()"))};`),
      },
    },
    {
      id: "effect_tick", side: "server",
      member: {
        "1.16.5": (t) => ov(`public void applyEffectTick(net.minecraft.entity.LivingEntity entity, int amplifier)`,
          `super.applyEffectTick(entity, amplifier);\nif (!entity.level.isClientSide()) ${t.call(at("entity", "entity.level"))};`),
        modern: (t) => ov(`public boolean applyEffectTick(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.LivingEntity entity, int amplifier)`,
          `${t.call(at("entity", "level"))};\nreturn super.applyEffectTick(level, entity, amplifier);`),
      },
    },
    {
      id: "effect_tick_condition", side: "server",
      member: {
        "1.16.5": (t) => ov("public boolean isDurationEffectTick(int duration, int amplifier)", `return ${t.returns ? t.call({}) : "true"};`),
        modern: (t) => ov("public boolean shouldApplyEffectTickThisTick(int duration, int amplifier)", `return ${t.returns ? t.call({}) : "true"};`),
      },
    },
    {
      id: "effect_mob_hurt", side: "server",
      member: {
        "1.16.5": null,
        modern: (t) => ov(`public void onMobHurt(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.LivingEntity entity, int amplifier, net.minecraft.world.damagesource.DamageSource damagesource, float amount)`,
          `super.onMobHurt(level, entity, amplifier, damagesource, amount);\n${t.call({ ...at("entity", "level"), damagesource: "damagesource", amount: "amount" })};`),
      },
    },
    {
      id: "effect_mob_removed", side: "server",
      member: {
        "1.16.5": null,
        modern: (t) => ov(`public void onMobRemoved(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.LivingEntity entity, int amplifier, net.minecraft.world.entity.Entity.RemovalReason reason)`,
          `super.onMobRemoved(level, entity, amplifier, reason);\nif (reason == net.minecraft.world.entity.Entity.RemovalReason.KILLED) ${t.call(at("entity", "level"))};`),
      },
    },
  ];
}

/** Element trigger ids generated by this module (the procedure fields listed in layer.json "generates"). */
export const ELEMENT_TRIGGER_IDS = new Set(elementTriggers("x").map((t) => t.id));
