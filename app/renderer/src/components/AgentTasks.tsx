import { useEffect, useState } from "react";
import type { ActivityEntry, AgentTask, TaskSource } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { ActionBar, ActionButton, DataTable, Dialog, FindBar, FindSelect, FormGroup, FormRow, PanelEmpty, Separator, SidePanel } from "./ui.tsx";

type Filter = "todo" | "all" | AgentTask["status"];

interface Props {
  dir: string;
  tasks: AgentTask[];
  /** The timeline entries, to link a task to the steps the agent made for it. */
  entries: ActivityEntry[];
  onNewTask: (source: TaskSource) => void;
  /** Shows a step in its session's timeline. */
  onShowStep: (session: string, step: number) => void;
  onOpenTarget: (target: string) => boolean;
  /** A task to select (picked in a session's timeline, KUYRUK 195). */
  show?: { id: string };
}

/** Status shown to the user; a task reopened by the user and not claimed again says so. */
export const taskStatus = (task: AgentTask): StringKey =>
  task.status === "open" && task.review?.verdict === "reopened" ? "tasks.status.reopened" : `tasks.status.${task.status}`;

const when = (at: string) => new Date(at).toLocaleString();

/** What a task is about, in words: "Field stackSize of item/ruby". */
export function sourceText(source: TaskSource): string {
  if (source.kind === "field") return t("newTask.source.field", { field: source.field ?? "", target: source.target ?? "" });
  if (source.kind === "element") return t("newTask.source.element", { target: source.target ?? "" });
  if (source.kind === "problem") return t("newTask.source.problem", { text: `${source.target ? `${source.target}${source.field ? `.${source.field}` : ""}: ` : ""}${source.text ?? ""}` });
  if (source.kind === "build") return t("newTask.source.build", { text: source.text ?? "" });
  return t("newTask.source.free");
}

/**
 * Agent tasks (KUYRUK 146): what the user asked the agent to do, with status, owner, progress, result and the timeline
 * steps the agent made for it. The user creates tasks here or by right-clicking an element, a field, a problem or a
 * build error, and accepts or reopens a finished one.
 */
export function AgentTasks({ dir, tasks, entries, onNewTask, onShowStep, onOpenTarget, show }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    if (!show) return;
    setSelected(show.id);
    setQuery("");
    setFilter("all");
  }, [show]);
  const [reopening, setReopening] = useState(false);
  const q = query.trim().toLowerCase();
  const rows = [...tasks].reverse().filter((task) =>
    (filter === "all" || (filter === "todo" ? task.status === "open" || task.status === "claimed" : task.status === filter))
    && (!q || [task.title, task.detail, task.source.target, task.source.text, task.result?.text].some((s) => s?.toLowerCase().includes(q))));
  // The selection follows what is listed (KUYRUK 112): a task the filter hides is not acted on.
  const current = rows.find((task) => task.id === selected);
  const steps = current ? taskSteps(entries, current.id) : [];

  return (
    <div className="tasksview">
      <FindBar query={query} onQuery={setQuery} placeholder={t("tasks.search")} meta={t("tasks.count", { count: tasks.length })}>
        <FindSelect<Filter> icon="filter" label={t("find.filter")} value={filter} onChange={setFilter} options={[
          { value: "all", label: t("tasks.filter.all") },
          { value: "todo", label: t("tasks.filter.todo") },
          ...(["open", "claimed", "done", "accepted"] as const).map((s) => ({ value: s, label: t(`tasks.status.${s}`) })),
        ]} />
      </FindBar>
      <ActionBar>
        <ActionButton icon="plus" label={t("tasks.new")} tone="primary" onClick={() => onNewTask({ kind: "free" })} />
        <Separator />
        <ActionButton icon="check" label={t("tasks.accept")} disabled={current?.status !== "done"}
          onClick={() => current && void api.reviewAgentTask(dir, current.id, "accepted")} />
        <ActionButton icon="undo" label={t("tasks.reopen")} disabled={current?.status !== "done" && current?.status !== "accepted"} onClick={() => setReopening(true)} />
        <Separator />
        <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" disabled={!current}
          onClick={() => current && (void api.deleteAgentTask(dir, current.id), setSelected(undefined))} />
      </ActionBar>
      <div className="split">
        <DataTable rows={rows} rowKey={(task) => task.id} selected={current?.id} onSelect={setSelected} empty={tasks.length ? t("list.noMatch") : t("tasks.empty")}
          columns={[
            { label: t("tasks.col.status"), width: "16%", cell: (task) => <span className={`taskstatus ${task.status}`}>{t(taskStatus(task))}</span> },
            { label: t("tasks.col.title"), width: "34%", cell: (task) => task.title },
            { label: t("tasks.col.about"), width: "22%", cell: (task) => <span className="dim">{sourceText(task.source)}</span> },
            { label: t("tasks.col.owner"), width: "14%", cell: (task) => task.owner?.client ?? <span className="dim">{t("tasks.nobody")}</span> },
            { label: t("tasks.col.updated"), cell: (task) => <span className="dim mono">{when(task.updated)}</span> },
          ]} />
        <SidePanel title={t("tasks.detail")}>
          {current ? (
            <div className="form taskdetail">
              <FormGroup title={current.title}>
                <FormRow label={t("tasks.col.status")}><span className={`taskstatus ${current.status}`}>{t(taskStatus(current))}</span></FormRow>
                <FormRow label={t("tasks.col.about")}>
                  {current.source.target ? <button className="linkbtn" onClick={() => onOpenTarget(current.source.target!)}>{sourceText(current.source)}</button> : sourceText(current.source)}
                </FormRow>
                {current.detail && <FormRow label={t("newTask.detail")} top><p className="taskdetailtext">{current.detail}</p></FormRow>}
                <FormRow label={t("tasks.col.owner")}>{current.owner?.client ?? t("tasks.nobody")}</FormRow>
                {current.review?.verdict === "reopened" && current.review.comment && (
                  <FormRow label={t("tasks.reopenedBecause")} top><p className="taskdetailtext">{current.review.comment}</p></FormRow>
                )}
              </FormGroup>
              {!!current.progress?.length && (
                <FormGroup title={t("tasks.progress")}>
                  <ul className="taskprogress">{current.progress.map((p, i) => <li key={i}><span className="dim mono">{new Date(p.at).toLocaleTimeString()}</span> {p.text}</li>)}</ul>
                </FormGroup>
              )}
              {current.result && (
                <FormGroup title={t("tasks.result")}>
                  <p className="taskresult" data-testid="task-result">{current.result.text}</p>
                </FormGroup>
              )}
              {steps.length > 0 && (
                <FormGroup title={t("tasks.steps")}>
                  <ul className="tasksteps">
                    {steps.map((s) => (
                      <li key={`${s.session}#${s.step}`}>
                        <button className="linkbtn" onClick={() => onShowStep(s.session, s.step)}>{t("tasks.stepLink", { client: s.client ?? t("live.agent"), n: s.step })}</button>
                        <span className="dim">{t("timeline.calls", { count: s.calls })}</span>
                      </li>
                    ))}
                  </ul>
                </FormGroup>
              )}
            </div>
          ) : <PanelEmpty text={t("tasks.selectHint")} />}
        </SidePanel>
      </div>
      {reopening && current && <ReopenDialog onCancel={() => setReopening(false)}
        onReopen={(comment) => (setReopening(false), void api.reviewAgentTask(dir, current.id, "reopened", comment))} />}
    </div>
  );
}

/** Timeline steps with calls the agent made while it held the task. */
function taskSteps(entries: ActivityEntry[], id: string) {
  const steps = new Map<string, { session: string; step: number; client?: string; calls: number }>();
  for (const e of entries) {
    if (e.task !== id || !e.session) continue;
    const key = `${e.session}#${e.step ?? 0}`;
    const step = steps.get(key) ?? { session: e.session, step: e.step ?? 0, client: e.client, calls: 0 };
    step.calls++;
    steps.set(key, step);
  }
  return [...steps.values()];
}

function ReopenDialog({ onCancel, onReopen }: { onCancel: () => void; onReopen: (comment: string) => void }) {
  const [comment, setComment] = useState("");
  return (
    <Dialog title={t("reopen.title")} okLabel={t("reopen.ok")} canOk={!!comment.trim()} onOk={() => onReopen(comment)} onCancel={onCancel}>
      <div className="form">
        <FormRow label={t("reopen.reason")} top>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </FormRow>
      </div>
    </Dialog>
  );
}

/** A new task for the agent, about what it was made from (prefilled) or about nothing in particular. */
export function NewTaskDialog({ dir, source, onCancel, onCreated }: { dir: string; source: TaskSource; onCancel: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(() => (source.kind === "problem" || source.kind === "build" ? t("newTask.fixTitle", { text: source.text ?? "" }).slice(0, 120) : ""));
  const [detail, setDetail] = useState("");
  const create = async () => {
    await api.createAgentTask(dir, { title, detail, source });
    onCreated();
  };
  return (
    <Dialog title={t("newTask.title")} okLabel={t("newTask.create")} canOk={!!title.trim()} onOk={() => void create()} onCancel={onCancel}>
      <div className="form newtask">
        <FormRow label={t("tasks.col.about")}><span className="newtaskabout">{sourceText(source)}</span></FormRow>
        <FormRow label={t("newTask.field")}>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={t("newTask.titleHint")} />
        </FormRow>
        <FormRow label={t("newTask.detail")} top>
          <textarea rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t("newTask.detailHint")} />
        </FormRow>
        <p className="hint">{t("newTask.hint")}</p>
      </div>
    </Dialog>
  );
}
