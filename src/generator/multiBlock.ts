import type { Element } from "../elements/model.ts";
import { cellBoxes, isMultiBlock, spannedCells, turnsFlat, type Cell } from "../elements/multiBlock.ts";
import { procedureBuild } from "./procedures.ts";
import { modClassName } from "./registries.ts";
import type { GenEnv, JavaSourceFile } from "./typeModule.ts";

/**
 * Multi-blocks (Q226): one block element spanning several cells (src/elements/multiBlock.ts).
 *
 * Every such block extends one generated base class, <Mod>MultiBlock, and only adds its data: its cells and a "part"
 * state property (0 = the origin, which draws the model; the others are invisible parts with their slice of the boxes).
 * The base class checks that the other cells are free before the origin is placed, places the parts with the origin
 * (by a player, a command or a procedure), removes the whole block when any part goes (only the origin drops: once,
 * whichever part was broken; nothing in creative), and refuses pistons. Cells turn with the block's facing like its model.
 */

/** The state property naming a cell's part. */
export const PART_PROPERTY = "part";

export const multiBlockClass = (env: GenEnv) => `${env.project.mod.package}.block.${modClassName(env)}MultiBlock`;

/**
 * The cells of a block that spans several, or undefined. Only plain blocks without a facing or with a horizontal one can;
 * the others, and a waterlogged or falling block, are warned about here and stay single blocks or lose that option.
 */
export function multiBlockCells(env: GenEnv, block: Element, rotation: number): Cell[] | undefined {
  if (!isMultiBlock(block)) return undefined;
  const warn = (text: string) => procedureBuild(env).warnings.push(`block/${block.id}: ${text}`);
  const cells = spannedCells({ ...block, rotationMode: rotation });
  if (!cells) {
    warn(turnsFlat({ ...block, rotationMode: rotation }) ? "spans several blocks, but its bounding boxes stay inside its own cell"
      : "a block spanning several cells can only face the four horizontal directions; it stays one block");
    return undefined;
  }
  if (block.isWaterloggable === true) warn("a block spanning several cells cannot be waterlogged; waterlogging is off");
  if (block.hasGravity === true) warn("a block spanning several cells cannot fall; gravity is off");
  if (block.useLootTableForDrops === true) warn("its own loot table runs for every part; let it drop only for part=0");
  return cells;
}

/** Java fields of one multi-block: its cells and its part property. */
export function multiBlockFields(env: GenEnv, cells: Cell[]): string[] {
  const property = env.mc === "1.16.5" ? "net.minecraft.state.IntegerProperty" : "net.minecraft.world.level.block.state.properties.IntegerProperty";
  return [
    `/** The cells this block spans, in blocks from the origin for the block facing north (Q226). */\n    private static final int[][] CELLS = { ${cells.map((c) => `{ ${c.join(", ")} }`).join(", ")} };`,
    `public static final ${property} PART = ${property}.create(${JSON.stringify(PART_PROPERTY)}, 0, ${cells.length - 1});`,
  ];
}

/** Java members of one multi-block: the base class asks for its part property and its facing in quarters. */
export function multiBlockMembers(env: GenEnv, rotation: number): string[] {
  const legacy = env.mc === "1.16.5";
  const property = legacy ? "net.minecraft.state.IntegerProperty" : "net.minecraft.world.level.block.state.properties.IntegerProperty";
  const state = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
  // Direction.get2DDataValue: south 0, west 1, north 2, east 3.
  const quarters = rotation ? "return (state.getValue(FACING).get2DDataValue() + 2) % 4;" : "return 0;";
  return [`
    @Override
    protected ${property} part() {
        return PART;
    }

    @Override
    protected int quarters(${state} state) {
        ${quarters}
    }
`];
}

/** Boxes of each part, in the part's own cell: the block's boxes cut to the cell. */
export function partBoxes<B extends { mx: number; my: number; mz: number; Mx: number; My: number; Mz: number; subtract?: boolean }>(boxes: B[], cells: Cell[]): B[][] {
  const ordered = boxes.map((b) => ({
    ...b, mx: Math.min(b.mx, b.Mx), Mx: Math.max(b.mx, b.Mx), my: Math.min(b.my, b.My), My: Math.max(b.my, b.My), mz: Math.min(b.mz, b.Mz), Mz: Math.max(b.mz, b.Mz),
  }));
  return cells.map((cell) => cellBoxes(ordered, cell));
}

/**
 * The blockstate of a multi-block from its single-block one: part 0 keeps every variant, the other parts show the empty
 * part model. Multipart blockstates get the part condition on every case.
 */
export function multiBlockstate(blockstate: Record<string, unknown>, parts: number, partModel: string): Record<string, unknown> {
  if (Array.isArray(blockstate.multipart)) {
    const cases = (blockstate.multipart as { when?: Record<string, unknown>; apply: unknown }[]).map((c) => {
      const when = c.when ?? {};
      // OR / AND cases keep their condition and are wrapped; plain ones just add the property.
      const own = "OR" in when || "AND" in when ? { AND: [when, { [PART_PROPERTY]: "0" }] } : { ...when, [PART_PROPERTY]: "0" };
      return { ...c, when: own };
    });
    return { multipart: [...cases, { when: { [PART_PROPERTY]: Array.from({ length: parts - 1 }, (_, i) => i + 1).join("|") }, apply: { model: partModel } }] };
  }
  const variants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((blockstate.variants ?? {}) as Record<string, unknown>)) {
    for (let p = 0; p < parts; p++) variants[`${key ? `${key},` : ""}${PART_PROPERTY}=${p}`] = p === 0 ? value : { model: partModel };
  }
  return { variants };
}

/** Java names that differ between 1.16.5 and 1.21.5+. */
function names(env: GenEnv) {
  return env.mc === "1.16.5"
    ? {
      Block: "net.minecraft.block.Block", Blocks: "net.minecraft.block.Blocks", State: "net.minecraft.block.BlockState", Pos: "net.minecraft.util.math.BlockPos",
      Props: "net.minecraft.block.AbstractBlock.Properties", Int: "net.minecraft.state.IntegerProperty", Reader: "net.minecraft.world.IWorldReader",
      Level: "net.minecraft.world.World", Player: "net.minecraft.entity.player.PlayerEntity", Direction: "net.minecraft.util.Direction",
      client: "level.isClientSide", outside: "net.minecraft.world.World.isOutsideBuildHeight(p)", replaceable: "there.getMaterial().isReplaceable()",
      canPlace: "level.getBlockState(p).getMaterial().isReplaceable()",
    }
    : {
      Block: "net.minecraft.world.level.block.Block", Blocks: "net.minecraft.world.level.block.Blocks", State: "net.minecraft.world.level.block.state.BlockState",
      Pos: "net.minecraft.core.BlockPos", Props: "net.minecraft.world.level.block.state.BlockBehaviour.Properties",
      Int: "net.minecraft.world.level.block.state.properties.IntegerProperty", Reader: "net.minecraft.world.level.LevelReader",
      Level: "net.minecraft.world.level.Level", Player: "net.minecraft.world.entity.player.Player", Direction: "net.minecraft.core.Direction",
      client: "level.isClientSide()", outside: "level.isOutsideBuildHeight(p)", replaceable: "there.canBeReplaced()",
      canPlace: "level.getBlockState(p).canBeReplaced()",
    };
}

/** Overrides of the base class that differ per generation. */
function overrides(env: GenEnv): string {
  const N = names(env);
  const S = N.State;
  if (env.mc === "1.16.5") {
    return `    @Override
    public boolean canSurvive(${S} state, ${N.Reader} level, ${N.Pos} pos) {
        return fits(state, level, pos) && super.canSurvive(state, level, pos);
    }

    @Override
    public ${S} updateShape(${S} state, ${N.Direction} facing, ${S} facingState, net.minecraft.world.IWorld level, ${N.Pos} pos, ${N.Pos} facingPos) {
        return intact(level, origin(state, pos), quarters(state)) ? super.updateShape(state, facing, facingState, level, pos, facingPos) : ${N.Blocks}.AIR.defaultBlockState();
    }

    @Override
    public void onPlace(${S} state, ${N.Level} level, ${N.Pos} pos, ${S} oldState, boolean moving) {
        super.onPlace(state, level, pos, oldState, moving);
        placeParts(state, level, pos, oldState, moving);
    }

    @Override
    public void playerWillDestroy(${N.Level} level, ${N.Pos} pos, ${S} state, ${N.Player} player) {
        creativeBreak(level, pos, state, player);
        super.playerWillDestroy(level, pos, state, player);
    }

    @Override
    public net.minecraft.block.material.PushReaction getPistonPushReaction(${S} state) {
        return net.minecraft.block.material.PushReaction.BLOCK;
    }
`;
  }
  return `    @Override
    protected boolean canSurvive(${S} state, ${N.Reader} level, ${N.Pos} pos) {
        return fits(state, level, pos) && super.canSurvive(state, level, pos);
    }

    @Override
    protected ${S} updateShape(${S} state, ${N.Reader} level, net.minecraft.world.level.ScheduledTickAccess ticks, ${N.Pos} pos, ${N.Direction} facing, ${N.Pos} facingPos, ${S} facingState, net.minecraft.util.RandomSource random) {
        return intact(level, origin(state, pos), quarters(state)) ? super.updateShape(state, level, ticks, pos, facing, facingPos, facingState, random) : ${N.Blocks}.AIR.defaultBlockState();
    }

    @Override
    protected void onPlace(${S} state, ${N.Level} level, ${N.Pos} pos, ${S} oldState, boolean moving) {
        super.onPlace(state, level, pos, oldState, moving);
        placeParts(state, level, pos, oldState, moving);
    }

    @Override
    public ${S} playerWillDestroy(${N.Level} level, ${N.Pos} pos, ${S} state, ${N.Player} player) {
        creativeBreak(level, pos, state, player);
        return super.playerWillDestroy(level, pos, state, player);
    }
`;
}

/** The shared base class of a mod's multi-blocks. */
export function multiBlockBase(env: GenEnv): JavaSourceFile {
  const N = names(env);
  const S = N.State;
  const cls = multiBlockClass(env);
  const simple = cls.slice(cls.lastIndexOf(".") + 1);
  const code = `package ${env.project.mod.package}.block;

/**
 * Generated by MCEdge: a block spanning several cells (Q226). Part 0, the origin, draws the model; the other cells hold
 * invisible parts of the same block. Cells are given in blocks from the origin for the block facing north and turn with
 * its facing. Placing needs every cell free; the origin places the parts; when any part goes, the whole block goes and
 * only the origin drops.
 */
public abstract class ${simple} extends ${N.Block} {
    private final int[][] cells;

    protected ${simple}(int[][] cells, ${N.Props} properties) {
        super(properties);
        this.cells = cells;
    }

    /** The block's part property: 0 is the origin. */
    protected abstract ${N.Int} part();

    /** Quarter turns of the block's facing from north (east 1, south 2, west 3); 0 without a facing. */
    protected abstract int quarters(${S} state);

    /** Where a part's cell is from the origin: its cell turned a quarter clockwise per step ([x, z] becomes [-z, x]). */
    private ${N.Pos} offset(int part, int quarters) {
        int x = cells[part][0], z = cells[part][2];
        for (int i = 0; i < quarters; i++) {
            int t = x;
            x = -z;
            z = t;
        }
        return new ${N.Pos}(x, cells[part][1], z);
    }

    /** The origin of the block that the part at \`pos\` belongs to. */
    public ${N.Pos} origin(${S} state, ${N.Pos} pos) {
        return pos.subtract(offset(state.getValue(part()), quarters(state)));
    }

    /** Whether cell \`part\` of the block at \`origin\` holds that part, facing the same way. */
    private boolean holds(${N.Reader} level, ${N.Pos} origin, int part, int quarters) {
        ${S} there = level.getBlockState(origin.offset(offset(part, quarters)));
        return there.getBlock() == this && there.getValue(part()) == part && quarters(there) == quarters;
    }

    /** Whether every cell of the block at \`origin\` still holds its part. */
    private boolean intact(${N.Reader} level, ${N.Pos} origin, int quarters) {
        for (int i = 0; i < cells.length; i++) if (!holds(level, origin, i, quarters)) return false;
        return true;
    }

    /** An origin about to be placed fits when every other cell is inside the world and free (or already its part). */
    private boolean fits(${S} state, ${N.Reader} level, ${N.Pos} pos) {
        if (state.getValue(part()) != 0) return true;
        int quarters = quarters(state);
        for (int i = 1; i < cells.length; i++) {
            ${N.Pos} p = pos.offset(offset(i, quarters));
            ${S} there = level.getBlockState(p);
            if (${N.outside} || !(${N.replaceable} || holds(level, pos, i, quarters))) return false;
        }
        return true;
    }

    /** A newly placed origin fills its other cells with its parts, then tells their neighbours. */
    private void placeParts(${S} state, ${N.Level} level, ${N.Pos} pos, ${S} oldState, boolean moving) {
        if (${N.client} || moving || state.getValue(part()) != 0 || oldState.is(this)) return;
        int quarters = quarters(state);
        for (int i = 1; i < cells.length; i++) {
            ${N.Pos} p = pos.offset(offset(i, quarters));
            // No shape updates yet: the half-placed block would find itself broken.
            if (${N.canPlace}) level.setBlock(p, state.setValue(part(), i), 2 | 16);
        }
        for (int i = 1; i < cells.length; i++) level.updateNeighborsAt(pos.offset(offset(i, quarters)), this);
    }

    /**
     * When a part goes the others find the block broken and go too; an origin going that way drops like a broken block
     * (vanilla doors work so). A player in creative breaking another part removes the origin first, without its drops.
     */
    private void creativeBreak(${N.Level} level, ${N.Pos} pos, ${S} state, ${N.Player} player) {
        if (${N.client} || !player.isCreative() || state.getValue(part()) == 0) return;
        ${N.Pos} origin = origin(state, pos);
        ${S} main = level.getBlockState(origin);
        if (main.getBlock() != this) return;
        // 35: neighbours and clients are told, nothing drops.
        level.setBlock(origin, ${N.Blocks}.AIR.defaultBlockState(), 35);
        level.levelEvent(player, 2001, origin, getId(main));
    }

${overrides(env)}}
`;
  return { path: `${cls.replaceAll(".", "/")}.java`, code };
}
