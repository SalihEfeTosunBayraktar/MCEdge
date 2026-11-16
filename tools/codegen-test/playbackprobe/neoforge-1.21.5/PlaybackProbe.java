package dev.mcedge.wavethree.custom;

// Q229 client probe (copied in by tools/codegen-test/playback-client-check.sh, removed afterwards). In a world it logs
// "[q229] t=<tick> <sprite> frame=<position in the frame list>" whenever a mod sprite's animation moves on, places the
// hold-last and ping-pong blocks in front of the camera with the hold item in hand, takes screenshots at fixed ticks
// (run/screenshots/q229_<tick>.png), opens playback_gui at tick 200 and restarts its procedure image at tick 300.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree", value = net.neoforged.api.distmarker.Dist.CLIENT)
public final class PlaybackProbe {
    private static final int[] SHOTS = {25, 35, 45, 55, 65, 125, 205, 215, 225, 245, 265, 305, 325, 345};
    private static final java.util.Map<String, Integer> LAST = new java.util.HashMap<>();
    private static int ticks;

    private PlaybackProbe() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null || mc.level == null) return;
        ticks++;
        if (ticks == 3) {
            mc.player.setYRot(0.0F);
            mc.player.setXRot(20.0F);
            net.minecraft.core.BlockPos base = mc.player.blockPosition().offset(0, 1, 3);
            mc.level.setBlock(base.east(), dev.mcedge.wavethree.WavethreeMod.PLAYBACK_HOLD_BLOCK.get().defaultBlockState(), 3);
            mc.level.setBlock(base.west(), dev.mcedge.wavethree.WavethreeMod.PLAYBACK_PINGPONG_BLOCK.get().defaultBlockState(), 3);
            mc.player.getInventory().setItem(mc.player.getInventory().getSelectedSlot(), new net.minecraft.world.item.ItemStack(dev.mcedge.wavethree.WavethreeMod.PLAYBACK_HOLD_ITEM.get()));
            System.out.println("[q229] blocks placed at " + base);
        }
        if (ticks == 200) {
            mc.setScreen(new dev.mcedge.wavethree.client.gui.PlaybackGuiScreen(new dev.mcedge.wavethree.world.inventory.PlaybackGuiMenu(0, mc.player.getInventory()), mc.player.getInventory(), net.minecraft.network.chat.Component.literal("Playback")));
            System.out.println("[q229] t=200 gui opened");
        }
        if (ticks == 300) {
            dev.mcedge.wavethree.client.WavethreeModTextureAnimations.restart("playback_gui", "replay");
            System.out.println("[q229] t=300 replay restarted");
        }
        for (int shot : SHOTS) if (ticks == shot) net.minecraft.client.Screenshot.grab(mc.gameDirectory, "q229_" + ticks + ".png", mc.getMainRenderTarget(), message -> {});
        try {
            Object atlas = mc.getTextureManager().getTexture(net.minecraft.client.renderer.texture.TextureAtlas.LOCATION_BLOCKS);
            for (java.lang.reflect.Field list : net.minecraft.client.renderer.texture.TextureAtlas.class.getDeclaredFields()) {
                if (!java.util.List.class.isAssignableFrom(list.getType())) continue;
                list.setAccessible(true);
                for (Object entry : (java.util.List<?>) list.get(atlas)) {
                    if (!(entry instanceof net.minecraft.client.renderer.texture.TextureAtlasSprite.Ticker)) continue;
                    net.minecraft.client.renderer.texture.TextureAtlasSprite sprite = null;
                    Object ticker = null;
                    for (java.lang.reflect.Field field : entry.getClass().getDeclaredFields()) {
                        field.setAccessible(true);
                        Object value = field.get(entry);
                        if (value instanceof net.minecraft.client.renderer.texture.TextureAtlasSprite s) sprite = s;
                        else if (value instanceof net.minecraft.client.renderer.texture.SpriteTicker) ticker = value;
                    }
                    if (sprite == null || ticker == null || !"wavethree".equals(sprite.contents().name().getNamespace())) continue;
                    String name = sprite.contents().name().toString();
                    if (!name.contains("playback")) continue;
                    int frame = firstInt(ticker);
                    if (!Integer.valueOf(frame).equals(LAST.put(name, frame))) System.out.println("[q229] t=" + ticks + " " + name + " frame=" + frame);
                }
            }
        } catch (ReflectiveOperationException e) {
            System.out.println("[q229] probe failed " + e);
        }
        if (mc.screen instanceof dev.mcedge.wavethree.client.gui.PlaybackGuiScreen && ticks % 5 == 0) {
            long since = dev.mcedge.wavethree.client.WavethreeModTextureAnimations.since("playback_gui", "replay");
            System.out.println("[q229] t=" + ticks + " gui replay frame=" + dev.mcedge.wavethree.client.WavethreeModTextureAnimations.frame(since, new int[] {0, 1, 2, 3}, new int[] {10, 10, 10, 10}, 3));
        }
    }

    private static int firstInt(Object owner) throws IllegalAccessException {
        for (java.lang.reflect.Field field : owner.getClass().getDeclaredFields()) {
            if (field.getType() != int.class || java.lang.reflect.Modifier.isFinal(field.getModifiers())) continue;
            field.setAccessible(true);
            return field.getInt(owner);
        }
        return -1;
    }
}
