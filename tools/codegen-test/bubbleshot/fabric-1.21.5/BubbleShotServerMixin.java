package dev.mcedge.wavethree.mixin;

// Q216 client check on Fabric (copied in by tools/codegen-test/bubble-client-check.sh and listed in the mixin config,
// removed afterwards): at the end of each server tick every online player gets the bubble and creative mode.
@org.spongepowered.asm.mixin.Mixin(net.minecraft.server.MinecraftServer.class)
public abstract class BubbleShotServerMixin {
    @org.spongepowered.asm.mixin.injection.Inject(method = "tickServer", at = @org.spongepowered.asm.mixin.injection.At("TAIL"))
    private void wavethree$bubbleShot(java.util.function.BooleanSupplier hasTime, org.spongepowered.asm.mixin.injection.callback.CallbackInfo info) {
        for (net.minecraft.server.level.ServerPlayer player : ((net.minecraft.server.MinecraftServer) (Object) this).getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            if (dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(player).isEmpty()) dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(player, "wave", "Ali", 0);
        }
    }
}
