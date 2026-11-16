package dev.mcedge.wavethree.custom;

// Q227 client check (copied in by tools/codegen-test/radial-client-check.sh, removed afterwards): every online player gets
// creative mode and, 5 s after joining, the wheel radial menu opened by the server (the radial_open path); a GUI the test
// project's own procedures open later is closed and the wheel opened again.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class RadialShotServer {
    private RadialShotServer() {}

    private static final java.util.Set<java.util.UUID> OPENED = new java.util.HashSet<>();

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        for (net.minecraft.server.level.ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            if (player.tickCount <= 100) continue;
            boolean gui = player.containerMenu != player.inventoryMenu;
            if (gui) player.closeContainer();
            if (OPENED.add(player.getUUID()) || gui) dev.mcedge.wavethree.procedures.RadialMenus.open(player, "wheel");
        }
    }
}
