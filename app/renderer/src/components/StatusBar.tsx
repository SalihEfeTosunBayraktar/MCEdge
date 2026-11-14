import { isRunKey } from "../../../shared/api.ts";
import type { PanelId } from "./BottomPanel.tsx";
import type { EngineBuild } from "../model.ts";
import { useSaving } from "../saveStatus.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  problems: number;
  elements?: number;
  builds: Record<string, EngineBuild>;
  engineName: string;
  /** An AI agent working on the project over MCP (live co-editing). */
  agent?: { client?: string; active: boolean; recent: number };
  onOpenPanel: (panel: PanelId) => void;
  /** A project (or a Gradle mod) is open; without one the bar stays empty (KUYRUK 137, U16). */
  open: boolean;
}

/** Save state, problems, active engine and Gradle state. */
export function StatusBar({ problems, elements, builds, engineName, agent, onOpenPanel, open }: Props) {
  const saving = useSaving();
  const entries = Object.entries(builds);
  const running = entries.find(([, b]) => b.status === "running" || b.status === "waiting");
  // Client runs end with a non-zero code when stopped; only real builds count toward the summary.
  const builtOnly = entries.filter(([key]) => !isRunKey(key));
  const ok = builtOnly.filter(([, b]) => b.status === "ok").length;
  const failed = builtOnly.some(([, b]) => b.status === "failed" && !b.stopped);
  const cancelled = builtOnly.some(([, b]) => b.stopped);
  const runKind = running?.[0].match(/ (client|server|gradle)$/)?.[1];
  const gradle = running
    ? t(runKind === "client" ? "status.running" : runKind === "server" ? "status.server" : runKind === "gradle" ? "status.gradle" : "status.building",
      { engine: running[0].replace(/ (client|server|gradle)$/, "") })
    : failed ? t("status.failed", { ok, total: builtOnly.length })
    : cancelled ? t("status.cancelled", { ok, total: builtOnly.length })
    : builtOnly.length ? t("status.built", { ok, total: builtOnly.length }) : t("status.idle");
  const tone = running ? "running" : failed ? "failed" : "ok";
  if (!open) return <footer className="status" />;
  return (
    <footer className="status">
      <span className={`smsg ${saving ? "saving" : ""}`}>
        <Icon name={saving ? "edit" : "check"} />
        {t(saving ? "editor.saving" : "editor.saved")}
        {elements !== undefined && <span className="dim">{t("status.summary", { count: elements })}</span>}
      </span>
      <span className="sgrow" />
      {agent && (
        <button className={`sitem agent ${agent.active ? "on" : ""}`} onClick={() => onOpenPanel("activity")}
          title={t(agent.active ? "live.activeHint" : "live.idleHint")}>
          <i className={`liveled ${agent.active ? "" : "off"}`} />
          {agent.active ? t("live.active", { client: agent.client ?? t("live.agent"), count: agent.recent }) : t("live.idle")}
        </button>
      )}
      <button className={`sitem ${problems ? "warn" : ""}`} onClick={() => onOpenPanel("problems")}>
        <Icon name="warn" />
        {problems ? t("status.problems", { count: problems }) : t("status.noProblems")}
      </button>
      <span className="sitem" title={t("top.engine")}>{engineName}</span>
      <button className="sitem gradle" onClick={() => onOpenPanel("build")}>
        <i className={`led ${tone}`} />{gradle}
      </button>
    </footer>
  );
}
