/**
 * Order of a creative tab (KUYRUK 98): the creative_tab element's `order` lists the mod elements in the tab in
 * order, with titled sections and spacers between them. Pure functions shared by the editor, the MCP tools and the
 * generator. Members come from the elements' own `creativeTabs`; the order only arranges them, so an element that
 * left the tab drops out and a new one is appended at the end.
 *
 * A section holds the rows after it up to the next section, or up to an end marker (KUYRUK 172): the rows after an end
 * marker stand outside every section until the next one starts. An end marker with no open section means nothing and
 * is dropped.
 *
 * In the game every version shows the elements in this order. A section and an end marker start a new row and a
 * spacer leaves empty slots (a number of them, or the rest of the row) on 1.16.5 only: from 1.20 a tab's display list
 * cannot hold empty slots, so there sections, end markers and spacers only group the order.
 */

export type TabEntry =
  | { kind: "element"; type: string; id: string }
  | { kind: "section"; title: string }
  /** `slots` empty slots (1 to 8); none or 0: up to the end of the row. */
  | { kind: "spacer"; slots?: number }
  /** End of the open section: the rows after it are outside sections. */
  | { kind: "end" };

export interface TabMember {
  type: string;
  id: string;
}

export const ROW = 9;

const key = (m: TabMember) => `${m.type}/${m.id}`;

/** Elements whose `creativeTabs` name the tab, in project order (types as given, elements as listed). */
export function tabMembers(elements: Record<string, { id: string; creativeTabs?: unknown }[]>, tabId: string): TabMember[] {
  const members: TabMember[] = [];
  for (const [type, list] of Object.entries(elements)) {
    for (const element of list) {
      if (Array.isArray(element.creativeTabs) && element.creativeTabs.includes(tabId)) members.push({ type, id: element.id });
    }
  }
  return members;
}

/** The entries of a stored `order` value that have a known shape. */
export function parseTabOrder(value: unknown): TabEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e): TabEntry[] => {
    if (!e || typeof e !== "object") return [];
    const entry = e as Record<string, unknown>;
    if (entry.kind === "element" && typeof entry.type === "string" && typeof entry.id === "string") return [{ kind: "element", type: entry.type, id: entry.id }];
    if (entry.kind === "section") return [{ kind: "section", title: typeof entry.title === "string" ? entry.title : "" }];
    if (entry.kind === "end") return [{ kind: "end" }];
    if (entry.kind === "spacer") {
      const slots = Math.round(Number(entry.slots));
      return [Number.isFinite(slots) && slots > 0 ? { kind: "spacer", slots: Math.min(ROW - 1, slots) } : { kind: "spacer" }];
    }
    return [];
  });
}

/**
 * The tab's effective order: the stored entries whose elements are still members (each once), then the members the
 * order does not name yet, in `members` order.
 */
export function resolveTabOrder(value: unknown, members: TabMember[]): TabEntry[] {
  const left = new Map(members.map((m) => [key(m), m]));
  const entries: TabEntry[] = [];
  for (const entry of parseTabOrder(value)) {
    if (entry.kind !== "element") entries.push(entry);
    else if (left.delete(key(entry))) entries.push(entry);
  }
  for (const m of left.values()) entries.push({ kind: "element", type: m.type, id: m.id });
  return closedEnds(entries);
}

/** The order without end markers that close no section (before the first section, or a second end in a row). */
export function closedEnds(entries: TabEntry[]): TabEntry[] {
  let open = false;
  return entries.filter((e) => {
    if (e.kind === "section") open = true;
    if (e.kind !== "end") return true;
    const closes = open;
    open = false;
    return closes;
  });
}

/**
 * Slots of a 1.16.5 tab: each element's item stacks, `null` for an empty slot. A section starts a new row, a spacer
 * leaves its slots (or the rest of the row) empty; empty slots at the end are dropped. `stacks` gives an element's
 * stacks (an armor element has several, an element without an item none).
 */
export function tabSlots<T>(entries: TabEntry[], stacks: (member: TabMember) => T[]): (T | null)[] {
  const slots: (T | null)[] = [];
  const toRowEnd = () => {
    while (slots.length % ROW !== 0) slots.push(null);
  };
  for (const entry of entries) {
    if (entry.kind === "element") slots.push(...stacks(entry));
    else if (entry.kind === "section" || entry.kind === "end") toRowEnd();
    else if (entry.slots) for (let i = 0; i < entry.slots; i++) slots.push(null);
    else if (slots.length % ROW !== 0) toRowEnd();
    else for (let i = 0; i < ROW; i++) slots.push(null); // at a row start: a blank row
  }
  while (slots.length && slots[slots.length - 1] === null) slots.pop();
  return slots;
}
