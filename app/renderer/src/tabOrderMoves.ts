import type { TabEntry } from "../../../src/elements/tabOrder.ts";

/**
 * Moves in the creative tab order editor (KUYRUK 163, 164): pure functions over the order and the folded sections
 * (entry objects, so they survive a reorder). A section moves with all its rows, up to the next section or through
 * its end marker (KUYRUK 172); any other row, an end marker too, moves alone. Rows of a folded section are hidden and
 * travel with it.
 */

/** Where the section at `i` stops: after its end marker, at the next section, or at the end of the order. */
export function sectionEnd(list: TabEntry[], i: number): number {
  const n = list.findIndex((e, j) => j > i && (e.kind === "section" || e.kind === "end"));
  return n < 0 ? list.length : list[n].kind === "end" ? n + 1 : n;
}

/** The section row `i` belongs to (its header index; its end marker belongs to it too), or -1 outside sections. */
export function sectionOf(list: TabEntry[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (list[j].kind === "section") return j;
    if (list[j].kind === "end") return -1;
  }
  return -1;
}

/** What moves with row `i`: [start, end). */
export const blockOf = (list: TabEntry[], i: number): [number, number] => [i, list[i]?.kind === "section" ? sectionEnd(list, i) : i + 1];

/** Indexes of the rows shown: those not inside a folded section. */
export function visibleOf(list: TabEntry[], folded: ReadonlySet<TabEntry>): number[] {
  const out: number[] = [];
  let hidden = false;
  list.forEach((e, i) => {
    if (e.kind === "section") hidden = folded.has(e);
    if (e.kind === "section" || !hidden) out.push(i);
    if (e.kind === "end") hidden = false;
  });
  return out;
}

/** The order with the block [start, end) moved to start at `to` (an index of the order without the block). */
function placeBlock(list: TabEntry[], start: number, end: number, to: number): TabEntry[] {
  const next = [...list];
  const block = next.splice(start, end - start);
  next.splice(to, 0, ...block);
  return next;
}

/**
 * One step up or down for the row at `i`: a section passes the whole section before or after it (or one row before
 * the first section); any other row passes one shown row, so it can step out of or into a section. Undefined when it
 * cannot move.
 */
export function stepOne(list: TabEntry[], folded: ReadonlySet<TabEntry>, i: number, direction: -1 | 1): TabEntry[] | undefined {
  const [start, end] = blockOf(list, i);
  if (list[i].kind === "section") {
    if (direction < 0) {
      if (start === 0) return undefined;
      const owner = list[start - 1].kind === "section" ? start - 1 : sectionOf(list, start - 1);
      return placeBlock(list, start, end, owner >= 0 ? owner : start - 1);
    }
    // Down: past the next section (with its rows) or past one row outside sections.
    if (end >= list.length) return undefined;
    const after = list[end].kind === "section" ? sectionEnd(list, end) : end + 1;
    return placeBlock(list, start, end, after - (end - start));
  }
  const visible = visibleOf(list, folded);
  const at = visible.indexOf(i);
  if (direction < 0) return at > 0 ? placeBlock(list, start, end, visible[at - 1]) : undefined;
  return at >= 0 && at < visible.length - 1 ? placeBlock(list, start, end, visible[at + 1]) : undefined;
}

/** The selected rows that move on their own: rows inside a selected section move with it. Sorted by index. */
export function movingRows(list: TabEntry[], selected: ReadonlySet<TabEntry>): number[] {
  const rows = list.map((e, i) => (selected.has(e) ? i : -1)).filter((i) => i >= 0);
  return rows.filter((i) => list[i].kind === "section" || !selected.has(list[sectionOf(list, i)]));
}

/**
 * Up / Down for a selection: each moving row steps once (from the top for Up, from the bottom for Down) unless the
 * step would pass another selected row, so the selection keeps its relative order. Undefined when nothing moved.
 */
export function stepSelection(list: TabEntry[], folded: ReadonlySet<TabEntry>, selected: ReadonlySet<TabEntry>, direction: -1 | 1): TabEntry[] | undefined {
  const order = movingRows(list, selected).map((i) => list[i]);
  if (direction > 0) order.reverse();
  let next = list;
  let moved = false;
  const rank = (l: TabEntry[]) => l.filter((e) => selected.has(e));
  for (const entry of order) {
    const stepped = stepOne(next, folded, next.indexOf(entry), direction);
    if (!stepped || JSON.stringify(rank(stepped).map((e) => list.indexOf(e))) !== JSON.stringify(rank(next).map((e) => list.indexOf(e)))) continue;
    next = stepped;
    moved = true;
  }
  return moved ? next : undefined;
}

/**
 * Drops the moving rows of the selection (with their blocks, in their order) before entry `before` (the end when
 * undefined). When a section moves, the drop point snaps to the start of the section it falls in. Undefined when the
 * drop point is inside what moves, or nothing would change.
 */
export function dropSelection(list: TabEntry[], selected: ReadonlySet<TabEntry>, before: number | undefined): TabEntry[] | undefined {
  const rows = movingRows(list, selected);
  if (!rows.length) return undefined;
  const blocks = rows.map((i) => blockOf(list, i));
  const inside = (i: number) => blocks.some(([s, e]) => i >= s && i < e);
  const target = before === undefined ? undefined : snapDrop(list, rows, before);
  if (target !== undefined && inside(target)) return undefined;
  const moving = blocks.flatMap(([s, e]) => list.slice(s, e));
  const rest = list.filter((_, i) => !inside(i));
  const at = target === undefined ? rest.length : rest.indexOf(list[target]);
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return next.every((e, i) => e === list[i]) ? undefined : next;
}

/** Where a drop before `before` really lands: a moving section never lands between the rows of another one. */
export function snapDrop(list: TabEntry[], rows: number[], before: number): number {
  if (!rows.some((i) => list[i].kind === "section") || list[before].kind === "section") return before;
  const owner = sectionOf(list, before);
  return owner >= 0 && !rows.includes(owner) ? owner : before;
}
