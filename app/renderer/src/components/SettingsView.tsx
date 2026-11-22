import { useEffect, useState } from "react";
import type { EngineInfo, IdentityResult, ModInfo, ProjectSnapshot } from "../../../shared/api.ts";
import type { DependencyResolution } from "../../../../src/build/modDependencies.ts";
import type { Dependency } from "../../../../src/ir/types.ts";
import { api } from "../api.ts";
import { useAutosave } from "../hooks/useAutosave.ts";
import { t } from "../strings.ts";
import { integrations } from "../types.ts";
import { TexturePicker } from "./TexturePicker.tsx";
import {
  ActionButton, DataTable, Dialog, FindBar, FindSelect, FormGroup, FormRow, PanelEmpty, Problems, SidePanel, TabList
} from "./ui.tsx";
import { EmptyState, TabsRow } from "../dock/Dock.tsx";

const SIDES = ["both", "client", "server"] as const;
/** A dependency's source with one key set, or removed when empty; no source at all when nothing is left. */
function withSource(source: Dependency["source"], key: keyof NonNullable<Dependency["source"]>, value: string): Dependency["source"] {
  const { [key]: _old, ...rest } = source ?? {};
  const next = value ? { ...rest, [key]: value } : rest;
  return Object.keys(next).length ? next : undefined;
}

const NEW_DEPENDENCY: Dependency = { modId: "", version: "*", required: true, side: "both" };
const TABS = ["mod", "dependencies", "integrations"] as const;
type Tab = (typeof TABS)[number];
type Use = "off" | "optional" | "required";

interface Props {
  snapshot: ProjectSnapshot;
  onSaved: (snapshot: ProjectSnapshot) => void;
}

/**
 * Workspace settings in three tabs (KUYRUK 121): the mod form, the dependency table and the integrations table. Each tab
 * has its own find bar and toolbar in the section frame; the tabs sit under the toolbar (KUYRUK 120).
 */
/** Where the jars are published (Q238); empty fields leave the key out, so an unpublished mod keeps no publish entry. */
function publishTarget(current: ModInfo["publish"], change: ModInfo["publish"]): ModInfo["publish"] {
  const next = Object.fromEntries(Object.entries({ ...current, ...change }).filter(([, v]) => v));
  return Object.keys(next).length ? next : undefined;
}

export function SettingsView({ snapshot, onSaved }: Props) {
  const [mod, setMod, , replaceMod] = useAutosave<ModInfo>(snapshot.project.mod, async (next) => onSaved(await api.saveModInfo(snapshot.dir, next)));
  const [tab, setTab] = useState<Tab>("mod");
  const set = (patch: Partial<ModInfo>) => setMod({ ...mod, ...patch });
  const used = mod.integrations ?? [];
  const tabs = (
    <TabList className="langtabs pagetabs" label={t("section.settings")}>
      {TABS.map((k) => (
        <button key={k} role="tab" aria-selected={k === tab} className={`ltab ${k === tab ? "on" : ""}`} onClick={() => setTab(k)}>
          {t(`settings.tab.${k}`)}
          {k === "dependencies" && <span className="lpct">{mod.dependencies.length}</span>}
          {k === "integrations" && <span className="lpct">{used.length}</span>}
        </button>
      ))}
    </TabList>
  );
  // After an identity change the draft takes the new id and package (already on disk), so no later save brings the old ones back.
  const props = { snapshot, mod, set, tabs, onSaved: (next: ProjectSnapshot) => (replaceMod(next.project.mod), onSaved(next)) };
  return (
    <section className="view">
      {tab === "mod" ? <ModTab {...props} /> : tab === "dependencies" ? <DependenciesTab {...props} /> : <IntegrationsTab {...props} />}
    </section>
  );
}

interface TabProps {
  snapshot: ProjectSnapshot;
  mod: ModInfo;
  set: (patch: Partial<ModInfo>) => void;
  tabs: React.ReactNode;
  onSaved: (snapshot: ProjectSnapshot) => void;
}

/** General and publishing fields; the id and package change only through the identity dialog (it rewrites what names them). */
function ModTab({ snapshot, mod, set, tabs, onSaved }: TabProps) {
  const [query, setQuery] = useState("");
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState<string>();
  const q = query.trim().toLowerCase();
  const shown = (label: string) => !q || label.toLowerCase().includes(q);
  const row = (label: string, control: React.ReactNode, top?: boolean) => shown(label) && <FormRow label={label} top={top}>{control}</FormRow>;
  const general = [
    row(t("settings.id"), <input value={mod.id} readOnly />),
    row(t("settings.package"), <input value={mod.package} readOnly />),
    row(t("settings.name"), <input value={mod.name} onChange={(e) => set({ name: e.target.value })} />),
    row(t("settings.version"), <input value={mod.version} onChange={(e) => set({ version: e.target.value })} />),
    row(t("settings.authors"), <input value={mod.authors.join(", ")} onChange={(e) => set({ authors: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })} />),
    row(t("settings.description"), <textarea rows={3} value={mod.description} onChange={(e) => set({ description: e.target.value })} />, true),
  ].filter(Boolean);
  const publishing = [
    row(t("settings.license"), <input value={mod.license} onChange={(e) => set({ license: e.target.value })} />),
    row(t("settings.website"), <input value={mod.website} onChange={(e) => set({ website: e.target.value })} />),
    row(t("settings.credits"), <input value={mod.credits} onChange={(e) => set({ credits: e.target.value })} />),
    row(t("settings.logo"), <TexturePicker dir={snapshot.dir} textures={snapshot.textures} value={mod.logo} allowNone onChange={(logo) => set({ logo })} />),
    row(t("settings.publishModrinth"), <input className="mono" value={mod.publish?.modrinth ?? ""} spellCheck={false} placeholder={t("settings.publishNone")}
      data-testid="publish-modrinth" onChange={(e) => set({ publish: publishTarget(mod.publish, { modrinth: e.target.value.trim() }) })} />),
    row(t("settings.publishCurseforge"), <input className="mono" value={mod.publish?.curseforge ?? ""} spellCheck={false} placeholder={t("settings.publishNone")}
      data-testid="publish-curseforge" onChange={(e) => set({ publish: publishTarget(mod.publish, { curseforge: e.target.value.trim() }) })} />),
  ].filter(Boolean);
  const issues = snapshot.issues.filter((issue) => issue.path.startsWith("mod.") && !issue.path.startsWith("mod.dependencies"));
  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("settings.searchFields")} meta={t("settings.modMeta", { id: mod.id, package: mod.package })}
        actions={<ActionButton icon="edit" label={t("settings.identity.change")} tone="primary" onClick={() => (setDone(undefined), setChanging(true))} />} />
      <TabsRow tabs={tabs} />
      <div className="formscroll">
        <div className="form wide-labels">
          {done && <p className="notice">{done}</p>}
          {general.length > 0 && <FormGroup title={t("settings.general")}>{general}</FormGroup>}
          {publishing.length > 0 && <FormGroup title={t("settings.publishing")}>{publishing}</FormGroup>}
          {!general.length && !publishing.length && <EmptyState icon="search" text={t("settings.noFieldMatch")} />}
          <Problems issues={issues} />
        </div>
      </div>
      {changing && (
        <IdentityDialog snapshot={snapshot} onCancel={() => setChanging(false)}
          onChanged={(next, result) => (setChanging(false), setDone(t("settings.identity.done", { files: result.filesChanged.length })), onSaved(next))} />
      )}
    </>
  );
}

/** New mod id and package, with a dry run of what the change rewrites; OK applies it. */
function IdentityDialog({ snapshot, onCancel, onChanged }: {
  snapshot: ProjectSnapshot;
  onCancel: () => void;
  onChanged: (snapshot: ProjectSnapshot, result: IdentityResult) => void;
}) {
  const current = snapshot.project.mod;
  const [modId, setModId] = useState(current.id);
  const [pkg, setPkg] = useState(current.package);
  const [preview, setPreview] = useState<{ result?: IdentityResult; error?: string }>({});
  const change = { modId: modId.trim(), package: pkg.trim() };
  useEffect(() => {
    let live = true;
    api.changeModIdentity(snapshot.dir, change, true).then(
      ({ result }) => live && setPreview({ result }),
      (error: Error) => live && setPreview({ error: error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") }),
    );
    return () => void (live = false);
  }, [modId, pkg]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = preview.result;
  return (
    <Dialog title={t("settings.identity.title")} okLabel={t("settings.identity.ok")} canOk={!!result} danger
      onCancel={onCancel} onOk={async () => {
        const { result: applied, snapshot: next } = await api.changeModIdentity(snapshot.dir, change);
        if (next) onChanged(next, applied);
      }}>
      <FormGroup title={t("settings.identity.group")}>
        <FormRow label={t("settings.id")}><input className="mono" value={modId} spellCheck={false} onChange={(e) => setModId(e.target.value)} /></FormRow>
        <FormRow label={t("settings.package")}><input className="mono" value={pkg} spellCheck={false} onChange={(e) => setPkg(e.target.value)} /></FormRow>
        <p className="hint">{t("settings.identity.hint")}</p>
        {result && <p className="notice" data-testid="identity-preview">{t("settings.identity.preview", { files: result.filesChanged.length, keys: result.keysRenamed, values: result.valuesChanged })}
          {result.datapackMoved && <> {t("settings.identity.datapack", { from: result.datapackMoved.from.slice(9), to: result.datapackMoved.to.slice(9) })}</>}</p>}
        {preview.error && (modId !== current.id || pkg !== current.package) && <p className="ferr">{preview.error}</p>}
      </FormGroup>
    </Dialog>
  );
}

type Jars = Record<string, DependencyResolution[]>;

/** The resolution of a dependency on one engine (matched by mod id and version, so an unsaved row shows none). */
const resolutionOf = (jars: Jars | undefined, engineId: string, dep: Dependency) =>
  jars?.[engineId]?.find((r) => r.modId === dep.modId && r.constraint === dep.version);

/**
 * Dependencies as a selectable table edited in the side panel. Each one also shows the jars dev runs load for it per
 * engine, from the machine's cache (KUYRUK 156); Resolve jars downloads the missing ones (deps:jars, as MCP resolve_dependencies).
 */
function DependenciesTab({ snapshot, mod, set, tabs }: TabProps) {
  const [query, setQuery] = useState("");
  const [side, setSide] = useState<"all" | Dependency["side"]>("all");
  const [selected, setSelected] = useState<number>();
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [jars, setJars] = useState<Jars>();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string>();
  const saved = JSON.stringify(snapshot.project.mod.dependencies);
  useEffect(() => void api.listEngines().then(setEngines), []);
  useEffect(() => {
    let live = true;
    api.dependencyJars(snapshot.dir).then((next) => live && setJars(next), () => {});
    return () => void (live = false);
  }, [snapshot.dir, saved]);
  const resolve = async () => {
    setResolving(true);
    setError(undefined);
    try {
      setJars(await api.dependencyJars(snapshot.dir, { resolve: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    } finally {
      setResolving(false);
    }
  };
  const summary = (dep: Dependency) => {
    const known = engines.map((e) => resolutionOf(jars, e.id, dep)).filter((r): r is DependencyResolution => !!r);
    if (!engines.length || !known.length) return <span className="dim">{t("settings.dep.status.unresolved")}</span>;
    const resolved = known.filter((r) => r.status === "resolved").length;
    return <span className={resolved === engines.length ? "" : "dim"}>{t("settings.dep.jarsSummary", { resolved, count: engines.length })}</span>;
  };
  const rows = mod.dependencies
    .map((dep, index) => ({ dep, index }))
    .filter(({ dep }) => (side === "all" || dep.side === side) && dep.modId.includes(query.trim().toLowerCase()));
  // A selection the filter or search hides is dropped (as KUYRUK 112/142).
  const current = selected !== undefined && rows.some((r) => r.index === selected) ? mod.dependencies[selected] : undefined;
  useEffect(() => {
    if (selected !== undefined && !current) setSelected(undefined);
  }, [selected, current]);
  const setDependency = (patch: Partial<Dependency>) => set({ dependencies: mod.dependencies.map((d, i) => (i === selected ? { ...d, ...patch } : d)) });
  const issues = snapshot.issues.filter((issue) => issue.path.startsWith("mod.dependencies"));
  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("settings.search")} meta={t("settings.count", { count: mod.dependencies.length })}
        actions={<>
          <ActionButton icon="jar" label={t(resolving ? "settings.dep.resolving" : "settings.dep.resolve")} disabled={resolving || !mod.dependencies.length}
            title={t("settings.dep.resolveHint")} onClick={resolve} />
          {current && <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" onClick={() => {
            set({ dependencies: mod.dependencies.filter((_, i) => i !== selected) });
            setSelected(undefined);
          }} />}
          <ActionButton icon="plus" label={t("settings.dep.add")} tone="primary" onClick={() => {
            // The new row has no mod id yet: clear the search and filter so it is shown and stays selected.
            setQuery("");
            setSide("all");
            set({ dependencies: [...mod.dependencies, NEW_DEPENDENCY] });
            setSelected(mod.dependencies.length);
          }} />
        </>}>
        <FindSelect icon="filter" label={t("find.filter")} value={side} onChange={setSide} options={[
          { value: "all", label: t("settings.allSides") },
          ...SIDES.map((s) => ({ value: s, label: t(`side.${s}`) })),
        ]} />
      </FindBar>
      <TabsRow tabs={tabs} />
      <div className="split">
        <div className="scrollarea">
          <DataTable rows={rows} rowKey={(r) => String(r.index)} selected={current ? String(selected) : undefined}
            onSelect={(key) => setSelected(Number(key))} empty={t("settings.noDependencies")}
            columns={[
              { label: t("settings.dep.modId"), width: "28%", cell: (r) => <code>{r.dep.modId || "—"}</code> },
              { label: t("settings.dep.version"), width: "16%", cell: (r) => <code>{r.dep.version}</code> },
              { label: t("settings.dep.required"), width: "16%", cell: (r) => t(r.dep.required ? "settings.dep.yes" : "settings.dep.no") },
              { label: t("settings.dep.side"), width: "16%", cell: (r) => t(`side.${r.dep.side}`) },
              { label: t("settings.dep.jars"), cell: (r) => summary(r.dep) },
            ]} />
        </div>
        <SidePanel title={t("settings.dep.edit")}>
          {current ? (
            <FormGroup title={t("group.dependency")}>
              <FormRow label={t("settings.dep.modId")}>
                <input className="mono" value={current.modId} onChange={(e) => setDependency({ modId: e.target.value.trim() })} />
              </FormRow>
              <FormRow label={t("settings.dep.version")}>
                <input className="mono" value={current.version} onChange={(e) => setDependency({ version: e.target.value })} />
              </FormRow>
              <FormRow label={t("settings.dep.required")}>
                <label className="check">
                  <input type="checkbox" checked={current.required} onChange={(e) => setDependency({ required: e.target.checked })} />
                  {t("settings.dep.requiredHint")}
                </label>
              </FormRow>
              <FormRow label={t("settings.dep.side")}>
                <select value={current.side} onChange={(e) => setDependency({ side: e.target.value as Dependency["side"] })}>
                  {SIDES.map((s) => <option key={s} value={s}>{t(`side.${s}`)}</option>)}
                </select>
              </FormRow>
              {/* source.curseforge (KUYRUK 184): a project slug or numeric id; empty leaves the Modrinth-first lookup by mod id. */}
              <FormRow label={t("settings.dep.curseforge")} top>
                <input className="mono depcf" value={current.source?.curseforge ?? ""} placeholder={t("settings.dep.curseforgePlaceholder")} spellCheck={false}
                  onChange={(e) => setDependency({ source: withSource(current.source, "curseforge", e.target.value.trim()) })} />
                <p className="hint nomargin">{t("settings.dep.curseforgeHint")}</p>
              </FormRow>
            </FormGroup>
          ) : <PanelEmpty text={t("settings.dep.selectHint")} />}
          {current && (
            <FormGroup title={t("group.dependencyJars")}>
              <ul className="depjars" data-testid="dependency-jars">
                {engines.map((engine) => {
                  const r = resolutionOf(jars, engine.id, current);
                  const status = r?.status ?? "unresolved";
                  return (
                    <li key={engine.id} data-engine={engine.id} data-status={status}>
                      <div className="djhead"><b>{engine.name}</b><span className={`djstatus ${status}`}>{t(`settings.dep.status.${status}`)}</span></div>
                      {r?.jars.map((jar) => (
                        <div key={jar.coords} className="djjar">
                          <span><code>{jar.title ?? jar.project}</code> {jar.version}{jar.via && <span className="dim"> · {t("settings.dep.via", { mod: jar.via })}</span>}</span>
                          <span className="djfile dim" title={jar.file}>{jar.file.split(/[\\/]/).pop()} · {Math.max(1, Math.round(jar.size / 1024))} KB</span>
                        </div>
                      ))}
                      {status === "unavailable" && <div className="djmsg dim">{t("settings.dep.unavailable", { mod: current.modId, version: current.version, engine: engine.name,
                        source: r?.source === "curseforge" ? "CurseForge" : r?.source === "maven" ? "Maven" : "Modrinth" })}</div>}
                      {status === "failed" && r?.message && <div className="djmsg dim">{r.message}</div>}
                    </li>
                  );
                })}
              </ul>
              <p className="hint">{t("settings.dep.jarsHint")}</p>
            </FormGroup>
          )}
          {error && <p className="ferr">{error}</p>}
          <Problems issues={issues} />
          <p className="hint">{t("settings.dependencies.hint")}</p>
        </SidePanel>
      </div>
    </>
  );
}

/** Optional mod integrations as a table; the toolbar and the side panel set the selected one off, optional or required. */
function IntegrationsTab({ mod, set, tabs }: TabProps) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "on" | "off">("all");
  const [selected, setSelected] = useState<string>();
  const used = mod.integrations ?? [];
  const useOf = (id: string): Use => {
    const use = used.find((i) => i.id === id);
    return use ? (use.required ? "required" : "optional") : "off";
  };
  const setUse = (id: string, use: Use) => {
    const others = used.filter((i) => i.id !== id);
    set({ integrations: use === "off" ? others : [...others, { id, required: use === "required" }] });
  };
  const all = integrations();
  const q = query.trim().toLowerCase();
  const rows = all.filter((i) => (!q || i.name.toLowerCase().includes(q)) && (show === "all" || (show === "on") === (useOf(i.id) !== "off")));
  const current = rows.find((i) => i.id === selected);
  useEffect(() => {
    if (selected && !current) setSelected(undefined);
  }, [selected, current]);
  const mods = (engines: Record<string, string>) => Object.entries(engines).map(([engine, name]) => `${name} (${engine})`).join(", ");
  const useLabel = (use: Use) => t(`settings.integration.${use}Short`);
  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("settings.integrations.search")} meta={t("settings.integrations.count", { on: used.length, count: all.length })}>
        <FindSelect icon="filter" label={t("find.show")} value={show} onChange={setShow} options={[
          { value: "all", label: t("settings.integrations.all") },
          { value: "on", label: t("settings.integrations.on") },
          { value: "off", label: t("settings.integrations.off") },
        ]} />
      </FindBar>
      <TabsRow tabs={tabs} actions={current && (["off", "optional", "required"] as const).map((use) => (
        <ActionButton key={use} icon={use === "off" ? "close" : "check"} label={useLabel(use)}
          pressed={useOf(current.id) === use} onClick={() => setUse(current.id, use)} />
      ))} />
      <div className="split">
        <div className="scrollarea">
          <DataTable rows={rows} rowKey={(i) => i.id} selected={current?.id} onSelect={setSelected} empty={t("settings.integrations.none")}
            columns={[
              { label: t("settings.integration.col.name"), width: "34%", cell: (i) => <b>{i.name}</b> },
              { label: t("settings.integration.col.mods"), cell: (i) => <span className="dim">{mods(i.engines)}</span> },
              { label: t("settings.integration.col.use"), width: "18%", cell: (i) => useLabel(useOf(i.id)) },
            ]} />
        </div>
        <SidePanel title={t("settings.integration.edit")}>
          {current ? (
            <FormGroup title={current.name}>
              <FormRow label={t("settings.integration.use")}>
                <select aria-label={current.name} value={useOf(current.id)} onChange={(e) => setUse(current.id, e.target.value as Use)}>
                  <option value="off">{t("settings.integration.off")}</option>
                  <option value="optional">{t("settings.integration.optional")}</option>
                  <option value="required">{t("settings.integration.required")}</option>
                </select>
              </FormRow>
              <p className="fhelp">{current.description} {t("settings.integration.engines", { mods: mods(current.engines) })}</p>
            </FormGroup>
          ) : <PanelEmpty text={t("settings.integration.selectHint")} />}
          <p className="hint">{t("settings.integrations.hint")}</p>
        </SidePanel>
      </div>
    </>
  );
}
