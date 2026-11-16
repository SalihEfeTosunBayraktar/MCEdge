package dev.mcedge.wavethree.custom;

// Q228 client check (copied in by tools/codegen-test/transition-client-check.sh, removed afterwards): once, 5 seconds
// after a player spawns, the slow_note bubble (200 tick appear, active time 300, 200 tick disappear) is shown to them
// and they get creative mode (the test project's mobs would kill them before the images).
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class TransitionShotServer {
    private TransitionShotServer() {}

    private static boolean shown;

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        for (net.minecraft.server.level.ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            if (!shown && player.tickCount >= 100) {
                shown = true;
                dev.mcedge.wavethree.procedures.WavethreeModBubbles.showBubble(player, "slow_note", "Ali", -1);
            }
        }
    }
}
