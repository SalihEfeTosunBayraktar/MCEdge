import { useEffect, useState } from "react";
import type { ProjectSnapshot, ResourceKind } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";
import { ActionButton, DataTable, FindBar, FormGroup, FormRow } from "./ui.tsx";
import { InspectorToggle, TabsRow, ViewShell, type DockSection } from "../dock/Dock.tsx";

interface Props {
  snapshot: ProjectSnapshot;
  onChanged: (snapshot: ProjectSnapshot) => void;
  onImport: (kind: ResourceKind) => void;
  tabs?: React.ReactNode;
}

interface Row { key: string; name: string; path: string; length: number; mode: string; warnings: string[] }

/**
 * Resources > Animations (KUYRUK 132): the model animations of the project, from Blockbench Java animation exports
 * and .bbmodel files in models/. Living entities and Java models play them by name; Import animations takes the
 * files like Import model does.
 */
export function AnimationsPane({ snapshot, onChanged, onImport, tabs }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const all: Row[] = snapshot.animations.flatMap((s) => s.animations.map((a) => ({ key: `${s.path}#${a.name}`, name: a.name, path: s.path, length: a.length, mode: a.mode, warnings: s.warnings })));
  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  const current = rows.find((r) => r.key === selected);
  useEffect(() => {
    if (selected && !current) setSelected(undefined);
  }, [selected, current]);
  const remove = async () => {
    if (!current) return;
    try {
      onChanged(await api.deleteResource(snapshot.dir, current.path));
      setSelected(undefined);
      setError(undefined);
    } catch {
      setError(t("files.inUse"));
    }
  };
  const short = (name: string) => name.split(".").pop()!;
  const inspector: DockSection[] = [{ id: "animations.details", icon: "info", title: t("animations.details"), body: <>
          {current ? (
            <FormGroup title={t("animations.animation")}>
              <FormRow label={t("animations.col.name")}><input value={current.name} readOnly /></FormRow>
              <FormRow label={t("animations.useAs")}><input value={short(current.name)} readOnly /></FormRow>
              <FormRow label={t("animations.col.file")}><div className="fval"><code>{current.path}</code></div></FormRow>
              <FormRow label={t("animations.col.length")}><div className="fval">{t("animations.seconds", { seconds: current.length.toFixed(2) })}</div></FormRow>
              <FormRow label={t("animations.col.mode")}><div className="fval">{t(`animations.mode.${current.mode}` as "animations.mode.loop")}</div></FormRow>
              <p className="hint">{t("animations.hint")}</p>
              {current.warnings.map((w, i) => <p key={i} className="ferr">{w}</p>)}
              {error && <p className="ferr">{error}</p>}
            </FormGroup>
          ) : <p className="hint">{t("animations.selectHint")}</p>}
  </> }];

  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("animations.search")} meta={t("animations.count", { count: all.length })}
        actions={<><ActionButton icon="import" label={t("animations.import")} tone="primary" onClick={() => onImport("model")} /><InspectorToggle /></>} />
      <TabsRow tabs={tabs} actions={current && <ActionButton icon="trash" label={t("resources.delete")} title={t("animations.deleteFileHint")} tone="danger" onClick={() => void remove()} />} />
      <ViewShell sections={inspector} inspectorLabel={t("dock.inspector")} inspectorClass="resinsp">
        <div className="scrollarea">
          <DataTable rows={rows} rowKey={(r) => r.key} selected={current?.key} onSelect={(key) => (setSelected(key), setError(undefined))}
            empty={all.length ? t("list.noMatch") : t("animations.empty")} columns={[
              { label: t("animations.col.name"), width: "30%", cell: (r) => <b>{short(r.name)}</b> },
              { label: t("animations.col.file"), cell: (r) => <code>{r.path}</code> },
              { label: t("animations.col.length"), width: "14%", cell: (r) => t("animations.seconds", { seconds: r.length.toFixed(2) }) },
              { label: t("animations.col.mode"), width: "14%", cell: (r) => t(`animations.mode.${r.mode}` as "animations.mode.loop") },
            ]} />
        </div>
      </ViewShell>
    </>
  );
}
