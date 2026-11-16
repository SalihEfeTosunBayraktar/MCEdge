package dev.mcedge.wavethree.mixin;

// Q216 client check on Fabric: the camera looks at the player from the front, so the window image shows the bubble over
// its head; screens the test project opens on its own are closed.
@org.spongepowered.asm.mixin.Mixin(net.minecraft.client.Minecraft.class)
public abstract class BubbleShotClientMixin {
    @org.spongepowered.asm.mixin.injection.Inject(method = "tick", at = @org.spongepowered.asm.mixin.injection.At("TAIL"))
    private void wavethree$bubbleShot(org.spongepowered.asm.mixin.injection.callback.CallbackInfo info) {
        net.minecraft.client.Minecraft mc = (net.minecraft.client.Minecraft) (Object) this;
        if (mc.player == null) return;
        if (mc.screen != null) mc.player.closeContainer();
        if (mc.options.getCameraType() != net.minecraft.client.CameraType.THIRD_PERSON_FRONT) mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
    }
}
