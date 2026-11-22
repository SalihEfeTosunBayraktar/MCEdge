import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { ActionButton } from "../components/ui.tsx";
import { t } from "../strings.ts";

/*
 * The shared editor layout of the GUI editor and the texture editor (Q278, direction A "Dock"): one top bar, a tool rail
 * on the left, the canvas, a collapsible inspector of sections on the right that shrinks to a 38 px strip of section
 * icons, and a status strip. The layout is CSS grid and CSS variables; collapse state lives in a small store, so toggling
 * a panel re-renders only the shell and the inspector, never the canvas (its element is the same object every time).
 */

/** Window width (CSS px) under which the inspector starts collapsed. */
const NARROW = "(max-width: 899.5px)";
const WIDTH_KEY = "mcedge.dockWidth";
const STATE_KEY = "mcedge.dock";
const DEFAULT_WIDTH = 300, MIN_WIDTH = 260;

interface Saved { wide?: boolean; narrow?: boolean; sections?: Record<string, boolean> }
let saved: Saved = {};
try {
  saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as Saved;
} catch {
  // Storage blocked or unreadable: the defaults apply.
}
const narrowQuery = window.matchMedia(NARROW);
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(saved));
  } catch {
    // Not remembered.
  }
  listeners.forEach((l) => l());
};
narrowQuery.addEventListener("change", () => ((version += 1), listeners.forEach((l) => l())));
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const useVersion = () => useSyncExternalStore(subscribe, () => version);

const inspectorIsOpen = () => (narrowQuery.matches ? saved.narrow ?? false : saved.wide ?? true);
/** Opens or closes the inspector for the current window class (wide windows and narrow ones are remembered apart). */
export function setInspectorOpen(open: boolean): void {
  if (narrowQuery.matches) saved.narrow = open;
  else saved.wide = open;
  emit();
}
const sectionIsOpen = (id: string, fallback: boolean) => saved.sections?.[id] ?? fallback;
/** Opens or closes one inspector section (remembered). Does not open a collapsed inspector. */
export function setDockSection(id: string, open: boolean): void {
  if (saved.sections?.[id] === open) return;
  saved.sections = { ...saved.sections, [id]: open };
  emit();
}

export interface DockSection {
  id: string;
  icon: IconName;
  title: string;
  /** Short note after the title (a count, the selected widget). */
  badge?: string;
  defaultOpen?: boolean;
  /** Not mounted while the section is closed or the inspector is collapsed. */
  body: React.ReactNode;
}

interface ShellProps {
  /** Names the bar and the status strip for assistive technology. */
  label: string;
  /** Contents of the top bar, in order: back, identity, file and edit actions, then the zoom group; the inspector toggle is added at the end. */
  bar: React.ReactNode;
  railLabel: string;
  /** Tool buttons and separators (`RailButton`, `RailSeparator`). */
  rail: React.ReactNode;
  railClass?: string;
  sections: DockSection[];
  inspectorLabel: string;
  /** Classes of the inspector aside and of its scrolling body (existing hooks of the editors: procpanel, guiform, paintform). */
  inspectorClass?: string;
  bodyClass?: string;
  status: React.ReactNode;
  /** Shown instead of the sections (the texture is still loading). */
  inspectorEmpty?: React.ReactNode;
  /** The canvas well. */
  children: React.ReactNode;
}

/** Open state of the inspector for the current window class, and the toggle (the same store for every view that has one). */
export function useInspector(): [open: boolean, toggle: () => void] {
  useVersion();
  const open = inspectorIsOpen();
  return [open, () => setInspectorOpen(!open)];
}

/** The inspector toggle button of a top bar. */
export function InspectorToggle() {
  const [open, toggle] = useInspector();
  return <ActionButton hideLabel icon={open ? "next" : "back"} label={t(open ? "dock.inspector.hide" : "dock.inspector.show")} pressed={undefined} onClick={toggle} />;
}

/**
 * The collapsible inspector: sections with a resize grip, or (collapsed) the 38 px strip of section icons. Shared by the
 * editors (`EditorShell`) and the other views (`ViewShell`, Q279). Section bodies are not mounted while closed or collapsed.
 */
export function Inspector({ sections, label, className = "", bodyClass = "", empty }: {
  sections: DockSection[]; label: string; className?: string; bodyClass?: string; empty?: React.ReactNode;
}) {
  const [open] = useInspector();
  return open ? (
    <aside className={`dk-insp ${className}`} aria-label={label}>
      <DockGrip />
      <div className={`dk-insp-body ${bodyClass}`}>
        {empty ?? sections.map((s) => <Section key={s.id} section={s} />)}
      </div>
    </aside>
  ) : (
    <aside className="dk-strip" aria-label={label}>
      <div role="toolbar" aria-orientation="vertical" aria-label={label}>
        {sections.map((s) => (
          <button key={s.id} type="button" className="abtn dkstripbtn" title={s.title} aria-label={s.title} aria-expanded={false}
            onClick={() => (setDockSection(s.id, true), setInspectorOpen(true))}>
            <Icon name={s.icon} />
          </button>
        ))}
      </div>
    </aside>
  );
}

export function EditorShell({ label, bar, railLabel, rail, railClass, sections, inspectorLabel, inspectorClass = "", bodyClass = "", status, inspectorEmpty, children }: ShellProps) {
  const [open] = useInspector();
  return (
    <div className="dk">
      <div className="dk-bar actions" role="toolbar" aria-label={label}>
        {bar}
        <InspectorToggle />
      </div>
      <div className={`dk-main ${open ? "" : "shut"}`}>
        <nav className={`dk-rail ${railClass ?? ""}`} role="toolbar" aria-orientation="vertical" aria-label={railLabel}>{rail}</nav>
        {children}
        <Inspector sections={sections} label={inspectorLabel} className={inspectorClass} bodyClass={bodyClass} empty={inspectorEmpty} />
      </div>
      <div className="dk-status" role="status" aria-label={label}>{status}</div>
    </div>
  );
}

/**
 * The shell of the views that are not canvas editors (Q279): the main column (`children`: bars, list, form) and an
 * optional inspector on the right, the same one the editors use. The main column keeps its own bars so each view's
 * existing structure and test hooks stay.
 */
export function ViewShell({ sections, inspectorLabel, inspectorClass = "", children }: {
  sections?: DockSection[]; inspectorLabel?: string; inspectorClass?: string; children: React.ReactNode;
}) {
  const [open] = useInspector();
  if (!sections?.length) return <>{children}</>;
  return (
    <div className={`dk-view ${open ? "" : "shut"}`}>
      <div className="dk-col">{children}</div>
      <Inspector sections={sections} label={inspectorLabel ?? t("dock.inspector")} className={inspectorClass} />
    </div>
  );
}

/** The row under a view's bar that holds the page tabs and, at its right end, the actions of the selection while there is one (Q284). */
export function TabsRow({ tabs, actions }: { tabs: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="pagetabbar tabsrow">
      {tabs}
      {actions && <div className="actions inbar" role="toolbar">{actions}</div>}
    </div>
  );
}

/** The page nav of a view with page-like groups (Localization's key groups): a vertical list, the same look as the editors' page tabs. */
export function PageNav({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <nav className={`pagenav ${className}`} aria-label={label}>{children}</nav>;
}

export function PageNavItem({ on, label, count, className = "", data, onClick }: { on: boolean; label: React.ReactNode; count?: number; className?: string; data?: string; onClick: () => void }) {
  return (
    <button type="button" aria-current={on || undefined} className={`pnitem ${className} ${on ? "on" : ""}`} data-group={data} onClick={onClick}>
      <span className="pnname">{label}</span>{count !== undefined && <span className="pncount">{count}</span>}
    </button>
  );
}

/** What a view shows when there is nothing to show yet: an icon, one line, an optional hint and the one action that fixes it (Q284). */
export function EmptyState({ icon, text, hint, children }: { icon: IconName; text: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="emptystate" role="status">
      <Icon name={icon} size={28} />
      <p>{text}</p>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}

function Section({ section: s }: { section: DockSection }) {
  const open = sectionIsOpen(s.id, s.defaultOpen ?? true);
  return (
    <section className={`dk-sec ${open ? "open" : "closed"}`} data-section={s.id}>
      <h3 className="dk-sech">
        <button type="button" aria-expanded={open} onClick={() => setDockSection(s.id, !open)}>
          <Icon name="chev" size={10} />
          <span>{s.title}</span>
          {s.badge && <span className="n">{s.badge}</span>}
        </button>
      </h3>
      {open && <div className="sb">{s.body}</div>}
    </section>
  );
}

/** Width of the inspector: dragging the grip on its left edge sets --dock-w; remembered. */
function DockGrip() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w >= MIN_WIDTH) document.documentElement.style.setProperty("--dock-w", `${Math.min(w, Math.round(window.innerWidth * 0.6))}px`);
    } catch {
      // Default width.
    }
  }, []);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const panel = (e.currentTarget as HTMLElement).parentElement;
    if (!panel) return;
    const startX = e.clientX, startW = panel.getBoundingClientRect().width;
    setDragging(true);
    const move = (m: PointerEvent) => {
      const w = Math.round(Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.6, startW + startX - m.clientX)));
      document.documentElement.style.setProperty("--dock-w", `${w}px`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      try {
        localStorage.setItem(WIDTH_KEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--dock-w"), 10) || DEFAULT_WIDTH));
      } catch {
        // Lasts until the app closes.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <span className={`panelgrip ${dragging ? "on" : ""}`} title={t("panel.resize")} onPointerDown={down} />;
}

/** One tool of the rail: icon, name for assistive technology and as tooltip (with the shortcut). */
export function RailButton({ icon, label, shortcut, pressed, disabled, onClick, tone, popup }: {
  icon: IconName; label: string; shortcut?: string; pressed?: boolean; disabled?: boolean; onClick?: () => void; tone?: "danger"; popup?: boolean;
}) {
  return (
    <button type="button" className={`abtn rb ${tone ?? ""} ${pressed ? "pressed" : ""}`} onClick={onClick} disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label} aria-label={label}
      aria-pressed={popup ? undefined : pressed} aria-haspopup={popup ? "menu" : undefined} aria-expanded={popup ? !!pressed : undefined}>
      <Icon name={icon} size={18} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export const RailSeparator = () => <i className="rg" aria-hidden="true" />;

/** Zoom out, the zoom value, zoom in and Fit: the same group in every editor. */
export function ZoomGroup({ zoom, canOut, canIn, onOut, onIn, onFit, fitted, disabled }: {
  zoom: number; canOut: boolean; canIn: boolean; onOut: () => void; onIn: () => void; onFit: () => void; fitted?: boolean; disabled?: boolean;
}) {
  return (
    <div className="dk-zoom" role="group" aria-label={t("dock.zoom")}>
      <ActionButton hideLabel icon="zoomout" label={t("gui.zoomOut")} disabled={disabled || !canOut} onClick={onOut} />
      <output className="dk-zoomval" aria-live="off">{Math.round(zoom * 100)}%</output>
      <ActionButton hideLabel icon="zoomin" label={t("gui.zoomIn")} disabled={disabled || !canIn} onClick={onIn} />
      <ActionButton hideLabel icon="fit" label={t("dock.fit")} pressed={fitted} disabled={disabled} onClick={onFit} />
    </div>
  );
}

/** The status strip: `items` are separated by a thin rule; a `null` item is skipped. */
export function StatusItems({ items }: { items: (React.ReactNode | null)[] }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false);
  return <>{shown.map((item, i) => <span key={i} className="dk-st">{item}</span>)}</>;
}

/**
 * Keeps `fitted` zoom in step with the canvas area while the user has not zoomed by hand: after a resize (a collapsed
 * inspector, a bigger window) the new fit is computed from the area's size. `compute` returns the zoom for a box.
 */
export function useFitOnResize(area: React.RefObject<HTMLElement | null>, fitted: boolean, apply: (box: { w: number; h: number }) => void): void {
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    const el = area.current;
    if (!el || !fitted) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => latest.current({ w: el.clientWidth, h: el.clientHeight }));
    };
    const observer = new ResizeObserver(run);
    observer.observe(el);
    run();
    return () => (cancelAnimationFrame(frame), observer.disconnect());
  }, [area, fitted]);
}
