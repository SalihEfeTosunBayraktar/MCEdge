import { useMemo, useRef, useState } from "react";
import { asProgram, countBlocks, type ProcedureIR } from "../../../../src/procedures/model.ts";
import type { Element, EngineInfo, ProjectSnapshot } from "../../../shared/api.ts";
import { Icon, type IconName } from "../components/Icon.tsx";
import { t } from "../strings.ts";
import { procedureWarnings, projectChoices } from "./checks.ts";
import { ProcedureWorkspace, type WorkspaceApi } from "./ProcedureWorkspace.tsx";

/**
 * Block program inside another element's form (advancement trigger, command arguments, AI goals, ...): a
 * compact canvas with its own mini toolbar, like the other list-style controls of a form.
 */
export function EmbeddedProgram({ value, set, snapshot, element, engine, label }: {
  value: unknown;
  set: (ir: ProcedureIR) => void;
  snapshot: ProjectSnapshot;
  element: Element;
  engine?: EngineInfo;
  label: string;
}) {
  const initial = useMemo(() => asProgram(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [count, setCount] = useState(() => countBlocks(initial));
  const [query, setQuery] = useState("");
  const api = useRef<WorkspaceApi>(undefined);
  const elementRef = useRef(element);
  elementRef.current = element;
  const button = (icon: IconName, text: string, run: () => void) => (
    <button type="button" className="mbtn" title={text} onClick={run}><Icon name={icon} size={12} /><span>{text}</span></button>
  );
  return (
    <div className="embeddedprog" aria-label={label}>
      <div className="minibar" role="toolbar">
        {button("undo", t("proc.undo"), () => api.current?.undo())}
        {button("redo", t("proc.redo"), () => api.current?.redo())}
        {button("fit", t("proc.fit"), () => api.current?.fit())}
        <label className="search minisearch">
          <Icon name="search" size={12} />
          <input value={query} placeholder={t("proc.searchBlocks")} spellCheck={false}
            onChange={(e) => (setQuery(e.target.value), api.current?.search(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && api.current?.addFirst(query) && (setQuery(""), api.current.search(""))} />
        </label>
        <span className="fmeta">{t("proc.blockCount", { count })}</span>
      </div>
      <ProcedureWorkspace initial={initial} className="embedded" choices={projectChoices(snapshot)}
        onChange={(ir) => (setCount(countBlocks(ir)), set(ir))}
        check={(ir) => procedureWarnings(snapshot, elementRef.current, ir, engine, false)}
        onReady={(a) => (api.current = a)} />
    </div>
  );
}
