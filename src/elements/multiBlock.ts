/**
 * Multi-blocks (Q226): a plain block element whose bounding boxes reach past its own cell spans every cell they cover.
 * The placed block (the origin, part 0) draws the model; the other cells hold invisible parts of the same block that
 * carry their slice of the boxes. Cells are whole blocks from the origin, [x, y, z], for the block facing north; a block
 * with a facing property turns them with its model (a quarter clockwise turns [x, z] into [-z, x]).
 *
 * Pure values shared by the generator (src/generator/multiBlock.ts) and the editor's preview, which draws the cells.
 */

export type Cell = [number, number, number];

/** More cells than this is not a piece of furniture; the rest are left out. */
export const MAX_CELLS = 64;

interface Box { mx: number; my: number; mz: number; Mx: number; My: number; Mz: number; subtract?: boolean }

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Whether the element asks to span several cells (only plain blocks can). */
export const isMultiBlock = (block: Record<string, unknown>) => block.multiBlock === true && (block.blockBase ?? "") === "";

/** The block's added (not subtracted) boxes, in pixels. */
function addedBoxes(block: Record<string, unknown>): Box[] {
  const boxes = (Array.isArray(block.boundingBoxes) ? block.boundingBoxes : []) as Partial<Box>[];
  return boxes.filter((b) => b && !b.subtract).map((b) => ({
    mx: Math.min(num(b.mx, 0), num(b.Mx, 16)), my: Math.min(num(b.my, 0), num(b.My, 16)), mz: Math.min(num(b.mz, 0), num(b.Mz, 16)),
    Mx: Math.max(num(b.mx, 0), num(b.Mx, 16)), My: Math.max(num(b.my, 0), num(b.My, 16)), Mz: Math.max(num(b.mz, 0), num(b.Mz, 16)),
  }));
}

/** Cell indices a range of pixels covers with some thickness: [0, 16] is cell 0, [-16, 2] cells -1 and 0. */
function cellRange(from: number, to: number): number[] {
  const first = Math.floor(from / 16), last = Math.ceil(to / 16) - 1;
  return to > from ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [];
}

/**
 * The cells of a multi-block: the origin first, then every other cell its boxes cover (bottom to top, north to south,
 * west to east). A block that does not span several cells has just the origin.
 */
export function blockCells(block: Record<string, unknown>): Cell[] {
  const cells = new Map<string, Cell>([["0,0,0", [0, 0, 0]]]);
  if (!isMultiBlock(block)) return [...cells.values()];
  for (const b of addedBoxes(block)) {
    for (const y of cellRange(b.my, b.My)) for (const z of cellRange(b.mz, b.Mz)) for (const x of cellRange(b.mx, b.Mx)) cells.set(`${x},${y},${z}`, [x, y, z]);
  }
  const [origin, ...rest] = [...cells.values()];
  rest.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  return [origin, ...rest].slice(0, MAX_CELLS);
}

/** Whether the block can turn the way a multi-block can: not at all, or to the four horizontal directions. */
export const turnsFlat = (block: Record<string, unknown>) => [0, 1, 3].includes(Number(block.rotationMode ?? 0)) && block.enablePitch !== true;

/** The cells of a block that really spans several (asks for it, can turn that way and reaches past its cell), else undefined. */
export function spannedCells(block: Record<string, unknown>): Cell[] | undefined {
  const cells = blockCells(block);
  return isMultiBlock(block) && turnsFlat(block) && cells.length > 1 ? cells : undefined;
}

/** A block's boxes cut to one of its cells and moved into that cell's own 0..16 space. */
export function cellBoxes<B extends Box>(boxes: B[], [cx, cy, cz]: Cell): B[] {
  const out: B[] = [];
  for (const b of boxes) {
    const clipped = {
      ...b,
      mx: Math.max(b.mx, cx * 16) - cx * 16, Mx: Math.min(b.Mx, cx * 16 + 16) - cx * 16,
      my: Math.max(b.my, cy * 16) - cy * 16, My: Math.min(b.My, cy * 16 + 16) - cy * 16,
      mz: Math.max(b.mz, cz * 16) - cz * 16, Mz: Math.min(b.Mz, cz * 16 + 16) - cz * 16,
    };
    if (clipped.Mx > clipped.mx && clipped.My > clipped.my && clipped.Mz > clipped.mz) out.push(clipped);
  }
  return out;
}
