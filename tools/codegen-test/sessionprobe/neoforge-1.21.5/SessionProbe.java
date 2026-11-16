package dev.mcedge.wavethree.custom;

// Q205 runtime probe (copied in by tools/codegen-test/session-runtime.sh, removed afterwards): /sessionprobe opens
// session GUI trade_gui on session "probe" for two fake players through the generated open path, puts items in through
// each player's own menu, locks slot 0 with a session value, closes the first player and then presses the second
// one's "End" button (gui_close_session). Expected lines are listed in session-runtime.sh.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class SessionProbe {
    private SessionProbe() {}

    /**
     * A server player without a client (NeoForge's FakePlayer refuses openMenu): its network handler sits on an
     * unconnected Connection, so packets queue. The player list finds it by UUID, like an online player.
     */
    @SuppressWarnings("unchecked")
    private static net.minecraft.server.level.ServerPlayer player(net.minecraft.server.level.ServerLevel level, String name) throws Exception {
        com.mojang.authlib.GameProfile profile = new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name);
        net.minecraft.server.level.ServerPlayer player = new net.minecraft.server.level.ServerPlayer(level.getServer(), level, profile, net.minecraft.server.level.ClientInformation.createDefault());
        net.minecraft.network.Connection connection = new net.minecraft.network.Connection(net.minecraft.network.protocol.PacketFlow.SERVERBOUND);
        // An embedded channel takes the packets (no encoders: they stay in its outbound queue).
        java.lang.reflect.Field channel = net.minecraft.network.Connection.class.getDeclaredField("channel");
        channel.setAccessible(true);
        channel.set(connection, new io.netty.channel.embedded.EmbeddedChannel());
        // Every payload counts as negotiated, as for NeoForge's game test players.
        net.neoforged.neoforge.network.registration.NetworkRegistry.configureMockConnection(connection);
        new net.minecraft.server.network.ServerGamePacketListenerImpl(level.getServer(), connection, player,
            net.minecraft.server.network.CommonListenerCookie.createInitial(profile, false));
        java.lang.reflect.Field byUuid = net.minecraft.server.players.PlayerList.class.getDeclaredField("playersByUUID");
        byUuid.setAccessible(true);
        ((java.util.Map<java.util.UUID, net.minecraft.server.level.ServerPlayer>) byUuid.get(level.getServer().getPlayerList())).put(player.getUUID(), player);
        return player;
    }

    private static int count(net.minecraft.world.entity.player.Player player, net.minecraft.world.item.Item item) {
        int n = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            if (player.getInventory().getItem(i).getItem() == item) n += player.getInventory().getItem(i).getCount();
        }
        return n;
    }

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("sessionprobe").executes(ctx -> {
            try {
                run(ctx.getSource().getLevel());
            } catch (Exception e) {
                System.out.println("[session] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }

    private static void run(net.minecraft.server.level.ServerLevel level) throws Exception {
        String id = "probe";
        net.minecraft.server.level.ServerPlayer a = player(level, "sess_a");
        net.minecraft.server.level.ServerPlayer b = player(level, "sess_b");
        dev.mcedge.wavethree.init.WavethreeModMenus.openSession(a, "trade_gui", id);
        dev.mcedge.wavethree.init.WavethreeModMenus.openSession(b, "trade_gui", id);
        net.minecraft.world.inventory.AbstractContainerMenu ma = a.containerMenu, mb = b.containerMenu;
        System.out.println("[session] menus " + (ma instanceof dev.mcedge.wavethree.world.inventory.TradeGuiMenu) + " " + (mb instanceof dev.mcedge.wavethree.world.inventory.TradeGuiMenu)
            + " " + (ma != mb) + " ids " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.sessionOf(a) + " " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.sessionOf(b)
            + " viewers " + (int) dev.mcedge.wavethree.init.WavethreeModGuiSessions.viewers(level, id));
        // First tick of each menu: onOpen (session_open_log).
        ma.broadcastChanges();
        mb.broadcastChanges();
        ma.getSlot(0).set(new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 5));
        mb.getSlot(1).set(new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.EMERALD, 3));
        ma.getSlot(2).set(new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.GOLD_INGOT, 1));
        System.out.println("[session] shared " + mb.getSlot(0).getItem().getCount() + " " + ma.getSlot(1).getItem().getCount()
            + " hidden " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.item(level, id, 3).getCount());
        // Q203: the tick after: onSlotChanged (session_slot_log) runs once per changed slot although two menus show them.
        ma.broadcastChanges();
        mb.broadcastChanges();
        boolean before = ma.getSlot(0).mayPickup(a);
        dev.mcedge.wavethree.init.WavethreeModGuiSessions.setDataLogic(level, id, "locked", true);
        System.out.println("[session] lock " + before + " " + ma.getSlot(0).mayPickup(a) + " " + mb.getSlot(0).mayPlace(new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.STONE)));
        a.closeContainer();
        System.out.println("[session] after a " + (dev.mcedge.wavethree.init.WavethreeModGuiSessions.get(id) != null) + " viewers " + (int) dev.mcedge.wavethree.init.WavethreeModGuiSessions.viewers(level, id)
            + " a " + count(a, net.minecraft.world.item.Items.DIAMOND));
        // "End" button (widget 4): session_end closes the session for everyone.
        mb.clickMenuButton(b, 4);
        System.out.println("[session] end " + (dev.mcedge.wavethree.init.WavethreeModGuiSessions.get(id) == null)
            + " a " + count(a, net.minecraft.world.item.Items.DIAMOND) + " " + count(a, net.minecraft.world.item.Items.EMERALD)
            + " b " + count(b, net.minecraft.world.item.Items.EMERALD) + " " + count(b, net.minecraft.world.item.Items.DIAMOND)
            + " stone " + count(b, net.minecraft.world.item.Items.STONE) + " gold " + (count(a, net.minecraft.world.item.Items.GOLD_INGOT) + count(b, net.minecraft.world.item.Items.GOLD_INGOT))
            + " menu " + (b.containerMenu == b.inventoryMenu));
    }
}
