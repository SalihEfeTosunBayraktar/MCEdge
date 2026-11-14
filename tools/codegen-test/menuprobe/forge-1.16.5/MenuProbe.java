package dev.mcedge.wavethree.custom;

// KUYRUK 191 runtime probe (copied in by tools/codegen-test/menu-shift-runtime.sh, removed afterwards):
// /menuprobe opens ruby_gui on the ruby_chest at 2 100 0 (max stack 32) for a fake player and shift clicks 64 diamonds
// from the first inventory slot. GUI slot 0 holds 20 diamonds, locked slot 3 holds 1 (mayPlace false).
// Expected "[menu] slots 32 0 0 1 32 rest 20": slot 0 topped up to 32, slot 3 untouched, slot 4 filled to 32.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class MenuProbe {
    private MenuProbe() {}

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("menuprobe").executes(ctx -> {
            net.minecraft.world.server.ServerWorld level = ctx.getSource().getLevel();
            net.minecraft.util.math.BlockPos pos = new net.minecraft.util.math.BlockPos(2, 100, 0);
            net.minecraft.inventory.IInventory chest = (net.minecraft.inventory.IInventory) level.getBlockEntity(pos);
            net.minecraft.entity.player.PlayerEntity player = net.minecraftforge.common.util.FakePlayerFactory.getMinecraft(level);
            chest.setItem(0, new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 20));
            chest.setItem(3, new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 1));
            player.inventory.setItem(9, new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 64));
            dev.mcedge.wavethree.world.inventory.RubyGuiMenu menu = new dev.mcedge.wavethree.world.inventory.RubyGuiMenu(0, player.inventory, chest, pos);
            menu.quickMoveStack(player, 5);
            StringBuilder slots = new StringBuilder();
            for (int i = 0; i < 5; i++) slots.append(' ').append(chest.getItem(i).getCount());
            System.out.println("[menu] slots" + slots + " rest " + player.inventory.getItem(9).getCount());
            return 1;
        }));
    }
}
