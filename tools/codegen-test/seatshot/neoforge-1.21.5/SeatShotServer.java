package dev.mcedge.wavethree.custom;

// Q225, Q226 client check (copied in by tools/codegen-test/seat-client-check.sh, removed afterwards): every online player
// gets creative mode and, once, the corner sofa (2x3 cells) with the tall chair (2 cells tall) beside it on a stone
// floor high above the world; the shared seat runtime lays them down on the sofa's lying spot.
@net.neoforged.fml.common.EventBusSubscriber(modid = "wavethree")
public final class SeatShotServer {
    private SeatShotServer() {}

    private static final java.util.Set<java.util.UUID> SEATED = new java.util.HashSet<>();

    @net.neoforged.bus.api.SubscribeEvent
    public static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        for (net.minecraft.server.level.ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            if (!player.isCreative()) player.setGameMode(net.minecraft.world.level.GameType.CREATIVE);
            if (player.tickCount < 40 || !SEATED.add(player.getUUID())) continue;
            // A clear spot high above the test world's blocks, so the front camera sees the player on the chair.
            net.minecraft.core.BlockPos pos = player.blockPosition().above(30);
            for (net.minecraft.core.BlockPos p : net.minecraft.core.BlockPos.betweenClosed(pos.offset(-6, -1, -6), pos.offset(6, 5, 6))) {
                player.level().setBlockAndUpdate(p, (p.getY() < pos.getY() ? net.minecraft.world.level.block.Blocks.STONE : net.minecraft.world.level.block.Blocks.AIR).defaultBlockState());
            }
            player.teleportTo(pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5);
            player.level().setBlockAndUpdate(pos, dev.mcedge.wavethree.WavethreeMod.CORNER_SOFA.get().defaultBlockState());
            player.level().setBlockAndUpdate(pos.east(3), dev.mcedge.wavethree.WavethreeMod.TALL_CHAIR.get().defaultBlockState());
            net.minecraft.world.phys.Vec3 lie = new net.minecraft.world.phys.Vec3(pos.getX() - 0.5, pos.getY() + 0.4375, pos.getZ() + 0.9375);
            boolean sat = dev.mcedge.wavethree.seat.WavethreeModSeats.sit(player, player.level(), pos, lie);
            System.out.println("[seat] shot sat=" + sat + " lying=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isLying(player));
        }
    }
}
