import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { issueText, t } from "../strings.ts";
import { Icon, type IconName } from "./Icon.tsx";

/* Shared Workbench building blocks: one find bar, one action toolbar, aligned forms, side panels. */

interface ActionProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger";
  title?: string;
  /** Toggle or tool choice that is currently on. */
  pressed?: boolean;
  /** Icon only; the label becomes the tooltip (with `title` after it). */
  compact?: boolean;
  /** Opens a menu: `pressed` then says whether it is open (aria-expanded), not a toggle. */
  popup?: boolean;
  /** Icon only on screen, but the label stays in the button's text (assistive technology, tests): the dock bar's Undo and Redo. */
  hideLabel?: boolean;
}

/** The one left-aligned icon+text toolbar of a screen. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="actions" role="toolbar">{children}</div>;
}

export function ActionButton({ icon, label, onClick, disabled, tone, title, pressed, compact, popup, hideLabel }: ActionProps) {
  return (
    <button className={`abtn ${tone ?? ""} ${pressed ? "pressed" : ""} ${compact || hideLabel ? "compact" : ""}`} onClick={onClick} disabled={disabled}
      title={compact || hideLabel ? (title ? `${label} (${title})` : label) : title} aria-label={compact ? label : undefined}
      aria-pressed={popup ? undefined : pressed} aria-haspopup={popup ? "menu" : undefined} aria-expanded={popup ? !!pressed : undefined}>
      <Icon name={icon} />
      {hideLabel ? <span className="sr-only">{label}</span> : !compact && <span>{label}</span>}
    </button>
  );
}

export const Separator = () => <i className="sep" aria-hidden="true" />;

/** Name of the rail section a view belongs to; its find bar shows it first (KUYRUK 122). Editors have their own header. */
export const SectionName = createContext<string | undefined>(undefined);

/** Section name, then search, filter and sort: always the first row of a section (search disabled while there is nothing to search yet). */
export function FindBar({ query, onQuery, placeholder, meta, disabled, children, actions, denseActions }: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  meta?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  /** The view's main action (New ...), at the right end of the same 40 px bar (Q279) instead of a row of its own. */
  actions?: React.ReactNode;
  /** Many actions (Localization): every one but the primary shows its icon only, whatever the window width (Q284). */
  denseActions?: boolean;
}) {
  const section = useContext(SectionName);
  return (
    <div className={`findbar ${denseActions ? "dense" : ""}`}>
      {section && <span className="fsection">{section}</span>}
      <label className="search">
        <Icon name="search" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} spellCheck={false} disabled={disabled} />
      </label>
      {children}
      {meta && <span className="fmeta">{meta}</span>}
      {actions && <div className={`actions inbar ${denseActions ? "dense" : ""}`} role="toolbar">{actions}</div>}
    </div>
  );
}

/** A native select dressed as a bevelled find-bar chip: "Filter: All types". */
export function FindSelect<V extends string>({ icon, label, value, options, onChange }: {
  icon?: IconName;
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <label className="fsel" title={`${label} ${options.find((o) => o.value === value)?.label ?? ""}`.trim()}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chev" size={10} />
    </label>
  );
}

/**
 * Titled group of aligned form rows. `titleLang` marks a title in another language than the UI (English
 * type.json titles in a Turkish UI), so the uppercase legend uses that language's casing (i -> I, not İ).
 */
/**
 * A titled group of form rows. `collapsible` turns the title into a toggle (Q242); `defaultOpen` false starts it closed,
 * for long sections the user rarely needs.
 */
export function FormGroup({ title, titleLang, collapsible, defaultOpen = true, children }: {
  title: string; titleLang?: string; collapsible?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <fieldset className="fgroup">
        <legend lang={titleLang} className="fgplain">{title}</legend>
        {children}
      </fieldset>
    );
  }
  return (
    <fieldset className={`fgroup collapsible ${open ? "open" : "closed"}`}>
      <legend lang={titleLang}>
        <button type="button" className="fgtoggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="chev" size={10} />
          <span>{title}</span>
        </button>
      </legend>
      {open && children}
    </fieldset>
  );
}

/** Fixed-width label column + control column. A screen reader gets the label as the field's name (a11y.ts, watchRowLabels). */
export function FormRow({ label, top, children }: { label: React.ReactNode; top?: boolean; children: React.ReactNode }) {
  return (
    <div className={`frow ${top ? "top" : ""}`}>
      <label>{label}</label>
      <div className="fctl">{children}</div>
    </div>
  );
}

const PANEL_WIDTH_KEY = "mcedge.panelWidth";
const PANEL_MIN = 280;
const panelMax = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.6));

/** Puts the remembered side panel width back; called once when the app starts. */
export function restorePanelWidth(): void {
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (saved >= PANEL_MIN) document.documentElement.style.setProperty("--panel-w", `${Math.min(saved, panelMax())}px`);
  } catch {
    // Storage blocked: the default width stays.
  }
}

/** Grip on the left edge of a side panel: dragging it sets the width of every side panel (--panel-w). */
export function PanelGrip() {
  const [dragging, setDragging] = useState(false);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const panel = (e.currentTarget as HTMLElement).parentElement;
    if (!panel) return;
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    setDragging(true);
    const move = (m: PointerEvent) => {
      const width = Math.round(Math.max(PANEL_MIN, Math.min(panelMax(), startW + startX - m.clientX)));
      document.documentElement.style.setProperty("--panel-w", `${width}px`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel-w"), 10)));
      } catch {
        // Storage blocked: the width lasts until the app closes.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <span className={`panelgrip ${dragging ? "on" : ""}`} title={t("panel.resize")} onPointerDown={down} />;
}

/** Aligned edit panel beside a table or grid. */
export function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="panel">
      <PanelGrip />
      <div className="ptitle">{title}</div>
      {children}
    </aside>
  );
}

export function PanelEmpty({ text }: { text: string }) {
  return <p className="panel-empty">{text}</p>;
}

export interface Column<R> {
  /** Names the column for a remembered width (with DataTable `resizeKey`); defaults to its position. */
  id?: string;
  label: React.ReactNode;
  width?: string;
  cell: (row: R) => React.ReactNode;
}

const MIN_COLUMN = 60;
type Widths = Record<string, number>;

/** Column widths by column id, kept in localStorage per table; the store can be unavailable, then they are just not kept. */
export function useColumnWidths(name?: string): [Widths, (widths: Widths, save?: boolean) => void] {
  const key = `mcedge.columns.${name}`;
  const [widths, set] = useState<Widths>(() => {
    try {
      return name ? JSON.parse(localStorage.getItem(key) ?? "{}") : {};
    } catch {
      return {};
    }
  });
  return [widths, (next, save) => {
    set(next);
    try {
      if (save && name) localStorage.setItem(key, JSON.stringify(next));
    } catch { /* not kept */ }
  }];
}

/** Drags a header edge: the column follows the mouse and the width is saved when the button comes up. */
export function startResize(e: React.MouseEvent, id: string, widths: Widths, setWidths: (w: Widths, save?: boolean) => void) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startWidth = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
  let latest = widths;
  const move = (m: MouseEvent) => {
    latest = { ...widths, [id]: Math.max(MIN_COLUMN, Math.round(startWidth + m.clientX - startX)) };
    setWidths(latest);
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    setWidths(latest, true);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

/**
 * A strip of tabs (children with role="tab" and aria-selected). Left/Right (Up/Down when `vertical`), Home and End move
 * between the tabs and, unless `manual`, select the one reached; only the selected tab is a tab stop.
 */
export function TabList({ className, label, vertical, manual, children }: {
  className?: string; label?: string; vertical?: boolean; manual?: boolean; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = () => [...(ref.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
  useLayoutEffect(() => {
    const list = tabs();
    const selected = list.find((x) => x.getAttribute("aria-selected") === "true") ?? list[0];
    for (const x of list) x.tabIndex = x === selected ? 0 : -1;
  });
  const keys = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = tabs();
    const at = list.indexOf((e.target as HTMLElement).closest<HTMLElement>("[role=tab]") as HTMLElement);
    if (at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = e.key === keys[1] ? list[(at + 1) % list.length] : e.key === keys[0] ? list[(at || list.length) - 1]
      : e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    to.focus();
    if (!manual) to.click();
  };
  return <div ref={ref} className={className} role="tablist" aria-label={label} aria-orientation={vertical ? "vertical" : undefined} onKeyDown={onKeyDown}>{children}</div>;
}

/** Read-only selectable list with a strong header; editing happens elsewhere. */
export function DataTable<R>({ columns, rows, rowKey, selected, picked, onSelect, onActivate, empty, resizeKey, sections, onRowDragStart, label }: {
  columns: Column<R>[];
  /** All rows, in the order they are shown (arrow keys step through them). */
  rows: R[];
  rowKey: (row: R) => string;
  selected?: string;
  /** More selected rows besides `selected` (a multi-selection). */
  picked?: string[];
  onSelect: (key: string, event?: React.MouseEvent) => void;
  /** The rows in groups, each under a heading row; `attrs` go on the heading and its rows (drop handlers). */
  sections?: { key: string; heading: React.ReactNode; rows: R[]; attrs?: React.HTMLAttributes<HTMLTableRowElement>; className?: string }[];
  /** Rows become draggable. */
  onRowDragStart?: (key: string, event: React.DragEvent) => void;
  onActivate?: (key: string) => void;
  empty: string;
  /** Header edges can be dragged to resize; the widths are remembered on this machine under this name. */
  resizeKey?: string;
  /** Accessible name of the table; defaults to the name of the section it is in. */
  label?: string;
}) {
  const [widths, setWidths] = useColumnWidths(resizeKey);
  const gid = useId();
  const section = useContext(SectionName);
  const rowId = (key: string) => `${gid}-${key.replace(/\s/g, "_")}`;
  const move = (step: number) => {
    const index = rows.findIndex((r) => rowKey(r) === selected);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    if (next) onSelect(rowKey(next));
  };
  // The table is one tab stop: the arrow keys move the selected row, which the screen reader follows (aria-activedescendant).
  return (
    <div className="tablewrap" tabIndex={0} role="grid" aria-label={label ?? section} aria-multiselectable={picked ? true : undefined}
      aria-activedescendant={selected && rows.some((r) => rowKey(r) === selected) ? rowId(selected) : undefined} onKeyDown={(e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1));
      else if (e.key === "PageDown" || e.key === "PageUp") (e.preventDefault(), move(e.key === "PageDown" ? 10 : -10));
      else if (e.key === "Home" || e.key === "End") (e.preventDefault(), move(e.key === "Home" ? -rows.length : rows.length));
      if (e.key === "Enter" && selected) onActivate?.(selected);
    }}>
      <table className="grid" role="presentation">
        <colgroup>{columns.map((c, i) => {
          const w = widths[c.id ?? String(i)];
          return <col key={i} style={w ? { width: w } : c.width ? { width: c.width } : undefined} />;
        })}</colgroup>
        <thead>
          <tr role="row">{columns.map((c, i) => (
            <th key={i} role="columnheader">
              {c.label}
              {resizeKey && <span className="colgrip" role="separator" aria-orientation="vertical" data-testid="colgrip"
                onMouseDown={(e) => startResize(e, c.id ?? String(i), widths, setWidths)} />}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {(sections ?? [{ key: "", heading: null, rows, attrs: undefined, className: "" }]).map((section) => (
            <Fragment key={section.key}>
              {section.heading && <tr role="row" className={`grouprow ${section.className ?? ""}`} {...section.attrs}><td role="gridcell" colSpan={columns.length}>{section.heading}</td></tr>}
              {section.rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key} data-key={key} id={rowId(key)} role="row" aria-selected={key === selected || picked?.includes(key) || false} className={`${key === selected || picked?.includes(key) ? "sel" : ""} ${section.className ?? ""}`} onClick={(e) => onSelect(key, e)}
                    onDoubleClick={() => onActivate?.(key)} draggable={!!onRowDragStart || undefined} onDragStart={onRowDragStart && ((e) => onRowDragStart(key, e))} {...section.attrs}>
                    {columns.map((c, i) => <td key={i} role="gridcell">{c.cell(row)}</td>)}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !sections?.length && <p className="table-empty">{empty}</p>}
    </div>
  );
}

export interface MenuItem {
  /** Stable name of the item (its label's string key), for hiding it in Simple mode. */
  id?: string;
  label: string;
  /** Missing while the command is unavailable (no project, build running). */
  onClick?: () => void;
  /** Not implemented yet; shown as "coming soon". */
  disabled?: boolean;
  /** Shows a check mark (active choice in a list). */
  checked?: boolean;
  separator?: boolean;
  /** Keyboard shortcut shown at the right, e.g. "Ctrl+B". */
  shortcut?: string;
  /** A colour box before the label ("" is an empty box: no colour). */
  swatch?: string;
  /** An icon before the label, drawn in `iconColor` when given. */
  icon?: IconName;
  iconColor?: string;
  /** Destructive command (delete). */
  danger?: boolean;
  /** Stays open after the click (it opens another page of the same menu). */
  keepOpen?: boolean;
}

/** What had the focus before the last menu opened: a dialog opened from a menu item gives the focus back there when it closes. */
let menuReturn: HTMLElement | null = null;

/**
 * Drop-down list for the menu bar and split buttons. It takes the focus when it opens; Up/Down, Home/End and the first
 * letter of an item move through the items (one tab stop: roving focus), Enter or Space runs one, Escape or Tab close it
 * and the focus goes back to the control that opened it. Left/Right go to `onSide` (the menu bar's neighbouring menu).
 * Closes on an outside click too.
 */
export function MenuList({ items, onClose, className = "", style, label, opener, onSide }: {
  items: MenuItem[];
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible name; without it the menu is named after its opener. */
  label?: string;
  /** What gets the focus back; without it, what had the focus when the menu opened. */
  opener?: HTMLElement | null;
  /** Left or Right was pressed: the menu bar moves to the next menu. */
  onSide?: (step: -1 | 1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [from] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
  const back = opener ?? from;
  const enabled = items.flatMap((item, i) => (!item.separator && !item.disabled && item.onClick ? [i] : []));
  const [focused, setFocused] = useState(-1);
  const stop = focused >= 0 && enabled.includes(focused) ? focused : enabled[0];
  const focusItem = (index: number | undefined) => {
    if (index === undefined) return;
    const target = ref.current?.querySelector<HTMLElement>(`[data-i="${index}"]`);
    target?.focus();
  };
  useEffect(() => {
    menuReturn = back;
    const down = (e: MouseEvent) => ref.current?.parentElement?.contains(e.target as Node) || onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  // The menu takes the focus when it opens (and again if the page of items changed under the focus).
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) focusItem(stop);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // Named after its opener; the focus goes back to it when the menu closes (not when the user clicked elsewhere).
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    if (!label && !menu.hasAttribute("aria-label") && back) {
      const named = back.getAttribute("aria-label") || back.textContent?.trim();
      if (named) menu.setAttribute("aria-label", named);
    }
    return () => {
      const active = document.activeElement;
      if (back?.isConnected && (!active || active === document.body || menu.contains(active))) back.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.indexOf(Number((document.activeElement as HTMLElement | null)?.dataset.i));
    const go = (to: number | undefined) => (e.preventDefault(), e.stopPropagation(), focusItem(to));
    if (e.key === "ArrowDown") go(enabled[(at + 1) % enabled.length]);
    else if (e.key === "ArrowUp") go(enabled[(at <= 0 ? enabled.length : at) - 1]);
    else if (e.key === "Home") go(enabled[0]);
    else if (e.key === "End") go(enabled[enabled.length - 1]);
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && onSide) (e.preventDefault(), e.stopPropagation(), onSide(e.key === "ArrowLeft" ? -1 : 1));
    else if (e.key === "Tab") (e.preventDefault(), onClose());
    else if (e.key === "Escape") (e.stopPropagation(), onClose());
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== " ") {
      // Type-ahead: the next item whose label starts with the letter.
      const order = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
      go(order.find((i) => items[i].label.trim().toLowerCase().startsWith(e.key.toLowerCase())));
    }
  };
  return (
    <div ref={ref} className={`menulist ${className}`} role="menu" aria-label={label} style={style} onKeyDown={move}>
      {items.map((item, i) =>
        item.separator ? <i key={i} className="msep" role="separator" /> : (
          <button key={i} data-i={i} role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={item.checked !== undefined ? item.checked : undefined} aria-keyshortcuts={item.shortcut}
            tabIndex={i === stop ? 0 : -1} className={item.danger ? "danger" : undefined} disabled={item.disabled || !item.onClick}
            onFocus={() => setFocused(i)} onClick={() => (!item.keepOpen && onClose(), item.onClick?.())}>
            {item.checked !== undefined && <span className="mcheck" aria-hidden="true">{item.checked && <Icon name="check" size={12} />}</span>}
            {item.swatch !== undefined && <span className="mswatch" aria-hidden="true" style={item.swatch ? { background: item.swatch } : undefined} />}
            {item.icon && <span className="micon" aria-hidden="true" style={item.iconColor ? { color: item.iconColor } : undefined}><Icon name={item.icon} size={16} /></span>}
            {item.label}
            {item.shortcut && <span className="kbd" aria-hidden="true">{item.shortcut}</span>}
            {item.disabled && <span className="soon">{t("menu.soon")}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Right-click menu at the pointer. `items` can be swapped while it is open (a submenu page); it stays inside the window
 * and closes on outside click, Escape or after a command.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  // Rows are 26px: keep the whole menu in view near the right and bottom edges.
  const left = Math.max(4, Math.min(x, window.innerWidth - 240));
  const top = Math.max(4, Math.min(y, window.innerHeight - (items.length * 26 + 12)));
  return (
    <div className="ctxwrap" onContextMenu={(e) => e.preventDefault()}>
      <MenuList className="ctx" label={t("menu.context")} style={{ left, top }} items={items} onClose={onClose} />
    </div>
  );
}

/**
 * Puts the focus in a dialog when it opens, unless a control inside already took it (autoFocus), so Escape and the
 * keyboard work at once (KUYRUK 125): the first text field or list, else Cancel/Close (never a destructive OK).
 * It also makes the dialog a dialog for a screen reader (role, name from its title, modal), keeps Tab inside a modal one,
 * and gives the focus back to what had it when the dialog closes (Q248).
 */
export function useDialogFocus(ref: React.RefObject<HTMLElement | null>): void {
  // What had the focus before the dialog was drawn (read while rendering, before an autoFocus control takes it).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
  const titleId = useId();
  useEffect(() => {
    const box = ref.current;
    if (!box || box.contains(document.activeElement)) return;
    const first = box.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]):not([type=checkbox]), select:not([disabled]), textarea:not([disabled])")
      ?? box.querySelector<HTMLElement>(".dlg-buttons button:not([type=submit]):not([disabled])")
      ?? box.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
    if (first) first.focus();
    else (box.tabIndex = -1, box.focus());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const modal = !!box.closest(".backdrop");
    if (!box.hasAttribute("role")) box.setAttribute("role", "dialog");
    if (modal) box.setAttribute("aria-modal", "true");
    const title = box.querySelector<HTMLElement>(".ptitle");
    if (title && !box.hasAttribute("aria-label") && !box.hasAttribute("aria-labelledby")) {
      title.id ||= titleId;
      box.setAttribute("aria-labelledby", title.id);
    }
    const tabbable = () => [...box.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modal) return;
      const list = tabbable();
      const active = document.activeElement;
      if (!list.length) return void (e.preventDefault(), box.focus());
      if (e.shiftKey ? active === list[0] || active === box : active === list[list.length - 1]) (e.preventDefault(), list[e.shiftKey ? list.length - 1 : 0].focus());
      else if (!box.contains(active)) (e.preventDefault(), list[0].focus());
    };
    box.addEventListener("keydown", trap);
    return () => {
      box.removeEventListener("keydown", trap);
      // A dialog opened from a menu item gives the focus back to the menu's opener (the item itself is gone).
      const fromMenu = !!opener?.getAttribute("role")?.startsWith("menuitem");
      const back = opener?.isConnected ? opener : fromMenu ? menuReturn : null;
      const active = document.activeElement;
      if (back?.isConnected && (!active || active === document.body || box.contains(active))) back.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A focused control the dialog disables while it works (Export's button and fields) drops the focus to the page
  // body, and Escape no longer reaches the dialog (KUYRUK 174). When controls are disabled or enabled again and the
  // focus has left, the dialog takes it back.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const observer = new MutationObserver(() => {
      if (box.contains(document.activeElement) || (document.activeElement && document.activeElement !== document.body)) return;
      if (box.tabIndex < 0 || !box.hasAttribute("tabindex")) box.tabIndex = -1;
      box.focus();
    });
    observer.observe(box, { attributes: true, attributeFilter: ["disabled"], subtree: true });
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Modal dialog in the inventory-panel style with an aligned form and OK/Cancel. */
export function Dialog({ title, okLabel, cancelLabel, canOk, onOk, onCancel, children, explicit, danger }: {
  title: string;
  okLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  canOk: boolean;
  onOk: () => void;
  onCancel: () => void;
  children: React.ReactNode;
  /** Both buttons do something that matters: only they close it (no outside click or Escape). */
  explicit?: boolean;
  /** The OK button destroys something (remove, delete): drawn in the danger style. */
  danger?: boolean;
}) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  return (
    <div className="backdrop" onMouseDown={explicit ? undefined : onCancel}>
      <form ref={box} className="dialog" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => !explicit && e.key === "Escape" && onCancel()}
        onSubmit={(e) => (e.preventDefault(), canOk && onOk())}>
        <div className="ptitle">{title}</div>
        {children}
        <div className="dlg-buttons">
          <button type="submit" className={`abtn ${danger ? "danger" : "primary"}`} disabled={!canOk}><Icon name="check" /><span>{okLabel}</span></button>
          <button type="button" className="abtn" onClick={onCancel}><span>{cancelLabel ?? t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}

/** A confirmation box (not a form): its own buttons go in `children`; Escape calls `onEscape`. Focus, role, trap and focus return come with it. */
export function AlertDialog({ title, onEscape, children }: { title: string; onEscape: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  return (
    <div className="backdrop">
      <div ref={box} className="dialog" role="alertdialog" onKeyDown={(e) => e.key === "Escape" && onEscape()}>
        <div className="ptitle">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** A keyboard shortcut: the keys as printed on the keyboard and what they do. */
export type Shortcut = [keys: string, does: string];

/**
 * Keyboard button of an editor's toolbar: opens the list of its shortcuts. "?" (Shift+/) opens it too while the
 * focus is not in a text field.
 */
export function ShortcutsButton({ shortcuts }: { shortcuts: Shortcut[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== "?" || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  return (
    <>
      <ActionButton icon="keys" compact label={t("shortcuts.title")} title="?" pressed={open} onClick={() => setOpen(!open)} />
      {open && <ShortcutsDialog shortcuts={shortcuts} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A list of keyboard shortcuts in a dialog (an editor's keyboard button, Help > Keyboard shortcuts). */
export function ShortcutsDialog({ shortcuts, title, onClose }: { shortcuts: Shortcut[]; title?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog shortcuts" role="dialog" aria-label={title ?? t("shortcuts.title")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{title ?? t("shortcuts.title")}</div>
        <table className="keytable">
          <tbody>
            {shortcuts.map(([keys, does]) => (
              <tr key={keys + does}>
                <td>{keys.split(" / ").map((k, i) => <span key={k}>{i > 0 && " / "}<kbd>{k}</kbd></span>)}</td>
                <td>{does}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dlg-buttons">
          <button type="button" className="abtn primary" autoFocus onClick={onClose}><span>{t("dialog.close")}</span></button>
        </div>
      </div>
    </div>
  );
}

/** Lists validation messages for the current screen. */
export function Problems({ issues }: { issues: { path: string; message: string; code?: string; values?: Record<string, string | number | undefined> }[] }) {
  if (issues.length === 0) return null;
  return (
    <FormGroup title={t("group.problems")}>
      <ul className="issues">
        {issues.map((issue) => (
          <li key={issue.path + issue.message}><Icon name="warn" size={12} /><code>{issue.path}</code> {issueText(issue)}</li>
        ))}
      </ul>
    </FormGroup>
  );
}
