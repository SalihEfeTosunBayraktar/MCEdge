import { useRef, useState } from "react";
import { closedEnds, resolveTabOrder, ROW, tabMembers, type TabEntry } from "../../../../src/elements/tabOrder.ts";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { elementName } from "../model.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { Icon } from "./Icon.tsx";
import { blockOf, dropSelection, movingRows, sectionOf, snapDrop, stepSelection, visibleOf } from "../tabOrderMoves.ts";

/**
 * Order of a creative tab (KUYRUK 98): the mod elements in the tab, titled sections and spacers, in the order the tab
 * shows them. Rows are selected with a click, Ctrl+click (toggle) and Shift+click (range) (KUYRUK 164); the selection
 * moves together by dragging a grip, with Up / Down or Alt+Up / Alt+Down, and stays selected. Sections fold (KUYRUK
 * 163); a section moves with all its rows. An end marker (KUYRUK 172) closes the section above it, so the rows after it
 * stand outside sections. Any change stores the whole order, so elements not ordered yet become explicit.
 */
export function TabOrderInput({ tabId, value, set, snapshot, label }: {
  tabId: string;
  value: unknown;
  set: (value: TabEntry[]) => void;
  snapshot: ProjectSnapshot;
  label: string;
}) {
  const entries = resolveTabOrder(value, tabMembers(snapshot.project.elements, tabId));
  /** Selected rows (indexes) and the row a Shift+click range starts from. */
  const [picked, setPicked] = useState<number[]>([]);
  const [anchor, setAnchor] = useState(-1);
  /** While dragging: the selected rows that move (indexes), all rows that go with them, and the shown row it drops before. */
  const [drag, setDrag] = useState<{ moving: number[]; rows: ReadonlySet<number>; gap: number }>();
  const rows = useRef<HTMLDivElement>(null);
  /**
   * Folded sections (KUYRUK 163), by their place among the sections: editor-only view state, the stored order and the
   * generated tab do not change. A folded section hides the rows after it up to the next section.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const sectionList: TabEntry[] = entries.filter((e) => e.kind === "section");
  const folded = new Set([...collapsed].map((n) => sectionList[n]).filter(Boolean));
  const visible = visibleOf(entries, folded);
  const shown = new Set(visible);
  const selection = picked.filter((i) => i < entries.length && shown.has(i));
  const selectedSet = new Set(selection.map((i) => entries[i]));
  const current = selection.length === 1 ? selection[0] : -1;
  const hiddenCount = (i: number) => blockOf(entries, i)[1] - i - 1;

  /** Stores a new order made of the same entry objects; the selection and the folds follow their rows. */
  const store = (moved: TabEntry[], select: TabEntry[]) => {
    // An end marker moved where it closes no section is dropped, as the stored order would read it.
    const next = closedEnds(moved);
    const keep = new Set(folded);
    // A row moved into a folded section unfolds it, so the selection stays in view.
    for (const e of select) {
      const owner = e.kind === "section" ? -1 : sectionOf(next, next.indexOf(e));
      if (owner >= 0) keep.delete(next[owner]);
    }
    setCollapsed(new Set(next.filter((e) => e.kind === "section").map((e, n) => (keep.has(e) ? n : -1)).filter((n) => n >= 0)));
    set(next);
    const at = select.map((e) => next.indexOf(e)).filter((i) => i >= 0);
    setPicked(at);
    setAnchor(at[0] ?? -1);
  };
  const step = (direction: -1 | 1) => {
    const next = stepSelection(entries, folded, selectedSet, direction);
    if (next) store(next, selection.map((i) => entries[i]));
  };
  const canStep = (direction: -1 | 1) => selection.length > 0 && !!stepSelection(entries, folded, selectedSet, direction);
  /** Where a new row goes: after the last selected row (after a folded section's hidden rows). */
  const insertAt = () => {
    const last = selection.at(-1);
    return last !== undefined ? (visible.find((v) => v > last) ?? entries.length) : entries.length;
  };
  const insert = (entry: TabEntry) => {
    const at = insertAt();
    store([...entries.slice(0, at), entry, ...entries.slice(at)], [entry]);
  };
  /** An end marker closes the section the new row would be in; outside sections there is nothing to close. */
  const canEnd = sectionOf(entries, insertAt()) >= 0;
  const change = (i: number, entry: TabEntry) => set(entries.map((e, j) => (j === i ? entry : e)));
  /** Removes the selected sections and spacers (an element leaves the tab from its own Creative tabs field). */
  const removable = selection.filter((i) => entries[i].kind !== "element");
  const remove = () => {
    const next = entries.filter((_, i) => !removable.includes(i));
    const after = next[Math.min(removable[0], next.length - 1)];
    store(next, after ? [after] : []);
  };
  const toggle = (i: number) => {
    const n = sectionList.indexOf(entries[i]);
    const next = new Set(collapsed);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setCollapsed(next);
  };
  const setAll = (fold: boolean) => {
    setCollapsed(new Set(fold ? sectionList.map((_, n) => n) : []));
    // Selected rows the fold hides give the selection to their sections.
    if (fold) setPicked([...new Set(selection.map((i) => (entries[i].kind === "section" ? i : sectionOf(entries, i))).filter((i) => i >= 0))]);
  };
  /** A click selects one row, Ctrl+click adds or drops a row, Shift+click selects the shown rows from the anchor. */
  const click = (i: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setPicked(selection.includes(i) ? selection.filter((j) => j !== i) : [...selection, i].sort((a, b) => a - b));
      setAnchor(i);
    } else if (e.shiftKey && anchor >= 0 && shown.has(anchor)) {
      const [a, b] = [visible.indexOf(anchor), visible.indexOf(i)].sort((x, y) => x - y);
      setPicked(visible.slice(a, b + 1));
    } else {
      setPicked([i]);
      setAnchor(i);
    }
  };

  /** Shown row under a pointer position: the row whose middle is below it, or the end. */
  const indexAt = (y: number) => {
    const list = [...(rows.current?.querySelectorAll<HTMLElement>(".torow") ?? [])];
    const at = list.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return at < 0 ? list.length : at;
  };
  /** Dragging a grip moves the selection (or only that row when it is not selected); `gap` is the shown row it is dropped before. */
  const grab = (from: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const moving = selection.includes(from) ? selection : [from];
    if (!selection.includes(from)) {
      setPicked([from]);
      setAnchor(from);
    }
    const movingSet = new Set(moving.map((i) => entries[i]));
    const dragged = new Set(movingRows(entries, movingSet).flatMap((i) => {
      const [s, end] = blockOf(entries, i);
      return Array.from({ length: end - s }, (_, k) => s + k);
    }));
    let gap = visible.indexOf(from);
    setDrag({ moving, rows: dragged, gap });
    const moveTo = (ev: PointerEvent) => {
      gap = indexAt(ev.clientY);
      setDrag({ moving, rows: dragged, gap });
    };
    const drop = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", drop);
      setDrag(undefined);
      const next = dropSelection(entries, movingSet, visible[gap]);
      if (next) store(next, moving.map((i) => entries[i]));
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", drop);
  };
  /**
   * The drop line while dragging (KUYRUK 165): above the row the drop lands before, or under the last row, indented
   * and named when the rows land inside a section, flush when they land outside every section (or move a section).
   */
  const dropAt = (() => {
    if (!drag) return undefined;
    const moving = new Set(drag.moving.map((i) => entries[i]));
    const gapBefore = visible[drag.gap];
    if (!dropSelection(entries, moving, gapBefore)) return undefined;
    const rowsMoving = movingRows(entries, moving);
    const before = gapBefore === undefined ? undefined : snapDrop(entries, rowsMoving, gapBefore);
    const position = before ?? entries.length;
    // The section the rows land in: the last section header before the drop point that is not itself moving, unless
    // an end marker (not moving either) closes it first.
    let into: TabEntry | undefined;
    for (let j = position - 1; j >= 0 && !into; j--) {
      const e = entries[j];
      if (moving.has(e) || (e.kind !== "section" && e.kind !== "end")) continue;
      if (e.kind === "end") break;
      into = e;
    }
    const section = rowsMoving.some((i) => entries[i].kind === "section");
    return { row: before ?? ("end" as const), section, inside: into?.kind === "section" ? into.title || t("tabOrder.untitled") : undefined };
  })();
  /** Rows after a section header belong to it and are drawn indented, with a guide line (KUYRUK 165). */
  const inSection = (i: number) => entries[i].kind !== "section" && sectionOf(entries, i) >= 0;

  const describe = (entry: TabEntry) => {
    if (entry.kind === "section") return <><b>{entry.title || t("tabOrder.untitled")}</b> <span className="dim">{t("tabOrder.section")}</span></>;
    if (entry.kind === "spacer") return <span className="dim">{entry.slots ? t("tabOrder.spacerSlots", { count: entry.slots }) : t("tabOrder.spacerRow")}</span>;
    if (entry.kind === "end") {
      const owner = entries[sectionOf(entries, entries.indexOf(entry))];
      return <span className="dim">{t("tabOrder.endOf", { section: owner?.kind === "section" ? owner.title || t("tabOrder.untitled") : "" })}</span>;
    }
    const element = snapshot.project.elements[entry.type]?.find((e) => e.id === entry.id);
    return <>{element ? elementName(entry.type, element) : entry.id} <span className="dim">{typeOf(entry.type)?.name ?? entry.type}</span></>;
  };
  const sel = current >= 0 ? entries[current] : undefined;
  const items = entries.filter((e) => e.kind === "element").length;

  return (
    <div className="listctl taborder">
      <div className="minibar" role="toolbar">
        <button type="button" className="mbtn" onClick={() => insert({ kind: "section", title: t("tabOrder.newSection") })}><Icon name="plus" size={12} /><span>{t("tabOrder.addSection")}</span></button>
        <button type="button" className="mbtn" onClick={() => insert({ kind: "spacer" })}><Icon name="plus" size={12} /><span>{t("tabOrder.addSpacer")}</span></button>
        <button type="button" className="mbtn" disabled={!canEnd} title={t("tabOrder.endHint")} onClick={() => insert({ kind: "end" })}><Icon name="plus" size={12} /><span>{t("tabOrder.addEnd")}</span></button>
        <button type="button" className="mbtn danger" disabled={!removable.length} title={t("tabOrder.removeHint")}
          onClick={remove}><Icon name="trash" size={12} /><span>{t("list.remove")}</span></button>
        <button type="button" className="mbtn" disabled={!canStep(-1)} onClick={() => step(-1)}><Icon name="up" size={12} /><span>{t("list.up")}</span></button>
        <button type="button" className="mbtn" disabled={!canStep(1)} onClick={() => step(1)}><Icon name="down" size={12} /><span>{t("list.down")}</span></button>
        <button type="button" className="mbtn" disabled={!sectionList.length || collapsed.size === sectionList.length} onClick={() => setAll(true)}><Icon name="up" size={12} /><span>{t("tabOrder.collapseAll")}</span></button>
        <button type="button" className="mbtn" disabled={!collapsed.size} onClick={() => setAll(false)}><Icon name="down" size={12} /><span>{t("tabOrder.expandAll")}</span></button>
        <span className="fmeta">{selection.length > 1 ? t("tabOrder.selected", { count: selection.length }) : t("tabOrder.count", { count: items })}</span>
      </div>
      {entries.length === 0 ? <p className="listempty">{t("tabOrder.empty")}</p> : (
        <div ref={rows} className="listrows torows" role="listbox" aria-label={label}
          onKeyDown={(e) => {
            if (!selection.length) return;
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) (e.preventDefault(), step(e.key === "ArrowUp" ? -1 : 1));
            // Left folds and Right unfolds the selected section.
            if (!e.altKey && current >= 0 && entries[current].kind === "section" && (e.key === "ArrowLeft" || e.key === "ArrowRight")
              && folded.has(entries[current]) === (e.key === "ArrowRight")) (e.preventDefault(), toggle(current));
          }}>
          {visible.map((i, at) => {
            const entry = entries[i];
            const isFolded = folded.has(entry);
            const on = selection.includes(i);
            const line = dropAt && (dropAt.row === i ? "above" : dropAt.row === "end" && at === visible.length - 1 ? "below" : "");
            return (
              <div key={entry.kind === "element" ? `${entry.type}/${entry.id}` : `${entry.kind}-${i}`} role="option" tabIndex={0} aria-selected={on}
                data-entry={entry.kind === "element" ? entry.id : entry.kind === "section" ? `#${entry.title}` : entry.kind === "end" ? "/" : "_"}
                className={`lrow torow k-${entry.kind} ${inSection(i) ? "insection" : ""} ${on ? "sel" : ""} ${isFolded ? "folded" : ""} ${drag?.rows.has(i) ? "dragging" : ""}`}
                onClick={(e) => click(i, e)}>
                {line && (
                  <span className={`todrop ${line} ${dropAt!.inside && !dropAt!.section ? "inside" : "outside"}`} data-testid="drop-line">
                    {!dropAt!.section && <span className="todroplabel">{dropAt!.inside ? t("tabOrder.dropInto", { section: dropAt!.inside }) : t("tabOrder.dropOutside")}</span>}
                  </span>
                )}
                <span className="tograb" title={t("tabOrder.drag")} onPointerDown={grab(i)}><Icon name="more" size={12} /></span>
                {inSection(i) && <span className="toindent" aria-hidden="true" />}
                {entry.kind === "section"
                  ? <button type="button" className="tofold" aria-expanded={!isFolded} title={t(isFolded ? "tabOrder.expand" : "tabOrder.collapse")}
                      onClick={(e) => (e.stopPropagation(), toggle(i))}><Icon name="chev" size={10} /></button>
                  : <span className="lnum">{entry.kind === "element" ? entries.slice(0, i + 1).filter((e) => e.kind === "element").length : ""}</span>}
                <span className="ltxt">{describe(entry)}{isFolded && <span className="tohidden"> {t("tabOrder.hidden", { count: hiddenCount(i) })}</span>}</span>
              </div>
            );
          })}
        </div>
      )}
      {sel && sel.kind !== "element" && (
        <div className="listform">
          {sel.kind === "end" ? <p className="hint">{t("tabOrder.endHint")}</p> : sel.kind === "section" ? (
            <div className="frow efrow">
              <label>{t("tabOrder.title")}</label>
              <div className="fctl"><input value={sel.title} spellCheck={false} onChange={(e) => change(current, { kind: "section", title: e.target.value })} /></div>
              <span />
            </div>
          ) : (
            <div className="frow efrow">
              <label>{t("tabOrder.slots")}</label>
              <div className="fctl">
                <select value={sel.slots ?? 0} onChange={(e) => change(current, Number(e.target.value) ? { kind: "spacer", slots: Number(e.target.value) } : { kind: "spacer" })}>
                  <option value={0}>{t("tabOrder.toRowEnd")}</option>
                  {Array.from({ length: ROW - 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t("tabOrder.spacerSlots", { count: n })}</option>)}
                </select>
              </div>
              <span />
            </div>
          )}
          <p className="hint">{t("tabOrder.versionHint")}</p>
        </div>
      )}
    </div>
  );
}
