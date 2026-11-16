package dev.mcedge.wavethree.custom;

// Q206 client check (copied in by tools/codegen-test/bubble-client-check.sh, removed afterwards): every online player
// gets the animated "wave" bubble captioned "Ali" and creative mode (the test project's mobs would kill it before the image).
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class BubbleShotServer {
    private BubbleShotServer() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        for (net.minecraft.server.level.ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            if (dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(player).isEmpty()) dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(player, "wave", "Ali", 0);
        }
    }
}
