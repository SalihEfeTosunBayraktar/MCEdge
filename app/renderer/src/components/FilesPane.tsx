import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, ResourceKind } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { useBlockbench } from "../models/Blockbench.tsx";
import { ModelPreview } from "../models/ModelPreview.tsx";
import { t } from "../strings.ts";
import { ActionBar, ActionButton, DataTable, FindBar, FormGroup, FormRow, PanelEmpty, Separator, SidePanel } from "./ui.tsx";
import { useRevealQuery } from "../hooks/reveal.ts";

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
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const files = snapshot[LIST[kind]];
  const q = query.trim().toLowerCase();
  const rows = files.filter((f) => !q || f.toLowerCase().includes(q));
  // A selection the search hides is dropped, so no action can reach a file the user cannot see (KUYRUK 142, as 112).
  const current = selected && rows.includes(selected) ? selected : undefined;
  useEffect(() => {
    if (selected && !current) (setSelected(undefined), audio.current?.pause(), setPlaying(false));
  }, [selected, current]);
  useEffect(() => () => audio.current?.pause(), []);
  const blockbench = useBlockbench(snapshot.dir);
  useEffect(() => blockbench.reset(), [current]);
  const jsonModel = kind === "model" && current?.endsWith(".json") ? baseName(current) : undefined;

  const remove = async () => {
    if (!current) return;
    try {
      onChanged(await api.deleteResource(snapshot.dir, current));
      setSelected(undefined);
      setError(undefined);
    } catch {
      setError(t("files.inUse"));
    }
  };
  const play = async () => {
    const player = audio.current;
    if (!current || !player) return;
    if (playing) return (player.pause(), setPlaying(false));
    player.src = await api.readSound(snapshot.dir, current);
    await player.play();
    setPlaying(true);
  };

  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t(`files.search.${kind}`)} meta={t("files.count", { count: files.length })} />
      <ActionBar>
        <ActionButton icon="import" label={t(`files.import.${kind}`)} tone="primary" onClick={() => onImport(kind)} />
        {kind === "model" && (
          <>
            <Separator />
            <ActionButton icon="cube" label={t("blockbench.edit")} disabled={!jsonModel} title={current && !jsonModel ? t("blockbench.jsonOnly") : undefined}
              onClick={() => jsonModel && void blockbench.open(jsonModel)} />
          </>
        )}
        {kind === "sound" && (
          <>
            <Separator />
            <ActionButton icon={playing ? "stop" : "play"} label={t(playing ? "files.stop" : "files.play")} disabled={!current} onClick={() => void play()} />
          </>
        )}
        <Separator />
        <ActionButton icon="trash" label={t("resources.delete")} tone="danger" disabled={!current} onClick={() => void remove()} />
      </ActionBar>
      {tabs}
      <audio ref={audio} onEnded={() => setPlaying(false)} hidden />
      <div className="split">
        <div className="scrollarea">
          <DataTable rows={rows} rowKey={(r) => r} selected={current} onSelect={(r) => (setSelected(r), setError(undefined), audio.current?.pause(), setPlaying(false))}
            empty={files.length ? t("list.noMatch") : t(`files.empty.${kind}`)} columns={[
              { label: t("files.col.name"), width: "34%", cell: (r) => <b>{baseName(r)}</b> },
              { label: t("files.col.use"), cell: (r) => <code>{useAs(snapshot, kind, r)}</code> },
              { label: t("files.col.type"), width: "18%", cell: (r) => <span className="dim">{r.slice(r.lastIndexOf(".") + 1).toUpperCase()}</span> },
            ]} />
        </div>
        <SidePanel title={t(`files.details.${kind}`)}>
          {current ? (
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
          ) : <PanelEmpty text={t(`files.selectHint.${kind}`)} />}
        </SidePanel>
      </div>
    </>
  );
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));

/** What an element field holds to use the file: "<modid>:<name>" for sounds and structures, the name for models. */
function useAs(snapshot: ProjectSnapshot, kind: ResourceKind, path: string): string {
  return kind === "model" ? baseName(path) : `${snapshot.project.mod.id}:${baseName(path)}`;
}
