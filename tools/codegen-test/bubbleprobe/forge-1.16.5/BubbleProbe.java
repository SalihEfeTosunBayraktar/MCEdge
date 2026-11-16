package dev.mcedge.wavethree.custom;

// Q206 runtime probe (copied in by tools/codegen-test/bubble-runtime.sh, removed afterwards). "/bubbleprobe start" runs
// the bubble_probe procedure (show, read, clear blocks) and shows bubbles on four fake players: a until cleared, b for 20
// ticks, c not in the player list (as if logged out), d dead. "/bubbleprobe check" (3 s later) reads them and clears a.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class BubbleProbe {
    private BubbleProbe() {}

    private static net.minecraft.entity.player.ServerPlayerEntity a, b, c, d;

    @SuppressWarnings("unchecked")
    private static net.minecraft.entity.player.ServerPlayerEntity player(net.minecraft.world.server.ServerWorld level, String name, boolean online) throws Exception {
        net.minecraft.entity.player.ServerPlayerEntity player = net.minecraftforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
        if (online) {
            java.lang.reflect.Field byUuid = net.minecraft.server.management.PlayerList.class.getDeclaredField("playersByUUID");
            byUuid.setAccessible(true);
            ((java.util.Map<java.util.UUID, net.minecraft.entity.player.ServerPlayerEntity>) byUuid.get(level.getServer().getPlayerList())).put(player.getUUID(), player);
        }
        return player;
    }

    private static String icons() {
        return "a=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(a) + " b=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(b)
            + " c=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(c) + " d=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(d);
    }

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("bubbleprobe")
            .then(net.minecraft.command.Commands.literal("start").executes(ctx -> {
                try {
                    net.minecraft.world.server.ServerWorld level = ctx.getSource().getLevel();
                    a = player(level, "bub_a", true);
                    b = player(level, "bub_b", true);
                    c = player(level, "bub_c", false);
                    d = player(level, "bub_d", true);
                    dev.mcedge.wavethree.procedures.BubbleProbeProcedure.execute(level, a);
                    // Q216: the standard block with a designed bubble, and the bubble data the server reads from bubbles.json.
                    dev.mcedge.wavethree.procedures.BubbleDesignedProcedure.execute(level, a);
                    System.out.println("[bubble] styles trade_offer=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("trade_offer").width + "x" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("trade_offer").height + " slice=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("trade_offer").slice
                        + " caption=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("trade_offer").caption + " default=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("default").iconSize + " unknown=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("nope").width);
                    // Q228, Q229: the transitions helper and the frame lists the runtime reads from bubbles.json.
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.Style offer = dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("trade_offer");
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.Style timed = dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("timed_note");
                    float[] out = offer.timing.leaving(4.0F);
                    StringBuilder bg = new StringBuilder(), ic = new StringBuilder();
                    for (int t : new int[] { 0, 10, 30, 40, 50, 60 }) bg.append(bg.length() == 0 ? "" : ",").append(timed.backgroundFrames.at(t));
                    for (int t : new int[] { 0, 35, 100 }) ic.append(ic.length() == 0 ? "" : ",").append(timed.iconFrames.at(t));
                    System.out.println(String.format(java.util.Locale.ROOT, "[bubble] timing appear=%d disappear=%d active=%d out=%.2f/%.2f/%.2f note=%d bg=%s icon=%s once=%b", offer.timing.appear.length(), offer.timing.disappear.length(), offer.duration, out[0], out[1], out[2],
                        dev.mcedge.wavethree.procedures.WavethreeModBubbles.style("plain_note").duration, bg, ic, timed.iconFrames.once()));
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(a, "trade", 0);
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(b, "trade", 20);
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(c, "trade", 0);
                    dev.mcedge.wavethree.procedures.WavethreeModBubbles.show(d, "trade", 0);
                    d.setHealth(0.0F);
                    System.out.println("[bubble] start " + icons());
                } catch (Exception e) {
                    System.out.println("[bubble] failed " + e);
                    e.printStackTrace(System.out);
                }
                return 1;
            }))
            .then(net.minecraft.command.Commands.literal("check").executes(ctx -> {
                System.out.println("[bubble] later " + icons());
                dev.mcedge.wavethree.procedures.WavethreeModBubbles.clear(a);
                System.out.println("[bubble] cleared " + icons());
                return 1;
            })));
    }
}
