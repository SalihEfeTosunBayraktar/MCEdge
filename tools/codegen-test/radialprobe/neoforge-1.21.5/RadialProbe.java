package dev.mcedge.wavethree.custom;

// Q227 runtime probe (copied in by tools/codegen-test/radial-runtime.sh, removed afterwards). "/radialprobe start" makes a
// fake player and lists the runtime images the server loaded; "/radialprobe choose <tab> <slice>" sends the request a
// client sends when it chooses a slice (one per command: a player cannot choose faster than every few ticks) and logs the
// bubble shown and the slice the "slice chosen" listeners got; "/radialprobe blocks" runs the radial_blocks procedure.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class RadialProbe {
    private RadialProbe() {}

    private static net.minecraft.server.level.ServerPlayer a;
    private static String last = "none";

    @SuppressWarnings("unchecked")
    private static net.minecraft.server.level.ServerPlayer player(net.minecraft.server.level.ServerLevel level, String name) throws Exception {
        net.minecraft.server.level.ServerPlayer player = net.neoforged.neoforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
        java.lang.reflect.Field byUuid = net.minecraft.server.players.PlayerList.class.getDeclaredField("playersByUUID");
        byUuid.setAccessible(true);
        ((java.util.Map<java.util.UUID, net.minecraft.server.level.ServerPlayer>) byUuid.get(level.getServer().getPlayerList())).put(player.getUUID(), player);
        return player;
    }

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("radialprobe")
            .then(net.minecraft.commands.Commands.literal("start").executes(ctx -> {
                try {
                    a = player(ctx.getSource().getLevel(), "radial_a");
                    // An operator, so the /say hi slice runs with its own permissions (level 2).
                    ctx.getSource().getServer().getPlayerList().op(a.getGameProfile());
                    dev.mcedge.wavethree.procedures.RadialMenus.LISTENERS.add((player, menu, tab, slice) -> last = menu + "/" + tab + "/" + slice);
                    StringBuilder images = new StringBuilder();
                    for (dev.mcedge.wavethree.procedures.RuntimeImages.Image image : dev.mcedge.wavethree.procedures.RuntimeImages.folder("emotes").values())
                        images.append(' ').append(image.name).append('=').append(image.frames).append('x').append(image.time);
                    System.out.println("[radial] images" + images + " menus=" + dev.mcedge.wavethree.procedures.RadialMenus.menus().keySet());
                } catch (Exception e) {
                    System.out.println("[radial] failed " + e);
                    e.printStackTrace(System.out);
                }
                return 1;
            }))
            .then(net.minecraft.commands.Commands.literal("choose").then(net.minecraft.commands.Commands.argument("tab", com.mojang.brigadier.arguments.IntegerArgumentType.integer())
                .then(net.minecraft.commands.Commands.argument("slice", com.mojang.brigadier.arguments.StringArgumentType.word()).executes(ctx -> {
                    last = "none";
                    String slice = com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "slice");
                    dev.mcedge.wavethree.procedures.RadialMenus.receive(a.level(), a, "choose", "wheel", com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(ctx, "tab"), slice);
                    System.out.println("[radial] choose " + slice + " chosen=" + last + " bubble=" + dev.mcedge.wavethree.procedures.WavethreeModBubbles.icon(a));
                    return 1;
                }))))
            .then(net.minecraft.commands.Commands.literal("blocks").executes(ctx -> {
                dev.mcedge.wavethree.procedures.WavethreeModBubbles.clear(a);
                dev.mcedge.wavethree.procedures.RadialBlocksProcedure.execute(a.level(), a);
                return 1;
            })));
    }
}
