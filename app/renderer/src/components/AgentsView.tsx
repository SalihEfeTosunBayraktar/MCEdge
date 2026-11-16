import { useEffect, useMemo, useState } from "react";
import type { AgentTask, LiveState } from "../../../shared/api.ts";
import { agentFolders, type DateRange } from "../live/agents.ts";
import { groupTimeline, type Session } from "../live/timeline.ts";
import { language, t } from "../strings.ts";
import { AgentTasks, taskStatus } from "./AgentTasks.tsx";
import { AiPanel } from "./AiPanel.tsx";
import { AgentTimeline } from "./AgentTimeline.tsx";
import { AgentMark, Icon } from "./Icon.tsx";

interface Props {
  dir: string;
  live: LiveState;
  now: number;
  /** "activity" and "tasks" are the old panels' names (commands, editor_screenshot, links): they open the latest session or the tasks. */
  panel: "agents" | "activity" | "tasks";
  /** Called once an old panel name is handled, so the panel reads "agents" from then on. */
  onRouted: () => void;
  onOpenTarget: (target: string) => boolean;
  /** A step to show (a task's link): its session is selected. */
  show?: { session: string; step: number };
  tasks: Omit<React.ComponentProps<typeof AgentTasks>, "show">;
  /** Opens Help > Connect an AI agent (Q201). */
  onConnect: () => void;
  /** The in-app AI assistant (Q239): one more node of the tree, next to the outside agents. */
  ai?: Omit<React.ComponentProps<typeof AiPanel>, "dir" | "live">;
}

type Node = { kind: "tasks" } | { kind: "ai" } | { kind: "session"; id: string };

/** A session counts as working now while the agent's heartbeat is fresh, like the status bar's. */
const ACTIVE_MS = 60_000;

/**
 * The Agents panel (KUYRUK 195): one place for agent sessions and tasks. On the left, the tasks and a folder per agent
 * (how it introduced itself over MCP: Claude, Codex, Gemini, ...) with its sessions in date ranges; on the right, the
 * selected session's timeline with its tasks, or the task list. Folders stay open or closed per project.
 */
export function AgentsView({ dir, live, now, panel, onRouted, onOpenTarget, show, tasks, onConnect, ai }: Props) {
  const { sessions, undone } = useMemo(() => groupTimeline(live.entries), [live.entries]);
  const folders = useMemo(() => agentFolders(sessions, now), [sessions, now]);
  const [node, setNode] = useState<Node>();
  const [showTask, setShowTask] = useState<{ id: string }>();
  const [open, setOpen] = useFolderState(dir);
  const latest = sessions[0];

  useEffect(() => {
    if (panel === "agents") return;
    setNode(panel === "tasks" || !latest ? { kind: "tasks" } : { kind: "session", id: latest.id });
    onRouted();
    // Runs when an old panel name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
  // Ctrl+Shift+A selects the AI assistant (the chat itself focuses its input box).
  useEffect(() => {
    if (ai?.focusRequest) setNode({ kind: "ai" });
  }, [ai?.focusRequest]);
  useEffect(() => {
    if (show) setNode({ kind: "session", id: show.session });
  }, [show]);

  const shown = node ?? (latest ? { kind: "session", id: latest.id } : { kind: "tasks" });
  const session = shown.kind === "session" ? sessions.find((s) => s.id === shown.id) : undefined;
  const working = (s: Session) => !!live.agent && s === latest && s.id !== "earlier" && now - Date.parse(live.agent.at) < ACTIVE_MS;
  const toReview = tasks.tasks.filter((task) => task.status === "done").length;
  const isOpen = (id: string, initial: boolean) => open[id] ?? initial;
  const toggle = (id: string, initial: boolean) => setOpen({ ...open, [id]: !isOpen(id, initial) });

  return (
    <div className="agentsview">
      <nav className="agtree" role="tree" aria-label={t("timeline.sessions")}>
        <button role="treeitem" aria-selected={shown.kind === "tasks"} className={`agnode agtasks ${shown.kind === "tasks" ? "on" : ""}`}
          onClick={() => setNode({ kind: "tasks" })}>
          <Icon name="check" size={14} />
          <span className="agname">{t("agents.tasks")}</span>
          {toReview > 0 && <span className="pcount" title={t("tasks.status.done")}>{toReview}</span>}
          <span className="agcount">{tasks.tasks.length}</span>
        </button>
        {ai && (
          <button role="treeitem" aria-selected={shown.kind === "ai"} className={`agnode agtasks ${shown.kind === "ai" ? "on" : ""}`} data-testid="agent-ai-node"
            onClick={() => setNode({ kind: "ai" })}>
            <Icon name="gem" size={14} />
            <span className="agname">{t("ai.title")}</span>
            {ai.chat.running && <i className="liveled" />}
          </button>
        )}
        {folders.length === 0 && <p className="dim agempty">{t("live.noActivity")}</p>}
        {folders.map((folder) => {
          const id = folder.provider;
          const expanded = isOpen(id, true);
          return (
            <div key={id} className="agfolder" role="treeitem" aria-expanded={expanded} data-provider={id}>
              <button className="agnode aghead" onClick={() => toggle(id, true)}>
                <span className={`tchev ${expanded ? "open" : ""}`}><Icon name="chev" size={10} /></span>
                <AgentMark name={id} size={16} />
                <span className="agname">{t(`agents.provider.${id}`)}</span>
                {folder.ranges.some((r) => r.sessions.some(working)) && <i className="liveled" title={t("live.activeHint")} />}
                <span className="agcount">{folder.sessions}</span>
              </button>
              {expanded && (
                <div role="group">
                  {folder.ranges.map(({ range, sessions: inRange }) => {
                    const rangeId = `${id}/${range}`;
                    const rangeOpen = isOpen(rangeId, !range.startsWith("month:"));
                    return (
                      <div key={range} className="agrange" role="treeitem" aria-expanded={rangeOpen} data-range={range}>
                        <button className="agnode agrangehead" onClick={() => toggle(rangeId, !range.startsWith("month:"))}>
                          <span className={`tchev ${rangeOpen ? "open" : ""}`}><Icon name="chev" size={10} /></span>
                          <span className="agname">{rangeLabel(range)}</span>
                          <span className="agcount">{inRange.length}</span>
                        </button>
                        {rangeOpen && inRange.map((s) => (
                          <button key={s.id} role="treeitem" aria-selected={s === session} className={`agnode agsession ${s === session ? "on" : ""}`}
                            data-session={s.id} onClick={() => setNode({ kind: "session", id: s.id })} title={sessionTitle(s)}>
                            <i className={`liveled ${working(s) ? "" : "off"}`} />
                            <span className="agname">{s.id === "earlier" ? t("timeline.earlier") : s.model ?? s.client ?? t("live.agent")}</span>
                            <span className="dim mono">{when(s.last, range)}</span>
                            <span className="dim agcalls">{t("timeline.calls", { count: s.calls })}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <button className="agnode agconnect" onClick={onConnect} title={t("connect.title")}>
          <Icon name="plus" size={14} />
          <span className="agname">{t("agents.connect")}</span>
        </button>
      </nav>
      {shown.kind === "ai" && ai ? (
        <AiPanel dir={dir} live={live} {...ai} />
      ) : shown.kind === "tasks" ? (
        <AgentTasks {...tasks} show={showTask} />
      ) : (
        <AgentTimeline key={session?.id} dir={dir} live={live} now={now} session={session} undone={undone} latest={!!session && session === latest}
          onOpenTarget={onOpenTarget} show={show}
          header={session && <SessionTasks session={session} tasks={tasks.tasks} onShow={(id) => (setShowTask({ id }), setNode({ kind: "tasks" }))} />} />
      )}
    </div>
  );
}

/** Tasks the session held: claimed by it, or named by its calls. */
function SessionTasks({ session, tasks, onShow }: { session: Session; tasks: AgentTask[]; onShow: (id: string) => void }) {
  const ids = new Set(session.steps.flatMap((s) => s.calls.map((c) => c.task)).filter((id): id is string => !!id));
  const held = tasks.filter((task) => task.owner?.session === session.id || ids.has(task.id));
  if (!held.length) return null;
  return (
    <section className="agsessiontasks" aria-label={t("agents.sessionTasks")}>
      <div className="tlnoteshead">{t("agents.sessionTasks")}</div>
      <ul>
        {held.map((task) => (
          <li key={task.id}>
            <span className={`taskstatus ${task.status}`}>{t(taskStatus(task))}</span>
            <button className="linkbtn" onClick={() => onShow(task.id)}>{task.title}</button>
            {task.result && <span className="dim">{task.result.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function rangeLabel(range: DateRange): string {
  if (!range.startsWith("month:")) return t(`agents.range.${range as "today" | "yesterday" | "week"}`);
  const [year, month] = range.slice(6).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(language(), { month: "long", year: "numeric" });
}

/** Time of day within the week, the date before. */
const when = (at: string, range: DateRange) =>
  range === "today" || range === "yesterday" ? new Date(at).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" })
    : new Date(at).toLocaleDateString(language(), { day: "numeric", month: "short", ...(range === "week" ? { weekday: "short" } : {}) });

const sessionTitle = (s: Session) => [s.client && `${s.client}${s.clientVersion ? ` ${s.clientVersion}` : ""}`, s.model, new Date(s.start).toLocaleString(language())].filter(Boolean).join(" · ");

/** Open/closed folders of the tree by id, kept per project in localStorage; unavailable storage just does not keep them. */
function useFolderState(dir: string): [Record<string, boolean>, (next: Record<string, boolean>) => void] {
  const key = `mcedge.agents.folders.${dir}`;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  };
  const [state, setState] = useState<Record<string, boolean>>(read);
  useEffect(() => setState(read()), [key]);
  return [state, (next) => {
    setState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* not kept */ }
  }];
}
