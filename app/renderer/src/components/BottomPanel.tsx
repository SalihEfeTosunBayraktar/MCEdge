import { useEffect, useRef, useState } from "react";
import { isRunKey, runKey, type ExperienceLevel, type LiveState, type TaskSource, type ValidationIssue } from "../../../shared/api.ts";
import { hidden } from "../experience.ts";
import type { ProblemAction } from "../../../../src/ir/problems.ts";
import type { EngineBuild } from "../model.ts";
import { t, type StringKey } from "../strings.ts";
import type { AgentTasks } from "./AgentTasks.tsx";
import { AgentsView } from "./AgentsView.tsx";
import { BuildExplain } from "./BuildExplain.tsx";
import { ProblemsPanel } from "./ProblemsPanel.tsx";
import { ScenariosView } from "./ScenariosView.tsx";
import { ContextMenu, TabList } from "./ui.tsx";
import { Icon } from "./Icon.tsx";

/** "activity" and "tasks" (the panels before KUYRUK 195) open the Agents panel at the latest session or at the tasks. */
export type PanelId = "problems" | "build" | "gradle" | "scenarios" | "agents" | "activity" | "tasks";

const isAgents = (panel: PanelId): panel is "agents" | "activity" | "tasks" => panel === "agents" || panel === "activity" || panel === "tasks";

const STATUS_KEY = { waiting: "build.waiting", running: "build.running", ok: "build.ok", failed: "build.failed" } as const;
const RUN_KEY = { waiting: "run.starting", running: "run.running", ok: "run.ended", failed: "run.crashed" } as const;

/**
 * State of a Build output entry (KUYRUK 154). Builds are waiting, building, OK or failed; runs (client, server, debug
 * client) are starting, running, stopped by the user, ended or crashed, so a stopped run never reads "Failed".
 */
function entryState(key: string, build: EngineBuild): { led: string; label: StringKey } {
  // A build stopped with Build & run > Cancel task (KUYRUK 135) reads Cancelled, not Failed.
  if (!isRunKey(key)) return build.stopped && build.status === "failed" ? { led: "stopped", label: "build.cancelled" } : { led: build.status, label: STATUS_KEY[build.status] };
  if (build.stopped && (build.status === "ok" || build.status === "failed")) return { led: "stopped", label: "run.stopped" };
  return { led: build.status === "running" || build.status === "waiting" ? `${build.status} run` : build.status, label: RUN_KEY[build.status] };
}

interface Props {
  panel: PanelId;
  issues: ValidationIssue[];
  /** Problems the project ignores (KUYRUK 196). */
  ignoredIssues?: ValidationIssue[];
  /** Ignores a problem or check, or changes a check's severity (problems.json). */
  onProblemAction?: (action: ProblemAction) => void;
  /** Fixes a problem in one step (Problems quick fix). */
  onProblemFix?: (issue: ValidationIssue) => void;
  /** The Gradle console tab (MCEdge projects; code projects build with their own wrapper). */
  console: boolean;
  /** The agent timeline of the open MCEdge project (KUYRUK 144); `show` selects a step in it. Shown in the Agents panel (KUYRUK 195). */
  agent?: { dir: string; live: LiveState; now: number; onOpenTarget: (target: string) => boolean; show?: { session: string; step: number }; onConnect: () => void; ai?: React.ComponentProps<typeof AgentsView>["ai"] };
  /** Project folder of an MCEdge project: shows the Scenarios tab (Q241). */
  scenariosDir?: string;
  /** Tasks for the agent (KUYRUK 146). */
  tasks?: React.ComponentProps<typeof AgentTasks>;
  /** Right-click on a problem or a build output line: a task for the agent made from it. */
  onNewTask?: (source: TaskSource) => void;
  builds: Record<string, EngineBuild>;
  /** Engine the Gradle console runs in. */
  engineId: string;
  onGradle: (args: string[]) => void;
  onStopGradle: () => void;
  /** Stops a running client or server entry by its key (KUYRUK 190: several clients run at once). */
  onStopRun?: (key: string) => void;
  onSelect: (panel: PanelId) => void;
  onClose: () => void;
  /** Opens Help > Report a bug; offered next to a failed build (Q208). */
  onReport?: () => void;
  /** Explained build errors (Q246): the project, the user's level, and the two buttons (go to an element and field; ask the AI). */
  explain?: { dir: string; level?: ExperienceLevel; mapped: boolean; onOpen: (element: string, field?: string) => void; onAsk: (text: string) => void };
}

const HEIGHT_KEY = "mcedge.panelHeight";
const PANEL_MIN_HEIGHT = 120;
/** Window height the rest of the screen keeps: the panel never takes the last 200 px of content (Q279), see `.bottom-panel` in styles.css. */
const readHeight = (): number | undefined => {
  try {
    const h = Number(localStorage.getItem(HEIGHT_KEY));
    return h >= PANEL_MIN_HEIGHT ? h : undefined;
  } catch {
    return undefined;
  }
};

/** The top edge of the panel: drag (or use the arrow keys) to set its height; remembered, clamped by the CSS. */
function PanelGrip({ panelRef }: { panelRef: React.RefObject<HTMLElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const apply = (h: number) => {
    const value = Math.max(PANEL_MIN_HEIGHT, Math.round(h));
    document.documentElement.style.setProperty("--panel-h", `${value}px`);
    try {
      localStorage.setItem(HEIGHT_KEY, String(value));
    } catch {
      // Lasts until the app closes.
    }
  };
  const down = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    const startY = e.clientY, startH = panel.getBoundingClientRect().height;
    setDragging(true);
    const move = (m: PointerEvent) => apply(startH + startY - m.clientY);
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up), setDragging(false));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const panel = panelRef.current;
    if (!panel || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    apply(panel.getBoundingClientRect().height + (e.key === "ArrowUp" ? 24 : -24));
  };
  return <span className={`bpgrip ${dragging ? "on" : ""}`} role="separator" aria-orientation="horizontal" aria-label={t("panel.resizeHeight")} title={t("panel.resizeHeight")}
    tabIndex={0} onPointerDown={down} onKeyDown={key} />;
}

/** Problems list, streaming build/run log and the Gradle console under the content area. */
// The remembered height is put back once, when the first panel opens.
if (typeof document !== "undefined") {
  const h = readHeight();
  if (h) document.documentElement.style.setProperty("--panel-h", `${h}px`);
}

export function BottomPanel({ panel, issues, ignoredIssues = [], onProblemAction, onProblemFix, console: hasConsole, scenariosDir, agent, tasks, onNewTask, builds, engineId, onGradle, onStopGradle, onStopRun, onSelect, onClose, onReport, explain }: Props) {
  const engineIds = Object.keys(builds).filter((id) => !id.endsWith(" gradle"));
  const [shown, setShown] = useState<string | undefined>();
  const [menu, setMenu] = useState<{ x: number; y: number; source: TaskSource }>();
  const current = shown && builds[shown] ? shown : engineIds.find((id) => builds[id].status === "running") ?? engineIds.at(-1);
  const log = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLElement>(null);
  const consoleKey = runKey(engineId, "gradle");
  const lines = panel === "gradle" ? builds[consoleKey]?.lines ?? [] : current ? builds[current].lines : [];
  useEffect(() => {
    // Block body on purpose: Chromium's scrollTo returns a Promise, which React would treat as a cleanup.
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [lines.length, panel]);

  return (
    <section ref={box} className={`bottom-panel ${isAgents(panel) || panel === "scenarios" ? "tall" : ""}`}>
      <PanelGrip panelRef={box} />
      <TabList className="panel-tabs" label={t("panel.tabs")}>
        <button role="tab" title={t("panel.problems")} className={`ptab ${panel === "problems" ? "on" : ""}`} onClick={() => onSelect("problems")}>
          <Icon name="warn" /><span className="ptlabel">{t("panel.problems")}</span>
        </button>
        <button role="tab" title={t("panel.build")} className={`ptab ${panel === "build" ? "on" : ""}`} onClick={() => onSelect("build")}>
          <Icon name="hammer" /><span className="ptlabel">{t("panel.build")}</span>
        </button>
        {hasConsole && !hidden("panels", "gradle") && (
          <button role="tab" title={t("panel.gradle")} className={`ptab ${panel === "gradle" ? "on" : ""}`} onClick={() => onSelect("gradle")}>
            <Icon name="code" /><span className="ptlabel">{t("panel.gradle")}</span>
          </button>
        )}
        {scenariosDir && !hidden("panels", "scenarios") && (
          <button role="tab" title={t("panel.scenarios")} className={`ptab ${panel === "scenarios" ? "on" : ""}`} data-testid="tab-scenarios" onClick={() => onSelect("scenarios")}>
            <Icon name="play" /><span className="ptlabel">{t("panel.scenarios")}</span>
          </button>
        )}
        <button role="tab" title={t("panel.agents")} className={`ptab ${isAgents(panel) ? "on" : ""}`} onClick={() => onSelect("agents")}>
          <Icon name="usages" /><span className="ptlabel">{t("panel.agents")}</span>
          {tasks?.tasks.some((task) => task.status === "done") && <span className="pcount">{tasks.tasks.filter((task) => task.status === "done").length}</span>}
        </button>
        <span className="sgrow" />
        <button className="vbtn" title={t("panel.close")} onClick={onClose}><Icon name="close" size={12} /></button>
      </TabList>
      {panel === "problems" ? (
        <ProblemsPanel issues={issues} ignored={ignoredIssues} onNewTask={onNewTask} onAction={onProblemAction} onFix={onProblemFix} />
      ) : isAgents(panel) ? (
        agent && tasks ? <AgentsView {...agent} panel={panel} onRouted={() => onSelect("agents")} tasks={tasks} />
          : <p className="problems dim">{t("live.noActivity")}</p>
      ) : panel === "scenarios" && scenariosDir ? (
        <ScenariosView dir={scenariosDir} engineId={engineId} />
      ) : panel === "gradle" && hasConsole ? (
        <GradleConsole lines={lines} log={log} engineId={engineId} running={["running", "waiting"].includes(builds[consoleKey]?.status ?? "")}
          onRun={onGradle} onStop={onStopGradle} />
      ) : (
        <div className="build-view">
          <ul className="engines">
            {engineIds.length === 0 && <li className="dim">{t("status.idle")}</li>}
            {engineIds.map((id) => (
              <li key={id}>
                <button className={id === current ? "on" : ""} onClick={() => setShown(id)}>
                  <i className={`led ${entryState(id, builds[id]).led}`} /> <span className="eng">{id}</span>
                  <span className="dim">{t(entryState(id, builds[id]).label)}</span>
                </button>
                {onStopRun && isRunKey(id) && ["running", "waiting"].includes(builds[id].status) && (
                  <button className="runstop" data-testid="run-stop" title={t("panel.stopRun")} aria-label={`${t("panel.stopRun")} ${id}`} onClick={() => onStopRun(id)}>
                    <Icon name="stop" size={12} />
                  </button>
                )}
              </li>
            ))}
            {onReport && current && builds[current].status === "failed" && (
              <li><button type="button" className="linkbtn reportbtn" data-testid="report-build" onClick={onReport}>{t("bug.reportThis")}</button></li>
            )}
          </ul>
          <div className="buildmain">
            {explain && current && !isRunKey(current) && builds[current].status === "failed" && !builds[current].stopped && (
              <BuildExplain dir={explain.dir} engineId={explain.mapped ? current : undefined} lines={lines} level={explain.level} onOpen={explain.onOpen} onAsk={explain.onAsk} />
            )}
            <pre ref={log} className="log" onContextMenu={onNewTask && ((e) => {
              const line = lineAt(e, lines);
              if (line) (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, source: { kind: "build", text: line } }));
            })}>{lines.join("\n")}</pre>
          </div>
        </div>
      )}
      {menu && onNewTask && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} items={[{ label: t("newTask.menu"), onClick: () => onNewTask(menu.source) }]} />}
    </section>
  );
}

/** Gradle tasks typed by hand, run in the selected engine's generated project; Up/Down walk the history. */
function GradleConsole({ lines, log, engineId, running, onRun, onStop }: {
  lines: string[];
  log: React.RefObject<HTMLPreElement | null>;
  engineId: string;
  running: boolean;
  onRun: (args: string[]) => void;
  onStop: () => void;
}) {
  const [command, setCommand] = useState("");
  const history = useRef<string[]>([]);
  const cursor = useRef(0);
  const submit = () => {
    const args = command.trim().replace(/^(gradlew?|\.\/gradlew)\s*/, "").split(/\s+/).filter(Boolean);
    if (running) return;
    history.current = [...history.current.filter((h) => h !== command.trim()), command.trim()].filter(Boolean);
    cursor.current = history.current.length;
    onRun(args);
    setCommand("");
  };
  return (
    <div className="gradle-view">
      <pre ref={log} className="log">{lines.length ? lines.join("\n") : t("gradle.intro", { engine: engineId })}</pre>
      <form className="gradle-input" onSubmit={(e) => (e.preventDefault(), submit())}>
        <span className="gprompt">{engineId} &gt; gradle</span>
        <input value={command} spellCheck={false} placeholder={t("gradle.placeholder")} aria-label={t("panel.gradle")}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            cursor.current = Math.max(0, Math.min(history.current.length, cursor.current + (e.key === "ArrowUp" ? -1 : 1)));
            setCommand(history.current[cursor.current] ?? "");
          }} />
        <button type="submit" className="mbtn" disabled={running}><Icon name="play" size={12} /><span>{t("gradle.run")}</span></button>
        <button type="button" className="mbtn danger" disabled={!running} onClick={onStop}><Icon name="stop" size={12} /><span>{t("gradle.stop")}</span></button>
      </form>
    </div>
  );
}

/** The output line under the pointer (or the selected text) of a build log. */
function lineAt(e: React.MouseEvent, lines: string[]): string | undefined {
  const selected = window.getSelection()?.toString().trim();
  if (selected) return selected;
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return undefined;
  const before = (range.startContainer.textContent ?? "").slice(0, range.startOffset);
  return lines[before.split("\n").length - 1]?.trim() || undefined;
}
