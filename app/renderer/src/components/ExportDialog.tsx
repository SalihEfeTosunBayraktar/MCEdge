import { useEffect, useRef, useState } from "react";
import { DEFAULT_EXPORT_PATTERN, exportFileName } from "../../../shared/exportName.ts";
import type { EngineInfo, ExportResult, Platform, ProjectSnapshot, PublishRun, ReleaseType } from "../../../shared/api.ts";
import type { Changelog } from "../../../../src/vcs/changelog.ts";
import { api } from "../api.ts";
import type { EngineBuild } from "../model.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

interface Props {
  snapshot: ProjectSnapshot;
  engines: EngineInfo[];
  engineId: string;
  builds: Record<string, EngineBuild>;
  /** Marks the engines as waiting in the shared build state before the export starts. */
  onStart: (engineIds: string[]) => void;
  onClose: () => void;
}

/** Engine name without its version: "Fabric 1.21.5" -> "Fabric". */
const loaderName = (engine: EngineInfo) => engine.name.replace(engine.minecraft, "").trim() || engine.loader;
const PLATFORM_NAMES: Record<Platform, string> = { modrinth: "Modrinth", curseforge: "CurseForge" };
const RELEASE_TYPES: ReleaseType[] = ["release", "beta", "alpha"];

const byVersion = (a: EngineInfo, b: EngineInfo) =>
  a.minecraft.localeCompare(b.minecraft, undefined, { numeric: true }) || loaderName(a).localeCompare(loaderName(b));

/** Where the changelog's commits come from, and what it leaves out. */
function changelogSource(c: Changelog): string {
  const count = c.commits.length;
  const date = c.since ? new Date(c.since.date).toLocaleDateString() : "";
  const parts = [
    !c.repo ? t("export.changelogNoRepo")
      : c.sinceMissing ? t("export.changelogMissing", { version: c.since!.version, date, count })
      : c.since ? t("export.changelogSince", { version: c.since.version, date, count })
      : t("export.changelogFirst", { count }),
  ];
  if (c.truncated) parts.push(t("export.changelogTruncated", { count }));
  if (c.uncommitted) parts.push(t("export.changelogUncommitted"));
  return parts.join(" ");
}

/**
 * File > Export mod jar: pick engines, folder and file name pattern; builds run one after another with
 * progress per engine, then the result lists each jar (or the log of a failed build) and skipped elements. The
 * changelog section drafts the notes of this version from the commits since the last export.
 */
export function ExportDialog({ snapshot, engines, engineId, builds, onStart, onClose }: Props) {
  // Ctrl+E opened it without focus, so Escape did nothing until a click (KUYRUK 125).
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const sorted = [...engines].sort(byVersion);
  const [selected, setSelected] = useState<string[]>([engineId]);
  const [folder, setFolder] = useState("");
  const [pattern, setPattern] = useState(DEFAULT_EXPORT_PATTERN);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ExportResult[]>();
  const [changelog, setChangelog] = useState<Changelog>();
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);
  // Publishing (Q238): with a platform ticked, Export becomes export, server test, tag and upload.
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [releaseType, setReleaseType] = useState<ReleaseType>("release");
  const [published, setPublished] = useState<PublishRun>();
  const { mod } = snapshot.project;

  useEffect(() => void api.exportFolder(snapshot.dir).then(setFolder), [snapshot.dir]);
  // The commits since the last export that built on every engine, as a draft to edit and copy (KUYRUK 168).
  useEffect(() => void api.exportChangelog(snapshot.dir).then((c) => (setChangelog(c), setNotes(c.text))), [snapshot.dir]);
  const copyNotes = async () => {
    await navigator.clipboard.writeText(notes).catch(() => {});
    setCopied(true);
  };

  const all = selected.length === engines.length;
  const toggle = (id: string, on: boolean) => setSelected(on ? [...selected, id] : selected.filter((s) => s !== id));
  const preview = (engine: EngineInfo) =>
    exportFileName(pattern, { modid: mod.id, modversion: mod.version, loader: engine.loader, mc: engine.minecraft, engine: engine.id });
  const canExport = !running && selected.length > 0 && folder.trim() !== "" && pattern.trim() !== "";

  const start = async () => {
    const ids = sorted.filter((e) => selected.includes(e.id)).map((e) => e.id);
    setRunning(true);
    setResults(undefined);
    setPublished(undefined);
    try {
      // The checks come before the shared build state marks any engine, so a refused publish leaves no build pending.
      const problems = platforms.length ? await api.publishCheck(snapshot.dir, platforms) : [];
      if (problems.length) return setPublished({ problems, results: [] });
      onStart(ids);
      if (platforms.length) {
        const run = await api.publishJars(snapshot.dir, ids, folder.trim(), pattern.trim(), { platforms, releaseType, changelog: notes });
        setPublished(run);
        setResults(run.results.length ? run.results : undefined);
      } else setResults(await api.exportJars(snapshot.dir, ids, folder.trim(), pattern.trim()));
    } finally {
      setRunning(false);
    }
  };
  const browse = async () => {
    const picked = await api.pickFolder(folder);
    if (picked) setFolder(picked);
  };

  return (
    <div className="backdrop" onMouseDown={() => !running && onClose()}>
      <form ref={box} className="dialog exportdlg" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !running && onClose()}
        onSubmit={(e) => (e.preventDefault(), canExport && start())}>
        <div className="ptitle">{t("export.title")}</div>
        <FormGroup title={t("export.engines")}>
          <div className="check-list exportlist">
            <label className="check">
              <input type="checkbox" checked={all} disabled={running} onChange={(e) => setSelected(e.target.checked ? engines.map((x) => x.id) : [])} />
              <b>{t("export.selectAll")}</b>
            </label>
            {sorted.map((engine) => {
              const build = builds[engine.id];
              const state = running || results ? build?.status : undefined;
              return (
                <label key={engine.id} className="check">
                  <input type="checkbox" checked={selected.includes(engine.id)} disabled={running} onChange={(e) => toggle(engine.id, e.target.checked)} />
                  <span>{t("export.engineLabel", { mc: engine.minecraft, loader: loaderName(engine) })}</span>
                  {state && selected.includes(engine.id) && <span className={`estate ${state}`}>{t(`build.${state}`)}</span>}
                </label>
              );
            })}
          </div>
        </FormGroup>
        <FormGroup title={t("export.output")}>
          <FormRow label={t("export.folder")}>
            <div className="fpair">
              <input value={folder} disabled={running} spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
              <button type="button" className="abtn" disabled={running} onClick={browse}><Icon name="folder" /><span>{t("export.browse")}</span></button>
            </div>
          </FormRow>
          <FormRow label={t("export.pattern")}>
            <input className="mono" value={pattern} disabled={running} spellCheck={false} onChange={(e) => setPattern(e.target.value)} />
          </FormRow>
          <FormRow label={t("export.preview")}>
            <div className="fval"><code>{preview(engines.find((e) => e.id === (selected[0] ?? engineId)) ?? engines[0])}</code></div>
          </FormRow>
        </FormGroup>
        <FormGroup title={t("export.changelog")}>
          <div className="changelog">
            {changelog && <div className="hint nomargin clsource">{changelogSource(changelog)}</div>}
            <textarea className="mono" rows={8} value={notes} spellCheck={false} aria-label={t("export.changelog")}
              onChange={(e) => (setNotes(e.target.value), setCopied(false))} />
            <div className="clbar">
              <button type="button" className="abtn" disabled={!notes.trim()} onClick={copyNotes}><Icon name="copy" /><span>{copied ? t("export.copied") : t("export.copy")}</span></button>
              <span className="hint nomargin">{t("export.changelogNote")}</span>
            </div>
          </div>
        </FormGroup>
        <FormGroup title={t("export.publish")}>
          <FormRow label={t("export.publishTo")}>
            <div className="check-row">
              {(Object.keys(PLATFORM_NAMES) as Platform[]).map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" data-testid={`publish-${p}`} checked={platforms.includes(p)} disabled={running}
                    onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))} />
                  <span>{PLATFORM_NAMES[p]}</span>
                </label>
              ))}
            </div>
          </FormRow>
          {platforms.length > 0 && (
            <>
              <FormRow label={t("export.releaseType")}>
                <select value={releaseType} disabled={running} onChange={(e) => setReleaseType(e.target.value as ReleaseType)}>
                  {RELEASE_TYPES.map((r) => <option key={r} value={r}>{t(`export.release.${r}`)}</option>)}
                </select>
              </FormRow>
              <p className="hint">{t("export.publishHint", { version: mod.version })}</p>
            </>
          )}
          {published && <PublishReport run={published} engines={engines} />}
        </FormGroup>
        {results && (
          <FormGroup title={t("export.result")}>
            <ul className="exportres">
              {results.map((r) => {
                const engine = engines.find((e) => e.id === r.engineId);
                return (
                  <li key={r.engineId}>
                    <div className={`eres ${r.ok ? "ok" : "failed"}`}>
                      <Icon name={r.ok ? "check" : "warn"} size={12} />
                      <b>{engine ? t("export.engineLabel", { mc: engine.minecraft, loader: loaderName(engine) }) : r.engineId}</b>
                      {r.ok ? <code title={r.jar}>{r.jar}</code> : <span>{t("export.failed")}</span>}
                      {!r.ok && r.logFile && <button type="button" className="linkbtn" onClick={() => api.openPath(r.logFile!)}>{t("export.openLog")}</button>}
                    </div>
                    {(r.skipped.length > 0 || r.warnings.length > 0) && (
                      <ul className="eskip">
                        {r.skipped.map((s) => <li key={`${s.typeId}/${s.id}`}>{t("export.skipped", { element: `${s.typeId}/${s.id}`, reason: s.reason })}</li>)}
                        {r.warnings.map((w) => <li key={w}>{t("export.notGenerated", { message: w })}</li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </FormGroup>
        )}
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!canExport}><Icon name="import" /><span>{running ? t(platforms.length ? "export.publishing" : "export.running") : t(platforms.length ? "export.runPublish" : "export.run")}</span></button>
          {results?.some((r) => r.ok) && (
            <button type="button" className="abtn" onClick={() => api.openPath(folder.trim())}><Icon name="folder" /><span>{t("export.openFolder")}</span></button>
          )}
          <button type="button" className="abtn" disabled={running} onClick={onClose}><span>{t("export.close")}</span></button>
        </div>
      </form>
    </div>
  );
}

/** What a publish did: the checks that stopped it, the server test per engine, the tag, and each upload with its page. */
function PublishReport({ run, engines }: { run: PublishRun; engines: EngineInfo[] }) {
  const label = (id: string) => {
    const engine = engines.find((e) => e.id === id);
    return engine ? t("export.engineLabel", { mc: engine.minecraft, loader: loaderName(engine) }) : id;
  };
  const { outcome } = run;
  return (
    <ul className="exportres" data-testid="publish-report">
      {run.problems.map((p) => (
        <li key={JSON.stringify(p)}><div className="eres failed"><Icon name="warn" size={12} />
          <span>{p.kind === "tagExists" ? t("export.problem.tagExists", { tag: p.tag }) : t(`export.problem.${p.kind}`, { platform: PLATFORM_NAMES[p.platform] })}</span>
        </div></li>
      ))}
      {!run.problems.length && !outcome && <li><div className="eres failed"><Icon name="warn" size={12} /><span>{t("export.gateBuildFailed")}</span></div></li>}
      {outcome?.smoke.map((s) => (
        <li key={`smoke-${s.engineId}`}><div className={`eres ${s.ok ? "ok" : "failed"}`}><Icon name={s.ok ? "check" : "warn"} size={12} />
          <b>{label(s.engineId)}</b><span>{t("export.gate")}: {s.ok ? t("export.gateOk") : s.reason}</span>
          {!s.ok && <button type="button" className="linkbtn" onClick={() => api.openPath(s.logFile)}>{t("export.openLog")}</button>}
        </div></li>
      ))}
      {outcome?.stopped && <li><div className="eres failed"><Icon name="warn" size={12} /><span>{t("export.gateFailed", { reason: outcome.stopped })}</span></div></li>}
      {outcome?.tag && <li><div className="eres ok"><Icon name="check" size={12} /><span>{t("export.tagged", { tag: outcome.tag })}</span></div></li>}
      {outcome?.uploads.map((u) => (
        <li key={`${u.platform}-${u.engineId}`}><div className={`eres ${u.ok ? "ok" : "failed"}`}><Icon name={u.ok ? "check" : "warn"} size={12} />
          <b>{PLATFORM_NAMES[u.platform]} · {label(u.engineId)}</b><span>{u.ok ? t("export.uploaded") : t("export.uploadFailed", { error: u.error ?? "" })}</span>
          {u.url && <button type="button" className="linkbtn" onClick={() => api.openExternal(u.url!)}>{t("export.openPage")}</button>}
        </div></li>
      ))}
    </ul>
  );
}
