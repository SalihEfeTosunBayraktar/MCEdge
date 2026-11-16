import { useState } from "react";
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
import { ActionBar, ActionButton, FindBar, FindSelect, FormGroup, FormRow, MenuList, PanelEmpty, Separator, SidePanel } from "./ui.tsx";
import { byFolderPath, folderName } from "../../../../src/ir/folders.ts";
import { OWN, useFolderDrop, useResourceFolders, useSelection } from "./ResourceFolders.tsx";

const DEFAULT_FOLDERS = ["block", "item"];
/** textures/bubbles/<id>.png are the icons of the status bubbles above a player's head (procedure blocks, Bubbles category). */
const BUBBLES = "bubbles";

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
  const [importing, setImporting] = useState(false);
  const [importingAnimated, setImportingAnimated] = useState(false);
  const usage = usageByTexture(snapshot);
  const res = useResourceFolders({ kind: "textures", snapshot, onChanged, keys: snapshot.textures, isUsed: (p) => usage.has(p), removeItem: (p) => api.deleteTexture(snapshot.dir, p) });
  // The user's own folders (texture-folders.json) come first; textures in none of them stay in their disk folder's group.
  const { own, ownFolder } = res;
  const groups = new Map<string, string[]>([
    ...[...own.folders].sort(byFolderPath).map((f) => [`${OWN}${f}`, snapshot.textures.filter((p) => ownFolder(p) === f)] as [string, string[]]),
    ...groupByFolder(snapshot.textures.filter((p) => !ownFolder(p))),
  ]);
  // The bubble icon folder is always in sight, empty or not, so the icons can be found and added.
  if (!groups.has(BUBBLES)) groups.set(BUBBLES, []);
  const folders = [...new Set([...DEFAULT_FOLDERS, ...groupByFolder(snapshot.textures).keys()].filter((f) => f && f !== BUBBLES))];
  const activeFilter = groups.has(folderFilter) ? folderFilter : "all";
  const q = query.trim().toLowerCase();
  const visible = [...groups]
    .filter(([folder]) => activeFilter === "all" || folder === activeFilter)
    .map(([folder, paths]) => [folder, paths.filter((p) => !q || p.toLowerCase().includes(q))] as const)
    // An empty folder of the user's stays in sight while nothing is searched, so textures can be dropped into it.
    .filter(([folder, paths]) => paths.length > 0 || ((folder.startsWith(OWN) || folder === BUBBLES) && !q));
  // A selection the folder filter or the search hides is dropped (KUYRUK 142, as 112).
  const order = visible.flatMap(([, paths]) => paths);
  const sel = useSelection(order, { selector: ".texcell[data-path]", attr: "data-path" });
  const { current, chosen } = sel;
  const drop = useFolderDrop("textures", res.moveInto);
  const drafts = newDraftPaths(snapshot.dir).filter((p) => !snapshot.textures.includes(p));
  const [exported, setExported] = useState<string>();
  const users = current ? usage.get(current) ?? [] : [];
  const inUse = chosen.some((p) => usage.has(p));

  const importInto = async (folder: string) => onChanged(await api.importTextures(snapshot.dir, folder));
  const remove = async () => {
    if (!chosen.length) return;
    for (const path of chosen) onChanged(await api.deleteTexture(snapshot.dir, path));
    sel.clear();
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
                { label: t("resources.addBubble"), onClick: () => importInto(BUBBLES) },
                { label: t("paint.importAnimMenu"), onClick: () => setImportingAnimated(true) }]} />
          )}
        </div>
        {res.toolbar(chosen)}
        {importingAnimated && (
          <ImportAnimatedDialog snapshot={snapshot} folders={folders} onCancel={() => setImportingAnimated(false)}
            onImported={(next) => (setImportingAnimated(false), onChanged(next))} />
        )}
        <Separator />
        <ActionButton icon="edit" label={t("resources.edit")} disabled={!current} onClick={() => current && onEdit(current)} />
        <ActionButton icon="usages" label={t("resources.searchUsages")} disabled={!current || users.length === 0}
          onClick={() => current && onSearchUsages(current)} />
        {res.moveButton(chosen)}
        <Separator />
        <ActionButton icon="trash" label={t("resources.delete")} tone="danger" disabled={!chosen.length || inUse}
          title={inUse ? t("resources.inUse") : undefined} onClick={remove} />
      </ActionBar>
      {res.hint}
      {tabs}
      <div className="split">
        <div className="scrollarea texarea" ref={sel.area} onMouseDown={sel.startBox}>
          {sel.box && <div className="selbox" style={sel.box} />}
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
          {res.folderError && <p className="ferr">{res.folderError}</p>}
          {visible.map(([folder, paths]) => {
            const mine = folder.startsWith(OWN) ? folder.slice(OWN.length) : undefined;
            const heading = res.heading({ path: mine, label: mine ? folderName(mine) : groupTitle(folder), locked: mine === undefined, chosen, onFocus: sel.clear });
            return (
              <div key={folder} className={`tgroup ${mine !== undefined ? "own" : ""} ${drop.over === folder ? "dropping" : ""}`} data-group={folder}
                style={mine ? { marginLeft: (mine.split("/").length - 1) * 16 } : undefined} {...drop.bind(folder, mine ?? "")}>
                {heading}
                {folder === BUBBLES && <p className="hint nomargin">{t("resources.bubblesHint")}</p>}
                <div className="texgrid" role="listbox" aria-multiselectable>
                  {paths.length === 0 && folder !== BUBBLES && <p className="hint nomargin">{t("resources.folderEmpty")}</p>}
                  {paths.map((path) => (
                    <button key={path} role="option" aria-selected={chosen.includes(path)} draggable data-path={path}
                      onDragStart={(e) => drop.dragStart(e, path, sel)}
                      className={`texcell ${chosen.includes(path) ? "sel" : ""}`} onClick={(e) => sel.pick(path, e)} onDoubleClick={() => onEdit(path)}
                      title={path}>
                      <span className="slot"><Texture dir={snapshot.dir} path={path} size={48} /></span>
                      <span className="texname">{fileName(path)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {res.dialogs}
        </div>
        <SidePanel title={t("resources.details")}>
          {chosen.length > 1 ? (
            <FormGroup title={t("resources.selected")}>
              <p className="hint">{t("resources.selectedCount", { count: chosen.length, items: t("resources.item.textures") })}</p>
              <ul className="plain">{chosen.map((p) => <li key={p}>{fileName(p)}</li>)}</ul>
            </FormGroup>
          ) : current ? (
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

/** "block" -> "Textures for blocks"; root files -> "Other textures". */
function groupTitle(folder: string): string {
  if (folder === BUBBLES) return t("resources.bubbleIcons");
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
