package dev.mcedge.wavethree.custom;

// Q202 runtime probe (copied in by tools/codegen-test/players-runtime.sh, removed afterwards): /playersprobe puts one
// fake player in the overworld and one in the nether (online: in the server's player list and their level's player
// list), runs procedure server_players_probe from the overworld and takes the players out again. Expected lines are
// listed in players-runtime.sh.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class PlayersProbe {
    private PlayersProbe() {}

    /** The live "players" list of a player list or level (their getters return a read-only view). */
    @SuppressWarnings("unchecked")
    private static java.util.List<Object> list(Class<?> owner, Object target) throws Exception {
        java.lang.reflect.Field field = owner.getDeclaredField("players");
        field.setAccessible(true);
        return (java.util.List<Object>) field.get(target);
    }

    private static net.minecraft.server.level.ServerPlayer player(net.minecraft.server.level.ServerLevel level, String name, double y) throws Exception {
        net.minecraft.server.level.ServerPlayer player = net.neoforged.neoforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
        player.setPos(0.5, y, 0.5);
        list(net.minecraft.server.players.PlayerList.class, level.getServer().getPlayerList()).add(player);
        list(net.minecraft.server.level.ServerLevel.class, level).add(player);
        return player;
    }

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("playersprobe").executes(ctx -> {
            net.minecraft.server.level.ServerLevel overworld = ctx.getSource().getServer().getLevel(net.minecraft.world.level.Level.OVERWORLD);
            net.minecraft.server.level.ServerLevel nether = ctx.getSource().getServer().getLevel(net.minecraft.world.level.Level.NETHER);
            net.minecraft.server.level.ServerPlayer over = null, hell = null;
            try {
                over = player(overworld, "q202_over", 100);
                hell = player(nether, "q202_nether", 70);
                System.out.println("[players] start online " + overworld.getServer().getPlayerList().getPlayers().size()
                    + " overworld " + overworld.players().size() + " nether " + nether.players().size());
                dev.mcedge.wavethree.procedures.ServerPlayersProbeProcedure.execute(overworld);
                list(net.minecraft.server.players.PlayerList.class, overworld.getServer().getPlayerList()).removeAll(java.util.Arrays.asList(over, hell));
                list(net.minecraft.server.level.ServerLevel.class, overworld).remove(over);
                list(net.minecraft.server.level.ServerLevel.class, nether).remove(hell);
            } catch (Exception e) {
                System.out.println("[players] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }
}
