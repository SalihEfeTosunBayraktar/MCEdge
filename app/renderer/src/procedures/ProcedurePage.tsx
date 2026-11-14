import { useEffect, useMemo, useRef, useState } from "react";
import { visibility, type FieldDef } from "../../../../src/elements/model.ts";
import { asProgram, countBlocks, DEPENDENCIES, isIdentifier, LOCAL_TYPES, type LocalType, type LocalVariable, type ProcedureIR } from "../../../../src/procedures/model.ts";
import { inferDependencies } from "../../../../src/procedures/analyze.ts";
import { procedureLookup, PROGRAM_FIELD } from "../../../../src/procedures/project.ts";
import type { Element, EngineInfo, ProjectSnapshot } from "../../../shared/api.ts";
import { FieldList, type FormContext } from "../components/ElementFields.tsx";
import { Icon } from "../components/Icon.tsx";
import { ActionButton, FormGroup, PanelGrip, Separator, ShortcutsButton } from "../components/ui.tsx";
import { elementName } from "../model.ts";
import { t } from "../strings.ts";
import { callersOf, compileFor, procEnvOf, procedureWarnings, projectChoices, providedFor } from "./checks.ts";
import { ProcedureWorkspace, type WorkspaceApi } from "./ProcedureWorkspace.tsx";

/** From this many blocks the editor suggests splitting the program: opening, zooming and dragging slow down (KUYRUK 188). */
const BIG_PROGRAM = 2000;

interface Props {
  snapshot: ProjectSnapshot;
  draft: Element;
  engine?: EngineInfo;
  ctx: FormContext;
  settings: FieldDef[];
  all: FieldDef[];
  onChange: (key: string, value: unknown) => void;
  /** The page's toolbar buttons that are not about the program (back, duplicate, delete). */
  elementActions: React.ReactNode;
}

/**
 * Procedure element page: one toolbar (element actions, then edit, view and search), the Blockly canvas, and a
 * side panel with the settings, local variables, dependencies and the generated Java of the selected engine.
 */
export function ProcedurePage({ snapshot, draft, engine, ctx, settings, all, onChange, elementActions }: Props) {
  const [ir, setIr] = useState<ProcedureIR>(() => asProgram(draft[PROGRAM_FIELD]));
  const [tab, setTab] = useState<"details" | "java">("details");
  const [query, setQuery] = useState("");
  const api = useRef<WorkspaceApi>(undefined);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initial = useMemo(() => asProgram(draft[PROGRAM_FIELD]), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: ProcedureIR) => {
    setIr(next);
    onChange(PROGRAM_FIELD, next);
  };
  const check = (next: ProcedureIR) => procedureWarnings(snapshot, draftRef.current, next, engine, true);
  // Ctrl+F jumps to the block search.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  return (
    <>
      <div className="actions" role="toolbar">
        {elementActions}
        <Separator />
        <ActionButton icon="undo" label={t("proc.undo")} onClick={() => api.current?.undo()} />
        <ActionButton icon="redo" label={t("proc.redo")} onClick={() => api.current?.redo()} />
        <Separator />
        <ActionButton icon="zoomin" label={t("proc.zoomIn")} onClick={() => api.current?.zoom(1)} />
        <ActionButton icon="zoomout" label={t("proc.zoomOut")} onClick={() => api.current?.zoom(-1)} />
        <ActionButton icon="fit" label={t("proc.fit")} onClick={() => api.current?.fit()} />
        <ActionButton icon="tidy" label={t("proc.tidy")} onClick={() => api.current?.tidy()} />
        <Separator />
        <label className="search procsearch">
          <Icon name="search" />
          <input ref={searchRef} value={query} placeholder={t("proc.searchBlocks")} title="Ctrl+F" spellCheck={false}
            onChange={(e) => (setQuery(e.target.value), api.current?.search(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Escape") (setQuery(""), api.current?.search(""));
              // Enter adds the best match under the selected block and closes the flyout.
              if (e.key === "Enter" && api.current?.addFirst(query)) (setQuery(""), api.current.search(""));
            }} />
        </label>
        <ShortcutsButton shortcuts={[
          ["Ctrl+F", t("keys.proc.search")], ["Esc", t("keys.proc.clear")], ["Delete / Backspace", t("keys.proc.remove")],
          ["Ctrl+C / Ctrl+V", t("keys.proc.copy")], ["Ctrl+Z", t("keys.undo")], ["Ctrl+Y / Ctrl+Shift+Z", t("keys.redo")],
          [t("keys.k.wheel"), t("keys.proc.wheel")], [t("keys.k.rightClick"), t("keys.proc.menu")], ["?", t("keys.list")],
        ]} />
      </div>
      <div className="procbody">
        <ProcedureWorkspace initial={initial} onChange={change} check={check} choices={projectChoices(snapshot)} onReady={(a) => (api.current = a)}
          onOpenProcedure={ctx.openElement && ((id) => ctx.openElement?.("procedure", id))} />
        <aside className="panel procpanel">
          <PanelGrip />
          <div className="langtabs pagetabs" role="tablist">
            <button role="tab" aria-selected={tab === "details"} className={`ltab ${tab === "details" ? "on" : ""}`} onClick={() => setTab("details")}>{t("proc.details")}</button>
            <button role="tab" aria-selected={tab === "java"} className={`ltab ${tab === "java" ? "on" : ""}`} onClick={() => setTab("java")}>
              <Icon name="code" size={12} />{t("proc.java")}
            </button>
          </div>
          {tab === "details"
            ? <Details snapshot={snapshot} draft={draft} ir={ir} ctx={ctx} settings={settings} all={all} onChange={onChange} api={api} onIr={setIr} />
            : <JavaView snapshot={snapshot} draft={draft} ir={ir} engine={engine} />}
        </aside>
      </div>
    </>
  );
}

function Details({ snapshot, draft, ir, ctx, settings, all, onChange, api, onIr }: {
  snapshot: ProjectSnapshot;
  draft: Element;
  ir: ProcedureIR;
  ctx: FormContext;
  settings: FieldDef[];
  all: FieldDef[];
  onChange: (key: string, value: unknown) => void;
  api: React.RefObject<WorkspaceApi | undefined>;
  onIr: (ir: ProcedureIR) => void;
}) {
  const scope = { fields: all, values: draft };
  const visible = visibility(scope);
  const deps = inferDependencies(ir, procedureLookup(snapshot.project), new Set([draft.id]));
  const provided = providedFor(snapshot, draft);
  const callers = callersOf(snapshot, draft.id);
  const blocks = countBlocks(ir);
  const setVariables = (variables: LocalVariable[], rename?: { from: string; to: string }) => {
    onIr({ ...ir, variables });
    api.current?.setVariables(variables, rename);
  };
  return (
    <div className="form procform">
      {settings.some((f) => visible(f.key)) && (
        <FormGroup title={t("proc.settings")}>
          <FieldList fields={settings} scope={scope} ctx={ctx} prefix="" coveragePrefix="" onChange={onChange} />
        </FormGroup>
      )}
      <FormGroup title={t("proc.locals")}>
        <LocalVariables variables={ir.variables} onChange={setVariables} />
      </FormGroup>
      <FormGroup title={t("proc.dependencies")}>
        {deps.length === 0 ? <p className="hint">{t("proc.noDependencies")}</p> : (
          <ul className="deplist">
            {deps.map((d) => {
              const missing = provided && !provided.includes(d);
              return (
                <li key={d} className={missing ? "missing" : ""}>
                  <code>{d}</code><span className="dim">{DEPENDENCIES[d].type}</span>
                  {missing && <span className="ferr"><Icon name="warn" size={12} />{t("proc.notProvided")}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="hint">{provided ? t("proc.providedBy", { deps: provided.join(", ") || "-" }) : t("proc.parameters")}</p>
        {callers.length > 0 && (
          <p className="hint">{t("proc.usedBy", { list: callers.map((c) => `${c.typeId}/${c.elementId}`).join(", ") })}</p>
        )}
      </FormGroup>
      <FormGroup title={t("proc.program")}>
        <div className="fval"><span>{t("proc.blockCount", { count: blocks })}</span></div>
        {blocks >= BIG_PROGRAM && <p className="hint procbig"><Icon name="warn" size={12} />{t("proc.bigProgram")}</p>}
        <p className="hint">{t("proc.sidesHint")}</p>
        <div className="sidekey">
          <span className="sk server">S</span>{t("proc.sideServer")}
          <span className="sk client">C</span>{t("proc.sideClient")}
          <span className="sk both" />{t("proc.sideBoth")}
        </div>
      </FormGroup>
    </div>
  );
}

function LocalVariables({ variables, onChange }: { variables: LocalVariable[]; onChange: (v: LocalVariable[], rename?: { from: string; to: string }) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<LocalType>("number");
  const [selected, setSelected] = useState<string>();
  const valid = isIdentifier(name) && !variables.some((v) => v.name === name);
  const add = () => {
    if (!valid) return;
    onChange([...variables, { name, type }]);
    setSelected(name);
    setName("");
  };
  return (
    <div className="listctl">
      <div className="minibar">
        <input className="mapkey" value={name} placeholder={t("proc.varName")} spellCheck={false} onChange={(e) => setName(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <select className="vartype" value={type} onChange={(e) => setType(e.target.value as LocalType)} aria-label={t("proc.varType")}>
          {LOCAL_TYPES.map((ty) => <option key={ty} value={ty}>{t(`proc.type.${ty}` as never)}</option>)}
        </select>
        <button type="button" className="mbtn" disabled={!valid} onClick={add}><Icon name="plus" size={12} /><span>{t("list.add")}</span></button>
        <button type="button" className="mbtn danger" disabled={!selected} onClick={() => (onChange(variables.filter((v) => v.name !== selected)), setSelected(undefined))}>
          <Icon name="trash" size={12} /><span>{t("list.remove")}</span>
        </button>
      </div>
      {variables.length === 0 ? <p className="listempty">{t("proc.noLocals")}</p> : (
        <div className="maprows">
          {variables.map((v) => (
            <div key={v.name} className={`maprow ${v.name === selected ? "sel" : ""}`} onClick={() => setSelected(v.name)}>
              <RenameInput value={v.name} taken={variables.map((x) => x.name)}
                onRename={(to) => onChange(variables.map((x) => (x.name === v.name ? { ...x, name: to } : x)), { from: v.name, to })} />
              <span className="dim">{t(`proc.type.${v.type}` as never)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Variable name edited in place; applied on blur or Enter when it is a free Java identifier. */
function RenameInput({ value, taken, onRename }: { value: string; taken: string[]; onRename: (to: string) => void }) {
  const [text, setText] = useState(value);
  const commit = () => {
    if (text !== value && isIdentifier(text) && !taken.includes(text)) onRename(text);
    else setText(value);
  };
  return <input className="varname" value={text} spellCheck={false} onChange={(e) => setText(e.target.value.trim())} onBlur={commit}
    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />;
}

function JavaView({ snapshot, draft, ir, engine }: { snapshot: ProjectSnapshot; draft: Element; ir: ProcedureIR; engine?: EngineInfo }) {
  const env = procEnvOf(engine, snapshot);
  const compiled = useMemo(() => (env ? compileFor(snapshot, draft, ir, env) : undefined), [snapshot, draft, ir, env?.gen, env?.loader]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!env || !compiled) return <p className="panel-empty">{t("proc.noEngine")}</p>;
  const notGenerated = compiled.issues.filter((i) => i.kind === "not_generated").length;
  return (
    <div className="javaview">
      <p className="hint">{t("proc.javaFor", { engine: engine!.name, name: elementName("procedure", draft) })}</p>
      {notGenerated > 0 && <p className="ferr"><Icon name="warn" size={12} />{t("proc.javaMissing", { count: notGenerated })}</p>}
      {compiled.segments.length > 0 && <p className="hint">{t("proc.packets", { count: compiled.segments.length })}</p>}
      <pre className="javapre" aria-label={t("proc.java")}>{compiled.source}</pre>
      {compiled.clientSource && <pre className="javapre">{compiled.clientSource}</pre>}
    </div>
  );
}
