package dev.mcedge.wavethree.custom;

// KUYRUK 104 runtime probe (copied in by tools/codegen-test/item-capability-runtime.sh, removed afterwards):
// /capprobe inserts into the ruby_chest at 2 100 0 through the NeoForge item capability, as other mods' pipes do.
// ruby_chest: 9 slots, in 0-1, out 2. Expected: "[cap] sided rest 0", "[cap] sided into out slot rest 1",
// "[cap] unsided into out slot rest 0", "[cap] slots 3 0 1".
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class CapProbe {
    private CapProbe() {}

    @net.neoforged.bus.api.SubscribeEvent
    public static void commands(net.neoforged.neoforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.commands.Commands.literal("capprobe").executes(ctx -> {
            net.minecraft.server.level.ServerLevel level = ctx.getSource().getLevel();
            net.minecraft.core.BlockPos pos = new net.minecraft.core.BlockPos(2, 100, 0);
            var up = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.ItemHandler.BLOCK, pos, net.minecraft.core.Direction.UP);
            var none = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.ItemHandler.BLOCK, pos, null);
            if (up == null || none == null) {
                System.out.println("[cap] no capability sided " + (up != null) + " unsided " + (none != null));
                return 0;
            }
            net.minecraft.world.item.ItemStack rest = net.neoforged.neoforge.items.ItemHandlerHelper.insertItem(up, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND, 3), false);
            System.out.println("[cap] sided rest " + rest.getCount());
            System.out.println("[cap] sided into out slot rest " + up.insertItem(2, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.EMERALD, 1), false).getCount());
            System.out.println("[cap] unsided into out slot rest " + none.insertItem(2, new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.EMERALD, 1), false).getCount());
            net.minecraft.world.Container chest = (net.minecraft.world.Container) level.getBlockEntity(pos);
            System.out.println("[cap] slots " + chest.getItem(0).getCount() + " " + chest.getItem(1).getCount() + " " + chest.getItem(2).getCount());
            return 1;
        }));
    }
}
