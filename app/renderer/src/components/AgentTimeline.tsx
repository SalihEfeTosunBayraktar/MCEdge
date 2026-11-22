import { useEffect, useState } from "react";
import type { ActivityEntry, LiveState, UndoResult } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { agentFocus, type Session, type Step } from "../live/timeline.ts";
import { t } from "../strings.ts";
import { Modal } from "./HelpDialogs.tsx";
import { Icon } from "./Icon.tsx";
import { ManualPath } from "./ManualPath.tsx";
import { ActionBar, ActionButton, FindBar, Separator } from "./ui.tsx";

interface Props {
  dir: string;
  live: LiveState;
  now: number;
  /** The session shown, picked in the Agents panel's tree (KUYRUK 195). */
  session?: Session;
  /** Calls taken back by an undo. */
  undone: Set<string>;
  /** The newest session: it says what the agent works on now. */
  latest: boolean;
  /** Opens an element the timeline names ("item/ruby"); false when there is no such element. */
  onOpenTarget: (target: string) => boolean;
  /** A step of this session to select and show (a task's link). */
  show?: { session: string; step: number };
  /** Shown above the steps: the session's tasks. */
  header?: React.ReactNode;
}

const time = (at: string) => new Date(at).toLocaleTimeString();

/**
 * The agent timeline (KUYRUK 144) of one session of an agent connected over MCP: its calls grouped into steps with a
 * field-level diff of each change, undo of a step or the session (refused with the conflicts when the user changed
 * the same fields since), and notes for the agent.
 */
export function AgentTimeline({ dir, live, now, session, undone, latest, onOpenTarget, show, header }: Props) {
  const [stepKey, setStepKey] = useState<string>();
  const [query, setQuery] = useState("");
  const [reads, setReads] = useState(true);
  const [result, setResult] = useState<UndoResult>();
  useEffect(() => {
    if (!show || show.session !== session?.id) return;
    setStepKey(`${show.session}#${show.step}`);
    setQuery("");
    // After the render that shows it.
    setTimeout(() => document.querySelector(`.tlstep[data-step="${show.step}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [show, session?.id]);
  const step = session?.steps.find((s) => s.key === stepKey);
  const focus = agentFocus(live.entries, now);
  const q = query.trim().toLowerCase();
  const matches = (c: ActivityEntry) => (reads || !c.read) && (!q || [c.tool, c.target, ...(c.fields ?? []), ...(c.changes ?? []).map((ch) => ch.path)].some((s) => s?.toLowerCase().includes(q)));
  const steps = (session?.steps ?? []).map((s) => ({ step: s, calls: s.calls.filter(matches) })).filter((s) => s.calls.length);

  const undo = async (calls: string[]) => setResult(await api.liveUndo(dir, calls));
  const undoable = (s?: Step) => !!s && s.open.length > 0;
  const sessionOpen = session?.steps.flatMap((s) => s.open) ?? [];

  return (
    <div className="timeline">
      <FindBar query={query} onQuery={setQuery} placeholder={t("timeline.search")} disabled={!session}
        meta={session ? t("timeline.calls", { count: session.calls }) : undefined} />
      <ActionBar>
        <ActionButton icon="undo" label={t("timeline.undoStep")} disabled={!undoable(step)} onClick={() => step && void undo(step.open)}
          title={step?.partial ? t("timeline.partial") : undefined} />
        <ActionButton icon="undo" label={t("timeline.undoSession")} disabled={!sessionOpen.length} onClick={() => void undo(sessionOpen)} />
        <Separator />
        <ActionButton icon="eye" label={t("timeline.showReads")} pressed={reads} onClick={() => setReads(!reads)} />
      </ActionBar>
      <div className="tlbody">
        <div className="tlsteps">
          {!session && <p className="dim">{t("live.noActivity")}</p>}
          {header}
          {session && focus && latest && (
            <p className="tlfocus" data-testid="agent-focus">
              <i className="liveled" />
              {t("timeline.now", { target: focus.target })}
              {focus.fields.length > 0 && <code>{focus.fields.join(", ")}</code>}
            </p>
          )}
          {steps.map(({ step: s, calls }) => {
            const allUndone = s.calls.some((c) => c.changes?.length) && !s.open.length;
            return (
              <section key={s.key} className={`tlstep ${s.key === stepKey ? "on" : ""} ${allUndone ? "undone" : ""}`} data-step={s.n}>
                <button className="tlstephead" aria-pressed={s.key === stepKey} onClick={() => setStepKey(s.key === stepKey ? undefined : s.key)}>
                  <b>{t("timeline.step", { n: s.n })}</b>
                  <span className="tltitle">{s.title ?? s.targets.join(", ")}</span>
                  {allUndone && <span className="tlbadge">{t("timeline.undone")}</span>}
                  <span className="dim mono">{time(s.calls[0].at)}</span>
                </button>
                <ul className="tlcalls">
                  {calls.map((c, i) => (
                    <li key={c.call ?? i} className={`${c.read ? "read" : ""} ${c.error ? "failed" : ""} ${c.call && undone.has(c.call) ? "undone" : ""}`}>
                      <span className="dim mono">{time(c.at)}</span>
                      <code className="tltool">{c.tool}</code>
                      {c.target && <button className="linkbtn" onClick={() => onOpenTarget(c.target!)}>{c.target}</button>}
                      {c.error && <span className="tlbadge bad">{t("timeline.failed")}</span>}
                      {c.call && undone.has(c.call) && <span className="tlbadge">{t("timeline.undone")}</span>}
                      {!c.read && !c.error && <ManualPath call={c} />}
                      {c.changes?.map((ch) => (
                        <div key={ch.path} className="tldiff">
                          <span className={`tlkind ${ch.kind}`}>{t(`timeline.kind.${ch.kind}`)}</span> <code>{ch.path}</code>
                          {ch.fields?.filter((f) => f.key !== "$schema").map((f) => (
                            <div key={f.key} className="tlfield">
                              <code>{f.key}</code>
                              <span className="tlbefore">{f.before ?? t("timeline.absent")}</span>
                              <span className="dim">{"->"}</span>
                              <span className="tlafter">{f.after ?? t("timeline.absent")}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <AgentNotes dir={dir} live={live} target={step?.targets[0] ?? focus?.target} />
      </div>
      {result && !result.ok && (
        <Modal title={t("timeline.conflictTitle")} className="tlconflictdlg" onClose={() => setResult(undefined)}>
          <p className="hint">{t(result.missing.length ? "timeline.missingText" : "timeline.conflictText")}</p>
          <table className="grid tlconflicts">
            <thead><tr><th>{t("timeline.conflictFile")}</th><th>{t("timeline.conflictField")}</th><th>{t("timeline.conflictAgent")}</th><th>{t("timeline.conflictNow")}</th></tr></thead>
            <tbody>
              {result.conflicts.map((c, i) => (
                <tr key={i}><td><code>{c.path}</code></td><td>{c.field ?? "-"}</td><td>{c.agent ?? t("timeline.absent")}</td><td>{c.now ?? t("timeline.absent")}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

/** Notes for the agent: it reads them over MCP (read_notes) and acknowledges them, optionally with a reply. */
function AgentNotes({ dir, live, target }: { dir: string; live: LiveState; target?: string }) {
  const [text, setText] = useState("");
  const [about, setAbout] = useState(true);
  /** Under a width the notes fold into a bar below the steps (Q224); this is its toggle. */
  const [open, setOpen] = useState(false);
  const notes = live.notes ?? [];
  const add = () => {
    if (!text.trim()) return;
    void api.addAgentNote(dir, text, about ? target : undefined);
    setText("");
  };
  return (
    <aside className={`tlnotes ${open ? "open" : ""}`} aria-label={t("notes.title")}>
      <button type="button" className="tlnoteshead" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("notes.title")}<Icon name="chev" size={10} />
      </button>
      <form className="tlnoteform" onSubmit={(e) => (e.preventDefault(), add())}>
        <textarea value={text} rows={2} placeholder={t("notes.placeholder")} aria-label={t("notes.placeholder")} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && (e.preventDefault(), add())} />
        <div className="tlnoterow">
          {target && (
            <label className="tlabout"><input type="checkbox" checked={about} onChange={(e) => setAbout(e.target.checked)} />{t("notes.about", { target })}</label>
          )}
          <button type="submit" className="mbtn" disabled={!text.trim()}>{t("notes.new")}</button>
        </div>
      </form>
      <ul className="tlnotelist">
        {notes.length === 0 && <li className="dim">{t("notes.empty")}</li>}
        {[...notes].reverse().map((n) => (
          <li key={n.id} className={n.ack ? "seen" : "waiting"}>
            <div className="tlnotetext">{n.text}</div>
            <div className="dim">
              {n.target && <code>{n.target}</code>} {n.ack ? t("notes.seen", { client: n.ack.client ?? t("live.agent") }) : t("notes.waiting")}
              <button className="vbtn" title={t("notes.delete")} aria-label={t("notes.delete")} onClick={() => void api.deleteAgentNote(dir, n.id)}><Icon name="close" size={10} /></button>
            </div>
            {n.ack?.reply && <div className="tlreply">{n.ack.reply}</div>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
