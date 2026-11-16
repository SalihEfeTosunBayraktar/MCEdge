package dev.mcedge.wavethree.custom;

// Q206 client check (copied in by tools/codegen-test/bubble-client-check.sh, removed afterwards): every online player
// gets the animated "wave" bubble captioned "Ali" and creative mode (the test project's mobs would kill it before the image).
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class BubbleShotServer {
    private BubbleShotServer() {}

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void tick(net.minecraftforge.event.TickEvent.ServerTickEvent event) {
        if (event.phase != net.minecraftforge.event.TickEvent.Phase.END) return;
        for (net.minecraft.entity.player.ServerPlayerEntity player : net.minecraftforge.fml.server.ServerLifecycleHooks.getCurrentServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.GameType.CREATIVE);
            if (dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(player).isEmpty()) dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(player, "wave", "Ali", 0);
        }
    }
}
