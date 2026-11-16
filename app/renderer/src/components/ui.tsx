import { createContext, Fragment, useContext, useEffect, useRef, useState } from "react";
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
}

/** The one left-aligned icon+text toolbar of a screen. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="actions" role="toolbar">{children}</div>;
}

export function ActionButton({ icon, label, onClick, disabled, tone, title, pressed, compact }: ActionProps) {
  return (
    <button className={`abtn ${tone ?? ""} ${pressed ? "pressed" : ""} ${compact ? "compact" : ""}`} onClick={onClick} disabled={disabled}
      title={compact ? (title ? `${label} (${title})` : label) : title} aria-label={compact ? label : undefined} aria-pressed={pressed}>
      <Icon name={icon} />
      {!compact && <span>{label}</span>}
    </button>
  );
}

export const Separator = () => <i className="sep" aria-hidden="true" />;

/** Name of the rail section a view belongs to; its find bar shows it first (KUYRUK 122). Editors have their own header. */
export const SectionName = createContext<string | undefined>(undefined);

/** Section name, then search, filter and sort: always the first row of a section (search disabled while there is nothing to search yet). */
export function FindBar({ query, onQuery, placeholder, meta, disabled, children }: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  meta?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const section = useContext(SectionName);
  return (
    <div className="findbar">
      {section && <span className="fsection">{section}</span>}
      <label className="search">
        <Icon name="search" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} spellCheck={false} disabled={disabled} />
      </label>
      {children}
      {meta && <span className="fmeta">{meta}</span>}
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
export function FormGroup({ title, titleLang, children }: { title: string; titleLang?: string; children: React.ReactNode }) {
  return (
    <fieldset className="fgroup">
      <legend lang={titleLang}>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Fixed-width label column + control column. */
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

/** Read-only selectable list with a strong header; editing happens elsewhere. */
export function DataTable<R>({ columns, rows, rowKey, selected, picked, onSelect, onActivate, empty, resizeKey, sections, onRowDragStart }: {
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
}) {
  const [widths, setWidths] = useColumnWidths(resizeKey);
  const move = (step: number) => {
    const index = rows.findIndex((r) => rowKey(r) === selected);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    if (next) onSelect(rowKey(next));
  };
  return (
    <div className="tablewrap" tabIndex={0} onKeyDown={(e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1));
      if (e.key === "Enter" && selected) onActivate?.(selected);
    }}>
      <table className="grid">
        <colgroup>{columns.map((c, i) => {
          const w = widths[c.id ?? String(i)];
          return <col key={i} style={w ? { width: w } : c.width ? { width: c.width } : undefined} />;
        })}</colgroup>
        <thead>
          <tr>{columns.map((c, i) => (
            <th key={i}>
              {c.label}
              {resizeKey && <span className="colgrip" role="separator" aria-orientation="vertical" data-testid="colgrip"
                onMouseDown={(e) => startResize(e, c.id ?? String(i), widths, setWidths)} />}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {(sections ?? [{ key: "", heading: null, rows, attrs: undefined, className: "" }]).map((section) => (
            <Fragment key={section.key}>
              {section.heading && <tr className={`grouprow ${section.className ?? ""}`} {...section.attrs}><td colSpan={columns.length}>{section.heading}</td></tr>}
              {section.rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key} data-key={key} className={`${key === selected || picked?.includes(key) ? "sel" : ""} ${section.className ?? ""}`} onClick={(e) => onSelect(key, e)}
                    onDoubleClick={() => onActivate?.(key)} draggable={!!onRowDragStart || undefined} onDragStart={onRowDragStart && ((e) => onRowDragStart(key, e))} {...section.attrs}>
                    {columns.map((c, i) => <td key={i}>{c.cell(row)}</td>)}
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

/** Drop-down list for the menu bar and split buttons; closes on outside click or Escape. */
export function MenuList({ items, onClose, className = "", style }: { items: MenuItem[]; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current?.parentElement?.contains(e.target as Node) || onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`menulist ${className}`} role="menu" style={style}>
      {items.map((item, i) =>
        item.separator ? <i key={i} className="msep" /> : (
          <button key={i} role="menuitem" className={item.danger ? "danger" : undefined} disabled={item.disabled || !item.onClick}
            onClick={() => (!item.keepOpen && onClose(), item.onClick?.())}>
            {item.checked !== undefined && <span className="mcheck">{item.checked && <Icon name="check" size={12} />}</span>}
            {item.swatch !== undefined && <span className="mswatch" style={item.swatch ? { background: item.swatch } : undefined} />}
            {item.icon && <span className="micon" style={item.iconColor ? { color: item.iconColor } : undefined}><Icon name={item.icon} size={16} /></span>}
            {item.label}
            {item.shortcut && <span className="kbd">{item.shortcut}</span>}
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
      <MenuList className="ctx" style={{ left, top }} items={items} onClose={onClose} />
    </div>
  );
}

/**
 * Puts the focus in a dialog when it opens, unless a control inside already took it (autoFocus), so Escape and the
 * keyboard work at once (KUYRUK 125): the first text field or list, else Cancel/Close (never a destructive OK).
 */
export function useDialogFocus(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = ref.current;
    if (!box || box.contains(document.activeElement)) return;
    const first = box.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]):not([type=checkbox]), select:not([disabled]), textarea:not([disabled])")
      ?? box.querySelector<HTMLElement>(".dlg-buttons button:not([type=submit]):not([disabled])")
      ?? box.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
    if (first) first.focus();
    else (box.tabIndex = -1, box.focus());
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
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="dialog shortcuts" role="dialog" aria-label={title ?? t("shortcuts.title")} onMouseDown={(e) => e.stopPropagation()}
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
