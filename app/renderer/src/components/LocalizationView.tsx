import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Localization, ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { LANGUAGE_CODE, MINECRAFT_LANGUAGES } from "../../../../src/ir/languages.ts";
import {
  addLanguage, BASE_LANGUAGE, elementNameKeys, hasPlaceholderIssue, keyMatches, keyProblem, keySearch, placeholderMismatch, removeLanguage,
  renameLanguage, translationTable, type ElementKey, type KeyFilter,
} from "../../../../src/ir/localization.ts";
import {
  applyImport, csvTranslations, exportCsv, exportLangJson, jsonTranslations, languageOfFile, planImport, type Incoming,
} from "../../../../src/ir/localizationIO.ts";
import { spriteFor } from "../catalog.ts";
import { useAutosave } from "../hooks/useAutosave.ts";
import type { ElementRef } from "../model.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { Flag } from "./Brand.tsx";
import { Sprite } from "./Sprite.tsx";
import { useRevealQuery } from "../hooks/reveal.ts";
import {
  ActionBar, ActionButton, Dialog, FindBar, FindSelect, FormGroup, FormRow, MenuList, Separator, ShortcutsButton, startResize, useColumnWidths,
} from "./ui.tsx";

/** A grid cell: a lang key in one language. */
interface Cell { key: string; lang: string }
/** Where the editor goes after a cell is saved or cancelled. */
type Move = "none" | "stay" | "up" | "down" | "left" | "right" | "missing";

/** The group list on the left: every key, the keys of one element type, or the custom keys under one prefix. */
type Group = { kind: "all" } | { kind: "type"; id: string } | { kind: "prefix"; id: string };

interface Props {
  snapshot: ProjectSnapshot;
  /** Engine whose generator reports the element keys (names, GUI labels, tooltips, advancements...). */
  engineId: string;
  onSaved: (snapshot: ProjectSnapshot) => void;
  onOpenElement: (ref: ElementRef) => void;
}

/** First part of a custom key ("gui" of gui.mymod.title): its group; keys without dots share the "" group. */
const prefixOf = (key: string) => (key.includes(".") ? key.split(".")[0] : "");

/**
 * One row per lang key, one column per language, cells edited in place. Element names fill en_us by default; an empty
 * cell means "use the default", so clearing a cell removes the override. A strip under the grid shows the key, the
 * element that uses it and a placeholder check.
 */
export function LocalizationView({ snapshot, engineId, onSaved, onOpenElement }: Props) {
  const [localization, setLocalization, , replaceLocalization] = useAutosave<Localization>(snapshot.project.localization, async (next) =>
    onSaved(await api.saveLocalization(snapshot.dir, next)),
  );
  const [query, setQuery] = useState("");
  useRevealQuery("localization", setQuery);
  const [show, setShow] = useState<KeyFilter>("all");
  const [sort, setSort] = useState<"key" | "type" | "missing">("key");
  const [group, setGroup] = useState<Group>({ kind: "all" });
  const [focus, setFocus] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string>();
  const [cursor, setCursor] = useState<Cell>();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"key" | "language" | "rename" | "remove" | "delete" | "export">();
  const [importing, setImporting] = useState<{ path: string; text: string }>();
  const [languageMenu, setLanguageMenu] = useState(false);
  const [hidden, setHidden] = useHiddenLanguages(snapshot.dir);
  const gridRef = useRef<HTMLDivElement>(null);
  const defaults = useElementKeys(snapshot, engineId);
  // Memoised: with thousands of keys these lists must not be rebuilt on every cursor move or scroll (KUYRUK 118).
  const table = useMemo(() => translationTable(localization, defaults), [localization, defaults]);
  const { languages, keys, text, shown } = table;
  /** Languages shown as columns: hidden ones stay in the project and in the filters (KUYRUK 115). */
  // Focus mode: key, en_us and one target language, for a translator working through one language.
  const focused = focus && languages.includes(focus) ? focus : "";
  const columns = focused ? [BASE_LANGUAGE, focused] : languages.filter((l) => l === BASE_LANGUAGE || !hidden.includes(l));
  // A Missing in <language> filter whose language was removed shows everything again.
  const filter: KeyFilter = show.startsWith("missing:") && !languages.includes(show.slice("missing:".length)) ? "all" : show;
  const isMissing = (key: string) => keyMatches(table, key, "missingAny");
  const typeName = (typeId: string) => typeOf(typeId)?.name ?? typeId;
  // Search and Show first, then the group: the group list counts what the search and filter leave.
  const found = useMemo(() => keys.filter((key) => keySearch(table, key, query) && keyMatches(table, key, filter)), [table, query, filter]);
  const inGroup = (key: string, g: Group) => g.kind === "all"
    || (g.kind === "type" ? defaults[key]?.typeId === g.id : !defaults[key] && prefixOf(key) === g.id);
  const rows = useMemo(() => found.filter((key) => inGroup(key, group))
    .sort((a, b) => (sort === "missing" ? Number(isMissing(b)) - Number(isMissing(a))
      : sort === "type" ? typeName(defaults[a]?.typeId ?? "\uffff").localeCompare(typeName(defaults[b]?.typeId ?? "\uffff")) : 0)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers only read table and defaults
  [found, group, sort, defaults]);

  // A selection or cell the filter or search hides is dropped, so no action can reach a key the user cannot see (KUYRUK 112).
  const listed = new Set(rows);
  const selected = selection.filter((k) => listed.has(k));
  const cell = cursor && listed.has(cursor.key) && columns.includes(cursor.lang) ? cursor : undefined;
  useEffect(() => {
    if (selected.length !== selection.length) setSelection(selected);
    if (cursor && !cell) (setCursor(undefined), setEditing(false));
  });
  const current = cell?.key ?? (selected.length === 1 ? selected[0] : undefined);

  const setCell = (l: string, key: string, value: string) => {
    const entries = { ...(localization[l] ?? {}) };
    if (value) entries[key] = value;
    else delete entries[key];
    setLocalization({ ...localization, [l]: entries });
  };
  /** Saves an edited cell; the inherited element name is not stored as an override. */
  const commit = ({ key, lang }: Cell, value: string) => {
    const next = lang === BASE_LANGUAGE && value === defaults[key]?.text ? "" : value;
    if (next !== text(lang, key)) setCell(lang, key, next);
  };
  const removeKeys = (gone: string[]) =>
    setLocalization(Object.fromEntries(Object.entries(localization).map(([l, entries]) =>
      [l, Object.fromEntries(Object.entries(entries).filter(([k]) => !gone.includes(k)))])));
  /** Language changes are written at once, with the edits still waiting for the autosave; a removed code loses its file. */
  const applyLanguages = async (next: Localization, removed: string[] = []) => {
    replaceLocalization(next);
    setDialog(undefined);
    onSaved(await api.saveLocalization(snapshot.dir, next, removed));
  };
  const completion = useMemo(() => Object.fromEntries(table.languages.map((l) =>
    [l, Math.round((100 * table.keys.filter((k) => table.shown(l, k)).length) / Math.max(1, table.keys.length))])), [table]);
  const deletable = selected.filter((k) => !defaults[k]);
  /** Selected element keys whose en_us text was typed over the element's own. */
  const overridden = selected.filter((k) => defaults[k] && text(BASE_LANGUAGE, k));

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  const open = (to: Cell, edit: boolean) => {
    setCursor(to);
    setSelection([to.key]);
    setAnchor(to.key);
    setEditing(edit);
    if (!edit) focusGrid();
  };
  /** The next cell of `lang` (after `from`, wrapping) that has no text. */
  const nextMissing = (lang: string, from?: string): Cell | undefined => {
    const start = from ? rows.indexOf(from) : -1;
    for (let i = 1; i <= rows.length; i++) {
      const key = rows[(start + i + rows.length) % rows.length];
      if (!shown(lang, key)) return { key, lang };
    }
    return undefined;
  };
  const targetLanguage = () => cell?.lang ?? columns.find((l) => l !== BASE_LANGUAGE) ?? BASE_LANGUAGE;
  const goNextMissing = (from = cell) => {
    const next = nextMissing(from?.lang ?? targetLanguage(), from?.key);
    if (next) open(next, true);
  };
  const neighbour = ({ key, lang }: Cell, move: Move): Cell | undefined => {
    const r = rows.indexOf(key);
    const c = columns.indexOf(lang);
    if (move === "up" || move === "down") {
      const next = rows[r + (move === "down" ? 1 : -1)];
      return next ? { key: next, lang } : undefined;
    }
    if (move === "left" || move === "right") {
      const at = r * columns.length + c + (move === "right" ? 1 : -1);
      const row = rows[Math.floor(at / columns.length)];
      return at >= 0 && row ? { key: row, lang: columns[at % columns.length] } : undefined;
    }
    return undefined;
  };
  const finishEdit = (at: Cell, value: string | undefined, move: Move) => {
    if (value !== undefined) commit(at, value);
    if (move === "missing") {
      const next = nextMissing(at.lang, at.key);
      return next && !(next.key === at.key && value) ? open(next, true) : open(at, false);
    }
    const next = neighbour(at, move);
    if (next) return open(next, true);
    if (move === "none") return setEditing(false);
    open(at, false);
  };
  const pickRow = (key: string, e: React.MouseEvent) => {
    focusGrid();
    setCursor(undefined);
    setEditing(false);
    if (e.shiftKey && anchor && listed.has(anchor)) {
      const [a, b] = [rows.indexOf(anchor), rows.indexOf(key)].sort((x, y) => x - y);
      return setSelection(rows.slice(a, b + 1));
    }
    if (e.ctrlKey || e.metaKey) setSelection(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
    else setSelection([key]);
    setAnchor(key);
  };
  const gridKeys = (e: React.KeyboardEvent) => {
    if (editing || e.target !== e.currentTarget) return;
    const arrows: Record<string, Move> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return (e.preventDefault(), goNextMissing());
    if (!cell) {
      if (arrows[e.key] && rows.length) (e.preventDefault(), open({ key: current ?? rows[0], lang: targetLanguage() }, false));
      return;
    }
    if (e.key === "Enter" || e.key === "F2") return (e.preventDefault(), setEditing(true));
    const next = arrows[e.key] && neighbour(cell, arrows[e.key]);
    if (arrows[e.key]) e.preventDefault();
    if (next) open(next, false);
  };

  return (
    <section className="view">
      <FindBar query={query} onQuery={setQuery} placeholder={t("localization.search")}
        meta={rows.length === keys.length
          ? t("localization.count", { count: keys.length, languages: languages.length })
          : t("localization.countShown", { shown: rows.length, count: keys.length, languages: languages.length })}>
        <FindSelect<KeyFilter> icon="filter" label={t("find.show")} value={filter} onChange={setShow} options={[
          { value: "all", label: t("localization.show.all") },
          ...languages.filter((l) => l !== BASE_LANGUAGE).map((l) => ({ value: `missing:${l}` as KeyFilter, label: t("localization.show.missingIn", { lang: l }) })),
          { value: "missingAny", label: t("localization.show.missingAny") },
          { value: "sourceEmpty", label: t("localization.show.sourceEmpty") },
          { value: "placeholder", label: t("localization.show.placeholder") },
          { value: "edited", label: t("localization.show.edited") },
          { value: "elements", label: t("localization.show.elements") },
        ]} />
        {languages.length > 1 && (
          <FindSelect icon="globe" label={t("localization.columns")} value={focused} onChange={setFocus} options={[
            { value: "", label: t("localization.allColumns") },
            ...languages.filter((l) => l !== BASE_LANGUAGE).map((l) => ({ value: l, label: t("localization.focusOn", { lang: l }) })),
          ]} />
        )}
        <FindSelect icon="sort" label={t("find.sort")} value={sort} onChange={setSort} options={[
          { value: "key", label: t("sort.key") },
          { value: "type", label: t("sort.type") },
          { value: "missing", label: t("sort.missingFirst") },
        ]} />
      </FindBar>
      <ActionBar>
        <ActionButton icon="plus" label={t("localization.addKey")} tone="primary" onClick={() => setDialog("key")} />
        <div className="menuwrap">
          <ActionButton icon="globe" label={t("localization.languages")} pressed={languageMenu} onClick={() => setLanguageMenu(!languageMenu)} />
          {languageMenu && (
            <MenuList onClose={() => setLanguageMenu(false)} items={[
              { label: t("localization.addLanguage"), onClick: () => setDialog("language") },
              { label: t("localization.renameLanguage"), onClick: languages.length > 1 ? () => setDialog("rename") : undefined },
              { label: t("localization.removeLanguage"), danger: true, onClick: languages.length > 1 ? () => setDialog("remove") : undefined },
              ...(languages.length > 1 ? [{ label: "", separator: true }] : []),
              ...languages.filter((l) => l !== BASE_LANGUAGE).map((l) => ({
                label: t("localization.showColumn", { lang: languageLabel(l) }), checked: !hidden.includes(l), keepOpen: true,
                onClick: () => setHidden(hidden.includes(l) ? hidden.filter((h) => h !== l) : [...hidden, l]),
              })),
            ]} />
          )}
        </div>
        <ActionButton icon="import" label={t("localization.import")} onClick={() => void api.importTranslations().then((file) => file && setImporting(file))} />
        <ActionButton icon="save" label={t("localization.export")} onClick={() => setDialog("export")} />
        <Separator />
        <ActionButton icon="next" label={t("localization.nextMissing")} title="Ctrl+Enter" disabled={!rows.length} onClick={() => goNextMissing()} />
        <ActionButton icon="undo" label={t("localization.resetName")} disabled={!overridden.length}
          onClick={() => setLocalization({ ...localization, [BASE_LANGUAGE]: Object.fromEntries(Object.entries(localization[BASE_LANGUAGE] ?? {}).filter(([k]) => !overridden.includes(k))) })} />
        <Separator />
        <ActionButton icon="trash" tone="danger" disabled={!deletable.length}
          label={deletable.length > 1 ? `${t("action.deleteSelected")} (${deletable.length})` : t("action.deleteSelected")}
          title={selected.length > deletable.length ? t("localization.elementKeyNoDelete") : undefined}
          onClick={() => (deletable.length > 1 ? setDialog("delete") : removeKeys(deletable))} />
        <Separator />
        <ShortcutsButton shortcuts={[
          [t("keys.k.click"), t("keys.loc.edit")], ["Enter / Shift+Enter", t("keys.loc.downUp")], ["Tab / Shift+Tab", t("keys.loc.nextPrev")],
          ["Ctrl+Enter", t("keys.loc.nextMissing")], ["Esc", t("keys.loc.cancel")], [t("keys.k.arrows"), t("keys.loc.move")],
          [t("keys.k.shiftClick"), t("keys.loc.select")], ["?", t("keys.list")],
        ]} />
      </ActionBar>
      <div className="locbody">
      <Groups keys={found} group={group} onGroup={setGroup} typeOfKey={(k) => defaults[k]?.typeId} typeName={typeName} />
      <div ref={gridRef} className="tablewrap locgrid" tabIndex={0} onKeyDown={gridKeys} data-rows={rows.length}>
        <LocTable scroller={gridRef} rows={rows} languages={columns} selected={selected} cell={cell} editing={editing}
          keyType={(k) => defaults[k]?.typeId} typeName={typeName}
          header={(l) => (
            <span className="colhead"><Flag lang={l} /><code>{l}</code><span className="lpct">{l === BASE_LANGUAGE ? t("localization.source") : `${completion[l]}%`}</span></span>
          )}
          view={(lang, key) => {
            const own = text(lang, key);
            const value = shown(lang, key);
            return {
              value,
              inherited: !own && !!value,
              mismatch: lang !== BASE_LANGUAGE && hasPlaceholderIssue(table, key, lang),
              editValue: own || value,
            };
          }}
          onPickRow={pickRow} onOpen={(to) => open(to, true)} onFinish={finishEdit} />
        {rows.length === 0 && <p className="table-empty">{t("localization.empty")}</p>}
      </div>
      </div>
      <Detail current={current} element={current ? defaults[current] : undefined} typeName={typeName} onOpenElement={onOpenElement}
        checks={current ? columns.filter((l) => l !== BASE_LANGUAGE).map((l) => ({ lang: l, ...placeholderMismatch(shown(BASE_LANGUAGE, current), shown(l, current)) })) : []} />
      {dialog === "key" && (
        <AddKeyDialog keys={keys} modId={snapshot.project.mod.id} onCancel={() => setDialog(undefined)}
          onAdd={(key, value) => (setCell(BASE_LANGUAGE, key, value), setSelection([key]), setDialog(undefined))} />
      )}
      {dialog === "language" && (
        <AddLanguageDialog languages={languages} onCancel={() => setDialog(undefined)}
          onAdd={(code, copyFrom) => void applyLanguages(addLanguage(localization, code, copyFrom, defaults))} />
      )}
      {dialog === "rename" && (
        <RenameLanguageDialog languages={languages} onCancel={() => setDialog(undefined)}
          onRename={(from, to) => (setHidden(hidden.map((h) => (h === from ? to : h))), void applyLanguages(renameLanguage(localization, from, to), [from]))} />
      )}
      {dialog === "remove" && (
        <RemoveLanguageDialog languages={languages} texts={(l) => Object.keys(localization[l] ?? {}).length} onCancel={() => setDialog(undefined)}
          onRemove={(code) => (setHidden(hidden.filter((h) => h !== code)), void applyLanguages(removeLanguage(localization, code), [code]))} />
      )}
      {dialog === "export" && (
        <ExportDialog languages={languages} counts={{ all: keys.length, listed: rows.length, selected: selected.length }}
          onCancel={() => setDialog(undefined)}
          onExport={(format, langs, which) => {
            const chosen = which === "all" ? keys : which === "listed" ? rows : rows.filter((k) => selected.includes(k));
            const name = format === "csv" ? `${snapshot.project.mod.id}-translations.csv` : `${langs[0]}.json`;
            const text = format === "csv" ? exportCsv(table, chosen, langs) : exportLangJson(table, chosen, langs[0]);
            setDialog(undefined);
            void api.exportTranslations(name, text);
          }} />
      )}
      {importing && (
        <ImportDialog file={importing} languages={languages} onCancel={() => setImporting(undefined)}
          plan={(incoming) => planImport(table, incoming)}
          onApply={(incoming, addUnknown) => (setImporting(undefined), void applyLanguages(applyImport(localization, table, incoming, addUnknown)))} />
      )}
      {dialog === "delete" && (
        <Dialog title={t("localization.deleteTitle")} okLabel={t("action.delete")} canOk danger onCancel={() => setDialog(undefined)}
          onOk={() => (removeKeys(deletable), setSelection([]), setDialog(undefined))}>
          <p>{t("localization.deleteConfirm", { count: deletable.length })}</p>
        </Dialog>
      )}
    </section>
  );
}

/** A key with, for keys an element creates, the element type's sprite and name. */
function KeyLabel({ name, typeId, typeName }: { name: string; typeId?: string; typeName: (typeId: string) => string }) {
  return (
    <span className="keylabel">
      {typeId ? <span className="ktype" title={typeName(typeId)}><Sprite name={spriteFor(typeId)} size={12} /></span> : <span className="ktype" />}
      <code>{name}</code>
      {typeId && <span className="ktypename">{typeName(typeId)}</span>}
    </span>
  );
}

/** Group list: all keys, element keys by type, custom keys by their first part; counts follow the search and Show. */
function Groups({ keys, group, onGroup, typeOfKey, typeName }: {
  keys: string[];
  group: Group;
  onGroup: (group: Group) => void;
  typeOfKey: (key: string) => string | undefined;
  typeName: (typeId: string) => string;
}) {
  const types = new Map<string, number>();
  const prefixes = new Map<string, number>();
  for (const key of keys) {
    const typeId = typeOfKey(key);
    if (typeId) types.set(typeId, (types.get(typeId) ?? 0) + 1);
    else prefixes.set(prefixOf(key), (prefixes.get(prefixOf(key)) ?? 0) + 1);
  }
  const on = (g: Group) => g.kind === group.kind && (g.kind === "all" || (group.kind !== "all" && g.id === group.id));
  const item = (g: Group, label: React.ReactNode, count: number) => (
    <button type="button" key={`${g.kind}:${g.kind === "all" ? "" : g.id}`} className={`lgroup ${on(g) ? "on" : ""}`}
      data-group={g.kind === "all" ? "all" : `${g.kind}:${g.id}`} onClick={() => onGroup(g)}>
      <span className="lgname">{label}</span><span className="lgcount">{count}</span>
    </button>
  );
  return (
    <nav className="locgroups" aria-label={t("localization.groups")}>
      {item({ kind: "all" }, t("localization.allKeys"), keys.length)}
      {types.size > 0 && <div className="lghead">{t("localization.fromElements")}</div>}
      {[...types].sort((a, b) => typeName(a[0]).localeCompare(typeName(b[0])))
        .map(([id, n]) => item({ kind: "type", id }, <><Sprite name={spriteFor(id)} size={12} />{typeName(id)}</>, n))}
      {prefixes.size > 0 && <div className="lghead">{t("localization.customKeys")}</div>}
      {[...prefixes].sort((a, b) => a[0].localeCompare(b[0])).map(([id, n]) => item({ kind: "prefix", id }, id ? <code>{id}.*</code> : t("localization.noPrefix"), n))}
    </nav>
  );
}

/**
 * Keys elements create: their names at once, then everything the generator writes for the current engine (GUI labels,
 * tooltips, advancement texts, subtitles...), which takes a moment on a large project. Fetched again when the elements
 * change, not on every translation save.
 */
function useElementKeys(snapshot: ProjectSnapshot, engineId: string): Record<string, ElementKey> {
  const names = useMemo(() => elementNameKeys(snapshot.project, typeOf), [snapshot]);
  const elements = useMemo(() => JSON.stringify(snapshot.project.elements), [snapshot]);
  const [generated, setGenerated] = useState<Record<string, ElementKey>>({});
  useEffect(() => {
    let live = true;
    if (engineId) void api.generatedLangKeys(snapshot.dir, engineId).then((keys) => live && setGenerated(keys), () => undefined);
    return () => void (live = false);
  }, [snapshot.dir, engineId, elements]);
  return useMemo(() => ({ ...names, ...generated }), [names, generated]);
}

interface CellView {
  value: string;
  /** The text is the element's name, not typed for this key. */
  inherited: boolean;
  mismatch: boolean;
  /** What the editor starts with. */
  editValue: string;
}

/** Rows drawn above and below the visible ones, so a fast scroll does not show blank space. */
const OVERSCAN = 12;

/**
 * The grid. Only the rows in view (plus OVERSCAN) are in the DOM, between two spacer rows that keep the scroll height
 * (KUYRUK 118: 5000 keys). Rows have one fixed height, measured from a drawn row.
 */
function LocTable({ scroller, rows, languages, selected, cell, editing, keyType, typeName, header, view, onPickRow, onOpen, onFinish }: {
  scroller: React.RefObject<HTMLDivElement | null>;
  rows: string[];
  keyType: (key: string) => string | undefined;
  typeName: (typeId: string) => string;
  languages: string[];
  selected: string[];
  cell?: Cell;
  editing: boolean;
  header: (lang: string) => React.ReactNode;
  view: (lang: string, key: string) => CellView;
  onPickRow: (key: string, e: React.MouseEvent) => void;
  onOpen: (cell: Cell) => void;
  onFinish: (cell: Cell, value: string | undefined, move: Move) => void;
}) {
  const [widths, setWidths] = useColumnWidths("localization");
  const columns = ["key", ...languages];
  const isSel = new Set(selected);
  const body = useRef<HTMLTableSectionElement>(null);
  const [port, setPort] = useState({ top: 0, height: 900 });
  const [rowHeight, setRowHeight] = useState(28);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const update = () => setPort((p) => (p.top === box.scrollTop && p.height === box.clientHeight ? p : { top: box.scrollTop, height: box.clientHeight }));
    update();
    box.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(box);
    return () => (box.removeEventListener("scroll", update), resize.disconnect());
  }, [scroller]);
  useLayoutEffect(() => {
    const drawn = body.current?.querySelector<HTMLElement>("tr[data-key]")?.getBoundingClientRect().height;
    if (drawn && Math.abs(drawn - rowHeight) > 0.5) setRowHeight(drawn);
  });
  // An even first row keeps the zebra stripes on the same rows while scrolling.
  let start = Math.max(0, Math.floor(port.top / rowHeight) - OVERSCAN);
  start -= start % 2;
  const end = Math.min(rows.length, Math.ceil((port.top + port.height) / rowHeight) + OVERSCAN);
  // Keep the cell under the cursor in view while moving with the keyboard (it may not be drawn yet).
  useEffect(() => {
    const box = scroller.current;
    if (!cell || !box) return;
    const head = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const top = rows.indexOf(cell.key) * rowHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + rowHeight > box.scrollTop + box.clientHeight - head) box.scrollTop = top + rowHeight - box.clientHeight + head;
    requestAnimationFrame(() => {
      const td = box.querySelector<HTMLElement>(`td[data-lang="${cell.lang}"][data-row="${CSS.escape(cell.key)}"]`);
      const keyWidth = box.querySelector<HTMLElement>("th")?.offsetWidth ?? 0;
      if (!td) return;
      if (td.offsetLeft < box.scrollLeft + keyWidth) box.scrollLeft = td.offsetLeft - keyWidth;
      else if (td.offsetLeft + td.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = td.offsetLeft + td.offsetWidth - box.clientWidth;
    });
  }, [cell?.key, cell?.lang]);
  const spacer = (height: number) => <tr className="spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height }} /></tr>;
  return (
    <table className="grid" style={{ minWidth: 280 + 200 * languages.length }}>
      <colgroup>{columns.map((id) => <col key={id} style={widths[id] ? { width: widths[id] } : id === "key" ? { width: "30%" } : undefined} />)}</colgroup>
      <thead>
        <tr>{columns.map((id) => (
          <th key={id}>
            {id === "key" ? t("localization.key") : header(id)}
            <span className="colgrip" role="separator" aria-orientation="vertical" onMouseDown={(e) => startResize(e, id, widths, setWidths)} />
          </th>
        ))}</tr>
      </thead>
      <tbody ref={body}>
        {spacer(start * rowHeight)}
        {rows.slice(start, end).map((key) => (
          <tr key={key} data-key={key} className={isSel.has(key) ? "sel" : ""}>
            <td className="lockey" onMouseDown={(e) => (e.preventDefault(), onPickRow(key, e))}>
              <KeyLabel name={key} typeId={keyType(key)} typeName={typeName} />
            </td>
            {languages.map((lang) => {
              const v = view(lang, key);
              const here = cell?.key === key && cell.lang === lang;
              const cls = [here ? "cur" : "", !v.value ? "miss" : "", v.inherited ? "inh" : "", v.mismatch ? "ph" : ""].join(" ");
              return (
                <td key={lang} data-lang={lang} data-row={key} className={cls} onClick={() => !(here && editing) && onOpen({ key, lang })}>
                  {here && editing
                    ? <CellEditor initial={v.editValue} onDone={(value, move) => onFinish({ key, lang }, value, move)} />
                    : v.value || (lang === BASE_LANGUAGE ? "" : <span className="nomiss">{t("localization.noTranslation")}</span>)}
                </td>
              );
            })}
          </tr>
        ))}
        {spacer((rows.length - end) * rowHeight)}
      </tbody>
    </table>
  );
}

/** The in-place cell editor: Enter/Tab save and move, Ctrl+Enter saves and goes to the next missing cell, Esc cancels. */
function CellEditor({ initial, onDone }: { initial: string; onDone: (value: string | undefined, move: Move) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | undefined, move: Move) => {
    if (done.current) return;
    done.current = true;
    onDone(value, move);
  };
  return (
    <input ref={ref} className="celledit" autoFocus defaultValue={initial} spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        const value = e.currentTarget.value;
        if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), finish(undefined, "stay"));
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), finish(value, "missing"));
        else if (e.key === "Enter") (e.preventDefault(), finish(value, e.shiftKey ? "up" : "down"));
        else if (e.key === "Tab") (e.preventDefault(), finish(value, e.shiftKey ? "left" : "right"));
      }}
      onBlur={(e) => finish(e.currentTarget.value, "none")} />
  );
}

/** One line under the grid: the key, what uses it, and whether each translation keeps the source's placeholders. */
function Detail({ current, element, typeName, onOpenElement, checks }: {
  current?: string;
  element?: ElementKey;
  typeName: (typeId: string) => string;
  onOpenElement: (ref: ElementRef) => void;
  checks: { lang: string; missing: string[]; extra: string[] }[];
}) {
  if (!current) return <div className="locdetail"><span className="dim">{t("localization.selectHint")}</span></div>;
  const problems = checks.filter((c) => c.missing.length || c.extra.length);
  return (
    <div className="locdetail">
      <span className="dlabel">{t("localization.key")}</span><code className="dkey">{current}</code>
      <span className="dlabel">{t("localization.usedBy")}</span>
      {element ? (
        <span className="dused">
          <Sprite name={spriteFor(element.typeId)} size={14} />{typeName(element.typeId)}: <code>{element.id}</code>
          <button type="button" className="linkbtn" onClick={() => onOpenElement({ typeId: element.typeId, id: element.id })}>{t("localization.openElement")}</button>
        </span>
      ) : <span>{t("localization.customKey")}</span>}
      <span className="dlabel">{t("localization.placeholders")}</span>
      {problems.length
        ? <span className="warn">{problems.map((p) => [
          p.missing.length ? t("localization.phMissing", { lang: p.lang, list: p.missing.join(" ") }) : "",
          p.extra.length ? t("localization.phExtra", { lang: p.lang, list: p.extra.join(" ") }) : "",
        ].filter(Boolean).join(", ")).join(" · ")}</span>
        : <span className="dim">{t("localization.phOk")}</span>}
    </div>
  );
}

function AddKeyDialog({ keys, modId, onAdd, onCancel }: { keys: string[]; modId: string; onAdd: (key: string, value: string) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const k = key.trim();
  const taken = keys.includes(k);
  const problem = k ? keyProblem(k, modId) : undefined;
  return (
    <Dialog title={t("localization.addKey")} okLabel={t("dialog.add")} canOk={!!k && !taken && problem !== "format"} onOk={() => onAdd(k, value || k)} onCancel={onCancel}>
      <FormGroup title={t("group.entry")}>
        <FormRow label={t("localization.key")}>
          <input className="mono" autoFocus value={key} placeholder={t("localization.newKey")} onChange={(e) => setKey(e.target.value)} />
        </FormRow>
        <FormRow label={<><Flag lang={BASE_LANGUAGE} />{BASE_LANGUAGE}</>}>
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </FormRow>
      </FormGroup>
      {taken && <p className="error-text">{t("localization.keyExists")}</p>}
      {!taken && problem === "format" && <p className="error-text">{t("localization.keyFormat")}</p>}
      {!taken && problem === "namespace" && <p className="warn-text">{t("localization.keyNamespace", { mod: modId })}</p>}
    </Dialog>
  );
}

/** "Türkçe (tr_tr)": Minecraft's name for the code, or the code alone. */
const languageLabel = (code: string) => (MINECRAFT_LANGUAGES[code] ? `${MINECRAFT_LANGUAGES[code]} (${code})` : code);

/** A searchable list of Minecraft's languages the project does not have, plus "start from" another language. */
function AddLanguageDialog({ languages, onAdd, onCancel }: { languages: string[]; onAdd: (code: string, copyFrom?: string) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const q = query.trim().toLowerCase();
  const choices = Object.entries(MINECRAFT_LANGUAGES).filter(([c, name]) => !languages.includes(c) && (!q || c.includes(q) || name.toLowerCase().includes(q)));
  // A code Minecraft's list does not have can still be typed in full.
  const typed = LANGUAGE_CODE.test(q) && !languages.includes(q) && !MINECRAFT_LANGUAGES[q] ? q : undefined;
  return (
    <Dialog title={t("localization.addLanguage")} okLabel={t("dialog.add")} canOk={!!code} onOk={() => onAdd(code, copyFrom || undefined)} onCancel={onCancel}>
      <FormGroup title={t("group.language")}>
        <FormRow label={t("localization.findLanguage")}>
          <input autoFocus value={query} placeholder={t("localization.languageCode")} onChange={(e) => setQuery(e.target.value)} />
        </FormRow>
        <div className="langpick" role="listbox">
          {typed && (
            <button type="button" role="option" aria-selected={code === typed} className={code === typed ? "on" : ""} onClick={() => setCode(typed)}>
              <Flag lang={typed} /><code>{typed}</code><span>{t("localization.otherCode")}</span>
            </button>
          )}
          {choices.map(([c, name]) => (
            <button type="button" role="option" key={c} data-code={c} aria-selected={code === c} className={code === c ? "on" : ""}
              onClick={() => setCode(c)} onDoubleClick={() => onAdd(c, copyFrom || undefined)}>
              <Flag lang={c} /><code>{c}</code><span>{name}</span>
            </button>
          ))}
        </div>
        <FormRow label={t("localization.copyFrom")}>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">{t("localization.startEmpty")}</option>
            {languages.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
          </select>
        </FormRow>
      </FormGroup>
    </Dialog>
  );
}

function RenameLanguageDialog({ languages, onRename, onCancel }: { languages: string[]; onRename: (from: string, to: string) => void; onCancel: () => void }) {
  const targets = languages.filter((l) => l !== BASE_LANGUAGE);
  const [from, setFrom] = useState(targets[0]);
  const [to, setTo] = useState("");
  const valid = LANGUAGE_CODE.test(to) && !languages.includes(to);
  return (
    <Dialog title={t("localization.renameLanguage")} okLabel={t("action.rename")} canOk={valid} onOk={() => onRename(from, to)} onCancel={onCancel}>
      <FormGroup title={t("group.language")}>
        <FormRow label={t("localization.language")}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {targets.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("localization.newCode")}>
          <input className="mono" autoFocus value={to} placeholder={t("localization.languageCode")} onChange={(e) => setTo(e.target.value.toLowerCase())} />
        </FormRow>
      </FormGroup>
      {to && !valid && <p className="error-text">{t(languages.includes(to) ? "localization.codeTaken" : "localization.codeFormat")}</p>}
    </Dialog>
  );
}

function RemoveLanguageDialog({ languages, texts, onRemove, onCancel }: {
  languages: string[];
  texts: (code: string) => number;
  onRemove: (code: string) => void;
  onCancel: () => void;
}) {
  const targets = languages.filter((l) => l !== BASE_LANGUAGE);
  const [code, setCode] = useState(targets[0]);
  return (
    <Dialog title={t("localization.removeLanguage")} okLabel={t("action.remove")} canOk onOk={() => onRemove(code)} onCancel={onCancel} explicit danger>
      <FormGroup title={t("group.language")}>
        <FormRow label={t("localization.language")}>
          <select autoFocus value={code} onChange={(e) => setCode(e.target.value)}>
            {targets.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
          </select>
        </FormRow>
      </FormGroup>
      <p className="warn-text">{t("localization.removeConfirm", { lang: languageLabel(code), count: texts(code), file: `localization/${code}.json` })}</p>
    </Dialog>
  );
}

type Rows = "all" | "listed" | "selected";

/** Export: CSV of chosen languages or one language as lang JSON, for all keys, the listed rows or the selection. */
function ExportDialog({ languages, counts, onExport, onCancel }: {
  languages: string[];
  counts: Record<Rows, number>;
  onExport: (format: "csv" | "json", languages: string[], rows: Rows) => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [chosen, setChosen] = useState(languages);
  const [single, setSingle] = useState(languages.find((l) => l !== BASE_LANGUAGE) ?? BASE_LANGUAGE);
  const [rows, setRows] = useState<Rows>("all");
  const langs = format === "csv" ? languages.filter((l) => chosen.includes(l)) : [single];
  return (
    <Dialog title={t("localization.exportTitle")} okLabel={t("localization.exportOk")} canOk={langs.length > 0 && counts[rows] > 0}
      onOk={() => onExport(format, langs, rows)} onCancel={onCancel}>
      <FormGroup title={t("localization.export")}>
        <FormRow label={t("localization.format")}>
          <select autoFocus value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
            <option value="csv">{t("localization.formatCsv")}</option>
            <option value="json">{t("localization.formatJson")}</option>
          </select>
        </FormRow>
        <FormRow label={format === "csv" ? t("localization.languagesLabel") : t("localization.language")} top={format === "csv"}>
          {format === "csv" ? (
            <div className="check-list">
              {languages.map((l) => (
                <label key={l} className="check">
                  <input type="checkbox" data-lang={l} checked={chosen.includes(l)}
                    onChange={() => setChosen(chosen.includes(l) ? chosen.filter((c) => c !== l) : [...chosen, l])} />
                  <Flag lang={l} />{languageLabel(l)}
                </label>
              ))}
            </div>
          ) : (
            <select value={single} onChange={(e) => setSingle(e.target.value)}>
              {languages.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
            </select>
          )}
        </FormRow>
        <FormRow label={t("localization.rows")}>
          <select value={rows} onChange={(e) => setRows(e.target.value as Rows)}>
            <option value="all">{t("localization.rowsAll", { count: counts.all })}</option>
            <option value="listed" disabled={!counts.listed}>{t("localization.rowsListed", { count: counts.listed })}</option>
            <option value="selected" disabled={!counts.selected}>{t("localization.rowsSelected", { count: counts.selected })}</option>
          </select>
        </FormRow>
      </FormGroup>
    </Dialog>
  );
}

/** Import preview: what each language gains or changes, and keys the project does not have, before anything is written. */
function ImportDialog({ file, languages, plan, onApply, onCancel }: {
  file: { path: string; text: string };
  languages: string[];
  plan: (incoming: Incoming) => ReturnType<typeof planImport>;
  onApply: (incoming: Incoming, addUnknown: boolean) => void;
  onCancel: () => void;
}) {
  const isJson = /\.json$/i.test(file.path);
  const [language, setLanguage] = useState(languageOfFile(file.path) ?? languages.find((l) => l !== BASE_LANGUAGE) ?? BASE_LANGUAGE);
  const [addUnknown, setAddUnknown] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isJson) listRef.current?.focus();
  }, [isJson]);
  let incoming: Incoming | undefined;
  let error = "";
  try {
    incoming = isJson ? jsonTranslations(file.text, language) : csvTranslations(file.text);
  } catch (e) {
    error = (e as Error).message;
  }
  const preview = incoming ? plan(incoming) : undefined;
  const writes = preview ? preview.changes.filter((c) => c.kind !== "unknown" || addUnknown).length : 0;
  return (
    <Dialog title={t("localization.importTitle")} okLabel={t("localization.importOk", { count: writes })} canOk={!!preview && writes > 0}
      onOk={() => incoming && onApply(incoming, addUnknown)} onCancel={onCancel}>
      <FormGroup title={t("localization.import")}>
        <FormRow label={t("localization.file")}><div className="fval mono importfile" title={file.path}>{file.path.replace(/^.*[\\/]/, "")}</div></FormRow>
        {isJson && (
          <FormRow label={t("localization.language")}>
            <select autoFocus value={language} onChange={(e) => setLanguage(e.target.value)}>
              {[...new Set([language, ...languages])].map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
            </select>
          </FormRow>
        )}
      </FormGroup>
      {error && <p className="error-text">{t("localization.importError", { error })}</p>}
      {preview && (
        <>
          <table className="importsum">
            <thead><tr><th>{t("localization.language")}</th><th>{t("localization.added")}</th><th>{t("localization.changed")}</th><th>{t("localization.unchanged")}</th></tr></thead>
            <tbody>
              {preview.languages.map((l) => (
                <tr key={l.code} data-lang={l.code}>
                  <td><Flag lang={l.code} /> <code>{l.code}</code>{l.isNew && <span className="dim"> {t("localization.newLanguage")}</span>}</td>
                  <td>{l.added}</td><td>{l.changed}</td><td>{l.unchanged}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.unknownKeys.length > 0 && (
            <label className="check importunknown">
              <input type="checkbox" checked={addUnknown} onChange={(e) => setAddUnknown(e.target.checked)} />
              {t("localization.addUnknown", { count: preview.unknownKeys.length })}
            </label>
          )}
          {/* Focus starts in the list (scrollable by keyboard), so Escape reaches the dialog. */}
          <div ref={listRef} className="importchanges" tabIndex={0}>
            {preview.changes.filter((c) => c.kind !== "unknown" || addUnknown).slice(0, 200).map((c) => (
              <div key={`${c.language}|${c.key}`} className={`ichange ${c.kind}`}>
                <code>{c.language}</code><code className="ikey">{c.key}</code>
                <span className="ifrom">{c.from}</span><span className="ito">{c.to}</span>
              </div>
            ))}
            {writes === 0 && <p className="dim">{t("localization.nothingToImport")}</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Language columns hidden in this project, kept on this computer in the app state (the language stays in the project). */
function useHiddenLanguages(dir: string): [string[], (next: string[]) => void] {
  const [hidden, set] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void api.hiddenLanguages(dir).then((codes) => live && set(codes));
    return () => void (live = false);
  }, [dir]);
  return [hidden, (next) => (set(next), void api.setHiddenLanguages(dir, next))];
}
