import { isRunKey } from "../../../shared/api.ts";
import type { PanelId } from "./BottomPanel.tsx";
import type { EngineBuild } from "../model.ts";
import { useSaving } from "../saveStatus.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { gameRunning, UpdateItem } from "./Updates.tsx";

interface Props {
  problems: number;
  builds: Record<string, EngineBuild>;
  /** Shown only for a code (Gradle mod) project's JDK; a mod project's engine is in the header (Q260). */
  engineName: string;
  /** An AI agent working on the project over MCP (live co-editing). */
  agent?: { client?: string; active: boolean; recent: number };
  onOpenPanel: (panel: PanelId) => void;
  /** Double click on the empty part of the bar: shows the bottom panel (last viewed tab) or hides it (Q209). */
  onTogglePanel: () => void;
  panelOpen: boolean;
  /** A project (or a Gradle mod) is open; without one the bar stays empty (KUYRUK 137, U16). */
  open: boolean;
}

/** Save state, problems, active engine and Gradle state; an update in progress shows with or without a project (Q207). */
export function StatusBar({ problems, builds, engineName, agent, onOpenPanel, onTogglePanel, panelOpen, open }: Props) {
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
  const update = <UpdateItem gameRunning={gameRunning(builds)} />;
  if (!open) return <footer className="status"><span className="sgrow" />{update}</footer>;
  return (
    <footer className="status">
      <span className={`smsg ${saving ? "saving" : ""}`} role="status">
        <Icon name={saving ? "edit" : "check"} />
        {t(saving ? "editor.saving" : "editor.saved")}
      </span>
      <button className={`sgrow toggle ${panelOpen ? "shown" : ""}`} title={t("status.togglePanel")} aria-label={t("status.togglePanel")}
        aria-expanded={panelOpen} onClick={(e) => e.detail < 2 && onTogglePanel()}>
        <Icon name="up" />
      </button>
      {update}
      {agent && (
        <button className={`sitem agent ${agent.active ? "on" : ""}`} onClick={() => onOpenPanel("activity")}
          title={t(agent.active ? "live.activeHint" : "live.idleHint")}>
          <i className={`liveled ${agent.active ? "" : "off"}`} aria-hidden="true" />
          {agent.active ? t("live.active", { client: agent.client ?? t("live.agent"), count: agent.recent }) : t("live.idle")}
        </button>
      )}
      {/* No problems: the icon alone, named by its tooltip (Q260). */}
      <button className={`sitem ${problems ? "warn" : ""}`} onClick={() => onOpenPanel("problems")}
        title={problems ? undefined : t("status.noProblems")} aria-label={problems ? undefined : t("status.noProblems")}>
        <Icon name="warn" />
        {problems ? t("status.problems", { count: problems }) : null}
      </button>
      {engineName && <span className="sitem" title={t("top.engine")}>{engineName}</span>}
      <button className="sitem gradle" onClick={() => onOpenPanel("build")}>
        <i className={`led ${tone}`} aria-hidden="true" />{gradle}
      </button>
    </footer>
  );
}
