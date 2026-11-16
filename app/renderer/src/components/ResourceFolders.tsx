import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";
import { COLOR_VALUE, FOLDER_COLORS } from "../folderColors.ts";
import { byFolderPath, ensureFolder, folderMembers, folderName, FOLDER_ICONS, kindFolders, moveElements, moveFolder, parentFolder, removeFolder, removeFolderTree, renameFolder, setFolderColor, setFolderIcon, withKindFolders, type FolderKind, type ProjectFolders } from "../../../../src/ir/folders.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { ActionButton, ContextMenu, Dialog, FormRow, MenuList, type MenuItem } from "./ui.tsx";

/**
 * Virtual folders of the Resources lists (KUYRUK 177, Q211): Textures, Sounds, Models and Structures share this code. The
 * folders live in texture-folders.json and only organise a list; files and element references never move.
 */

/** Group keys of the user's own folders, beside the disk folders of the Textures list. */
export const OWN = "@folder:";
/** Drag data of a list item: a JSON list of the keys dragged, the whole selection. */
const DRAG: Record<FolderKind, string> = {
  textures: "application/x-mcedge-texture", sounds: "application/x-mcedge-sound", models: "application/x-mcedge-model", structures: "application/x-mcedge-structure",
};

interface Item {
  /** CSS selector of the selectable items, and the attribute that holds an item's key. */
  selector: string;
  attr: string;
}

/**
 * Click, Ctrl/Cmd, Shift and box selection over a list. `current` is the item the details panel shows (the last one
 * clicked, and the anchor of Shift+click); `chosen` is the whole selection. A selection the search or filter hides is dropped.
 */
export function useSelection(order: string[], item: Item) {
  const [selected, setSelected] = useState<string>();
  const [picked, setPicked] = useState<string[]>([]);
  const current = selected && order.includes(selected) ? selected : undefined;
  const chosen = picked.filter((p) => order.includes(p));
  useEffect(() => {
    if (selected && !current) setSelected(undefined);
    if (chosen.length !== picked.length) setPicked(chosen);
  }, [selected, current, chosen.length, picked.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Click: one item; Ctrl/Cmd adds or removes it; Shift takes everything from the last clicked one to it. */
  const pick = (key: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (e?.shiftKey && current) {
      const [a, b] = [order.indexOf(current), order.indexOf(key)].sort((x, y) => x - y);
      setPicked(order.slice(a, b + 1));
      return;
    }
    setSelected(key);
    setPicked(e?.ctrlKey || e?.metaKey ? (chosen.includes(key) ? chosen.filter((p) => p !== key) : [...chosen, key]) : [key]);
  };
  const clear = () => (setSelected(undefined), setPicked([]));
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();
  const area = useRef<HTMLDivElement>(null);
  /** Dragging on the empty space draws a box and selects the items it touches; Ctrl/Cmd keeps the earlier selection. */
  const startBox = (down: React.MouseEvent) => {
    const el = area.current;
    if (down.button !== 0 || !el || (down.target as HTMLElement).closest(`${item.selector}, thead, tr, .gtitle, button, input, .ferr`)) return;
    const bounds = el.getBoundingClientRect();
    const start = { x: down.clientX - bounds.left + el.scrollLeft, y: down.clientY - bounds.top + el.scrollTop };
    const base = down.ctrlKey || down.metaKey ? chosen : [];
    if (!base.length) clear();
    const move = (e: MouseEvent) => {
      const x = e.clientX - bounds.left + el.scrollLeft, y = e.clientY - bounds.top + el.scrollTop;
      const rect = { left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      if (rect.width < 4 && rect.height < 4) return;
      setBox(rect);
      const hit = [...el.querySelectorAll<HTMLElement>(item.selector)].filter((c) => {
        const r = c.getBoundingClientRect();
        const [l, tp] = [r.left - bounds.left + el.scrollLeft, r.top - bounds.top + el.scrollTop];
        return l < rect.left + rect.width && l + r.width > rect.left && tp < rect.top + rect.height && tp + r.height > rect.top;
      }).map((c) => c.getAttribute(item.attr)!);
      setPicked([...new Set([...base, ...hit])]);
      setSelected(hit[hit.length - 1] ?? base[base.length - 1]);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setBox(undefined);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return { current, chosen, pick, clear, select: (key: string) => (setSelected(key), setPicked([key])), box, area, startBox };
}

/** Drag the selection onto a folder: `bind` gives a group (or a heading and its rows) the drop handlers, `dragStart` an item the drag ones. */
export function useFolderDrop(kind: FolderKind, onDrop: (keys: string[], folder: string) => void) {
  const [over, setOver] = useState<string>();
  const mime = DRAG[kind];
  const bind = (group: string, folder: string) => ({
    onDragOver: (e: React.DragEvent) => e.dataTransfer.types.includes(mime) && (e.preventDefault(), setOver(group)),
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(undefined),
    onDrop: (e: React.DragEvent) => {
      const data = e.dataTransfer.getData(mime);
      setOver(undefined);
      if (data) (e.preventDefault(), e.stopPropagation(), onDrop(JSON.parse(data) as string[], folder));
    },
  });
  /** Dragging an item of the selection takes the whole selection; any other one is dragged alone. */
  const dragStart = (e: React.DragEvent, key: string, sel: ReturnType<typeof useSelection>) => {
    if (!sel.chosen.includes(key)) sel.select(key);
    e.dataTransfer.setData(mime, JSON.stringify(sel.chosen.includes(key) ? sel.chosen : [key]));
    e.dataTransfer.effectAllowed = "move";
  };
  return { over, bind, dragStart };
}

interface Menu { x: number; y: number; /** An own folder; missing for a fixed group's menu. */ folder?: string; page?: "color" | "icon" | "move"; chosen: string[] }
interface Naming { rename?: string; parent?: string; value: string; /** Items to move into the new folder. */ move?: string[] }
interface Deleting { folder: string; files: string[]; subfolders: number; removeFiles: boolean }

/**
 * The folders of one Resources list: the state, the heading menu (also from the visible button), the toolbar buttons,
 * and the new/rename/delete dialogs. `keys` are the list's items, `isUsed` tells whether an element uses one (it then
 * survives "delete the contents"), `removeItem` deletes one.
 */
export function useResourceFolders({ kind, snapshot, onChanged, keys, isUsed, removeItem }: {
  kind: FolderKind;
  snapshot: ProjectSnapshot;
  onChanged: (snapshot: ProjectSnapshot) => void;
  keys: string[];
  isUsed: (key: string) => boolean;
  removeItem: (key: string) => Promise<unknown>;
}) {
  const own = kindFolders(snapshot.project.textureFolders, kind);
  const ownFolder = (key: string) => (own.folders.includes(own.placement[key] ?? "") ? own.placement[key] : undefined);
  const [naming, setNaming] = useState<Naming>();
  const [menu, setMenu] = useState<Menu>();
  const [deleting, setDeleting] = useState<Deleting>();
  const [moving, setMoving] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [focus, setFocus] = useState<string>();
  const items = t(`resources.item.${kind}`);
  const saveOwn = async (change: (s: ProjectFolders) => ProjectFolders) => {
    try {
      onChanged(await api.saveTextureFolders(snapshot.dir, withKindFolders(snapshot.project.textureFolders, kind, change(own))));
      setFolderError("");
      return true;
    } catch (e) {
      setFolderError((e as Error).message);
      return false;
    }
  };
  const moveInto = (moved: string[], folder: string) => void saveOwn((s) => moveElements(s, moved, folder));
  const finishNaming = async () => {
    const value = naming?.value.trim();
    if (!naming || !value) return;
    const path = naming.parent ? `${naming.parent}/${value}` : value;
    const parent = naming.rename && parentFolder(naming.rename);
    const ok = await saveOwn((s) => {
      if (naming.rename) return renameFolder(s, naming.rename, value);
      const next = ensureFolder(s, path).state;
      return naming.move ? moveElements(next, naming.move, path) : next;
    });
    if (ok) (setNaming(undefined), setFocus(naming.rename ? (parent ? `${parent}/${value}` : value) : path));
  };
  /** The delete dialog of a folder with items or subfolders in it; an empty one goes at once. */
  const askDelete = (folder: string) => {
    const files = folderMembers(own, folder).filter((k) => keys.includes(k));
    const subfolders = own.folders.filter((f) => f.startsWith(`${folder}/`)).length;
    if (!files.length && !subfolders) void saveOwn((s) => removeFolder(s, folder));
    else setDeleting({ folder, files, subfolders, removeFiles: false });
  };
  const finishDelete = async () => {
    if (!deleting) return;
    const { folder, files, removeFiles } = deleting;
    if (!removeFiles) await saveOwn((s) => removeFolder(s, folder));
    else {
      // Items an element uses stay (moved up to the parent folder), so no reference breaks.
      const keep = new Set(files.filter(isUsed));
      for (const key of files.filter((k) => !keep.has(k))) await removeItem(key).catch(() => keep.add(key));
      await saveOwn((s) => removeFolderTree(s, folder, keep));
    }
    setDeleting(undefined);
  };
  const rename = (folder: string) => setNaming({ rename: folder, value: folderName(folder) });
  const menuItems = (m: Menu): MenuItem[] => {
    const { folder } = m;
    const to = (page: "color" | "icon" | "move") => () => setMenu({ ...m, page });
    if (folder === undefined)
      return [{ label: t("folders.new"), onClick: () => setNaming({ value: "" }) },
        ...(m.chosen.length ? [{ label: t("folders.newFromSelection"), onClick: () => setNaming({ value: "", move: m.chosen }) }] : [])];
    if (m.page === "color")
      return [{ label: t("folders.colorNone"), swatch: "", checked: !own.colors?.[folder], onClick: () => void saveOwn((s) => setFolderColor(s, folder, "")) },
        ...FOLDER_COLORS.map((name) => ({ label: t(`folders.color.${name}`), swatch: COLOR_VALUE[name], checked: own.colors?.[folder] === COLOR_VALUE[name],
          onClick: () => void saveOwn((s) => setFolderColor(s, folder, COLOR_VALUE[name])) }))];
    if (m.page === "icon") {
      const now = own.icons?.[folder] ?? "";
      return [{ label: t("folders.icon.folder"), icon: "folder" as IconName, iconColor: own.colors?.[folder], checked: !now, onClick: () => void saveOwn((s) => setFolderIcon(s, folder, "")) },
        ...FOLDER_ICONS.map((name) => ({ label: t(`folders.icon.${name}`), icon: name as IconName, iconColor: own.colors?.[folder], checked: now === name,
          onClick: () => void saveOwn((s) => setFolderIcon(s, folder, name)) }))];
    }
    if (m.page === "move")
      return ["", ...[...own.folders].sort(byFolderPath)].filter((f) => f !== parentFolder(folder) && f !== folder && !f.startsWith(`${folder}/`))
        .map((f) => ({ label: f || t("folders.top"), onClick: () => void saveOwn((s) => moveFolder(s, folder, f)) }));
    return [
      { label: t("folders.newSub"), onClick: () => setNaming({ parent: folder, value: "" }) },
      { label: t("rename.button"), onClick: () => rename(folder) },
      { label: t("folders.color"), keepOpen: true, onClick: to("color") },
      { label: t("folders.icon"), keepOpen: true, onClick: to("icon") },
      { label: t("folders.move"), keepOpen: true, onClick: to("move") },
      { label: "", separator: true },
      { label: t("action.delete"), danger: true, onClick: () => askDelete(folder) },
    ];
  };
  const focused = focus && own.folders.includes(focus) ? focus : undefined;
  return {
    own, ownFolder, moveInto, saveOwn, folderError, setFolderError,
    /** The folder-aware toolbar buttons: New folder, and Rename, New subfolder and Delete folder while one own folder is focused and no item selected. */
    toolbar: (chosen: string[]) => (
      <>
        <ActionButton icon="folder" label={t("folders.new")} onClick={() => setNaming({ value: "" })} />
        {focused && !chosen.length && (
          <>
            <ActionButton icon="plus" label={t("folders.newSub")} onClick={() => setNaming({ parent: focused, value: "" })} />
            <ActionButton icon="edit" label={t("rename.button")} onClick={() => rename(focused)} />
            <ActionButton icon="trash" label={t("folders.delete")} tone="danger" onClick={() => askDelete(focused)} />
          </>
        )}
      </>
    ),
    /** Move the selection into a folder; disabled with nothing to move or nowhere to move it. */
    moveButton: (chosen: string[]) => (
      <div className="menuwrap texmove">
        <ActionButton icon="folder" label={t("folders.move")} disabled={!chosen.length || (!own.folders.length && !chosen.some(ownFolder))} onClick={() => setMoving(!moving)} />
        {moving && chosen.length > 0 && (
          <MenuList onClose={() => setMoving(false)} items={[
            { label: t("resources.noFolder"), checked: chosen.every((p) => !ownFolder(p)), onClick: () => (setMoving(false), moveInto(chosen, "")) },
            ...[...own.folders].sort(byFolderPath).map((f) => ({ label: f, checked: chosen.every((p) => ownFolder(p) === f), onClick: () => (setMoving(false), moveInto(chosen, f)) })),
          ]} />
        )}
      </div>
    ),
    /** A one-line hint while the list has no folder of its own. */
    hint: own.folders.length ? null : <p className="hint foldertip">{t("folders.tip", { items })}</p>,
    /**
     * The heading of a group: an own folder (`path`: its icon in its colour, indented by depth, rename by double click or F2,
     * Delete key) or a fixed group (`locked`: a Minecraft folder; the unfiled items otherwise). Its button and right-click
     * open the folder menu, or New folder for a fixed group.
     */
    heading: ({ path, label, locked, chosen, onFocus }: { path?: string; label: string; locked?: boolean; chosen: string[]; onFocus: () => void }) => {
      const open = (x: number, y: number) => setMenu({ x, y, folder: path, chosen });
      const color = path ? own.colors?.[path] : undefined;
      const icon = path ? own.icons?.[path] : undefined;
      return (
        <h3 className={`gtitle folderhead ${path && path === focused && !chosen.length ? "focus" : ""}`} title={path} tabIndex={path ? 0 : undefined}
          onFocus={() => path && (onFocus(), setFocus(path))}
          onContextMenu={(e) => (e.preventDefault(), open(e.clientX, e.clientY))}
          onDoubleClick={() => path && rename(path)}
          onKeyDown={(e) => {
            if (!path || e.target !== e.currentTarget) return;
            if (e.key === "F2") (e.preventDefault(), rename(path));
            if (e.key === "Delete") (e.preventDefault(), askDelete(path));
          }}>
          {path ? <span className="gicon" style={color ? { color } : undefined}><Icon name={(icon && (FOLDER_ICONS as readonly string[]).includes(icon) ? icon : "folder") as IconName} size={14} /></span>
            : locked && <span className="gicon glock" title={t("folders.locked")}><Icon name="lock" size={12} /></span>}
          <span className="gname">{label}</span>
          <button type="button" className="gmore" aria-label={t("folders.actions")} title={t("folders.actions")}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); open(r.left, r.bottom); }}><Icon name="more" size={14} /></button>
        </h3>
      );
    },
    /** The menu, the delete dialog and the name dialog; render them inside the list's area. */
    dialogs: (
      <>
        {menu && <ContextMenu key={menu.page ?? "main"} x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} items={menuItems(menu)} />}
        {deleting && (
          <Dialog title={t("resources.deleteFolder", { folder: folderName(deleting.folder) })} okLabel={t("action.delete")} danger={deleting.removeFiles}
            canOk onOk={() => void finishDelete()} onCancel={() => setDeleting(undefined)}>
            <label className="radiorow"><input type="radio" name="delmode" checked={!deleting.removeFiles} onChange={() => setDeleting({ ...deleting, removeFiles: false })} />
              <span>{t("resources.deleteKeep", { count: deleting.files.length, items, subfolders: deleting.subfolders, parent: parentFolder(deleting.folder) || t("folders.top") })}</span></label>
            <label className="radiorow"><input type="radio" name="delmode" checked={deleting.removeFiles} onChange={() => setDeleting({ ...deleting, removeFiles: true })} />
              <span>{t("resources.deleteAll", { count: deleting.files.filter((k) => !isUsed(k)).length, items, used: deleting.files.filter(isUsed).length })}</span></label>
            {kind === "sounds" && <p className="hint">{t("resources.deleteSoundNote")}</p>}
          </Dialog>
        )}
        {naming && (
          <Dialog title={naming.rename ? t("rename.button") : naming.parent ? t("folders.newIn", { folder: naming.parent }) : t("folders.new")} okLabel={naming.rename ? t("rename.button") : t("new.create")}
            canOk={!!naming.value.trim()} onOk={() => void finishNaming()} onCancel={() => (setNaming(undefined), setFolderError(""))}>
            <FormRow label={t("folders.name")}>
              <input className="texfoldername" value={naming.value} autoFocus spellCheck={false} onChange={(e) => setNaming({ ...naming, value: e.target.value })} />
            </FormRow>
            <p className="hint">{t("resources.folderHint")}</p>
            {folderError && <p className="ferr">{folderError}</p>}
          </Dialog>
        )}
      </>
    ),
  };
}

interface RowGroup<R> { folder?: string; rows: R[] }

/**
 * A table list's rows by folder: the user's folders (sorted as a tree), then the rows in none. An empty folder stays in
 * sight while nothing is searched, so rows can be dropped into it. With no folder at all it is one group.
 */
export function groupRows<R>(own: ProjectFolders, rows: R[], rowKey: (row: R) => string, filtering: boolean): RowGroup<R>[] {
  const folderOf = (row: R) => (own.folders.includes(own.placement[rowKey(row)] ?? "") ? own.placement[rowKey(row)] : undefined);
  if (!own.folders.length) return [{ rows }];
  const groups: RowGroup<R>[] = [
    ...[...own.folders].sort(byFolderPath).map((folder) => ({ folder, rows: rows.filter((r) => folderOf(r) === folder) })),
    { rows: rows.filter((r) => !folderOf(r)) },
  ];
  return groups.filter((g) => g.rows.length > 0 || (g.folder !== undefined && !filtering));
}

/** The `sections` of a DataTable for these groups; undefined while the list has no folder (a plain table). */
export function tableSections<R>(res: ReturnType<typeof useResourceFolders>, drop: ReturnType<typeof useFolderDrop>, sel: ReturnType<typeof useSelection>, groups: RowGroup<R>[]) {
  if (!res.own.folders.length) return undefined;
  return groups.map((g) => ({
    key: g.folder ?? "", rows: g.rows, className: drop.over === (g.folder ?? "") ? "dropping" : "", attrs: drop.bind(g.folder ?? "", g.folder ?? ""),
    heading: (
      <div style={g.folder ? { marginLeft: (g.folder.split("/").length - 1) * 16 } : undefined}>
        {res.heading({ path: g.folder, label: g.folder ? folderName(g.folder) : t("resources.noFolder"), chosen: sel.chosen, onFocus: sel.clear })}
      </div>
    ),
  }));
}
