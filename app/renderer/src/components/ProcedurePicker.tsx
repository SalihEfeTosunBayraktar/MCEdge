import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopupPlace } from "../hooks/usePopupPlace.ts";
import { t } from "../strings.ts";

const LIST_SIZE = { width: 420, height: 420 };

export interface ProcedureChoice {
  id: string;
  name: string;
}

/** Most rows drawn at once; a project can have hundreds of procedures, the search narrows them. */
const MAX_SHOWN = 120;

/** Procedures that match every word of the search in their name or id: exact first, then prefixes, then the rest. */
export function matchProcedures(choices: ProcedureChoice[], query: string): ProcedureChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return choices;
  const words = q.split(/\s+/);
  const rank = (c: ProcedureChoice) => {
    const name = c.name.toLowerCase(), id = c.id.toLowerCase();
    return name === q || id === q ? 0 : name.startsWith(q) || id.startsWith(q) ? 1 : 2;
  };
  return choices
    .filter((c) => words.every((w) => `${c.name} ${c.id}`.toLowerCase().includes(w)))
    .map((c, i) => ({ c, r: rank(c), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Procedure field: the chosen procedure's name; opens a searchable list (by name and id, like the texture picker).
 * Enter picks the highlighted entry, the arrow keys move it, Escape closes.
 */
export function ProcedurePicker({ choices, value, onChange }: { choices: ProcedureChoice[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // The list opens over the whole window, like the texture grid, so a narrow side panel does not cut it off.
  const place = usePopupPlace(open, box, LIST_SIZE);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => box.current?.contains(e.target as Node) || pop.current?.contains(e.target as Node) || setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const matches = useMemo(() => matchProcedures(choices, query), [choices, query]);
  // "No procedure" is the first entry while the search is empty.
  const entries: ProcedureChoice[] = useMemo(() => [...(query.trim() ? [] : [{ id: "", name: t("procedure.none") }]), ...matches.slice(0, MAX_SHOWN)], [matches, query]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(".procrow.active")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const pick = (id: string) => (onChange(id), setOpen(false), setQuery(""));
  const shownName = choices.find((c) => c.id === value)?.name ?? value;
  return (
    <div className="texpicker procpicker" ref={box}>
      <button type="button" className="texpicked procpicked" title={value} onClick={() => (setOpen(!open), setActive(0))}>
        <span className={`texpickedname${value ? "" : " dim"}`}>{value ? shownName : t("procedure.none")}</span>
        <span className="procchev" aria-hidden="true" />
      </button>
      {open && place && createPortal(
        <div ref={pop} className="texpop proclistpop" role="listbox" style={place}>
          <input autoFocus value={query} placeholder={t("procedure.search")} spellCheck={false}
            onChange={(e) => (setQuery(e.target.value), setActive(0))}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.preventDefault(), entries[active] && pick(entries[active].id));
              else if (e.key === "ArrowDown") (e.preventDefault(), setActive(Math.min(entries.length - 1, active + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive(Math.max(0, active - 1)));
            }} />
          <div className="proclist" ref={list}>
            {entries.map((c, i) => (
              <button type="button" key={c.id || "none"} role="option" aria-selected={c.id === value} title={c.id}
                className={`procrow${i === active ? " active" : ""}${c.id === value ? " sel" : ""}${c.id ? "" : " dim"}`}
                onMouseMove={() => active !== i && setActive(i)} onClick={() => pick(c.id)}>
                <span className="procname">{c.name}</span>
                {c.id && c.id !== c.name && <span className="procid">{c.id}</span>}
              </button>
            ))}
          </div>
          {matches.length > MAX_SHOWN && <p className="empty-note">{t("procedure.more", { count: matches.length - MAX_SHOWN })}</p>}
          {!matches.length && <p className="empty-note">{t("procedure.noMatch")}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
