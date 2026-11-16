package dev.mcedge.wavethree.custom;

// Q228 client check: the camera looks at the player from the front (screens the test project opens are closed), and
// the bubble's age is logged with the wall clock every 5 ticks so each window image can be matched to its transition phase.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class TransitionShotClient {
    private TransitionShotClient() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null || mc.level == null) return;
        if (mc.screen != null) mc.player.closeContainer();
        if (mc.options.getCameraType() != net.minecraft.client.CameraType.THIRD_PERSON_FRONT) mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
        dev.mcedge.wavethree.procedures.WavethreeModBubbles.Shown shown = dev.mcedge.wavethree.procedures.WavethreeModBubbles.shown(mc.player.getId());
        if (shown != null && mc.level.getGameTime() % 5 == 0) System.out.println("TRANSITION age=" + (mc.level.getGameTime() - shown.since) + " leaving=" + shown.leaving + " ms=" + System.currentTimeMillis());
    }
}
