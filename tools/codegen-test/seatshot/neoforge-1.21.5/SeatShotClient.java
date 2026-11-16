package dev.mcedge.wavethree.custom;

// Q225, Q226 client check: the camera looks at the player from the front, so the window image shows it on the sofa;
// screens (ruby_gui, the pause menu) are closed. Each client tick also logs the player's pose once it rides.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class SeatShotClient {
    private SeatShotClient() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null) return;
        // The window may lose focus while the run starts; keep the game unpaused and close any screen.
        mc.options.pauseOnLostFocus = false;
        if (mc.screen != null) {
            mc.player.closeContainer();
            mc.setScreen(null);
        }
        if (mc.options.getCameraType() != net.minecraft.client.CameraType.THIRD_PERSON_FRONT) mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
        if (mc.player.isPassenger() && mc.player.tickCount % 100 == 0) System.out.println("[seat] client pose " + mc.player.getPose() + " body " + Math.round(mc.player.yBodyRot) + " lying " + dev.mcedge.wavethree.seat.WavethreeModSeats.isLying(mc.player));
    }
}
