package dev.mcedge.wavethree.custom;

// Radial click check: once the wheel has been open 2 s the
// screen gets a left click over its top slice ("offer", a bubble) through its mouseClicked, as the mouse handler calls it; the camera then turns to the front so
// the window image shows the player's own bubble.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class RadialClickClient {
    private RadialClickClient() {}

    private static int open;

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        net.minecraft.client.gui.screens.Screen screen = mc.gui.screen();
        if (!(screen instanceof dev.mcedge.wavethree.procedures.client.RadialMenuScreen)) return;
        double scale = mc.getWindow().getGuiScale(), cx = mc.getWindow().getScreenWidth() / 2.0D, cy = mc.getWindow().getScreenHeight() / 2.0D;
        if (++open == 40) {
            boolean taken = screen.mouseClicked(new net.minecraft.client.input.MouseButtonEvent(cx / scale, (cy - 55 * scale) / scale, new net.minecraft.client.input.MouseButtonInfo(0, 0)), false);
            System.out.println("[radialclick] clicked taken=" + taken + " screen after=" + (mc.gui.screen() == null ? "none" : mc.gui.screen().getClass().getSimpleName()));
            mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
        }
    }
}
