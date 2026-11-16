/**
 * Seatable blocks (Q225): the Seat page of a block element. A seat is a point a player sits on, in block pixels from the
 * block's north-west bottom corner (16 = one block), for the block facing north (its model unturned), plus a yaw in
 * degrees relative to the block's front: 0 looks out of the north face, 90 turns clockwise (east). A block with a facing
 * property turns its seats with it, as its model and boxes turn.
 *
 * A seat either sits a player (looking along the yaw) or lays one down on their back, head along the yaw, the body's
 * middle on the point (a sofa's long side); lying has nothing of a bed: no sleeping, no night skipping.
 *
 * Points may lie outside 0..16: a block spanning several cells (Q226) puts seats in its other cells the same way, so one
 * list covers every cell.
 *
 * Pure values shared by the generator (src/generator/seats.ts writes them into data/<modid>/seats.json, which one Java
 * runtime reads) and the editor's live preview, so both put every seat at the same place and height.
 */

export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: SeatPose;
}

/** How a seat holds its player: sitting, or lying on the back. */
export const SEAT_POSES = ["sit", "lie"] as const;
export type SeatPose = (typeof SEAT_POSES)[number];

export const SEAT_HEIGHT_MODES = ["auto", "manual"] as const;
/** Where a player stands up: on top of the block, in front of the seat (on its floor), or back where they stood. */
export const SEAT_DISMOUNTS = ["top", "front", "back"] as const;

/**
 * How far a sitting player's feet (their position) are below the seat surface, in blocks: the game puts a rider 0.6
 * below its vehicle's attachment point (the player's vehicle attachment), which leaves the thighs on the surface.
 */
export const SIT_DROP = 0.6;
/** A lying player's back is this far above the surface (blocks), as on a bed. */
export const LIE_LIFT = 0.125;
/** A lying player's feet are this far from the middle of the lying spot (blocks), against the yaw. */
export const LIE_HALF = 0.85;
/** A lying player's body reaches this far either way from the middle of the lying spot along the yaw (blocks), for room. */
export const LIE_REACH = 0.75;
/** Half the room a rider takes across (blocks): near a lying rider, a spot closer than twice this to a taken one is taken too. */
export const SEAT_ROOM = 0.3;

interface Box { mx: number; my: number; mz: number; Mx: number; My: number; Mz: number; subtract?: boolean }

const FULL: Box = { mx: 0, my: 0, mz: 0, Mx: 16, My: 16, Mz: 16 };
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The boxes a seat stands on: the block's own outline boxes for a plain block, the vanilla shape for slabs and stairs. */
export function seatBoxes(block: Record<string, unknown>): Box[] {
  const base = typeof block.blockBase === "string" ? block.blockBase : "";
  // A bottom slab, and the seat half of a stair.
  if (base === "Slab" || base === "Stairs") return [{ ...FULL, My: 8 }];
  if (base !== "") return [FULL];
  const boxes = (Array.isArray(block.boundingBoxes) ? block.boundingBoxes : []) as Partial<Box>[];
  const added = boxes.filter((b) => b && !b.subtract).map((b) => ({
    mx: num(b.mx, 0), my: num(b.my, 0), mz: num(b.mz, 0), Mx: num(b.Mx, 16), My: num(b.My, 16), Mz: num(b.Mz, 16),
  }));
  return added.length ? added : [FULL];
}

/** Top of the block under a point (pixels): the highest box covering x/z, else the top of the whole shape. */
export function surfaceAt(block: Record<string, unknown>, x: number, z: number): number {
  const boxes = seatBoxes(block);
  const covering = boxes.filter((b) => x >= Math.min(b.mx, b.Mx) && x <= Math.max(b.mx, b.Mx) && z >= Math.min(b.mz, b.Mz) && z <= Math.max(b.mz, b.Mz));
  return Math.max(...(covering.length ? covering : boxes).map((b) => Math.max(b.my, b.My)));
}

/** Footprint of the block's boxes on the ground (pixels). */
export function footprint(block: Record<string, unknown>) {
  const boxes = seatBoxes(block);
  return {
    minX: Math.min(...boxes.map((b) => Math.min(b.mx, b.Mx))), maxX: Math.max(...boxes.map((b) => Math.max(b.mx, b.Mx))),
    minZ: Math.min(...boxes.map((b) => Math.min(b.mz, b.Mz))), maxZ: Math.max(...boxes.map((b) => Math.max(b.mz, b.Mz))),
  };
}

export const autoHeight = (block: Record<string, unknown>) => block.seatHeightMode !== "manual";

/** The stored seats of a block, as numbers. */
export function storedSeats(block: Record<string, unknown>): Seat[] {
  const rows = (Array.isArray(block.seats) ? block.seats : []) as Partial<Seat>[];
  return rows.filter((s) => s && typeof s === "object").map((s) => ({ x: num(s.x, 8), y: num(s.y, 16), z: num(s.z, 8), yaw: num(s.yaw, 0), pose: s.pose === "lie" ? "lie" : "sit" }));
}

/**
 * The seats a block seats players on: its stored seats (one in the middle without any), each at the block's surface under
 * it when the height is automatic, or at its own height when it is manual.
 */
export function resolvedSeats(block: Record<string, unknown>): Seat[] {
  const seats = storedSeats(block);
  const list = seats.length ? seats : spreadSeats(block, 1);
  return autoHeight(block) ? list.map((s) => ({ ...s, y: surfaceAt(block, s.x, s.z) })) : list;
}

/** `count` seats spread evenly along the long axis of the block's footprint, in its middle across, facing the front. */
export function spreadSeats(block: Record<string, unknown>, count: number): Seat[] {
  const { minX, maxX, minZ, maxZ } = footprint(block);
  const alongX = maxX - minX >= maxZ - minZ;
  const [from, to] = alongX ? [minX, maxX] : [minZ, maxZ];
  const across = alongX ? (minZ + maxZ) / 2 : (minX + maxX) / 2;
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n }, (_, i) => {
    const along = round(from + ((to - from) * (i + 0.5)) / n);
    const x = alongX ? along : across, z = alongX ? across : along;
    return { x, y: surfaceAt(block, x, z), z, yaw: 0, pose: "sit" as const };
  });
}

/** Rounds to 1/100 pixel, so stored values stay short. */
export const round = (value: number) => Math.round(value * 100) / 100;

/**
 * One block's entry of seats.json: seats in blocks [x, y, z, yaw, lying (1) or sitting (0)], the empty hand rule, the
 * dismount rule and, for a block spanning several cells, its cells (a click on any part seats on the whole block).
 */
export function seatEntry(block: Record<string, unknown>, cells?: number[][]) {
  const dismount = SEAT_DISMOUNTS.includes(block.seatDismount as never) ? String(block.seatDismount) : "top";
  return {
    seats: resolvedSeats(block).map((s) => [...[s.x / 16, s.y / 16, s.z / 16, s.yaw].map((v) => Math.round(v * 10000) / 10000), s.pose === "lie" ? 1 : 0]),
    emptyHand: block.seatEmptyHand !== false,
    dismount,
    ...(cells && cells.length > 1 ? { cells } : {}),
  };
}
