package dev.mcedge.wavethree.custom;

// Radial click check (copied in by tools/codegen-test/radial-click-check.sh, removed afterwards): every player gets creative
// mode and, 5 s after joining, the "wheel" menu opened by the server once; the bubble the player shows is logged when it
// changes, so a slice chosen in the client shows up in the log.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class RadialClickServer {
    private RadialClickServer() {}

    private static final java.util.Set<java.util.UUID> OPENED = new java.util.HashSet<>();
    private static String last = "";

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        for (net.minecraft.server.level.ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            String bubble = dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(player);
            if (!bubble.equals(last)) System.out.println("[radialclick] server bubble=" + (last = bubble));
            if (player.tickCount > 100 && OPENED.add(player.getUUID())) dev.mcedge.wavethree.procedures.RadialMenus.open(player, "wheel");
        }
    }
}
