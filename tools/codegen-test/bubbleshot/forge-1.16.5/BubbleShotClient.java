package dev.mcedge.wavethree.custom;

// Q206 client check: the camera looks at the player from the front, so the window image shows the bubble over its head;
// screens the test project opens on its own (ruby_gui) are closed.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree", value = net.minecraftforge.api.distmarker.Dist.CLIENT)
public final class BubbleShotClient {
    private BubbleShotClient() {}

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void tick(net.minecraftforge.event.TickEvent.ClientTickEvent event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (event.phase != net.minecraftforge.event.TickEvent.Phase.END || mc.player == null) return;
        if (mc.screen != null) mc.player.closeContainer();
        if (mc.options.getCameraType() != net.minecraft.client.settings.PointOfView.THIRD_PERSON_FRONT) mc.options.setCameraType(net.minecraft.client.settings.PointOfView.THIRD_PERSON_FRONT);
    }
}
