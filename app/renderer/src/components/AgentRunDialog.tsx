import { useRef } from "react";
import type { ApprovalChoice, ApprovalRequest } from "../../../shared/api.ts";
import { LANGUAGES, t, type StringKey } from "../strings.ts";
import { useDialogFocus } from "./ui.tsx";

/**
 * An AI agent asks to start something heavy over MCP (Q255: build, run_client, ...). Modal, never dismissed by a click
 * outside; Deny has the focus. The MCP server waits for the answer and refuses when nobody gives one.
 */
export function AgentRunDialog({ request, more, onAnswer }: { request: ApprovalRequest; more: number; onAnswer: (answer: ApprovalChoice) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const label = `agentRun.tool.${request.tool}` as StringKey;
  return (
    <div className="backdrop">
      <div ref={box} className="dialog agentrundlg" role="alertdialog" aria-label={t("agentRun.title")} data-testid="agent-run" onKeyDown={(e) => e.key === "Escape" && onAnswer("deny")}>
        <div className="ptitle">{t("agentRun.title")}</div>
        <p>{t("agentRun.text", { agent: request.client ?? t("agentRun.unknownAgent"), tool: request.tool })}</p>
        <p className="agentrun-what">{label in LANGUAGES.en.strings ? t(label) : t("agentRun.generic")}</p>
        {request.summary !== "{}" && <pre className="agentrun-args">{request.summary}</pre>}
        {more > 0 && <p className="hint">{t("agentRun.more", { count: more })}</p>}
        <p className="hint">{t("agentRun.hint")}</p>
        <div className="dlg-buttons">
          <button type="button" className="abtn primary" data-testid="agent-run-once" onClick={() => onAnswer("once")}><span>{t("agentRun.once")}</span></button>
          <button type="button" className="abtn" data-testid="agent-run-session" onClick={() => onAnswer("session")}><span>{t("agentRun.session")}</span></button>
          <button type="button" className="abtn danger" data-testid="agent-run-deny" autoFocus onClick={() => onAnswer("deny")}><span>{t("agentRun.deny")}</span></button>
        </div>
      </div>
    </div>
  );
}
