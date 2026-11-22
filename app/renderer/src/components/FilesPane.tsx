import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, ResourceKind } from "../../../shared/api.ts";
import { elementsNaming } from "../../../../src/resources/resourceUse.ts";
import { api } from "../api.ts";
import { allElements } from "../model.ts";
import { useBlockbench } from "../models/Blockbench.tsx";
import { ModelPreview } from "../models/ModelPreview.tsx";
import { t } from "../strings.ts";
import { ActionButton, DataTable, FindBar, FormGroup, FormRow } from "./ui.tsx";
import { InspectorToggle, TabsRow, ViewShell, type DockSection } from "../dock/Dock.tsx";
import { useRevealQuery } from "../hooks/reveal.ts";
import { groupRows, tableSections, useFolderDrop, useResourceFolders, useSelection } from "./ResourceFolders.tsx";

const LIST: Record<ResourceKind, "sounds" | "models" | "structures"> = { sound: "sounds", model: "models", structure: "structures" };

interface Props {
  snapshot: ProjectSnapshot;
  kind: ResourceKind;
  onChanged: (snapshot: ProjectSnapshot) => void;
  onImport: (kind: ResourceKind) => void;
  /** The Resources kind tabs, shown under the toolbar. */
  tabs?: React.ReactNode;
}

/** Imported sounds, models or structure templates: a list, the id elements use, play (sounds) and delete. */
export function FilesPane({ snapshot, kind, onChanged, onImport, tabs }: Props) {
  const [query, setQuery] = useState("");
  useRevealQuery(`files:${kind}`, setQuery);
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const files = snapshot[LIST[kind]];
  const q = query.trim().toLowerCase();
  const rows = files.filter((f) => !q || f.toLowerCase().includes(q));
  const named = elementsNaming(allElements(snapshot).map((e) => e.element));
  const res = useResourceFolders({ kind: LIST[kind], snapshot, onChanged, keys: files, isUsed: (f) => named(baseName(f)), removeItem: (f) => api.deleteResource(snapshot.dir, f) });
  const groups = groupRows(res.own, rows, (f) => f, !!q);
  const shown = groups.flatMap((g) => g.rows);
  // A selection the search hides is dropped, so no action can reach a file the user cannot see (KUYRUK 142, as 112).
  const sel = useSelection(shown, { selector: "tbody tr[data-key]", attr: "data-key" });
  const drop = useFolderDrop(LIST[kind], res.moveInto);
  const sections = tableSections(res, drop, sel, groups);
  const current = sel.current;
  useEffect(() => (audio.current?.pause(), setPlaying(false)), [current]);
  useEffect(() => () => audio.current?.pause(), []);
  const blockbench = useBlockbench(snapshot.dir);
  useEffect(() => blockbench.reset(), [current]);
  const jsonModel = kind === "model" && current?.endsWith(".json") ? baseName(current) : undefined;

  const remove = async () => {
    let failed = false;
    for (const file of sel.chosen) {
      try {
        onChanged(await api.deleteResource(snapshot.dir, file));
      } catch {
        failed = true;
      }
    }
    sel.clear();
    setError(failed ? t("files.inUse") : undefined);
  };
  const play = async () => {
    const player = audio.current;
    if (!current || !player) return;
    if (playing) return (player.pause(), setPlaying(false));
    player.src = await api.readSound(snapshot.dir, current);
    await player.play();
    setPlaying(true);
  };

  const inspector: DockSection[] = [{ id: "files.details", icon: "info", title: t(`files.details.${kind}`), body: <>
          {sel.chosen.length > 1 ? (
            <FormGroup title={t("resources.selected")}>
              <p className="hint">{t("resources.selectedCount", { count: sel.chosen.length, items: t(`resources.item.${LIST[kind]}`) })}</p>
              <ul className="plain">{sel.chosen.map((f) => <li key={f}>{baseName(f)}</li>)}</ul>
            </FormGroup>
          ) : current ? (
            <>
            {kind === "model" && current.endsWith(".json") && (
              <FormGroup title={t("model.preview")}>
                {blockbench.note}
                <ModelPreview dir={snapshot.dir} modId={snapshot.project.mod.id} model={baseName(current)} textures={snapshot.textures} height={240} />
              </FormGroup>
            )}
            <FormGroup title={t("files.file")}>
              <FormRow label={t("resources.file")}><div className="fval"><code>{current.slice(current.indexOf("/") + 1)}</code></div></FormRow>
              <FormRow label={t("resources.path")}><input value={current} readOnly /></FormRow>
              <FormRow label={t("files.useAs")}><input value={useAs(snapshot, kind, current)} readOnly /></FormRow>
              <p className="hint">{t(`files.hint.${kind}`)}</p>
              {error && <p className="ferr">{error}</p>}
            </FormGroup>
            </>
          ) : <p className="hint">{t(`files.selectHint.${kind}`)}</p>}
  </> }];

  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t(`files.search.${kind}`)} meta={t("files.count", { count: files.length })}
        actions={<>
          {res.toolbar(sel.chosen)}
          <ActionButton icon="import" label={t(`files.import.${kind}`)} tone="primary" onClick={() => onImport(kind)} />
          <InspectorToggle />
        </>} />
      {res.hint}
      <TabsRow tabs={tabs} actions={sel.chosen.length > 0 && <>
        {kind === "model" && (
          <ActionButton icon="cube" label={t("blockbench.edit")} disabled={!jsonModel} title={current && !jsonModel ? t("blockbench.jsonOnly") : undefined}
            onClick={() => jsonModel && void blockbench.open(jsonModel)} />
        )}
        {kind === "sound" && <ActionButton icon={playing ? "stop" : "play"} label={t(playing ? "files.stop" : "files.play")} disabled={!current} onClick={() => void play()} />}
        {res.moveButton(sel.chosen)}
        <ActionButton icon="trash" label={t("resources.delete")} tone="danger" onClick={() => void remove()} />
      </>} />
      <audio ref={audio} onEnded={() => setPlaying(false)} hidden />
      <ViewShell sections={inspector} inspectorLabel={t("dock.inspector")} inspectorClass="resinsp">
        <div className="scrollarea texarea" ref={sel.area} onMouseDown={sel.startBox}>
          {sel.box && <div className="selbox" style={sel.box} />}
          {res.folderError && <p className="ferr">{res.folderError}</p>}
          <DataTable rows={shown} rowKey={(r) => r} selected={current} picked={sel.chosen} sections={sections}
            onRowDragStart={(f, e) => drop.dragStart(e, f, sel)} onSelect={(r, e) => (sel.pick(r, e), setError(undefined))}
            empty={files.length ? t("list.noMatch") : t(`files.empty.${kind}`)} columns={[
              { label: t("files.col.name"), width: "34%", cell: (r) => <b>{baseName(r)}</b> },
              { label: t("files.col.use"), cell: (r) => <code>{useAs(snapshot, kind, r)}</code> },
              { label: t("files.col.type"), width: "18%", cell: (r) => <span className="dim">{r.slice(r.lastIndexOf(".") + 1).toUpperCase()}</span> },
            ]} />
          {res.dialogs}
        </div>
      </ViewShell>
    </>
  );
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));

/** What an element field holds to use the file: "<modid>:<name>" for sounds and structures, the name for models. */
function useAs(snapshot: ProjectSnapshot, kind: ResourceKind, path: string): string {
  return kind === "model" ? baseName(path) : `${snapshot.project.mod.id}:${baseName(path)}`;
}
