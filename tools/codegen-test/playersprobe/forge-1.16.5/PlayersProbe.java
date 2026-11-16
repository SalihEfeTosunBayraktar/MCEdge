package dev.mcedge.wavethree.custom;

// Q202 runtime probe (copied in by tools/codegen-test/players-runtime.sh, removed afterwards): /playersprobe puts one
// fake player in the overworld and one in the nether (online: in the server's player list and their level's player
// list), runs procedure server_players_probe from the overworld and takes the players out again. Expected lines are
// listed in players-runtime.sh.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class PlayersProbe {
    private PlayersProbe() {}

    /** The live "players" list of a player list or level (their getters return a read-only view). */
    @SuppressWarnings("unchecked")
    private static java.util.List<Object> list(Class<?> owner, Object target) throws Exception {
        java.lang.reflect.Field field = owner.getDeclaredField("players");
        field.setAccessible(true);
        return (java.util.List<Object>) field.get(target);
    }

    private static net.minecraft.entity.player.ServerPlayerEntity player(net.minecraft.world.server.ServerWorld level, String name, double y) throws Exception {
        net.minecraft.entity.player.ServerPlayerEntity player = net.minecraftforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
        player.setPos(0.5, y, 0.5);
        list(net.minecraft.server.management.PlayerList.class, level.getServer().getPlayerList()).add(player);
        list(net.minecraft.world.server.ServerWorld.class, level).add(player);
        return player;
    }

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("playersprobe").executes(ctx -> {
            net.minecraft.world.server.ServerWorld overworld = ctx.getSource().getServer().getLevel(net.minecraft.world.World.OVERWORLD);
            net.minecraft.world.server.ServerWorld nether = ctx.getSource().getServer().getLevel(net.minecraft.world.World.NETHER);
            net.minecraft.entity.player.ServerPlayerEntity over = null, hell = null;
            try {
                over = player(overworld, "q202_over", 100);
                hell = player(nether, "q202_nether", 70);
                System.out.println("[players] start online " + overworld.getServer().getPlayerList().getPlayers().size()
                    + " overworld " + overworld.players().size() + " nether " + nether.players().size());
                dev.mcedge.wavethree.procedures.ServerPlayersProbeProcedure.execute(overworld);
                list(net.minecraft.server.management.PlayerList.class, overworld.getServer().getPlayerList()).removeAll(java.util.Arrays.asList(over, hell));
                list(net.minecraft.world.server.ServerWorld.class, overworld).remove(over);
                list(net.minecraft.world.server.ServerWorld.class, nether).remove(hell);
            } catch (Exception e) {
                System.out.println("[players] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }
}
