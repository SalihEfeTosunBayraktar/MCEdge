package dev.mcedge.wavethree.custom;

// Q206 client check: the camera looks at the player from the front, so the window image shows the bubble over its head;
// screens the test project opens on its own (ruby_gui) are closed.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class BubbleShotClient {
    private BubbleShotClient() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null) return;
        if (mc.screen != null) mc.player.closeContainer();
        if (mc.options.getCameraType() != net.minecraft.client.CameraType.THIRD_PERSON_FRONT) mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
    }
}
