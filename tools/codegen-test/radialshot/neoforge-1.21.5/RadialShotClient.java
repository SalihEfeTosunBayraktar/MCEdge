package dev.mcedge.wavethree.custom;

// Q227 client check: while the radial menu is open the cursor stays over its second slice (upper right); once the check
// script leaves a "radial-scroll" file in the game folder (after the first window image) every wheel scrolls to the next
// tab (the runtime image folder), so the two window images show both.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class RadialShotClient {
    private RadialShotClient() {}

    private static net.minecraft.client.gui.screens.Screen scrolled;

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (!(mc.screen instanceof dev.mcedge.wavethree.procedures.client.RadialMenuScreen)) return;
        double scale = mc.getWindow().getGuiScale(), cx = mc.getWindow().getScreenWidth() / 2.0D, cy = mc.getWindow().getScreenHeight() / 2.0D;
        org.lwjgl.glfw.GLFW.glfwSetCursorPos(mc.getWindow().getWindow(), cx + 52 * scale, cy - 30 * scale);
        if (scrolled != mc.screen && new java.io.File(mc.gameDirectory, "radial-scroll").exists()) (scrolled = mc.screen).mouseScrolled(cx / scale, cy / scale, 0.0D, 1.0D);
    }
}
