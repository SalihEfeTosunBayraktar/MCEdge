import { useEffect, useRef, useState } from "react";
import type { LiveState } from "../../../shared/api.ts";
import type { UndoResult } from "../../../../src/live/timeline.ts";
import { api } from "../api.ts";
import type { AiPart, AiTurn, useAiPanel } from "../hooks/useAiPanel.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { ManualPath } from "./ManualPath.tsx";

interface Props {
  dir: string;
  chat: ReturnType<typeof useAiPanel>;
  live: LiveState;
  /** Preferences changed: asks again whether a provider is set. */
  preferencesRev: unknown;
  onPreferences: () => void;
  /** Changes when Ctrl+Shift+A asks for the input box. */
  focusRequest: number;
  /** A message to put in the input box (not sent); a new `n` replaces what is typed. */
  draft?: { text: string; n: number };
}

/** What a tool call is about, for its row: "item/ruby" for an element, else its id, path or name. */
function targetOf(args: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  if (text(args.type) && text(args.id)) return `${text(args.type)}/${text(args.id)}`;
  return text(args.id) || text(args.path) || text(args.name);
}

const isValues = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function ToolRow({ part }: { part: Extract<AiPart, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const target = targetOf(part.args);
  const status = t(part.status === "running" ? "ai.toolRunning" : part.status === "ok" ? "ai.toolOk" : "ai.toolFailed");
  return (
    <div className={`aitool ${part.status}`} data-testid="ai-tool" data-tool={part.name}>
      <button type="button" className="aitoolhead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`tchev ${open ? "open" : ""}`}><Icon name="chev" size={10} /></span>
        <code className="aitoolname">{part.name}</code>
        {target && <span className="aitooltarget">{target}</span>}
        <span className="aitoolstatus">{status}</span>
      </button>
      {part.status === "ok" && <ManualPath call={{ tool: part.name, target, fields: isValues(part.args.values) ? Object.keys(part.args.values) : undefined }} />}
      {open && (
        <div className="aitoolbody">
          <p className="aihead">{t("ai.toolArguments")}</p>
          <pre>{JSON.stringify(part.args, null, 2)}</pre>
          {part.result !== undefined && (
            <>
              <p className="aihead">{t("ai.toolResult")}</p>
              <pre>{part.result}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Reply({ dir, turn, live }: { dir: string; turn: AiTurn; live: LiveState }) {
  const [result, setResult] = useState<UndoResult>();
  const calls = turn.parts.flatMap((p) => (p.kind === "tool" && p.call ? [p.call] : []));
  // What the reply changed and nobody took back yet, from the project's activity log.
  const changed = live.entries.filter((e) => e.call && calls.includes(e.call) && e.changes?.length);
  const undone = new Set(live.entries.flatMap((e) => e.undoes ?? []));
  const open = changed.filter((e) => !undone.has(e.call!));
  const wasUndone = changed.length > 0 && open.length === 0;
  return (
    <div className="aireply" data-testid="ai-reply">
      <p className="aihead">{t("ai.assistant")}</p>
      {turn.parts.map((part, i) => part.kind === "text"
        ? <p key={i} className="aitext" data-testid="ai-text">{part.text}</p>
        : <ToolRow key={part.id} part={part} />)}
      {turn.running && <p className="dim aiworking">{t("ai.working")}...</p>}
      {turn.stopped && <p className="dim">{t("ai.stopped")}</p>}
      {turn.error && <p className="aierror" role="alert" data-testid="ai-error">{turn.error.code === "rounds" ? t("ai.roundsLimit") : t("ai.error", { message: turn.error.message })}</p>}
      {!turn.running && changed.length > 0 && (
        wasUndone ? <p className="dim" data-testid="ai-undone">{t("ai.undone")}</p> : (
          <button type="button" className="abtn" data-testid="ai-undo" onClick={() => void api.liveUndo(dir, open.map((e) => e.call!)).then(setResult)}>
            <Icon name="undo" size={14} />{t("ai.undo")}
          </button>
        )
      )}
      {result && !result.ok && (
        <div className="aiconflicts" data-testid="ai-conflicts">
          <p className="hint">{t(result.missing.length ? "timeline.missingText" : "ai.conflictText")}</p>
          <ul>
            {result.conflicts.map((c, i) => <li key={i}><code>{c.path}</code>{c.field ? <> <b>{c.field}</b></> : null}: {c.agent ?? t("timeline.absent")} / {c.now ?? t("timeline.absent")}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The AI assistant (Q239, docs/AI-PANEL.md): the conversation of the open project, one more agent in the Agents panel. The AI works
 * through the project's own MCP server, so what it changes shows in the Agents view and "Undo this reply" is the
 * per-call undo of the calls that reply made.
 */
export function AiPanel({ dir, chat, live, preferencesRev, onPreferences, focusRequest, draft }: Props) {
  const [configured, setConfigured] = useState<boolean>();
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.aiStatus().then((s) => setConfigured(s.configured));
  }, [preferencesRev]);
  useEffect(() => {
    input.current?.focus();
  }, [configured, focusRequest]);
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft?.n]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.turns]);

  const send = () => {
    if (!text.trim() || chat.running) return;
    chat.send(text);
    setText("");
  };
  return (
    <section className="aipanel" aria-label={t("ai.title")} data-testid="ai-panel">
      <header className="aihdr">
        <b>{t("ai.title")}</b>
        <button type="button" className="abtn" disabled={chat.running || !chat.turns.length} onClick={chat.reset} data-testid="ai-new">{t("ai.new")}</button>
      </header>
      {configured === false ? (
        <div className="ainone" data-testid="ai-no-provider">
          <p>{t("ai.noProvider")}</p>
          <button type="button" className="abtn primary" onClick={onPreferences}>{t("ai.openPrefs")}</button>
        </div>
      ) : (
        <>
          <div className="ailog" ref={log}>
            {!chat.turns.length && <p className="dim aiempty">{t("ai.empty")}</p>}
            {chat.turns.map((turn) => (
              <section key={turn.id} className="aiturn">
                <div className="aiuser" data-testid="ai-user"><p className="aihead">{t("ai.you")}</p><p className="aitext">{turn.user}</p></div>
                <Reply dir={dir} turn={turn} live={live} />
              </section>
            ))}
          </div>
          <footer className="aiinput">
            <textarea ref={input} rows={3} value={text} placeholder={t("ai.placeholder")} data-testid="ai-input"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }} />
            {chat.running
              ? <button type="button" className="abtn danger" data-testid="ai-stop" onClick={chat.stop}><Icon name="stop" size={14} />{t("ai.stop")}</button>
              : <button type="button" className="abtn primary" data-testid="ai-send" disabled={!text.trim()} onClick={send}>{t("ai.send")}</button>}
          </footer>
        </>
      )}
    </section>
  );
}
