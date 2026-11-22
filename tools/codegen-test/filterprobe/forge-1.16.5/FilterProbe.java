package dev.mcedge.wavethree.custom;

// Q257 runtime probe (copied in by tools/codegen-test/filter-runtime.sh, removed afterwards): /filterprobe opens filter_gui
// over the ruby_chest at 2 100 0 for a fake player, prints each slot's mayPlace and shift clicks diamonds, paper, sticks and a bone.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class FilterProbe {
    private FilterProbe() {}

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("filterprobe").executes(ctx -> {
            net.minecraft.world.server.ServerWorld level = ctx.getSource().getLevel();
            net.minecraft.util.math.BlockPos pos = new net.minecraft.util.math.BlockPos(2, 100, 0);
            net.minecraft.inventory.IInventory chest = (net.minecraft.inventory.IInventory) level.getBlockEntity(pos);
            net.minecraft.entity.player.PlayerEntity player = net.minecraftforge.common.util.FakePlayerFactory.getMinecraft(level);
            net.minecraft.item.ItemStack[] test = {new net.minecraft.item.ItemStack(net.minecraft.item.Items.DIAMOND, 5), new net.minecraft.item.ItemStack(net.minecraft.item.Items.STICK, 2), new net.minecraft.item.ItemStack(net.minecraft.item.Items.PAPER, 3), new net.minecraft.item.ItemStack(net.minecraft.item.Items.BONE, 1)};
            player.inventory.setItem(9, test[0].copy());
            player.inventory.setItem(10, test[2].copy());
            player.inventory.setItem(11, test[1].copy());
            player.inventory.setItem(12, test[3].copy());
            dev.mcedge.wavethree.world.inventory.FilterGuiMenu menu = new dev.mcedge.wavethree.world.inventory.FilterGuiMenu(0, player.inventory, chest, pos);
            StringBuilder may = new StringBuilder();
            for (int s = 0; s < 5; s++) {
                may.append(" s").append(s).append(':');
                for (net.minecraft.item.ItemStack t : test) may.append(menu.getSlot(s).mayPlace(t) ? 'Y' : 'n');
            }
            System.out.println("[filter] mayPlace (diamond stick paper bone)" + may);
            menu.quickMoveStack(player, 5);
            menu.quickMoveStack(player, 6);
            menu.quickMoveStack(player, 7);
            menu.quickMoveStack(player, 8);
            StringBuilder slots = new StringBuilder();
            for (int i = 0; i < 5; i++) slots.append(' ').append(chest.getItem(i).getCount());
            System.out.println("[filter] shift slots" + slots + " rest " + player.inventory.getItem(9).getCount() + " " + player.inventory.getItem(10).getCount() + " " + player.inventory.getItem(11).getCount() + " " + player.inventory.getItem(12).getCount());
            return 1;
        }));
    }
}
