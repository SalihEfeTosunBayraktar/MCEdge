import { pascal } from "./java.ts";
import type { GenEnv } from "./typeModule.ts";

/** Class names and registry calls of one Minecraft generation (1.16.5 keeps MCP class names and Mojang method names). */
interface Names {
  Level: string;
  Player: string;
  Entity: string;
  BlockPos: string;
  BlockState: string;
  ItemStack: string;
  Item: string;
  Hand: string;
  Direction: string;
  Vec: string;
  Hit: string;
  Box: string;
  Component: string;
  Source: string;
  /** Java for an id string `id` -> the registry object. */
  item: (id: string) => string;
  itemKey: (item: string) => string;
  blockKey: (block: string) => string;
  entityKey: (type: string) => string;
  literal: (text: string) => string;
  inventory: (player: string) => string;
  levelOf: (player: string) => string;
  setName: (stack: string, name: string) => string;
  describeMessage: (component: string) => string;
  result: (value: string) => string;
}

const LEGACY: Names = {
  Level: "net.minecraft.world.server.ServerWorld",
  Player: "net.minecraft.entity.player.ServerPlayerEntity",
  Entity: "net.minecraft.entity.Entity",
  BlockPos: "net.minecraft.util.math.BlockPos",
  BlockState: "net.minecraft.block.BlockState",
  ItemStack: "net.minecraft.item.ItemStack",
  Item: "net.minecraft.item.Item",
  Hand: "net.minecraft.util.Hand",
  Direction: "net.minecraft.util.Direction",
  Vec: "net.minecraft.util.math.vector.Vector3d",
  Hit: "net.minecraft.util.math.BlockRayTraceResult",
  Box: "net.minecraft.util.math.AxisAlignedBB",
  Component: "net.minecraft.util.text.ITextComponent",
  Source: "net.minecraft.command.CommandSource",
  item: (id) => `net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(new net.minecraft.util.ResourceLocation(${id}))`,
  itemKey: (item) => `${item}.getRegistryName().toString()`,
  blockKey: (block) => `${block}.getRegistryName().toString()`,
  entityKey: (type) => `net.minecraft.entity.EntityType.getKey(${type}).toString()`,
  literal: (text) => `new net.minecraft.util.text.StringTextComponent(${text})`,
  inventory: (player) => `${player}.inventory`,
  levelOf: (player) => `((net.minecraft.world.server.ServerWorld) ${player}.level)`,
  setName: (stack, name) => `${stack}.setHoverName(${LEGACY.literal(name)})`,
  describeMessage: (c) => `${c} instanceof net.minecraft.util.text.TranslationTextComponent ? ((net.minecraft.util.text.TranslationTextComponent) ${c}).getKey() + " " + java.util.Arrays.toString(((net.minecraft.util.text.TranslationTextComponent) ${c}).getArgs()) : ${c}.getString()`,
  result: (value) => `${value}.toString()`,
};

const MODERN = (identifier: string): Names => ({
  Level: "net.minecraft.server.level.ServerLevel",
  Player: "net.minecraft.server.level.ServerPlayer",
  Entity: "net.minecraft.world.entity.Entity",
  BlockPos: "net.minecraft.core.BlockPos",
  BlockState: "net.minecraft.world.level.block.state.BlockState",
  ItemStack: "net.minecraft.world.item.ItemStack",
  Item: "net.minecraft.world.item.Item",
  Hand: "net.minecraft.world.InteractionHand",
  Direction: "net.minecraft.core.Direction",
  Vec: "net.minecraft.world.phys.Vec3",
  Hit: "net.minecraft.world.phys.BlockHitResult",
  Box: "net.minecraft.world.phys.AABB",
  Component: "net.minecraft.network.chat.Component",
  Source: "net.minecraft.commands.CommandSourceStack",
  item: (id) => `net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(${identifier}.parse(${id}))`,
  itemKey: (item) => `net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(${item}).toString()`,
  blockKey: (block) => `net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(${block}).toString()`,
  entityKey: (type) => `net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(${type}).toString()`,
  literal: (text) => `net.minecraft.network.chat.Component.literal(${text})`,
  inventory: (player) => `${player}.getInventory()`,
  levelOf: (player) => `((net.minecraft.server.level.ServerLevel) ${player}.level())`,
  setName: (stack, name) => `${stack}.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, net.minecraft.network.chat.Component.literal(${name}))`,
  describeMessage: (c) => `${c}.getContents() instanceof net.minecraft.network.chat.contents.TranslatableContents ? ((net.minecraft.network.chat.contents.TranslatableContents) ${c}.getContents()).getKey() + " " + java.util.Arrays.toString(((net.minecraft.network.chat.contents.TranslatableContents) ${c}.getContents()).getArgs()) : ${c}.getString()`,
  // Modern results are a sealed interface: Success, Fail, Pass.
  result: (value) => `${value}.getClass().getSimpleName().toUpperCase(java.util.Locale.ROOT)`,
});

/**
 * The thin adapter of the test probe (Q218): the vanilla and loader calls a scenario step needs, behind static methods
 * with plain types so the neutral core (probeCore.ts) compiles the same on every engine. Fake players differ by engine:
 * Forge 1.16.5 a FakePlayer (or a real server player to tick), NeoForge a real server player on an unconnected
 * connection (menus open, as in the codegen tests), Fabric the Fabric API fake player (its messages are not captured).
 */
export function probeGame(env: GenEnv): string {
  const pkg = env.project.mod.package;
  const mod = `${pascal(env.modId)}Mod`;
  const legacy = env.mc === "1.16.5";
  const N = legacy ? LEGACY : MODERN(env.mc === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation");
  // 26.x passes the hit position of the click too.
  const interact = env.mc === "26.3" ? `player.interactOn((${N.Entity}) target, hand(hand), new ${N.Vec}(((${N.Entity}) target).getX(), ((${N.Entity}) target).getY(), ((${N.Entity}) target).getZ()))` : `player.interactOn((${N.Entity}) target, hand(hand))`;
  const playerList = legacy ? "net.minecraft.server.management.PlayerList" : "net.minecraft.server.players.PlayerList";
  return String.raw`package ${pkg}.probe;

/** Generated by MCEdge for dev builds only (run_scenario, tick_profile): the vanilla and loader calls of ${mod}Probe. */
final class ${mod}ProbeGame {
    private ${mod}ProbeGame() {}

    static int tick(net.minecraft.server.MinecraftServer server) {
        return server.getTickCount();
    }

    static java.util.UUID uuid(Object entity) {
        return ((${N.Entity}) entity).getUUID();
    }

    /** A dimension by id ("overworld", "nether", "end" or "namespace:path"), null when there is none. */
    static Object level(net.minecraft.server.MinecraftServer server, String dimension) {
        String name = dimension.equals("nether") ? "the_nether" : dimension.equals("end") ? "the_end" : dimension;
        String wanted = name.indexOf(':') < 0 ? "minecraft:" + name : name;
        for (${N.Level} level : server.getAllLevels()) {
            if (level.dimension().toString().endsWith(" / " + wanted + "]")) return level;
        }
        return null;
    }

    static ${N.Level} levelOf(Object player) {
        return ${N.levelOf("((" + N.Player + ") player)")};
    }

    /** Loads the chunk of a position and keeps it loaded, so blocks placed there stay and tick. */
    static void load(net.minecraft.server.MinecraftServer server, Object level, int x, int z) throws Exception {
        ((${N.Level}) level).getChunk(x >> 4, z >> 4);
        try {
            command(server, level, null, "forceload add " + x + " " + z);
        } catch (com.mojang.brigadier.exceptions.CommandSyntaxException alreadyForced) {
            // The chunk is forced already.
        }
    }

    /** Runs a command as the server, or as a player, and returns its result. */
    static int command(net.minecraft.server.MinecraftServer server, Object level, Object player, String command) throws Exception {
        ${N.Source} source = server.createCommandSourceStack();
        if (player != null) source = source.withLevel(levelOf(player)).withEntity((${N.Entity}) player).withPosition(((${N.Entity}) player).position());
        else if (level != null) source = source.withLevel((${N.Level}) level);
        return server.getCommands().getDispatcher().execute(command.startsWith("/") ? command.substring(1) : command, source);
    }

    /** A player the server does not know as a client: it can click, hold items, open menus and receive messages. */
    @SuppressWarnings("unchecked")
    static Object fakePlayer(net.minecraft.server.MinecraftServer server, Object levelObject, String name, double x, double y, double z, boolean ticking, java.util.List<String> messages) throws Exception {
        ${N.Level} level = (${N.Level}) levelObject;
        com.mojang.authlib.GameProfile profile = new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name);
${legacy ? legacyPlayer(N) : env.loader === "neoforge" ? neoforgePlayer(N) : fabricPlayer()}
        player.setPos(x, y, z);
        java.lang.reflect.Field byUuid = ${playerList}.class.getDeclaredField("playersByUUID");
        byUuid.setAccessible(true);
        ((java.util.Map<java.util.UUID, ${N.Player}>) byUuid.get(server.getPlayerList())).put(player.getUUID(), player);
        playerList(server).add(player);
        playersOf(level).add(player);
        return player;
    }

    @SuppressWarnings("unchecked")
    private static java.util.List<${N.Player}> listOf(Class<?> owner, Object target) throws Exception {
        java.lang.reflect.Field field = owner.getDeclaredField("players");
        field.setAccessible(true);
        return (java.util.List<${N.Player}>) field.get(target);
    }

    private static java.util.List<${N.Player}> playerList(net.minecraft.server.MinecraftServer server) throws Exception {
        return listOf(${playerList}.class, server.getPlayerList());
    }

    private static java.util.List<${N.Player}> playersOf(${N.Level} level) throws Exception {
        return listOf(${N.Level}.class, level);
    }

    /** Takes a fake player out of the server and its level. */
    static void remove(Object object) throws Exception {
        if (object == null) return;
        ${N.Player} player = (${N.Player}) object;
        ${N.Level} level = levelOf(player);
        java.lang.reflect.Field byUuid = ${playerList}.class.getDeclaredField("playersByUUID");
        byUuid.setAccessible(true);
        ((java.util.Map<?, ?>) byUuid.get(level.getServer().getPlayerList())).remove(player.getUUID());
        playerList(level.getServer()).remove(player);
        playersOf(level).remove(player);
    }

    /** The block at a position as "namespace:id" and, when it has any, "[property=value,...]". */
    static String block(Object level, int x, int y, int z) {
        ${N.BlockState} state = ((${N.Level}) level).getBlockState(new ${N.BlockPos}(x, y, z));
        String shown = state.toString();
        int properties = shown.indexOf('[');
        return ${N.blockKey("state.getBlock()")} + (properties >= 0 ? shown.substring(properties) : "");
    }

    private static ${N.Item} item(String id) {
        ${N.Item} item = ${N.item("id")};
        if (item == null || ${N.itemKey("item")}.equals("minecraft:air") && !id.equals("minecraft:air")) throw new IllegalArgumentException("unknown item " + id);
        return item;
    }

    private static ${N.ItemStack} stack(String id, int count, String name) {
        ${N.ItemStack} stack = new ${N.ItemStack}(item(id), count);
        if (!name.isEmpty()) ${N.setName("stack", "name")};
        return stack;
    }

    private static String describe(${N.ItemStack} stack) {
        return stack.isEmpty() ? "" : stack.getCount() + " x " + ${N.itemKey("stack.getItem()")};
    }

    private static ${N.Hand} hand(String name) {
        return name.equals("off") ? ${N.Hand}.OFF_HAND : ${N.Hand}.MAIN_HAND;
    }

    /** Puts items in the inventory, or in a hand with hold; returns how many of that item the player has then. */
    static int give(Object object, String id, int count, String name, boolean hold) {
        ${N.Player} player = (${N.Player}) object;
        ${N.ItemStack} stack = stack(id, count, name);
        if (hold) player.setItemInHand(${N.Hand}.MAIN_HAND, stack);
        else ${N.inventory("player")}.add(stack);
        return count(object, id);
    }

    /** How many of an item the player carries (any item for an empty id). */
    static int count(Object object, String id) {
        ${N.Player} player = (${N.Player}) object;
        int total = 0;
        for (int i = 0; i < ${N.inventory("player")}.getContainerSize(); i++) {
            ${N.ItemStack} stack = ${N.inventory("player")}.getItem(i);
            if (!stack.isEmpty() && (id.isEmpty() || ${N.itemKey("stack.getItem()")}.equals(id))) total += stack.getCount();
        }
        return total;
    }

    static java.util.Map<String, Integer> inventory(Object object) {
        ${N.Player} player = (${N.Player}) object;
        java.util.Map<String, Integer> out = new java.util.TreeMap<>();
        for (int i = 0; i < ${N.inventory("player")}.getContainerSize(); i++) {
            ${N.ItemStack} stack = ${N.inventory("player")}.getItem(i);
            if (!stack.isEmpty()) out.merge(${N.itemKey("stack.getItem()")}, stack.getCount(), Integer::sum);
        }
        return out;
    }

    static double[] position(Object entity) {
        ${N.Entity} e = (${N.Entity}) entity;
        return new double[] {e.getX(), e.getY(), e.getZ()};
    }

    /** Right-click a block the way a client does (the loader's interaction events fire). */
    static String useBlock(Object object, int x, int y, int z, String face, String hand) {
        ${N.Player} player = (${N.Player}) object;
        ${N.Direction} side = ${N.Direction}.byName(face);
        ${N.BlockPos} pos = new ${N.BlockPos}(x, y, z);
        ${N.Hit} hit = new ${N.Hit}(new ${N.Vec}(x + 0.5, y + 0.5, z + 0.5), side == null ? ${N.Direction}.UP : side, pos, false);
        return ${N.result(`player.gameMode.useItemOn(player, levelOf(player), player.getItemInHand(hand(hand)), hand(hand), hit)`)};
    }

    static String useItem(Object object, String hand) {
        ${N.Player} player = (${N.Player}) object;
        return ${N.result(`player.gameMode.useItem(player, levelOf(player), player.getItemInHand(hand(hand)), hand(hand))`)};
    }

    static String useEntity(Object object, Object target, String hand) {
        ${N.Player} player = (${N.Player}) object;
        return ${N.result(interact)};
    }

    /** The nearest entity of a type (id, "minecraft:" assumed) within a radius of a position. */
    static Object nearestEntity(Object level, String type, double x, double y, double z, double radius) {
        String wanted = type.indexOf(':') < 0 ? "minecraft:" + type : type;
        ${N.Entity} best = null;
        double bestDistance = Double.MAX_VALUE;
        for (${N.Entity} entity : ((${N.Level}) level).getEntities((${N.Entity}) null, new ${N.Box}(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius), candidate -> true)) {
            double distance = entity.distanceToSqr(x, y, z);
            if (${N.entityKey("entity.getType()")}.equals(wanted) && distance < bestDistance) {
                best = entity;
                bestDistance = distance;
            }
        }
        return best;
    }

    static java.util.Map<String, Object> menu(Object object) {
        ${N.Player} player = (${N.Player}) object;
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("class", player.containerMenu.getClass().getSimpleName());
        out.put("slots", player.containerMenu.slots.size());
        return out;
    }

    /** A slot of the open menu as "count x item", empty text for an empty slot. */
    static String slot(Object object, int index) {
        ${N.Player} player = (${N.Player}) object;
        return describe(player.containerMenu.getSlot(index).getItem());
    }

    static void setSlot(Object object, int index, String id, int count) {
        ${N.Player} player = (${N.Player}) object;
        player.containerMenu.getSlot(index).set(id.isEmpty() ? ${N.ItemStack}.EMPTY : stack(id, count, ""));
    }

    /** One tick of a player the way the server's connection runs it: the player tick events and the tick procedures follow. */
    static void tickPlayer(Object player) {
        ((${N.Player}) player).doTick();
    }

    static void closeMenu(Object object) {
        ((${N.Player}) object).closeContainer();
    }

    /** What the server's player tick does for a client: sends the open menu's changes (which also starts its first tick). */
    static void sync(Object object) {
        try {
            ((${N.Player}) object).containerMenu.broadcastChanges();
        } catch (RuntimeException e) {
            // A menu without a client may refuse to broadcast; the step's own result still stands.
        }
    }
}
`;
}

function legacyPlayer(N: Names): string {
  const override = `public void displayClientMessage(${N.Component} component, boolean overlay) {
                messages.add(${N.describeMessage("component")});
            }`;
  return `        ${N.Player} player = ticking
            ? new ${N.Player}(server, level, profile, new net.minecraft.server.management.PlayerInteractionManager(level)) {
            @Override
            ${override}
        }
            : new net.minecraftforge.common.util.FakePlayer(level, profile) {
            @Override
            ${override}
        };
        new net.minecraft.network.play.ServerPlayNetHandler(server, new net.minecraft.network.NetworkManager(net.minecraft.network.PacketDirection.CLIENTBOUND), player);`;
}

function neoforgePlayer(N: Names): string {
  // No @Override: the message method differs between generations; the one that exists is the one that captures.
  return `        ${N.Player} player = new ${N.Player}(server, level, profile, net.minecraft.server.level.ClientInformation.createDefault()) {
            public void displayClientMessage(${N.Component} component, boolean overlay) {
                messages.add(${N.describeMessage("component")});
            }
        };
        net.minecraft.network.Connection connection = new net.minecraft.network.Connection(net.minecraft.network.protocol.PacketFlow.SERVERBOUND);
        // An embedded channel takes the packets (no encoders: they stay in its outbound queue).
        java.lang.reflect.Field channel = net.minecraft.network.Connection.class.getDeclaredField("channel");
        channel.setAccessible(true);
        channel.set(connection, new io.netty.channel.embedded.EmbeddedChannel());
        // Every payload counts as negotiated, as for NeoForge's game test players.
        net.neoforged.neoforge.network.registration.NetworkRegistry.configureMockConnection(connection);
        new net.minecraft.server.network.ServerGamePacketListenerImpl(server, connection, player, net.minecraft.server.network.CommonListenerCookie.createInitial(profile, false));`;
}

function fabricPlayer(): string {
  return "        net.minecraft.server.level.ServerPlayer player = net.fabricmc.fabric.api.entity.FakePlayer.get(level, profile);";
}
