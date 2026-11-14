import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../strings.ts";
import { usePopupPlace } from "../hooks/usePopupPlace.ts";
import { Texture } from "./Texture.tsx";

const GRID_SIZE = { width: 640, height: 520 };

/** Loads a preview only once its cell scrolls into view, so a project with hundreds of textures opens at once. */
function LazyTexture({ dir, path, size }: { dir: string; path: string; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const cell = ref.current;
    if (!cell || seen) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true));
    observer.observe(cell);
    return () => observer.disconnect();
  }, [seen]);
  return <span ref={ref} className="slot">{seen ? <Texture dir={dir} path={path} size={size} /> : null}</span>;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.png$/i, "");

/** Texture field: the chosen texture's preview and name; opens a searchable grid of every project texture. */
export function TexturePicker({ dir, textures, value, allowNone, onChange, openRequest, label }: {
  dir: string;
  textures: string[];
  value: string;
  allowNone: boolean;
  onChange: (path: string) => void;
  /** Opens the grid whenever this number changes to a new non-zero value (a click on a block face, KUYRUK 187). */
  openRequest?: number;
  /** Accessible name of the button when no visible label names it. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => void (openRequest && setOpen(true)), [openRequest]);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // The grid opens over the whole window (not inside a narrow side panel), beside the field when it fits.
  const place = usePopupPlace(open, box, GRID_SIZE);
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
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? textures.filter((path) => path.toLowerCase().includes(q)) : textures;
  }, [textures, query]);
  const pick = (path: string) => (onChange(path), setOpen(false), setQuery(""));
  return (
    <div className="texpicker" ref={box}>
      <button type="button" className="texpicked" title={value} aria-label={label && `${label}: ${value ? fileName(value) : t("field.none")}`} onClick={() => setOpen(!open)}>
        <span className="slot small">{value && <Texture dir={dir} path={value} size={24} />}</span>
        <span className="texpickedname">{value ? fileName(value) : t("field.none")}</span>
      </button>
      {open && place && createPortal(
        <div ref={pop} className="texpop" role="listbox" style={place}>
          <input autoFocus value={query} placeholder={t("resources.search")} spellCheck={false}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && shown[0] && pick(shown[0])} />
          <div className="texgrid">
            {allowNone && (
              <button type="button" className={`texcell${value ? "" : " sel"}`} onClick={() => pick("")}>
                <span className="slot" />
                <span className="texname">{t("field.none")}</span>
              </button>
            )}
            {shown.map((path) => (
              <button type="button" key={path} title={path} className={`texcell${path === value ? " sel" : ""}`} onClick={() => pick(path)}>
                <LazyTexture dir={dir} path={path} size={40} />
                <span className="texname">{fileName(path)}</span>
              </button>
            ))}
          </div>
          {!shown.length && <p className="empty-note">{t("resources.noMatch")}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
