import { useState } from "react";
import type { TaskSource, ValidationIssue } from "../../../shared/api.ts";
import { adjustable, type ProblemAction, type Severity } from "../../../../src/ir/problems.ts";
import { issueText, t } from "../strings.ts";
import { ContextMenu, type MenuItem } from "./ui.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  issues: ValidationIssue[];
  /** Problems the project ignores (problems.json, KUYRUK 196), listed only when the user shows them. */
  ignored: ValidationIssue[];
  onNewTask?: (source: TaskSource) => void;
  onAction?: (action: ProblemAction) => void;
}

const AS: Record<Severity, "problems.asError" | "problems.asWarning" | "problems.asInfo"> = { error: "problems.asError", warning: "problems.asWarning", info: "problems.asInfo" };

/**
 * The Problems tab: each problem with its severity. Warnings and info can be ignored (one problem or the whole check)
 * and their check's severity changed; errors break the build or the game and cannot (src/ir/problems.ts).
 */
export function ProblemsPanel({ issues, ignored, onNewTask, onAction }: Props) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; issue: ValidationIssue; isIgnored: boolean }>();

  const menuItems = (issue: ValidationIssue, isIgnored: boolean): MenuItem[] => {
    const items: MenuItem[] = onNewTask ? [{ label: t("newTask.menu"), onClick: () => onNewTask(problemSource(issue)) }] : [];
    if (!onAction || !issue.code || !adjustable(issue.code)) return items;
    const code = issue.code;
    if (isIgnored) items.push({ label: t("problems.unignore"), onClick: () => onAction({ kind: "unignore", code, path: issue.path }) },
      { label: t("problems.unignoreCheck"), onClick: () => onAction({ kind: "unignoreCheck", code }) });
    else if (issue.severity !== "error") items.push({ label: t("problems.ignore"), onClick: () => onAction({ kind: "ignore", code, path: issue.path }) },
      { label: t("problems.ignoreCheck"), onClick: () => onAction({ kind: "ignoreCheck", code }) });
    items.push({ label: "", separator: true }, ...(["error", "warning", "info"] as const).map((severity) => ({
      label: t(AS[severity]), checked: issue.severity === severity, onClick: () => onAction({ kind: "severity", code, severity }),
    })));
    return items;
  };

  const row = (issue: ValidationIssue, isIgnored: boolean) => {
    const severity = issue.severity ?? "error";
    const canIgnore = !!onAction && !isIgnored && severity !== "error" && adjustable(issue.code);
    return (
      <li key={issue.path + issue.message} className={`sev-${severity}${isIgnored ? " ignored" : ""}`} data-severity={severity}
        onContextMenu={(e) => {
          if (!menuItems(issue, isIgnored).length) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, issue, isIgnored });
        }}>
        <span className="psev" title={severity === "error" ? `${t("problems.severity.error")}: ${t("problems.errorNote")}` : t(`problems.severity.${severity}`)}>
          <Icon name={severity === "info" ? "info" : "warn"} size={12} />
        </span>
        <code>{issue.path}</code> {issueText(issue)}
        {isIgnored && <span className="dim">({t("problems.ignored")})</span>}
        {canIgnore && (
          <button className="vbtn pact" title={t("problems.ignore")} aria-label={t("problems.ignore")}
            onClick={() => onAction!({ kind: "ignore", code: issue.code!, path: issue.path })}><Icon name="close" size={10} /></button>
        )}
        {isIgnored && onAction && issue.code && (
          <button className="vbtn pact" title={t("problems.unignore")} aria-label={t("problems.unignore")}
            onClick={() => onAction({ kind: "unignore", code: issue.code!, path: issue.path })}><Icon name="undo" size={10} /></button>
        )}
      </li>
    );
  };

  return (
    <>
      <ul className="problems">
        {issues.length === 0 && <li className="dim">{t("status.noProblems")}</li>}
        {issues.map((issue) => row(issue, false))}
        {ignored.length > 0 && (
          <li className="ptoggle">
            <button className="mbtn" onClick={() => setShowIgnored((on) => !on)}>
              <span>{t(showIgnored ? "problems.hideIgnored" : "problems.showIgnored", { count: ignored.length })}</span>
            </button>
          </li>
        )}
        {showIgnored && ignored.map((issue) => row(issue, true))}
      </ul>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} items={menuItems(menu.issue, menu.isIgnored)} />}
    </>
  );
}

/** A problem as a task source: "item/ruby.stackSize" is the field stackSize of item/ruby. */
function problemSource(issue: ValidationIssue): TaskSource {
  const [target, ...rest] = issue.path.split(".");
  const element = /^[a-z0-9_]+\/[a-z0-9_]+$/.test(target) ? target : undefined;
  return { kind: "problem", text: issueText(issue), ...(element ? { target: element, ...(rest.length ? { field: rest.join(".").replace(/\[.*$/, "") } : {}) } : {}) };
}
