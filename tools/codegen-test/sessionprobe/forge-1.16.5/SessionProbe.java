package dev.mcedge.wavethree.custom;

// Q205 runtime probe (copied in by tools/codegen-test/session-runtime.sh, removed afterwards): /sessionprobe opens
// session GUI trade_gui on session "probe" for two fake players through the generated open path, puts items in through
// each player's own menu, locks slot 0 with a session value, closes the first player and then presses the second
// one's "End" button (gui_close_session). Expected lines are listed in session-runtime.sh.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class SessionProbe {
    private SessionProbe() {}

    /** A fake player with a network handler (packets queue) that the player list finds by UUID, like an online player. */
    @SuppressWarnings("unchecked")
    private static net.minecraft.entity.player.ServerPlayerEntity player(net.minecraft.world.server.ServerWorld level, String name) throws Exception {
        net.minecraft.entity.player.ServerPlayerEntity player = net.minecraftforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
        if (player.connection == null) new net.minecraft.network.play.ServerPlayNetHandler(level.getServer(), new net.minecraft.network.NetworkManager(net.minecraft.network.PacketDirection.CLIENTBOUND), player);
        java.lang.reflect.Field byUuid = net.minecraft.server.management.PlayerList.class.getDeclaredField("playersByUUID");
        byUuid.setAccessible(true);
        ((java.util.Map<java.util.UUID, net.minecraft.entity.player.ServerPlayerEntity>) byUuid.get(level.getServer().getPlayerList())).put(player.getUUID(), player);
        return player;
    }

    private static int count(net.minecraft.entity.player.PlayerEntity player, net.minecraft.item.Item item) {
        int n = 0;
        for (int i = 0; i < player.inventory.getContainerSize(); i++) {
            if (player.inventory.getItem(i).getItem() == item) n += player.inventory.getItem(i).getCount();
        }
        return n;
    }

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("sessionprobe").executes(ctx -> {
            try {
                run(ctx.getSource().getLevel());
            } catch (Exception e) {
                System.out.println("[session] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }

    private static void run(net.minecraft.world.server.ServerWorld level) throws Exception {
        String id = "probe";
        net.minecraft.entity.player.ServerPlayerEntity a = player(level, "sess_a");
        net.minecraft.entity.player.ServerPlayerEntity b = player(level, "sess_b");
        dev.mcedge.wavethree.init.WavethreeModMenus.openSession(a, "trade_gui", id);
        dev.mcedge.wavethree.init.WavethreeModMenus.openSession(b, "trade_gui", id);
        net.minecraft.inventory.container.Container ma = a.containerMenu, mb = b.containerMenu;
        System.out.println("[session] menus " + (ma instanceof dev.mcedge.wavethree.world.inventory.TradeGuiMenu) + " " + (mb instanceof dev.mcedge.wavethree.world.inventory.TradeGuiMenu)
            + " " + (ma != mb) + " ids " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.sessionOf(a) + " " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.sessionOf(b)
            + " viewers " + (int) dev.mcedge.wavethree.init.WavethreeModGuiSessions.viewers(level, id));
        // First tick of each menu: onOpen (session_open_log).
        ma.broadcastChanges();
        mb.broadcastChanges();
        ma.getSlot(0).set(new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 5));
        mb.getSlot(1).set(new net.minecraft.item.ItemStack(net.minecraft.item.Items.EMERALD, 3));
        ma.getSlot(2).set(new net.minecraft.item.ItemStack(net.minecraft.item.Items.GOLD_INGOT, 1));
        System.out.println("[session] shared " + mb.getSlot(0).getItem().getCount() + " " + ma.getSlot(1).getItem().getCount()
            + " hidden " + dev.mcedge.wavethree.init.WavethreeModGuiSessions.item(level, id, 3).getCount());
        // Q203: the tick after: onSlotChanged (session_slot_log) runs once per changed slot although two menus show them.
        ma.broadcastChanges();
        mb.broadcastChanges();
        boolean before = ma.getSlot(0).mayPickup(a);
        dev.mcedge.wavethree.init.WavethreeModGuiSessions.setDataLogic(level, id, "locked", true);
        System.out.println("[session] lock " + before + " " + ma.getSlot(0).mayPickup(a) + " " + mb.getSlot(0).mayPlace(new net.minecraft.item.ItemStack(net.minecraft.item.Items.STONE)));
        a.closeContainer();
        System.out.println("[session] after a " + (dev.mcedge.wavethree.init.WavethreeModGuiSessions.get(id) != null) + " viewers " + (int) dev.mcedge.wavethree.init.WavethreeModGuiSessions.viewers(level, id)
            + " a " + count(a, net.minecraft.item.Items.DIAMOND));
        // "End" button (widget 4): session_end closes the session for everyone.
        mb.clickMenuButton(b, 4);
        System.out.println("[session] end " + (dev.mcedge.wavethree.init.WavethreeModGuiSessions.get(id) == null)
            + " a " + count(a, net.minecraft.item.Items.DIAMOND) + " " + count(a, net.minecraft.item.Items.EMERALD)
            + " b " + count(b, net.minecraft.item.Items.EMERALD) + " " + count(b, net.minecraft.item.Items.DIAMOND)
            + " stone " + count(b, net.minecraft.item.Items.STONE) + " gold " + (count(a, net.minecraft.item.Items.GOLD_INGOT) + count(b, net.minecraft.item.Items.GOLD_INGOT))
            + " menu " + (b.containerMenu == b.inventoryMenu));
    }
}
