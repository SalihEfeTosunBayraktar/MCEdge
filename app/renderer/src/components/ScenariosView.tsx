import { useCallback, useEffect, useState } from "react";
import type { EngineInfo, ScenarioFile, ScenarioRunOutcome, ScenarioStatus } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";

const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Scenario files of the project (scenarios/*.json): edit as JSON, run on a dedicated server, Reload data (Q241). */
export function ScenariosView({ dir, engineId }: { dir: string; engineId: string }) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engine, setEngine] = useState(engineId);
  const [files, setFiles] = useState<ScenarioFile[]>([]);
  const [name, setName] = useState<string>();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [newName, setNewName] = useState("scenario");
  const [status, setStatus] = useState<ScenarioStatus>();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<ScenarioRunOutcome>();
  const [note, setNote] = useState<{ ok: boolean; text: string }>();

  const refresh = useCallback(() => api.listScenarios(dir).then(setFiles), [dir]);
  useEffect(() => void api.listEngines().then((list) => (setEngines(list), setEngine((e) => e || list[0]?.id || ""))), []);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (!engine) return;
    const poll = () => void api.scenarioStatus(dir, engine).then(setStatus);
    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [dir, engine]);

  const open = async (file: string) => {
    const body = await api.readScenario(dir, file);
    setName(file);
    setText(body);
    setSaved(body);
    setOutcome(undefined);
    setNote(undefined);
    setProblems(await api.scenarioProblems(body));
  };
  const edit = (body: string) => {
    setText(body);
    void api.scenarioProblems(body).then(setProblems);
  };
  const save = async () => {
    if (!name) return;
    await api.writeScenario(dir, name, text);
    setSaved(text);
    await refresh();
  };
  const create = async () => {
    const base = newName.trim().replace(/\.json$/, "") || "scenario";
    let unique = base;
    for (let i = 2; files.some((f) => f.name === unique); i++) unique = `${base}-${i}`;
    const body = await api.scenarioTemplate();
    await api.writeScenario(dir, unique, body);
    await refresh();
    await open(unique);
  };
  const run = async () => {
    if (!name || running) return;
    if (text !== saved) await save();
    setRunning(true);
    setOutcome(undefined);
    setNote(undefined);
    try {
      setOutcome(await api.runScenario(dir, engine, name));
    } finally {
      setRunning(false);
    }
  };
  const reload = async () => {
    const result = await api.reloadData(dir, engine);
    setNote({ ok: result.ok, text: result.ok ? t("scenarios.reloaded", { reply: result.message }) : result.message === "noServer" ? t("scenarios.reloadNoServer") : result.message });
  };

  const error = outcome?.error === "serverRunning" ? t("scenarios.serverRunning") : outcome?.error === "serverForeign" ? t("scenarios.serverForeign") : outcome?.error;
  const result = outcome?.result;
  return (
    <div className="scn-view" data-testid="scenarios">
      <aside className="scn-files">
        <h4>{t("scenarios.files")}</h4>
        <ul>
          {files.length === 0 && <li className="dim">{t("scenarios.noFiles")}</li>}
          {files.map((f) => (
            <li key={f.name}>
              <button type="button" className={f.name === name ? "on" : ""} data-testid={`scn-file-${f.name}`} onClick={() => void open(f.name)}>
                <span className="eng">{f.name}</span>
                <span className="dim">{f.problems.length ? t("scenarios.problem") : t("scenarios.steps", { n: f.steps })}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="scn-new">
          <input value={newName} spellCheck={false} aria-label={t("scenarios.nameLabel")} title={t("scenarios.nameAsk")} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" className="mbtn" data-testid="scn-new" onClick={() => void create()}><Icon name="plus" size={12} /><span>{t("scenarios.new")}</span></button>
        </div>
      </aside>
      <div className="scn-main">
        <div className="scn-bar">
          <label className="dim">{t("scenarios.engine")}
            <select value={engine} data-testid="scn-engine" onChange={(e) => setEngine(e.target.value)}>
              {engines.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
            </select>
          </label>
          <button type="button" className="mbtn" data-testid="scn-save" disabled={!name || text === saved} onClick={() => void save()}><Icon name="save" size={12} /><span>{t("scenarios.save")}</span></button>
          <button type="button" className="mbtn" data-testid="scn-run" disabled={!name || running || problems.length > 0} onClick={() => void run()}><Icon name="play" size={12} /><span>{t("scenarios.run")}</span></button>
          <button type="button" className="mbtn" data-testid="scn-reload" disabled={!status?.reloadable && !!status} onClick={() => void reload()}><Icon name="next" size={12} /><span>{t("scenarios.reload")}</span></button>
          {result?.log && <button type="button" className="linkbtn" data-testid="scn-log" onClick={() => void api.openPath(result.log!)}>{t("scenarios.openLog")}</button>}
        </div>
        {!name ? <p className="dim scn-hint">{t("scenarios.intro")} {t("scenarios.select")}</p> : (
          <div className="scn-work">
            <div className="scn-editor">
              <textarea value={text} spellCheck={false} aria-label={t("scenarios.editorLabel")} data-testid="scn-editor" onChange={(e) => edit(e.target.value)} />
              {problems.length ? <pre className="error-text scn-problems" data-testid="scn-problems">{problems.join("\n")}</pre> : <p className="dim scn-valid">{t("scenarios.valid")}</p>}
            </div>
            <div className="scn-result" data-testid="scn-result">
              {running && <p className="scn-running" data-testid="scn-running">{t("scenarios.running")}</p>}
              {note && <p className={note.ok ? "scn-ok" : "warn-text"} data-testid="scn-note">{note.text}</p>}
              {status?.foreign && !running && <p className="warn-text">{t("scenarios.serverForeign")}</p>}
              {error && <p className="error-text" data-testid="scn-error">{error}</p>}
              {result && (
                <>
                  <p className={outcome.ok ? "scn-ok" : "error-text"} data-testid="scn-summary">
                    {outcome.ok ? t("scenarios.allPassed") : t("scenarios.failedSome")} - {t("scenarios.passed", { passed: result.passed, failed: result.failed, errors: result.errors })}
                  </p>
                  {result.fatal && <p className="error-text">{t("scenarios.fatal", { reason: result.fatal })}</p>}
                  <ul className="scn-steps">
                    {result.steps.map((step, i) => {
                      const state = step.error ? "fail" : step.pass === undefined ? "none" : step.pass ? "pass" : "fail";
                      return (
                        <li key={i} className={state} data-testid="scn-step" data-state={state}>
                          <i className={`led ${state === "pass" ? "ok" : state === "fail" ? "failed" : ""}`} />
                          <span className="eng">{step.label ?? step.op}</span>
                          <code>{step.error ?? (step.value === undefined ? "" : show(step.value))}</code>
                          {state !== "none" && <span className={state === "pass" ? "scn-ok" : "error-text"}>{t(state === "pass" ? "scenarios.pass" : "scenarios.fail")}</span>}
                          {state === "fail" && step.expected !== undefined && <span className="dim">{t("scenarios.expected", { value: show(step.expected) })}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
