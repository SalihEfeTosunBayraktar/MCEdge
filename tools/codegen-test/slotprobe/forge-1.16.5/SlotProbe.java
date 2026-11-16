package dev.mcedge.wavethree.custom;

// Q203 runtime probe (copied in by tools/codegen-test/slotchange-runtime.sh, removed afterwards): /slotprobe opens
// watch_gui (onSlotChanged: slot_changed) over the ruby_chest at 2 100 0 for two fake players and changes its slots by a
// click, a shift click, a procedure, the chest itself (as a hopper would) and a slot the procedure rewrites. After each
// step both menus broadcast as the server does every tick. Expected lines are listed in slotchange-runtime.sh.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class SlotProbe {
    private SlotProbe() {}

    private static net.minecraft.entity.player.PlayerEntity player(net.minecraft.world.server.ServerWorld level, String name) {
        return net.minecraftforge.common.util.FakePlayerFactory.get(level,
            new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
    }

    private static void broadcast(net.minecraft.inventory.container.Container... menus) {
        for (net.minecraft.inventory.container.Container menu : menus) menu.broadcastChanges();
    }

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("slotprobe").executes(ctx -> {
            try {
                run(ctx.getSource().getLevel());
            } catch (Exception e) {
                System.out.println("[watch] failed " + e);
                e.printStackTrace(System.out);
            }
            return 1;
        }));
    }

    private static void run(net.minecraft.world.server.ServerWorld level) {
        net.minecraft.util.math.BlockPos pos = new net.minecraft.util.math.BlockPos(2, 100, 0);
        net.minecraft.inventory.IInventory chest = (net.minecraft.inventory.IInventory) level.getBlockEntity(pos);
        net.minecraft.entity.player.PlayerEntity a = player(level, "slot_a"), b = player(level, "slot_b");
        dev.mcedge.wavethree.world.inventory.WatchGuiMenu ma = new dev.mcedge.wavethree.world.inventory.WatchGuiMenu(1, a.inventory, chest, pos);
        dev.mcedge.wavethree.world.inventory.WatchGuiMenu mb = new dev.mcedge.wavethree.world.inventory.WatchGuiMenu(2, b.inventory, chest, pos);
        a.containerMenu = ma;
        b.containerMenu = mb;
        System.out.println("[watch] start");
        broadcast(ma, mb);
        System.out.println("[watch] idle");
        // A click puts the 5 carried diamonds into slot 0.
        a.inventory.setCarried(new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 5));
        ma.clicked(0, 0, net.minecraft.inventory.container.ClickType.PICKUP, a);
        broadcast(ma, mb);
        System.out.println("[watch] clicked");
        // A shift click moves 10 emeralds from inventory slot 9 (menu slot 3) into the first empty slot, 1.
        a.inventory.setItem(9, new net.minecraft.item.ItemStack(net.minecraft.item.Items.EMERALD, 10));
        ma.clicked(3, 0, net.minecraft.inventory.container.ClickType.QUICK_MOVE, a);
        broadcast(ma, mb);
        System.out.println("[watch] shifted");
        // A procedure (gui_set_slot_item) puts 2 gold ingots into slot 1.
        dev.mcedge.wavethree.procedures.WatchWriteProcedure.execute(a);
        broadcast(ma, mb);
        System.out.println("[watch] written");
        // The chest itself changes (as a hopper would); the second player's menu sees it first.
        chest.setItem(0, net.minecraft.item.ItemStack.EMPTY);
        broadcast(mb, ma);
        System.out.println("[watch] chest");
        // Slot 2 changes; the procedure answers by writing stone into slot 2, which must not run it again.
        chest.setItem(2, new net.minecraft.item.ItemStack(net.minecraft.block.Blocks.DIRT, 1));
        for (int i = 0; i < 4; i++) broadcast(ma, mb);
        System.out.println("[watch] loop " + (chest.getItem(2).getItem() == net.minecraft.item.Items.STONE) + " " + chest.getItem(2).getCount());
        broadcast(ma, mb);
        System.out.println("[watch] end");
    }
}
