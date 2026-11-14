import { useEffect, useMemo, useRef, useState } from "react";
import { useViewState } from "../hooks/useViewState.ts";
import { addFolder, elementKey, folderName, moveElements, NO_FOLDERS, parentFolder, moveFolder, removeFolder, renameFolder, setFolderColor, setFolderIcon, FOLDER_ICONS, subfolders, type ProjectFolders } from "../../../../src/ir/folders.ts";
import type { Coverage, ProjectSnapshot, TaskSource } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { deleteElement, duplicateElement } from "../elementActions.ts";
import { allElements, elementName, elementTexture, findElement, issuesFor, type ElementRef } from "../model.ts";
import { t } from "../strings.ts";
import { typeGenerated, typeOf } from "../types.ts";
import { ELEMENT_DRAG, ElementTile } from "./ElementTile.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { NewElementPopup } from "./NewElementPopup.tsx";
import { ReferencesDialog } from "./ReferencesDialog.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { UnlockCodeDialog } from "./LockedCodeDialog.tsx";
import type { LockedFileChange } from "../../../../src/generator/lockedCode.ts";
import { ActionBar, ActionButton, ContextMenu, DataTable, FindBar, FindSelect, Separator, type MenuItem } from "./ui.tsx";

/**
 * Folder colours the menu offers: Minecraft's 16 dye colours (KUYRUK 178; a folder keeps any "#rrggbb" an agent sets,
 * and the earlier eight still show).
 */
const FOLDER_COLORS = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"] as const;
const COLOR_VALUE: Record<(typeof FOLDER_COLORS)[number], string> = {
  white: "#f9fffe", light_gray: "#9d9d97", gray: "#474f52", black: "#1d1d21", brown: "#835432", red: "#b02e26", orange: "#f9801d", yellow: "#fed83d",
  lime: "#80c71f", green: "#5e7c16", cyan: "#169c9c", light_blue: "#3ab3da", blue: "#3c44aa", purple: "#8932b8", magenta: "#c74ebd", pink: "#f38baa",
};

/** Drag data of a folder tile (KUYRUK 175); the path being dragged is kept too, as drag-over cannot read the data. */
const FOLDER_DRAG = "application/x-mcedge-folder";
let draggedFolder: string | undefined;
/** Whether the dragged folder may go into `target` ("" is the top): not into itself, its subfolders or where it is. */
const folderFits = (target: string) => draggedFolder === undefined
  || (target !== parentFolder(draggedFolder) && target !== draggedFolder && !target.startsWith(`${draggedFolder}/`));

/** The right-click menu: on a folder or an element, in its main list or the Move / Colour list. */
interface Menu {
  x: number;
  y: number;
  target: { folder: string } | { element: ElementRef };
  page: "main" | "move" | "color" | "icon";
}

/** "all", an element type id, or a problem filter: "@problems" (elements with problems), "@notgenerated" (types the engine does not generate). */
type Filter = string;
type Sort = "type" | "name";
type View = "tiles" | "details";

/** Tiles or the Details table (KUYRUK 129), remembered in the app state; kept here so a remount shows it at once. */
const VIEW_KEY = "elements.view";
let lastView: View | undefined;

interface Props {
  snapshot: ProjectSnapshot;
  coverage?: Coverage;
  engineName: string;
  selected?: ElementRef;
  /** Texture path; when set only elements using it are shown ("Search usages" from Resources). */
  usage?: string;
  onSelect: (ref: ElementRef | undefined) => void;
  onOpen: (ref: ElementRef) => void;
  onChanged: (snapshot: ProjectSnapshot) => void;
  onClearUsage: () => void;
  /** "typeId/id" of elements an AI agent changed moments ago. */
  live?: Set<string>;
  /** "typeId/id" of the element the agent works on right now. */
  agentOn?: string;
  /** Right-click > New task for the agent (KUYRUK 146). */
  onNewTask?: (source: TaskSource) => void;
  /** Ctrl+N asked for the New popup (KUYRUK 128); cleared through onNewHandled once it is open. */
  newRequest?: boolean;
  onNewHandled?: () => void;
}

/** Mod elements: the section toolbar (New first, Delete last) over dense, selectable tiles. */
export function Workspace({ snapshot, coverage, engineName, selected, usage, onSelect, onOpen, onChanged, onClearUsage, live, agentOn, onNewTask, newRequest, onNewHandled }: Props) {
  // Kept while an element editor is open, so coming back shows the same list (per project).
  const [filter, setFilter] = useViewState<Filter>(snapshot.dir, "filter", "all");
  const [sort, setSort] = useViewState<Sort>(snapshot.dir, "sort", "type");
  const [query, setQuery] = useViewState(snapshot.dir, "query", "");
  const [creating, setCreating] = useState(false);
  const [view, setViewState] = useState<View>(lastView ?? "tiles");
  useEffect(() => {
    if (!lastView) void api.uiState(VIEW_KEY).then((saved) => saved === "details" && setViewState((lastView = "details")));
  }, []);
  const setView = (next: View) => {
    lastView = next;
    setViewState(next);
    void api.setUiState(VIEW_KEY, next);
  };
  /** Open folder; "" is the top. */
  const [folder, setFolder] = useViewState(snapshot.dir, "folder", "");
  const [pickedFolder, setPickedFolder] = useState<string>();
  /** Inline folder name box: a new folder, or the folder being renamed. */
  const [naming, setNaming] = useState<{ rename?: string; value: string }>();
  const [menu, setMenu] = useState<Menu>();
  const [folderError, setFolderError] = useState("");
  /** The toolbar's Move: its menu opens under it (KUYRUK 175). */
  const moveButton = useRef<HTMLSpanElement>(null);
  /** Find usages dialog target, and the "typeId/id" keys of elements nothing uses while that filter is on. */
  const [usagesOf, setUsagesOf] = useState<ElementRef>();
  const [renaming, setRenaming] = useState<ElementRef>();
  /** Unlock of an element whose locked files were edited: waits for the user to confirm (KUYRUK 131). */
  const [unlocking, setUnlocking] = useState<{ ref: ElementRef; changes: LockedFileChange[] }>();
  /** Keys of the elements selected with Ctrl or Shift (the primary selection is always among them). */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [unused, setUnused] = useViewState<Set<string> | undefined>(snapshot.dir, "unused", undefined);

  const state = snapshot.project.folders ?? NO_FOLDERS;
  // Searching and filtering look through every folder; the Details table lists every folder with a Folder column.
  const browsing = !query.trim() && filter === "all" && !usage && !unused && view === "tiles";
  const open = state.folders.includes(folder) ? folder : "";
  const saveFolders = async (change: (s: ProjectFolders) => ProjectFolders) => {
    try {
      onChanged(await api.saveFolders(snapshot.dir, change(state)));
      setFolderError("");
    } catch (e) {
      setFolderError((e as Error).message);
    }
  };
  const finishNaming = async () => {
    const value = naming?.value.trim();
    if (value) await saveFolders((s) => (naming?.rename ? renameFolder(s, naming.rename, value) : addFolder(s, open, value)));
    setNaming(undefined);
  };
  const moveTo = (keys: string[], target: string) => saveFolders((s) => moveElements(s, keys, target));
  const moveFolderTo = (path: string, target: string) => saveFolders((s) => moveFolder(s, path, target));
  /** What a folder tile or a breadcrumb part does with a drop: an element (with the selection) or a folder goes into `target`. */
  const dropInto = (target: string) => (data: DataTransfer) => {
    const key = data.getData(ELEMENT_DRAG);
    const path = data.getData(FOLDER_DRAG);
    if (key) void moveTo(chosen.includes(key) ? chosen : [key], target);
    else if (path && path !== target && !target.startsWith(`${path}/`) && parentFolder(path) !== target) void moveFolderTo(path, target);
  };
  // The unused filter follows the project while it is on.
  useEffect(() => {
    if (!unused) return;
    void api.unusedElements(snapshot.dir).then((report) => setUnused(new Set(report.unused.map((u) => elementKey(u.type, u.id)))));
  }, [snapshot]);

  const tiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = allElements(snapshot).filter(({ typeId, element }) =>
      (!browsing || (state.placement[elementKey(typeId, element.id)] ?? "") === open)
      && (filter === "all" || filter === typeId
        || (filter === "@problems" && issuesFor(snapshot, { typeId, id: element.id }).length > 0)
        || (filter === "@notgenerated" && typeGenerated(coverage, typeId) === "no"))
      && (!q || elementName(typeId, element).toLowerCase().includes(q) || element.id.includes(q))
      && (!usage || elementTexture(snapshot, typeId, element) === usage)
      && (!unused || unused.has(elementKey(typeId, element.id))));
    return sort === "name" ? list.sort((a, b) => elementName(a.typeId, a.element).localeCompare(elementName(b.typeId, b.element))) : list;
  }, [snapshot, filter, sort, query, usage, unused, browsing, open, state, coverage]);

  // The selection is what is picked and still shown (an element in another folder or filtered out is not selected here).
  const shown = new Set(tiles.map((tile) => elementKey(tile.typeId, tile.element.id)));
  const current = selected && findElement(snapshot, selected) && shown.has(elementKey(selected.typeId, selected.id)) ? selected : undefined;
  const currentElement = current && findElement(snapshot, current);
  const currentKey = current && elementKey(current.typeId, current.id);
  const chosen = currentKey && picked.has(currentKey) ? [...picked].filter((key) => shown.has(key)) : currentKey ? [currentKey] : [];
  const several = chosen.length > 1;
  const choose = (ref: ElementRef, event?: React.MouseEvent) => {
    const key = elementKey(ref.typeId, ref.id);
    setPickedFolder(undefined);
    if (event && (event.ctrlKey || event.metaKey)) {
      const next = new Set(chosen);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setPicked(next);
      const primary = next.has(key) ? ref : [...next].map((k) => allElements(snapshot).find((e) => elementKey(e.typeId, e.element.id) === k)).filter(Boolean).map((e) => ({ typeId: e!.typeId, id: e!.element.id }))[0];
      onSelect(primary);
    } else if (event?.shiftKey && currentKey) {
      const keys = tiles.map((tile) => elementKey(tile.typeId, tile.element.id));
      const [a, b] = [keys.indexOf(currentKey), keys.indexOf(key)].sort((x, y) => x - y);
      setPicked(new Set(a < 0 ? [key] : keys.slice(a, b + 1)));
    } else {
      setPicked(new Set([key]));
      onSelect(ref);
    }
  };
  const duplicate = async () => {
    if (!current || several) return;
    const [next, copy] = await duplicateElement(snapshot, current);
    onChanged(next);
    onSelect(copy);
  };
  const isLocked = (ref: ElementRef) => snapshot.locked.includes(`${ref.typeId}/${ref.id}`);
  const lockCode = async (ref: ElementRef) => onChanged(await api.lockCode(snapshot.dir, ref.typeId, ref.id));
  const unlockCode = async (ref: ElementRef, force = false) => {
    const result = await api.unlockCode(snapshot.dir, ref.typeId, ref.id, force);
    if (result.snapshot) (setUnlocking(undefined), onChanged(result.snapshot));
    else setUnlocking({ ref, changes: result.changes });
  };
  const remove = async () => {
    const next = current && !several && (await deleteElement(snapshot, current));
    if (next) (onChanged(next), onSelect(undefined));
  };

  useEffect(() => {
    if (newRequest) (setCreating(true), onNewHandled?.());
  }, [newRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  // Enter opens, F2 renames and Delete deletes the selected element (or folder) while the focus is on the list, not in a
  // field, menu or dialog (KUYRUK 128).
  const keys = useRef({ current, several, pickedFolder, remove, onOpen, saveFolders });
  keys.current = { current, several, pickedFolder, remove, onOpen, saveFolders };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || !["Enter", "F2", "Delete"].includes(e.key)) return;
      const target = e.target as HTMLElement;
      const inTable = !!target.closest?.(".elemtable");
      // The Details table opens on Enter itself (DataTable onActivate).
      const onList = target === document.body || !!target.closest?.(".tiles") || (inTable && e.key !== "Enter");
      if (!onList || document.querySelector(".backdrop, .addpop, .menulist")) return;
      const k = keys.current;
      if (k.pickedFolder) {
        if (e.key === "Enter") setFolder(k.pickedFolder), setPickedFolder(undefined);
        else if (e.key === "F2") setNaming({ rename: k.pickedFolder, value: folderName(k.pickedFolder) });
        else void k.saveFolders((s) => removeFolder(s, k.pickedFolder!)), setPickedFolder(undefined);
      } else if (k.current && !k.several) {
        if (e.key === "Enter") k.onOpen(k.current);
        else if (e.key === "F2") setRenaming(k.current);
        else void k.remove();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Items of the open right-click menu. */
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const sub = (page: Menu["page"]) => () => setMenu({ ...menu, page });
    const folderTarget = "folder" in menu.target ? menu.target.folder : undefined;
    if (menu.page === "move") {
      if (folderTarget !== undefined) {
        const into = (path: string) => () => void moveFolderTo(folderTarget, path);
        const targets = ["", ...[...state.folders].sort()].filter((path) => path !== parentFolder(folderTarget) && path !== folderTarget && !path.startsWith(`${folderTarget}/`));
        return targets.map((path) => ({ label: path || t("folders.top"), onClick: into(path) }));
      }
      const to = (path: string) => () => void moveTo(chosen, path);
      return [
        { label: t("folders.top"), onClick: to("") },
        ...[...state.folders].sort().map((path) => ({ label: path, onClick: to(path) })),
      ];
    }
    if (menu.page === "color" && folderTarget !== undefined) {
      const paint = (color: string) => () => void saveFolders((s) => setFolderColor(s, folderTarget, color));
      return [
        { label: t("folders.colorNone"), swatch: "", checked: !state.colors?.[folderTarget], onClick: paint("") },
        ...FOLDER_COLORS.map((name) => ({ label: t(`folders.color.${name}`), swatch: COLOR_VALUE[name], checked: state.colors?.[folderTarget] === COLOR_VALUE[name], onClick: paint(COLOR_VALUE[name]) })),
      ];
    }
    if (menu.page === "icon" && folderTarget !== undefined) {
      const pick = (icon: string) => () => void saveFolders((s) => setFolderIcon(s, folderTarget, icon));
      const tint = state.colors?.[folderTarget];
      const now = state.icons?.[folderTarget] ?? "";
      return [
        { label: t("folders.icon.folder"), icon: "folder", iconColor: tint, checked: !now, onClick: pick("") },
        ...FOLDER_ICONS.map((name) => ({ label: t(`folders.icon.${name}`), icon: name as IconName, iconColor: tint, checked: now === name, onClick: pick(name) })),
      ];
    }
    if (folderTarget !== undefined) {
      return [
        { label: t("folders.open"), onClick: () => (setFolder(folderTarget), setPickedFolder(undefined)) },
        { label: t("rename.button"), onClick: () => setNaming({ rename: folderTarget, value: folderName(folderTarget) }) },
        { label: t("folders.color"), keepOpen: true, onClick: sub("color") },
        { label: t("folders.icon"), keepOpen: true, onClick: sub("icon") },
        { label: t("folders.move"), keepOpen: true, onClick: sub("move") },
        { label: "", separator: true },
        { label: t("action.delete"), danger: true, onClick: () => (void saveFolders((s) => removeFolder(s, folderTarget)), setPickedFolder(undefined)) },
      ];
    }
    return [
      { label: t("action.edit"), onClick: current && !several ? () => onOpen(current) : undefined },
      { label: t("action.duplicate"), onClick: current && !several ? duplicate : undefined },
      { label: t("rename.button"), onClick: current && !several ? () => setRenaming(current) : undefined },
      { label: t("refs.find"), onClick: current && !several ? () => setUsagesOf(current) : undefined },
      current && !several && isLocked(current)
        ? { label: t("lock.unlock"), onClick: () => void unlockCode(current) }
        : { label: t("lock.lock"), onClick: current && !several ? () => void lockCode(current) : undefined },
      { label: t("folders.move"), keepOpen: true, onClick: state.folders.length ? sub("move") : undefined },
      { label: t("newTask.menu"), onClick: current && !several && onNewTask ? () => onNewTask({ kind: "element", target: `${current.typeId}/${current.id}` }) : undefined },
      { label: "", separator: true },
      { label: t("action.delete"), danger: true, onClick: current && !several ? remove : undefined },
    ];
  };

  const total = allElements(snapshot).length;
  // Browsing counts every element under the shown folder (also those in its subfolders), not only the tiles at this level.
  const underOpen = browsing
    ? allElements(snapshot).filter(({ typeId, element }) => {
        const where = state.placement[elementKey(typeId, element.id)] ?? "";
        return !open || where === open || where.startsWith(`${open}/`);
      }).length
    : tiles.length;
  const folderTiles = browsing ? subfolders(state, open) : [];
  // A selected folder that moved away or is not shown here any more is no longer selected, so Move and Delete never act
  // on a folder the user cannot see (KUYRUK 175, as 142).
  useEffect(() => {
    if (pickedFolder && !folderTiles.includes(pickedFolder)) setPickedFolder(undefined);
  }, [pickedFolder, folderTiles.join("\n")]);
  return (
    <section className="view">
      <FindBar query={query} onQuery={setQuery} placeholder={t("workspace.search")}
        meta={t("workspace.count", { count: underOpen, total })}>
        <FindSelect icon="filter" label={t("find.filter")} value={filter} onChange={setFilter} options={[
          { value: "all", label: t("workspace.filter.all") },
          { value: "@problems", label: t("workspace.filter.problems") },
          { value: "@notgenerated", label: t("workspace.filter.notGenerated") },
          ...Object.keys(snapshot.project.elements)
            .map((typeId) => ({ value: typeId, label: typeOf(typeId)?.name ?? typeId }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ]} />
        <FindSelect icon="sort" label={t("find.sort")} value={sort} onChange={setSort} options={[
          { value: "type", label: t("sort.type") },
          { value: "name", label: t("sort.name") },
        ]} />
        <FindSelect icon={view === "details" ? "table" : "tiles"} label={t("find.view")} value={view} onChange={setView} options={[
          { value: "tiles", label: t("workspace.view.tiles") },
          { value: "details", label: t("workspace.view.details") },
        ]} />
      </FindBar>
      <ActionBar>
        <ActionButton icon="plus" label={t("action.new")} tone="primary" pressed={creating} onClick={() => setCreating(!creating)} />
        <ActionButton icon="folder" label={t("folders.new")} onClick={() => setNaming({ value: "" })} />
        <Separator />
        <ActionButton icon="edit" label={t("action.edit")} disabled={(!current || several) && !pickedFolder}
          onClick={() => (pickedFolder ? setNaming({ rename: pickedFolder, value: folderName(pickedFolder) }) : current && onOpen(current))} />
        <ActionButton icon="dup" label={t("action.duplicate")} disabled={!current || several} onClick={duplicate} />
        <span ref={moveButton} className="movebtn">
          <ActionButton icon="folder" label={t("folders.move")} disabled={!pickedFolder && (!current || !state.folders.length)}
            onClick={() => {
              const r = moveButton.current!.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2, target: pickedFolder ? { folder: pickedFolder } : { element: current! }, page: "move" });
            }} />
        </span>
        <ActionButton icon="warn" label={t("refs.unused")} pressed={!!unused}
          onClick={() => (unused ? setUnused(undefined) : void api.unusedElements(snapshot.dir).then((report) => setUnused(new Set(report.unused.map((u) => elementKey(u.type, u.id))))))} />
        <Separator />
        <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" disabled={(!current || several) && !pickedFolder}
          onClick={() => (pickedFolder ? (void saveFolders((s) => removeFolder(s, pickedFolder)), setPickedFolder(undefined)) : remove())} />
      </ActionBar>
      <div className="wsbody">
        <div className="tarea">
          <div className="crumbrow">
            <Icon name="folder" size={14} />
            <span className="crumb">
              <CrumbDrop path="" onDrop={dropInto("")}>
                <button className="linkbtn" onClick={() => setFolder("")}>{snapshot.project.mod.id}</button>
              </CrumbDrop>
              {browsing && open.split("/").filter(Boolean).map((part, i, parts) => (
                <span key={i}> / <CrumbDrop path={parts.slice(0, i + 1).join("/")} onDrop={dropInto(parts.slice(0, i + 1).join("/"))}>
                  <button className="linkbtn" onClick={() => setFolder(parts.slice(0, i + 1).join("/"))}>{part}</button>
                </CrumbDrop></span>
              ))}
              {!browsing && <> / <b>{filter === "all" ? t("workspace.allElements") : filter === "@problems" ? t("workspace.filter.problems")
                : filter === "@notgenerated" ? t("workspace.filter.notGenerated") : typeOf(filter)?.name ?? filter}</b></>}
            </span>
            {naming && (
              <input className="foldername" autoFocus value={naming.value} placeholder={t("folders.name")} spellCheck={false}
                onChange={(e) => setNaming({ ...naming, value: e.target.value })} onBlur={() => void finishNaming()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void finishNaming();
                  if (e.key === "Escape") setNaming(undefined);
                }} />
            )}
            {folderError && <span className="usage">{folderError}</span>}
            {unused && <span className="usage" data-testid="unused-note">{t("refs.unusedShown", { count: unused.size })}</span>}
            {usage && (
              <span className="usage">
                {t("workspace.usingTexture")} <code>{usage}</code>
                <button className="linkbtn" onClick={onClearUsage}>{t("workspace.clearUsage")}</button>
              </span>
            )}
            <span className="selinfo">
              {t("workspace.selected")}{" "}
              {several ? <b>{t("workspace.selectedMany", { count: chosen.length })}</b> : currentElement && current ? <><b>{elementName(current.typeId, currentElement)}</b> · {typeOf(current.typeId)?.name}</> : <span>{t("workspace.none")}</span>}
            </span>
            {snapshot.needsMigration && <span className="usage" title={t("workspace.migrationHint")}>{t("workspace.migration")}</span>}
          </div>
          {view === "details" ? (
            <div className="elemtable">
              <DataTable rows={tiles} rowKey={({ typeId, element }) => elementKey(typeId, element.id)} resizeKey="elements"
                selected={currentKey} empty={t("workspace.empty")}
                onSelect={(key) => {
                  const row = tiles.find((r) => elementKey(r.typeId, r.element.id) === key);
                  if (row) choose({ typeId: row.typeId, id: row.element.id });
                }}
                onActivate={(key) => {
                  const row = tiles.find((r) => elementKey(r.typeId, r.element.id) === key);
                  if (row) onOpen({ typeId: row.typeId, id: row.element.id });
                }}
                columns={[
                  { id: "name", label: t("workspace.col.name"), width: "24%", cell: ({ typeId, element }) => <b>{elementName(typeId, element)}</b> },
                  { id: "type", label: t("workspace.col.type"), width: "14%", cell: ({ typeId }) => typeOf(typeId)?.name ?? typeId },
                  { id: "id", label: t("workspace.col.id"), width: "20%", cell: ({ element }) => <code>{element.id}</code> },
                  { id: "folder", label: t("workspace.col.folder"), width: "18%", cell: ({ typeId, element }) => <span className="dim">{state.placement[elementKey(typeId, element.id)] || "—"}</span> },
                  { id: "problems", label: t("workspace.col.problems"), width: "10%", cell: ({ typeId, element }) => {
                    const count = issuesFor(snapshot, { typeId, id: element.id }).length;
                    return count ? <span className="probcount" data-problems={count}><Icon name="warn" size={12} /> {count}</span> : <span className="dim" data-problems={0}>0</span>;
                  } },
                  { id: "generated", label: t("workspace.col.generated"), cell: ({ typeId }) => typeGenerated(coverage, typeId) === "no"
                    ? <span className="tnocode">{t("editor.notGenerated")}</span> : <span className="dim">{t("workspace.generatedYes")}</span> },
                ]} />
            </div>
          ) : tiles.length === 0 && !folderTiles.length ? (
            <p className="empty-note">{t("workspace.empty")}</p>
          ) : (
            <div className="tiles" role="listbox" aria-label={t("section.elements")}>
              {browsing && open && (
                <FolderTile name={t("folders.up")} target={parentFolder(open)} onSelect={() => undefined} onOpen={() => setFolder(parentFolder(open))}
                  onDrop={dropInto(parentFolder(open))} />
              )}
              {folderTiles.map((path) => (
                <FolderTile key={path} name={folderName(path)} path={path} target={path} color={state.colors?.[path]} icon={state.icons?.[path]} selected={pickedFolder === path}
                  onSelect={() => (setPickedFolder(path), onSelect(undefined))}
                  onOpen={() => (setFolder(path), setPickedFolder(undefined))} onDrop={dropInto(path)}
                  onMenu={(e) => (setPickedFolder(path), onSelect(undefined), setMenu({ x: e.clientX, y: e.clientY, target: { folder: path }, page: "main" }))} />
              ))}
              {tiles.map(({ typeId, element }) => {
                const ref = { typeId, id: element.id };
                return (
                  <ElementTile key={`${typeId}:${element.id}`} snapshot={snapshot} typeId={typeId} element={element}
                    noCode={typeGenerated(coverage, typeId) === "no"} locked={isLocked(ref)} live={live?.has(`${typeId}/${element.id}`)} agentHere={agentOn === `${typeId}/${element.id}`}
                    selected={chosen.includes(elementKey(typeId, element.id))} onSelect={(event) => choose(ref, event)} onOpen={() => onOpen(ref)}
                    onDelete={remove}
                    onMenu={(e) => (chosen.includes(elementKey(typeId, element.id)) || choose(ref), setMenu({ x: e.clientX, y: e.clientY, target: { element: ref }, page: "main" }))} />
                );
              })}
            </div>
          )}
        </div>
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(undefined)} />}
        {usagesOf && <ReferencesDialog snapshot={snapshot} target={usagesOf} onClose={() => setUsagesOf(undefined)} onOpen={(ref) => (setUsagesOf(undefined), onSelect(ref), onOpen(ref))} />}
        {renaming && (
          <RenameDialog snapshot={snapshot} target={renaming} onCancel={() => setRenaming(undefined)}
            onRenamed={(next, ref) => (setRenaming(undefined), onChanged(next), onSelect(ref))} />
        )}
        {unlocking && (
          <UnlockCodeDialog name={elementName(unlocking.ref.typeId, findElement(snapshot, unlocking.ref)!)} changes={unlocking.changes}
            onUnlock={() => void unlockCode(unlocking.ref, true)} onCancel={() => setUnlocking(undefined)} />
        )}
        {creating && (
          <NewElementPopup snapshot={snapshot} coverage={coverage} engineName={engineName} onCancel={() => setCreating(false)}
            onCreated={(next, ref) => (setCreating(false), onChanged(next), onSelect(ref), onOpen(ref))} />
        )}
      </div>
    </section>
  );
}

/** A breadcrumb part that takes dropped elements and folders (KUYRUK 175). */
function CrumbDrop({ path, onDrop, children }: { path: string; onDrop: (data: DataTransfer) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <span className={`crumbdrop ${over ? "dropping" : ""}`} data-path={path}
      onDragOver={(e) => folderFits(path) && (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), onDrop(e.dataTransfer))}>
      {children}
    </span>
  );
}

/**
 * A folder in the tile grid: double-click opens it; elements and other folders dropped on it move inside, and a folder
 * tile (not Back) is dragged itself (KUYRUK 175).
 */
function FolderTile({ name, path, target, color, icon, selected, onSelect, onOpen, onDrop, onMenu }: {
  name: string;
  /** The folder's path, when the tile can be dragged (not the Back tile). */
  path?: string;
  /** Where a drop on the tile moves things to. */
  target: string;
  /** "#rrggbb" of the folder icon, when it has one. */
  color?: string;
  /** One of FOLDER_ICONS in place of the folder icon (KUYRUK 178). */
  icon?: string;
  selected?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDrop: (data: DataTransfer) => void;
  /** Right click: the context menu (not for the Back tile). */
  onMenu?: (event: React.MouseEvent) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button className={`tile foldertile ${selected ? "sel" : ""} ${over ? "dropping" : ""}`} onClick={onSelect} onDoubleClick={onOpen}
      data-folder={path} draggable={!!path}
      onDragStart={path ? (e) => ((draggedFolder = path), e.dataTransfer.setData(FOLDER_DRAG, path), (e.dataTransfer.effectAllowed = "move")) : undefined}
      onDragEnd={() => (draggedFolder = undefined)}
      onContextMenu={onMenu && ((e) => (e.preventDefault(), onMenu(e)))}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onOpen())}
      onDragOver={(e) => folderFits(target) && (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        draggedFolder = undefined;
        onDrop(e.dataTransfer);
      }}>
      <span className="slot" data-icon={icon || "folder"} style={color ? { color, background: `${color}33` } : undefined}>
        <Icon name={(icon && (FOLDER_ICONS as readonly string[]).includes(icon) ? icon : "folder") as IconName} size={24} />
      </span>
      <span className="meta"><span className="tname">{name}</span></span>
    </button>
  );
}
