import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REGISTRY_PROVIDERS } from "../../../../src/elements/model.ts";
import type { PickerKind, ProjectSnapshot } from "../../../shared/api.ts";
import { spriteFor } from "../catalog.ts";
import { usePopupPlace } from "../hooks/usePopupPlace.ts";
import { useVanillaCatalog, useVanillaIcon } from "../hooks/useVanilla.ts";
import { elementName, elementsOf, elementTexture } from "../model.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { Texture } from "./Texture.tsx";

/**
 * Item, block and entity fields (KUYRUK 127, MCreator's MCItemSelectorDialog): the field shows the chosen entry's icon and
 * name and opens a searchable icon grid of this mod's elements, vanilla Minecraft (names and icons from the client jar an
 * engine downloaded) and, where the field takes them, tags. A namespaced id that is in none of the lists can be typed.
 */

type Source = "mod" | "vanilla" | "tag";
interface Entry {
  value: string;
  name: string;
  source: Source;
  typeId?: string;
  texture?: string;
}

const GRID_SIZE = { width: 680, height: 540 };
const SHOWN = 240;
const TAG_TYPE: Record<PickerKind, string> = { item: "item", block: "block", entity: "entity_type" };
const TYPED = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/** Every entry the picker offers for a kind: this mod first, then vanilla, then tags. */
function useEntries(kind: PickerKind, snapshot: ProjectSnapshot, minecraft: string | undefined, allowTags: boolean): Entry[] {
  const catalog = useVanillaCatalog(kind, minecraft);
  return useMemo(() => {
    const modId = snapshot.project.mod.id;
    const mod: Entry[] = elementsOf(snapshot, REGISTRY_PROVIDERS[kind]).map(({ typeId, element }) => ({
      value: element.id, name: elementName(typeId, element), source: "mod", typeId, texture: elementTexture(snapshot, typeId, element),
    }));
    const vanilla: Entry[] = (catalog?.ids ?? []).map((id) => ({ value: id, name: catalog?.names[id] ?? id.replace(/^minecraft:/, ""), source: "vanilla" }));
    const tags: Entry[] = !allowTags ? [] : [...new Set([
      ...snapshot.tags.filter((tag) => tag.type === TAG_TYPE[kind]).map((tag) => `#${tag.id.includes(":") ? tag.id : `${modId}:${tag.id}`}`),
      ...(catalog?.tags ?? []),
    ])].map((tag) => ({ value: tag, name: tag, source: "tag" }));
    return [...mod, ...vanilla, ...tags];
  }, [kind, snapshot, catalog, allowTags]);
}

/** The icon of an entry: a mod element's texture (or its type's sprite), the vanilla picture, or the tag symbol. */
function EntryIcon({ entry, kind, size, dir, minecraft }: { entry: Entry; kind: PickerKind; size: number; dir: string; minecraft?: string }) {
  const url = useVanillaIcon(kind, entry.source === "vanilla" ? entry.value : "", minecraft);
  if (entry.source === "mod") return entry.texture ? <Texture dir={dir} path={entry.texture} size={size} /> : <Sprite name={spriteFor(entry.typeId!)} size={size} />;
  if (entry.source === "tag") return <Icon name="tag" size={Math.round(size * 0.6)} />;
  // An animated texture is a strip of frames: the box shows the first one.
  if (url) return <span className="regicon" style={{ width: size, height: size, backgroundImage: `url(${url})` }} />;
  return <span className="regicon none" style={{ width: size, height: size }}>{url === null ? "?" : ""}</span>;
}

/** Loads an icon only once its cell is scrolled into view. */
function LazyIcon(props: Parameters<typeof EntryIcon>[0]) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const observer = new IntersectionObserver((items) => items.some((i) => i.isIntersecting) && setSeen(true));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return <span ref={ref} className="slot">{seen && <EntryIcon {...props} />}</span>;
}

export interface RegistryPickerProps {
  kind: PickerKind;
  value: string;
  onChange: (value: string) => void;
  snapshot: ProjectSnapshot;
  /** Minecraft version of the selected engine: vanilla names and icons come from its client jar. */
  minecraft?: string;
  allowTags?: boolean;
  /** Offers None (an empty value). */
  allowNone?: boolean;
  /** "slot": a square inventory slot with the icon only (recipe grids). */
  variant?: "field" | "slot";
  /** Accessible name of a slot. */
  label?: string;
}

export function RegistryPicker({ kind, value, onChange, snapshot, minecraft, allowTags = false, allowNone = true, variant = "field", label }: RegistryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | Source>("all");
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const place = usePopupPlace(open, box, GRID_SIZE);
  const entries = useEntries(kind, snapshot, minecraft, allowTags);
  const current: Entry | undefined = value ? entries.find((e) => e.value === value) ?? { value, name: value, source: value.startsWith("#") ? "tag" : "vanilla" } : undefined;
  const known = !!value && entries.some((e) => e.value === value);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => box.current?.contains(e.target as Node) || pop.current?.contains(e.target as Node) || setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const q = query.trim().toLowerCase();
  const matching = useMemo(() => entries.filter((e) => !q || e.name.toLowerCase().includes(q) || e.value.includes(q)), [entries, q]);
  const counts = { all: matching.length, mod: 0, vanilla: 0, tag: 0 };
  for (const e of matching) counts[e.source]++;
  const shown = source === "all" ? matching : matching.filter((e) => e.source === source);
  const typed = TYPED.test(q) && !entries.some((e) => e.value === q) && (allowTags || !q.startsWith("#")) ? q : undefined;
  const pick = (next: string) => (onChange(next), setOpen(false), setQuery(""));
  const icon = (entry: Entry, size: number) => <EntryIcon entry={entry} kind={kind} size={size} dir={snapshot.dir} minecraft={minecraft} />;
  const sources = (["all", "mod", "vanilla", ...(allowTags ? ["tag"] : [])] as const) as readonly ("all" | Source)[];

  return (
    <div className={`texpicker regpicker ${variant}`} ref={box}>
      {variant === "slot" ? (
        <button type="button" className={`rslot ${value && !known ? "unknown" : ""}`} aria-label={`${label ?? ""}: ${current?.name ?? t("field.none")}`}
          title={current ? `${current.name} (${current.value})` : label} data-value={value} onClick={() => setOpen(!open)}>
          {current && icon(current, 32)}
        </button>
      ) : (
        <button type="button" className="texpicked regpicked" title={current?.value} data-value={value} onClick={() => setOpen(!open)}>
          <span className="slot small">{current && icon(current, 24)}</span>
          <span className="texpickedname">{current ? current.name : t("field.none")}</span>
          {current && current.name !== current.value && <code className="regid dim">{current.value}</code>}
          {value && !known && <span className="regwarn" title={t("picker.unknown")}><Icon name="warn" size={12} /></span>}
        </button>
      )}
      {open && place && createPortal(
        <div ref={pop} className="texpop regpop" role="dialog" aria-label={t(`picker.title.${kind}`)} style={place}>
          <div className="regsearch">
            <input autoFocus value={query} placeholder={t(`picker.search.${kind}`)} spellCheck={false} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (shown[0]) pick(shown[0].value);
                else if (typed) pick(typed);
              }} />
          </div>
          <div className="langtabs regtabs" role="tablist">
            {sources.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={s === source} className={`ltab ${s === source ? "on" : ""}`} onClick={() => setSource(s)}>
                {t(`picker.source.${s}`)}<span className="lpct">{counts[s]}</span>
              </button>
            ))}
          </div>
          <div className="texgrid regcells" role="listbox">
            {allowNone && !q && (
              <button type="button" role="option" aria-selected={!value} className={`texcell${value ? "" : " sel"}`} onClick={() => pick("")}>
                <span className="slot" />
                <span className="texname">{t("field.none")}</span>
              </button>
            )}
            {typed && (
              <button type="button" role="option" aria-selected={false} className="texcell typed" title={typed} onClick={() => pick(typed)}>
                <span className="slot"><Icon name="plus" /></span>
                <span className="texname">{t("picker.useTyped", { id: typed })}</span>
              </button>
            )}
            {shown.slice(0, SHOWN).map((entry) => (
              <button type="button" role="option" aria-selected={entry.value === value} key={`${entry.source}|${entry.value}`} data-value={entry.value}
                title={entry.name === entry.value ? entry.value : `${entry.name} (${entry.value})`}
                className={`texcell ${entry.source}${entry.value === value ? " sel" : ""}`} onClick={() => pick(entry.value)}>
                <LazyIcon entry={entry} kind={kind} size={32} dir={snapshot.dir} minecraft={minecraft} />
                <span className="texname">{entry.name}</span>
              </button>
            ))}
          </div>
          {shown.length > SHOWN && <p className="hint nomargin">{t("picker.more", { shown: SHOWN, count: shown.length })}</p>}
          {!shown.length && !typed && <p className="empty-note">{t("picker.noMatch")}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
