package dev.mcedge.wavethree.custom;

// Q225 runtime probe (copied in by tools/codegen-test/seat-runtime.sh, removed afterwards). "/seatprobe start" puts a
// ruby_chair facing east and a ruby_bench next to the world spawn and right-clicks them with fake players: a sits on the
// chair, b is refused (taken), c and d fill the bench's two seats, e is refused (full), f holds an item (the chair wants
// an empty hand); g runs the seat_probe procedure on a stone block. "/seatprobe check" (2 s later) reads the seats and
// heights, reads where a and c would stand up, stands a up, breaks the bench; "/seatprobe after" (2 s later) checks that every seat entity is gone.
// Q226 and lying seats: start also places the corner sofa (2x3 cells) and the two cells tall tall chair facing east and
// checks their parts and that a taken cell refuses the sofa; i lies down on the long arm, then h clicks a seat there that
// i's body covers and is laid on the free lying spot of the short arm instead; check reads them and j (survival) breaks
// another part; after counts what is left and what dropped.
@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = "wavethree")
public final class SeatProbe {
    private SeatProbe() {}

    private static net.minecraft.entity.player.ServerPlayerEntity a, b, c, d, e, f, g;
    private static net.minecraft.util.math.BlockPos chair, bench, sofa, tall;
    private static net.minecraft.entity.player.ServerPlayerEntity h, i, j;

    private static net.minecraft.entity.player.ServerPlayerEntity player(net.minecraft.world.server.ServerWorld level, String name) {
        return net.minecraftforge.common.util.FakePlayerFactory.get(level, new com.mojang.authlib.GameProfile(java.util.UUID.nameUUIDFromBytes(name.getBytes(java.nio.charset.StandardCharsets.UTF_8)), name));
    }

    private static boolean use(net.minecraft.entity.player.ServerPlayerEntity player, net.minecraft.util.math.BlockPos pos, double dx) {
        player.setPos(pos.getX() + 0.5 + dx, pos.getY(), pos.getZ() - 1.5);
        return dev.mcedge.wavethree.seat.WavethreeModSeats.use(player, player.level, pos, new net.minecraft.util.math.vector.Vector3d(pos.getX() + 0.5 + dx, pos.getY() + 0.5, pos.getZ() + 0.5), true);
    }

    private static String seat(net.minecraft.entity.player.ServerPlayerEntity player, net.minecraft.util.math.BlockPos pos) {
        net.minecraft.entity.Entity seat = player.getVehicle();
        if (!(seat instanceof dev.mcedge.wavethree.seat.WavethreeModSeats.Seat)) return "none";
        return String.format(java.util.Locale.ROOT, "dx=%.4f dz=%.4f height=%.4f drop=%.4f yaw=%.1f", seat.getX() - pos.getX(), seat.getZ() - pos.getZ(), seat.getY() - pos.getY(), seat.getY() - player.getY(), net.minecraft.util.math.MathHelper.wrapDegrees(player.yRot));
    }

    /** A click on the block at pos hitting the point x, y, z (blocks) from origin. */
    private static boolean useAt(net.minecraft.entity.player.ServerPlayerEntity player, net.minecraft.util.math.BlockPos pos, net.minecraft.util.math.BlockPos origin, double x, double y, double z) {
        net.minecraft.util.math.vector.Vector3d hit = new net.minecraft.util.math.vector.Vector3d(origin.getX() + x, origin.getY() + y, origin.getZ() + z);
        player.setPos(hit.x, origin.getY(), hit.z - 1);
        return dev.mcedge.wavethree.seat.WavethreeModSeats.use(player, player.level, pos, hit, true);
    }

    private static int dropsBefore;

    /** Blocks of a kind around a point. */
    private static int count(net.minecraft.world.server.ServerWorld level, net.minecraft.util.math.BlockPos around, net.minecraft.block.Block block) {
        int found = 0;
        for (net.minecraft.util.math.BlockPos p : net.minecraft.util.math.BlockPos.betweenClosed(around.offset(-3, -1, -3), around.offset(3, 3, 3))) if (level.getBlockState(p).is(block)) found++;
        return found;
    }

    /** Items of a block around a point, down to the ground they fell to. */
    private static int drops(net.minecraft.world.server.ServerWorld level, net.minecraft.util.math.BlockPos around, net.minecraft.block.Block block) {
        int found = 0;
        for (net.minecraft.entity.item.ItemEntity item : level.getEntitiesOfClass(net.minecraft.entity.item.ItemEntity.class, new net.minecraft.util.math.AxisAlignedBB(around).inflate(6, 30, 6))) if (item.getItem().getItem() == block.asItem()) found += item.getItem().getCount();
        return found;
    }

    private static String offset(net.minecraft.util.math.vector.Vector3d at, net.minecraft.util.math.BlockPos pos) {
        return String.format(java.util.Locale.ROOT, "%.2f,%.2f,%.2f", at.x - pos.getX(), at.y - pos.getY(), at.z - pos.getZ());
    }

    private static int seats(net.minecraft.world.server.ServerWorld level) {
        return level.getEntitiesOfClass(dev.mcedge.wavethree.seat.WavethreeModSeats.Seat.class, new net.minecraft.util.math.AxisAlignedBB(chair).inflate(8)).size();
    }

    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void commands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(net.minecraft.command.Commands.literal("seatprobe")
            .then(net.minecraft.command.Commands.literal("start").executes(ctx -> {
                try {
                    net.minecraft.world.server.ServerWorld level = ctx.getSource().getLevel();
                    chair = level.getSharedSpawnPos().above(20);
                    bench = chair.east(3);
                    level.setBlockAndUpdate(chair, dev.mcedge.wavethree.WavethreeMod.RUBY_CHAIR.get().defaultBlockState().setValue(dev.mcedge.wavethree.block.RubyChairBlock.FACING, net.minecraft.util.Direction.EAST));
                    level.setBlockAndUpdate(bench, dev.mcedge.wavethree.WavethreeMod.RUBY_BENCH.get().defaultBlockState());
                    level.setBlockAndUpdate(chair.west(3), net.minecraft.block.Blocks.STONE.defaultBlockState());
                    a = player(level, "seat_a"); b = player(level, "seat_b"); c = player(level, "seat_c"); d = player(level, "seat_d");
                    e = player(level, "seat_e"); f = player(level, "seat_f"); g = player(level, "seat_g");
                    f.setItemInHand(net.minecraft.util.Hand.MAIN_HAND, new net.minecraft.item.ItemStack(net.minecraft.item.Items.STICK));
                    System.out.println("[seat] use a=" + use(a, chair, 0) + " b=" + use(b, chair, 0) + " f=" + use(f, chair, 0));
                    System.out.println("[seat] bench c=" + use(c, bench, -0.3) + " d=" + use(d, bench, 0.3) + " e=" + use(e, bench, 0));
                    net.minecraft.util.math.BlockPos stone = chair.west(3);
                    dev.mcedge.wavethree.procedures.SeatProbeProcedure.execute(level, stone.getX(), stone.getY(), stone.getZ(), g);
                    net.minecraft.block.Block sofaBlock = dev.mcedge.wavethree.WavethreeMod.CORNER_SOFA.get(), chairBlock = dev.mcedge.wavethree.WavethreeMod.TALL_CHAIR.get();
                    sofa = chair.south(12);
                    tall = chair.south(20);
                    level.setBlockAndUpdate(sofa, sofaBlock.defaultBlockState());
                    level.setBlockAndUpdate(tall, chairBlock.defaultBlockState().setValue(dev.mcedge.wavethree.block.TallChairBlock.FACING, net.minecraft.util.Direction.EAST));
                    System.out.println("[multi] placed sofa=" + count(level, sofa, sofaBlock) + " chair=" + count(level, tall, chairBlock) + " top=" + level.getBlockState(tall.above()).getValue(dev.mcedge.wavethree.block.TallChairBlock.PART));
                    // A taken cell (the sofa's south-west one) refuses the origin; free, it fits.
                    net.minecraft.util.math.BlockPos test = sofa.east(8);
                    level.setBlockAndUpdate(test.offset(-1, 0, 1), net.minecraft.block.Blocks.STONE.defaultBlockState());
                    boolean blocked = sofaBlock.defaultBlockState().canSurvive(level, test);
                    level.setBlockAndUpdate(test.offset(-1, 0, 1), net.minecraft.block.Blocks.AIR.defaultBlockState());
                    System.out.println("[multi] fits blocked=" + blocked + " free=" + sofaBlock.defaultBlockState().canSurvive(level, test));
                    h = player(level, "multi_h"); i = player(level, "multi_i"); j = player(level, "multi_j");
                    System.out.println("[multi] use i=" + useAt(i, sofa, sofa, -0.5, 0.4375, 0.9375) + " h=" + useAt(h, sofa.offset(-1, 0, 1), sofa, -0.3125, 0.4375, 1.6875));
                } catch (Exception ex) {
                    System.out.println("[seat] failed " + ex);
                    ex.printStackTrace(System.out);
                }
                return 1;
            }))
            .then(net.minecraft.command.Commands.literal("check").executes(ctx -> {
                net.minecraft.world.server.ServerWorld level = ctx.getSource().getLevel();
                System.out.println("[seat] chair a " + seat(a, chair) + " sitting=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(a));
                System.out.println("[seat] bench c " + seat(c, bench));
                System.out.println("[seat] bench d " + seat(d, bench));
                System.out.println("[seat] entities " + seats(level));
                // Where they would stand up: a on top of the chair (its back box, 1.0), c in front of the bench (north, on its floor).
                System.out.println("[seat] dismount a " + offset(a.getVehicle().getDismountLocationForPassenger(a), chair) + " c " + offset(c.getVehicle().getDismountLocationForPassenger(c), bench));
                dev.mcedge.wavethree.seat.WavethreeModSeats.standUp(a);
                level.setBlockAndUpdate(bench, net.minecraft.block.Blocks.AIR.defaultBlockState());
                System.out.println("[seat] stood a=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(a));
                System.out.println("[multi] h " + seat(h, sofa) + " lying=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isLying(h) + " i lying=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isLying(i) + " feet " + offset(new net.minecraft.util.math.vector.Vector3d(i.getX(), i.getY(), i.getZ()), sofa));
                // j (survival) breaks the sofa's north-west part: the whole sofa goes and drops once (the world is reused, so
                // sofas dropped by earlier runs are counted first).
                dropsBefore = drops(ctx.getSource().getLevel(), sofa, dev.mcedge.wavethree.WavethreeMod.CORNER_SOFA.get());
                j.gameMode.destroyBlock(sofa.offset(-1, 0, -1));
                return 1;
            }))
            .then(net.minecraft.command.Commands.literal("after").executes(ctx -> {
                System.out.println("[seat] after c=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(c) + " d=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(d) + " entities " + seats(ctx.getSource().getLevel()));
                net.minecraft.block.Block sofaBlock = dev.mcedge.wavethree.WavethreeMod.CORNER_SOFA.get();
                System.out.println("[multi] after sofa=" + count(ctx.getSource().getLevel(), sofa, sofaBlock) + " drops=" + (drops(ctx.getSource().getLevel(), sofa, sofaBlock) - dropsBefore) + " h=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(h) + " i=" + dev.mcedge.wavethree.seat.WavethreeModSeats.isSitting(i));
                return 1;
            })));
    }
}
