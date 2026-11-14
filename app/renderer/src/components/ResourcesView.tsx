import { useEffect, useState } from "react";
import type { ProjectSnapshot, ResourceKind } from "../../../shared/api.ts";
import { AnimationsPane } from "./AnimationsPane.tsx";
import { FilesPane } from "./FilesPane.tsx";
import { SoundsPane } from "./SoundsPane.tsx";
import { typeFields, valuesOfType } from "../../../../src/elements/model.ts";
import { api } from "../api.ts";
import { allElements, elementName } from "../model.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { newDraftPaths } from "../textures/drafts.ts";
import { ImportAnimatedDialog } from "../textures/ImportAnimatedDialog.tsx";
import { Texture } from "./Texture.tsx";
import { ActionBar, ActionButton, ContextMenu, Dialog, FindBar, FindSelect, FormGroup, FormRow, MenuList, PanelEmpty, Separator, SidePanel } from "./ui.tsx";
import { ensureFolder, moveElements, NO_FOLDERS, removeFolder, renameFolder, folderName, type ProjectFolders } from "../../../../src/ir/folders.ts";
import { Icon } from "./Icon.tsx";

const DEFAULT_FOLDERS = ["block", "item"];
/** Drag data of a texture cell (KUYRUK 177). */
const TEXTURE_DRAG = "application/x-mcedge-texture";
/** Group keys of the user's own folders, beside the disk folders ("block", "item", ""). */
const OWN = "@folder:";

interface Props {
  snapshot: ProjectSnapshot;
  onChanged: (snapshot: ProjectSnapshot) => void;
  /** Shows the mod elements that use a texture. */
  onSearchUsages: (path: string) => void;
  /** Resources > Create texture. */
  onCreate: () => void;
  /** Opens a texture in the texture editor. */
  onEdit: (path: string) => void;
  tab: ResourceTab;
  onTab: (tab: ResourceTab) => void;
  /** Resources > Import sounds / model / structure. */
  onImport: (kind: ResourceKind) => void;
}

export type ResourceTab = "textures" | "sounds" | "models" | "animations" | "structures";
const TABS: ResourceTab[] = ["textures", "sounds", "models", "animations", "structures"];
const KIND: Record<"models" | "structures", ResourceKind> = { models: "model", structures: "structure" };

/** Project resources by kind: textures (grid, editor), sounds, models and structure templates (lists). */
export function ResourcesView(props: Props) {
  const { snapshot, tab, onTab } = props;
  const count = (k: ResourceTab) => (k === "textures" ? snapshot.textures : k === "sounds" ? snapshot.soundEvents
    : k === "animations" ? snapshot.animations.flatMap((s) => s.animations) : snapshot[k]).length;
  // The kind tabs sit under the pane's find bar and toolbar, so those stay where every section has them (KUYRUK 120).
  const tabs = (
    <div className="langtabs pagetabs" role="tablist" aria-label={t("section.resources")}>
      {TABS.map((k) => (
        <button key={k} role="tab" aria-selected={k === tab} className={`ltab ${k === tab ? "on" : ""}`} onClick={() => onTab(k)}>
          {t(`resources.tab.${k}`)}<span className="lpct">{count(k)}</span>
        </button>
      ))}
    </div>
  );
  return (
    <section className="view">
      {tab === "textures" ? <TexturesPane {...props} tabs={tabs} />
        : tab === "sounds" ? <SoundsPane snapshot={snapshot} onChanged={props.onChanged} onImport={props.onImport} tabs={tabs} />
        : tab === "animations" ? <AnimationsPane snapshot={snapshot} onChanged={props.onChanged} onImport={props.onImport} tabs={tabs} />
        : <FilesPane key={tab} snapshot={snapshot} kind={KIND[tab]} onChanged={props.onChanged} onImport={props.onImport} tabs={tabs} />}
    </section>
  );
}

/** Texture groups ("Textures for blocks/items/..."), a selection and an aligned details panel. */
function TexturesPane({ snapshot, onChanged, onSearchUsages, onCreate, onEdit, tabs }: Omit<Props, "tab" | "onTab" | "onImport"> & { tabs: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [selected, setSelected] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [importingAnimated, setImportingAnimated] = useState(false);
  // The user's own folders (texture-folders.json) come first; textures in none of them stay in their disk folder's group.
  const own = snapshot.project.textureFolders ?? NO_FOLDERS;
  const ownFolder = (path: string) => (own.folders.includes(own.placement[path] ?? "") ? own.placement[path] : undefined);
  const groups = new Map<string, string[]>([
    ...[...own.folders].sort((a, b) => a.localeCompare(b)).map((f) => [`${OWN}${f}`, snapshot.textures.filter((p) => ownFolder(p) === f)] as [string, string[]]),
    ...groupByFolder(snapshot.textures.filter((p) => !ownFolder(p))),
  ]);
  const folders = [...new Set([...DEFAULT_FOLDERS, ...groupByFolder(snapshot.textures).keys()].filter(Boolean))];
  const [naming, setNaming] = useState<{ rename?: string; value: string }>();
  const [headMenu, setHeadMenu] = useState<{ x: number; y: number; folder: string }>();
  const [moving, setMoving] = useState(false);
  const [folderError, setFolderError] = useState("");
  const saveOwn = async (change: (s: ProjectFolders) => ProjectFolders) => {
    try {
      onChanged(await api.saveTextureFolders(snapshot.dir, change(own)));
      setFolderError("");
      return true;
    } catch (e) {
      setFolderError((e as Error).message);
      return false;
    }
  };
  const moveInto = (paths: string[], folder: string) => void saveOwn((s) => moveElements(s, paths, folder));
  const finishNaming = async () => {
    const value = naming?.value.trim();
    if (!value) return;
    const ok = await saveOwn((s) => (naming?.rename ? renameFolder(s, naming.rename, value) : ensureFolder(s, value).state));
    if (ok) setNaming(undefined);
  };
  const usage = usageByTexture(snapshot);
  const activeFilter = groups.has(folderFilter) ? folderFilter : "all";
  const q = query.trim().toLowerCase();
  const visible = [...groups]
    .filter(([folder]) => activeFilter === "all" || folder === activeFilter)
    .map(([folder, paths]) => [folder, paths.filter((p) => !q || p.toLowerCase().includes(q))] as const)
    // An empty folder of the user's stays in sight while nothing is searched, so textures can be dropped into it.
    .filter(([folder, paths]) => paths.length > 0 || (folder.startsWith(OWN) && !q));
  // A selection the folder filter or the search hides is dropped (KUYRUK 142, as 112).
  const current = selected && visible.some(([, paths]) => paths.includes(selected)) ? selected : undefined;
  useEffect(() => {
    if (selected && !current) setSelected(undefined);
  }, [selected, current]);
  const drafts = newDraftPaths(snapshot.dir).filter((p) => !snapshot.textures.includes(p));
  const [exported, setExported] = useState<string>();
  const users = current ? usage.get(current) ?? [] : [];

  const importInto = async (folder: string) => onChanged(await api.importTextures(snapshot.dir, folder));
  const remove = async () => {
    if (!current) return;
    onChanged(await api.deleteTexture(snapshot.dir, current));
    setSelected(undefined);
  };

  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("resources.search")}
        meta={t("resources.count", { count: snapshot.textures.length })}>
        <FindSelect icon="filter" label={t("find.show")} value={activeFilter} onChange={setFolderFilter} options={[
          { value: "all", label: t("resources.allFolders") },
          // Only folders that hold textures, so a filter never empties the list; "item" and "items" read the same title.
          ...[...groups].filter(([f, paths]) => paths.length || f.startsWith(OWN))
            .map(([f, paths]) => ({ value: f, label: f.startsWith(OWN) ? `${f.slice(OWN.length)} (${paths.length})` : `${groupTitle(f)} · ${f ? `textures/${f}` : "textures"} (${paths.length})` })),
        ]} />
      </FindBar>
      <ActionBar>
        <ActionButton icon="plus" label={t("resources.create")} tone="primary" onClick={onCreate} />
        <div className="menuwrap">
          <ActionButton icon="import" label={t("resources.import")} onClick={() => setImporting(!importing)} />
          {importing && (
            <MenuList onClose={() => setImporting(false)}
              items={[...folders.map((f) => ({ label: t("resources.importInto", { folder: `textures/${f}` }), onClick: () => importInto(f) })),
                { label: t("paint.importAnimMenu"), onClick: () => setImportingAnimated(true) }]} />
          )}
        </div>
        <ActionButton icon="folder" label={t("folders.new")} onClick={() => setNaming({ value: "" })} />
        {importingAnimated && (
          <ImportAnimatedDialog snapshot={snapshot} folders={folders} onCancel={() => setImportingAnimated(false)}
            onImported={(next) => (setImportingAnimated(false), onChanged(next))} />
        )}
        <Separator />
        <ActionButton icon="edit" label={t("resources.edit")} disabled={!current} onClick={() => current && onEdit(current)} />
        <ActionButton icon="usages" label={t("resources.searchUsages")} disabled={!current || users.length === 0}
          onClick={() => current && onSearchUsages(current)} />
        <div className="menuwrap texmove">
          <ActionButton icon="folder" label={t("folders.move")} disabled={!current || (!own.folders.length && !ownFolder(current))} onClick={() => setMoving(!moving)} />
          {moving && current && (
            <MenuList onClose={() => setMoving(false)} items={[
              { label: t("resources.noFolder"), checked: !ownFolder(current), onClick: () => (setMoving(false), moveInto([current], "")) },
              ...[...own.folders].sort().map((f) => ({ label: f, checked: ownFolder(current) === f, onClick: () => (setMoving(false), moveInto([current], f)) })),
            ]} />
          )}
        </div>
        <Separator />
        <ActionButton icon="trash" label={t("resources.delete")} tone="danger" disabled={!current || users.length > 0}
          title={users.length ? t("resources.inUse") : undefined} onClick={remove} />
      </ActionBar>
      {tabs}
      <div className="split">
        <div className="scrollarea">
          {snapshot.textures.length === 0 && <p className="empty-note">{t("resources.empty")}</p>}
          {snapshot.textures.length > 0 && visible.length === 0 && <p className="empty-note">{t("resources.noMatch")}</p>}
          {drafts.length > 0 && (
            <div className="tgroup">
              <h3 className="gtitle">{t("resources.drafts")}</h3>
              <div className="texgrid" role="list">
                {drafts.map((path) => (
                  <button key={path} className="texcell draft" onClick={() => onEdit(path)} title={`${path} · ${t("resources.draftHint")}`}>
                    <span className="slot"><span className="texname">{t("resources.draft")}</span></span>
                    <span className="texname">{fileName(path)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {folderError && <p className="ferr">{folderError}</p>}
          {visible.map(([folder, paths]) => (
            <TextureGroup key={folder} folder={folder} onDrop={(path) => moveInto([path], folder.startsWith(OWN) ? folder.slice(OWN.length) : "")}
              onMenu={folder.startsWith(OWN) ? (e) => setHeadMenu({ x: e.clientX, y: e.clientY, folder: folder.slice(OWN.length) }) : undefined}>
              <div className="texgrid" role="listbox">
                {paths.length === 0 && <p className="hint nomargin">{t("resources.folderEmpty")}</p>}
                {paths.map((path) => (
                  <button key={path} role="option" aria-selected={path === current} draggable data-path={path}
                    onDragStart={(e) => (e.dataTransfer.setData(TEXTURE_DRAG, path), (e.dataTransfer.effectAllowed = "move"))}
                    className={`texcell ${path === current ? "sel" : ""}`} onClick={() => setSelected(path)} onDoubleClick={() => onEdit(path)}
                    title={path}>
                    <span className="slot"><Texture dir={snapshot.dir} path={path} size={48} /></span>
                    <span className="texname">{fileName(path)}</span>
                  </button>
                ))}
              </div>
            </TextureGroup>
          ))}
          {headMenu && (
            <ContextMenu x={headMenu.x} y={headMenu.y} onClose={() => setHeadMenu(undefined)} items={[
              { label: `${t("rename.button")}...`, onClick: () => setNaming({ rename: headMenu.folder, value: folderName(headMenu.folder) }) },
              { label: "", separator: true },
              { label: t("action.delete"), danger: true, onClick: () => void saveOwn((s) => removeFolder(s, headMenu.folder)) },
            ]} />
          )}
          {naming && (
            <Dialog title={naming.rename ? t("rename.button") : t("folders.new")} okLabel={naming.rename ? t("rename.button") : t("new.create")}
              canOk={!!naming.value.trim()} onOk={() => void finishNaming()} onCancel={() => (setNaming(undefined), setFolderError(""))}>
              <FormRow label={t("folders.name")}>
                <input className="texfoldername" value={naming.value} autoFocus spellCheck={false} onChange={(e) => setNaming({ ...naming, value: e.target.value })} />
              </FormRow>
              <p className="hint">{t("resources.folderHint")}</p>
              {folderError && <p className="ferr">{folderError}</p>}
            </Dialog>
          )}
        </div>
        <SidePanel title={t("resources.details")}>
          {current ? (
            <>
              <FormGroup title={t("group.texture")}>
                <FormRow label={t("resources.preview")}>
                  <span className="slot big"><Texture dir={snapshot.dir} path={current} size={64} /></span>
                </FormRow>
                <FormRow label={t("resources.file")}><div className="fval"><code>{fileName(current)}</code></div></FormRow>
                <FormRow label={t("resources.path")}><input value={current} readOnly /></FormRow>
                <button type="button" className="abtn" onClick={async () => setExported(await api.exportTexture(snapshot.dir, current))}>{t("resources.export")}</button>
                {exported && <p className="hint">{t("resources.exported", { file: exported })}</p>}
              </FormGroup>
              <FormGroup title={t("group.usedBy")}>
                {users.length ? (
                  <ul className="plain">{users.map((name, i) => <li key={i}>{name}</li>)}</ul>
                ) : <p className="hint">{t("resources.unused")}</p>}
              </FormGroup>
            </>
          ) : <PanelEmpty text={t("resources.selectHint")} />}
        </SidePanel>
      </div>
    </>
  );
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * A group of the texture grid with its heading: one of the user's folders (a folder icon, right-click to rename or
 * delete) or a disk folder. Textures dropped on it move into the folder, or out of the user's folders (KUYRUK 177).
 */
function TextureGroup({ folder, onDrop, onMenu, children }: {
  folder: string;
  onDrop: (path: string) => void;
  onMenu?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const mine = folder.startsWith(OWN);
  return (
    <div className={`tgroup ${mine ? "own" : ""} ${over ? "dropping" : ""}`} data-group={folder}
      onDragOver={(e) => e.dataTransfer.types.includes(TEXTURE_DRAG) && (e.preventDefault(), setOver(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        const path = e.dataTransfer.getData(TEXTURE_DRAG);
        setOver(false);
        if (path) (e.preventDefault(), onDrop(path));
      }}>
      <h3 className="gtitle" onContextMenu={onMenu && ((e) => (e.preventDefault(), onMenu(e)))}>
        {mine ? <><Icon name="folder" size={12} /> {folder.slice(OWN.length)}</> : groupTitle(folder)}
      </h3>
      {children}
    </div>
  );
}

/** "block" -> "Textures for blocks"; root files -> "Other textures". */
function groupTitle(folder: string): string {
  if (!folder) return t("resources.otherTextures");
  const plural = folder.endsWith("s") ? folder : `${folder}s`;
  return t("resources.texturesFor", { folder: plural });
}

/** "textures/item/ruby.png" -> group "item"; files directly under textures/ go to "". */
function groupByFolder(paths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split("/");
    const name = parts.length > 2 ? parts.slice(1, -1).join("/") : "";
    groups.set(name, [...(groups.get(name) ?? []), path]);
  }
  return new Map([...groups].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))));
}

function usageByTexture(snapshot: ProjectSnapshot): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const add = (path: string, name: string) => usage.set(path, [...(usage.get(path) ?? []), name]);
  for (const { typeId, element } of allElements(snapshot)) {
    const type = typeOf(typeId);
    if (type) valuesOfType(typeFields(type), element, "texture").forEach((path) => add(path, elementName(typeId, element)));
  }
  if (snapshot.project.mod.logo) add(snapshot.project.mod.logo, t("resources.logo"));
  return usage;
}
