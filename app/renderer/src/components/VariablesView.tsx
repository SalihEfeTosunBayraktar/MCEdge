import { useEffect, useState } from "react";
import { VARIABLE_SCOPES, VARIABLE_TYPES } from "../../../../src/ir/types.ts";
import type { ProjectSnapshot, Variable } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { useAutosave } from "../hooks/useAutosave.ts";
import { t } from "../strings.ts";
import { useRevealQuery } from "../hooks/reveal.ts";
import { ActionButton, DataTable, FindBar, FindSelect, FormRow, Problems } from "./ui.tsx";
import { InspectorToggle, ViewShell, type DockSection } from "../dock/Dock.tsx";

const DEFAULT_INITIAL: Record<Variable["type"], string> = {
  number: "0", logic: "false", string: "", itemstack: "minecraft:air", blockstate: "minecraft:air", direction: "north",
};

type Scope = "all" | Variable["scope"];
type Sort = "name" | "type";

interface Props {
  snapshot: ProjectSnapshot;
  onSaved: (snapshot: ProjectSnapshot) => void;
}

/** Read-only variable list; the selected variable is edited in the side panel. Rows are keyed by index. */
export function VariablesView({ snapshot, onSaved }: Props) {
  const [variables, setVariables] = useAutosave<Variable[]>(snapshot.project.variables, async (next) =>
    onSaved(await api.saveVariables(snapshot.dir, next)),
  );
  const [query, setQuery] = useState("");
  useRevealQuery("variables", setQuery);
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [selected, setSelected] = useState<number>();

  const rows = variables
    .map((v, index) => ({ v, index }))
    .filter(({ v }) => (scope === "all" || v.scope === scope) && v.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === "type" ? a.v.type.localeCompare(b.v.type) : 0) || a.v.name.localeCompare(b.v.name));
  // The selection follows what is listed (KUYRUK 112/147): a variable the filter or search hides is dropped, and
  // stays dropped when they are cleared, so Delete selected never reaches a row the user cannot see. Only a change of
  // the filter or search drops it: renaming the selected variable in the panel keeps it while typing.
  const shown = selected !== undefined && rows.some((r) => r.index === selected);
  useEffect(() => void (!shown && setSelected(undefined)), [query, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = selected !== undefined ? variables[selected] : undefined;

  const update = (patch: Partial<Variable>) =>
    selected !== undefined && setVariables(variables.map((v, i) => (i === selected ? { ...v, ...patch } : v)));
  /** The new variable is shown: it takes the filtered scope, and a search it would not match is cleared. */
  const add = () => {
    const name = nextFreeName(variables);
    setVariables([...variables, { name, type: "number", scope: scope === "all" ? "global_world" : scope, initial: DEFAULT_INITIAL.number }]);
    if (!name.toLowerCase().includes(query.trim().toLowerCase())) setQuery("");
    setSelected(variables.length);
  };
  const remove = () => {
    setVariables(variables.filter((_, i) => i !== selected));
    setSelected(undefined);
  };
  const issues = snapshot.issues.filter((issue) => issue.path.startsWith("variables["));
  /** The selected variable, edited in the inspector (Q284), then the project's variable problems and the note. */
  const sections: DockSection[] = [
    { id: "variables.variable", icon: "vars", title: t("group.variable"), body: !current ? <p className="hint">{t("variables.selectHint")}</p> : (
      <div className="form">
        <FormRow label={t("variables.name")}>
          <input value={current.name} onChange={(e) => update({ name: e.target.value.trim() })} />
        </FormRow>
        <FormRow label={t("variables.type")}>
          <select value={current.type} onChange={(e) => {
            const type = e.target.value as Variable["type"];
            update({ type, initial: DEFAULT_INITIAL[type] });
          }}>
            {VARIABLE_TYPES.map((type) => <option key={type} value={type}>{t(`varType.${type}`)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("variables.scope")}>
          <select value={current.scope} onChange={(e) => update({ scope: e.target.value as Variable["scope"] })}>
            {VARIABLE_SCOPES.map((s) => <option key={s} value={s}>{t(`scope.${s}`)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("variables.initial")}>
          {current.type === "logic" ? (
            <select value={current.initial} onChange={(e) => update({ initial: e.target.value })}>
              <option value="false">false</option><option value="true">true</option>
            </select>
          ) : (
            <input value={current.initial} onChange={(e) => update({ initial: e.target.value })} />
          )}
        </FormRow>
      </div>
    ) },
    { id: "variables.problems", icon: "warn", title: t("dock.problems"), badge: issues.length ? String(issues.length) : undefined, defaultOpen: issues.length > 0,
      body: issues.length ? <Problems issues={issues} /> : <p className="hint">{t("dock.noProblemsHere")}</p> },
    { id: "variables.note", icon: "info", title: t("dock.about"), defaultOpen: false, body: <p className="hint">{t("variables.note")}</p> },
  ];

  return (
    <section className="view">
      <FindBar query={query} onQuery={setQuery} placeholder={t("variables.search")}
        meta={t("variables.count", { count: variables.length })}
        actions={<>
          {current && <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" onClick={remove} />}
          <ActionButton icon="plus" label={t("variables.add")} tone="primary" onClick={add} />
          <InspectorToggle />
        </>}>
        <FindSelect icon="filter" label={t("find.filter")} value={scope} onChange={setScope} options={[
          { value: "all", label: t("variables.allScopes") },
          ...VARIABLE_SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) })),
        ]} />
        <FindSelect icon="sort" label={t("find.sort")} value={sort} onChange={setSort} options={[
          { value: "name", label: t("sort.name") },
          { value: "type", label: t("sort.type") },
        ]} />
      </FindBar>
      <ViewShell sections={sections} inspectorLabel={t("dock.inspector")} inspectorClass="tagsinsp">
        <DataTable rows={rows} rowKey={(r) => String(r.index)} selected={selected === undefined ? undefined : String(selected)}
          onSelect={(key) => setSelected(Number(key))} empty={variables.length ? t("list.noMatch") : t("variables.empty")}
          columns={[
            { label: t("variables.name"), width: "30%", cell: (r) => <code>{r.v.name}</code> },
            { label: t("variables.type"), width: "18%", cell: (r) => t(`varType.${r.v.type}`) },
            { label: t("variables.scope"), width: "24%", cell: (r) => t(`scope.${r.v.scope}`) },
            { label: t("variables.initial"), cell: (r) => <code>{r.v.initial || "—"}</code> },
          ]} />
      </ViewShell>
    </section>
  );
}

function nextFreeName(variables: Variable[]): string {
  const taken = new Set(variables.map((v) => v.name));
  let n = variables.length + 1;
  while (taken.has(`variable${n}`)) n++;
  return `variable${n}`;
}
