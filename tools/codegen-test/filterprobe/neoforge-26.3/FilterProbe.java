package dev.mcedge.wavethree.custom;

// Q257 runtime probe (copied in by tools/codegen-test/filter-runtime.sh, removed afterwards): /filterprobe opens filter_gui
// over the ruby_chest at 2 100 0 for a fake player, prints each slot's mayPlace and shift clicks diamonds, paper, sticks and a bone.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class FilterProbe {
    private FilterProbe() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("filterprobe").executes(ctx -> {
            net.minecraft.server.level.ServerLevel level = ctx.getSource().getLevel();
            net.minecraft.core.BlockPos pos = new net.minecraft.core.BlockPos(2, 100, 0);
            net.minecraft.world.Container chest = (net.minecraft.world.Container) level.getBlockEntity(pos);
            net.minecraft.world.entity.player.Player player = net.neoforged.neoforge.common.util.FakePlayerFactory.getMinecraft(level);
            net.minecraft.world.item.ItemStack[] test = {new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 5), new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.STICK, 2), new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.PAPER, 3), new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BONE, 1)};
            player.getInventory().setItem(9, test[0].copy());
            player.getInventory().setItem(10, test[2].copy());
            player.getInventory().setItem(11, test[1].copy());
            player.getInventory().setItem(12, test[3].copy());
            var menu = new dev.mcedge.wavethree.world.inventory.FilterGuiMenu(0, player.getInventory(), chest, pos);
            StringBuilder may = new StringBuilder();
            for (int s = 0; s < 5; s++) {
                may.append(" s").append(s).append(':');
                for (net.minecraft.world.item.ItemStack t : test) may.append(menu.getSlot(s).mayPlace(t) ? 'Y' : 'n');
            }
            System.out.println("[filter] mayPlace (diamond stick paper bone)" + may);
            menu.quickMoveStack(player, 5);
            menu.quickMoveStack(player, 6);
            menu.quickMoveStack(player, 7);
            menu.quickMoveStack(player, 8);
            StringBuilder slots = new StringBuilder();
            for (int i = 0; i < 5; i++) slots.append(' ').append(chest.getItem(i).getCount());
            System.out.println("[filter] shift slots" + slots + " rest " + player.getInventory().getItem(9).getCount() + " " + player.getInventory().getItem(10).getCount() + " " + player.getInventory().getItem(11).getCount() + " " + player.getInventory().getItem(12).getCount());
            return 1;
        }));
    }
}
