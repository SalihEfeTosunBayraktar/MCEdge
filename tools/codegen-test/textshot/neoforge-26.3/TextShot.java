package dev.mcedge.hello.custom;

// Q276 client probe (copied in by tools/codegen-test/textshot/run.sh, removed afterwards). In a world it sets GUI
// scale 2, opens texttest and saves run/screenshots/q276_text.png, then a second shot at GUI scale 3.
@net.neoforged.fml.common.EventBusSubscriber(modid = "hellomcedge", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class TextShot {
    private static int ticks;

    private TextShot() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null || mc.level == null) return;
        ticks++;
        if (ticks == 20 || ticks == 80) {
            mc.options.guiScale().set(ticks == 20 ? 2 : 3);
            mc.gui.setScreen(new dev.mcedge.hello.client.gui.TexttestScreen(new dev.mcedge.hello.world.inventory.TexttestMenu(0, mc.player.getInventory()), mc.player.getInventory(), net.minecraft.network.chat.Component.literal("Text test")));
            System.out.println("[q276] t=" + ticks + " gui opened, window " + mc.getWindow().getWidth() + "x" + mc.getWindow().getHeight() + " scale " + mc.getWindow().getGuiScale());
        }
        if (ticks == 50 || ticks == 110) {
            net.minecraft.client.Screenshot.grab(mc.gameDirectory, "q276_scale" + (ticks == 50 ? 2 : 3) + ".png", mc.gameRenderer.mainRenderTarget(), 1, message -> {});
            System.out.println("[q276] t=" + ticks + " shot");
        }
    }
}
