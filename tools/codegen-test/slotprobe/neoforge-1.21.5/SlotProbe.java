package dev.mcedge.wavethree.custom;

// Q203 runtime probe (copied in by tools/codegen-test/slotchange-runtime.sh, removed afterwards): /slotprobe opens
// watch_gui (onSlotChanged: slot_changed) over the ruby_chest at 2 100 0 for two fake players and changes its slots by a
// click, a shift click, a procedure, the chest itself (as a hopper would) and a slot the procedure rewrites. After each
// step both menus broadcast as the server does every tick. Expected lines are listed in slotchange-runtime.sh.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class SlotProbe {
    private SlotProbe() {}

    private static net.minecraft.world.entity.player.Player player(net.minecraft.server.level.ServerLevel level, String name) {
        return net.neoforged.neoforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
    }

    private static void broadcast(net.minecraft.world.inventory.AbstractContainerMenu... menus) {
        for (net.minecraft.world.inventory.AbstractContainerMenu menu : menus) menu.broadcastChanges();
    }

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("slotprobe").executes(ctx -> {
            try {
                run(ctx.getSource().getLevel());
            } catch (Exception e) {
                System.out.println("[watch] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }

    private static void run(net.minecraft.server.level.ServerLevel level) {
        net.minecraft.core.BlockPos pos = new net.minecraft.core.BlockPos(2, 100, 0);
        net.minecraft.world.Container chest = (net.minecraft.world.Container) level.getBlockEntity(pos);
        net.minecraft.world.entity.player.Player a = player(level, "slot_a"), b = player(level, "slot_b");
        var ma = new dev.mcedge.wavethree.world.inventory.WatchGuiMenu(1, a.getInventory(), chest, pos);
        var mb = new dev.mcedge.wavethree.world.inventory.WatchGuiMenu(2, b.getInventory(), chest, pos);
        a.containerMenu = ma;
        b.containerMenu = mb;
        System.out.println("[watch] start");
        broadcast(ma, mb);
        System.out.println("[watch] idle");
        // A click puts the 5 carried diamonds into slot 0.
        ma.setCarried(new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 5));
        ma.clicked(0, 0, net.minecraft.world.inventory.ClickType.PICKUP, a);
        broadcast(ma, mb);
        System.out.println("[watch] clicked");
        // A shift click moves 10 emeralds from inventory slot 9 (menu slot 3) into the first empty slot, 1.
        a.getInventory().setItem(9, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.EMERALD, 10));
        ma.clicked(3, 0, net.minecraft.world.inventory.ClickType.QUICK_MOVE, a);
        broadcast(ma, mb);
        System.out.println("[watch] shifted");
        // A procedure (gui_set_slot_item) puts 2 gold ingots into slot 1.
        dev.mcedge.wavethree.procedures.WatchWriteProcedure.execute(a);
        broadcast(ma, mb);
        System.out.println("[watch] written");
        // The chest itself changes (as a hopper would); the second player's menu sees it first.
        chest.setItem(0, net.minecraft.world.item.ItemStack.EMPTY);
        broadcast(mb, ma);
        System.out.println("[watch] chest");
        // Slot 2 changes; the procedure answers by writing stone into slot 2, which must not run it again.
        chest.setItem(2, new net.minecraft.world.item.ItemStack(net.minecraft.world.level.block.Blocks.DIRT, 1));
        for (int i = 0; i < 4; i++) broadcast(ma, mb);
        System.out.println("[watch] loop " + (chest.getItem(2).getItem() == net.minecraft.world.item.Items.STONE) + " " + chest.getItem(2).getCount());
        broadcast(ma, mb);
        System.out.println("[watch] end");
    }
}
