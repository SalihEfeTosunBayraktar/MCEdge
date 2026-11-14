package dev.mcedge.wavethree.custom;

// KUYRUK 191 runtime probe (copied in by tools/codegen-test/menu-shift-runtime.sh, removed afterwards):
// /menuprobe opens ruby_gui on the ruby_chest at 2 100 0 (max stack 32) for a fake player and shift clicks 64 diamonds
// from the first inventory slot. GUI slot 0 holds 20 diamonds, locked slot 3 holds 1 (mayPlace false).
// Expected "[menu] slots 32 0 0 1 32 rest 20": slot 0 topped up to 32, slot 3 untouched, slot 4 filled to 32.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class MenuProbe {
    private MenuProbe() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("menuprobe").executes(ctx -> {
            net.minecraft.server.level.ServerLevel level = ctx.getSource().getLevel();
            net.minecraft.core.BlockPos pos = new net.minecraft.core.BlockPos(2, 100, 0);
            net.minecraft.world.Container chest = (net.minecraft.world.Container) level.getBlockEntity(pos);
            net.minecraft.world.entity.player.Player player = net.neoforged.neoforge.common.util.FakePlayerFactory.getMinecraft(level);
            chest.setItem(0, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 20));
            chest.setItem(3, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 1));
            player.getInventory().setItem(9, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 64));
            var menu = new dev.mcedge.wavethree.world.inventory.RubyGuiMenu(0, player.getInventory(), chest, pos);
            menu.quickMoveStack(player, 5);
            StringBuilder slots = new StringBuilder();
            for (int i = 0; i < 5; i++) slots.append(' ').append(chest.getItem(i).getCount());
            System.out.println("[menu] slots" + slots + " rest " + player.getInventory().getItem(9).getCount());
            return 1;
        }));
    }
}
