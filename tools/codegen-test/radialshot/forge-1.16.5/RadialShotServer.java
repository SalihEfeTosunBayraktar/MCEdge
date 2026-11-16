package dev.mcedge.wavethree.custom;

// Q227 client check (copied in by tools/codegen-test/radial-client-check.sh, removed afterwards): every online player gets
// creative mode and, 5 s after joining, the wheel radial menu opened by the server (the radial_open path); a GUI the test
// project's own procedures open later is closed and the wheel opened again.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class RadialShotServer {
    private RadialShotServer() {}

    private static final java.util.Set<java.util.UUID> OPENED = new java.util.HashSet<>();

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void tick(net.minecraftforge.event.TickEvent.ServerTickEvent event) {
        if (event.phase != net.minecraftforge.event.TickEvent.Phase.END) return;
        for (net.minecraft.entity.player.ServerPlayerEntity player : net.minecraftforge.fml.server.ServerLifecycleHooks.getCurrentServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.GameType.CREATIVE);
            if (player.tickCount <= 100) continue;
            boolean gui = player.containerMenu != player.inventoryMenu;
            if (gui) player.closeContainer();
            if (OPENED.add(player.getUUID()) || gui) dev.mcedge.wavethree.procedures.RadialMenus.open(player, "wheel");
        }
    }
}
