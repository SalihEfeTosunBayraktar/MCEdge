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
            var up = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.Item.BLOCK, pos, net.minecraft.core.Direction.UP);
            var none = level.getCapability(net.neoforged.neoforge.capabilities.Capabilities.Item.BLOCK, pos, null);
            if (up == null || none == null) {
                System.out.println("[cap] no capability sided " + (up != null) + " unsided " + (none != null));
                return 0;
            }
            var diamond = net.neoforged.neoforge.transfer.item.ItemResource.of(net.minecraft.world.item.Items.DIAMOND);
            var emerald = net.neoforged.neoforge.transfer.item.ItemResource.of(net.minecraft.world.item.Items.EMERALD);
            try (var tx = net.neoforged.neoforge.transfer.transaction.Transaction.openRoot()) {
                System.out.println("[cap] sided rest " + (3 - up.insert(diamond, 3, tx)));
                System.out.println("[cap] sided into out slot rest " + (1 - up.insert(2, emerald, 1, tx)));
                System.out.println("[cap] unsided into out slot rest " + (1 - none.insert(2, emerald, 1, tx)));
                tx.commit();
            }
            net.minecraft.world.Container chest = (net.minecraft.world.Container) level.getBlockEntity(pos);
            System.out.println("[cap] slots " + chest.getItem(0).getCount() + " " + chest.getItem(1).getCount() + " " + chest.getItem(2).getCount());
            return 1;
        }));
    }
}
