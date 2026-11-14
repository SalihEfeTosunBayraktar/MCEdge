import type { ActivityEntry } from "../../../shared/api.ts";

/** A step of an agent session: calls the agent made for one piece of work (begin_step, or one target). */
export interface Step {
  /** "<session>#<n>", unique in the timeline. */
  key: string;
  session: string;
  n: number;
  title?: string;
  calls: ActivityEntry[];
  /** Targets its changes touched, else the targets it read. */
  targets: string[];
  /** Calls with changes that are not undone yet. */
  open: string[];
  /** Some change cannot be undone (file too big, or its record trimmed). */
  partial: boolean;
}

export interface Session {
  id: string;
  client?: string;
  clientVersion?: string;
  /** The model the agent named (begin_step), when it did. */
  model?: string;
  start: string;
  last: string;
  steps: Step[];
  calls: number;
}

/** Entries written before the timeline (no session): one session, one step per call. */
const EARLIER = "earlier";

/** Groups the activity log into sessions (newest first) and steps (oldest first); undo entries mark calls undone. */
export function groupTimeline(entries: ActivityEntry[]): { sessions: Session[]; undone: Set<string> } {
  const undone = new Set(entries.flatMap((e) => e.undoes ?? []));
  const sessions = new Map<string, Session>();
  const steps = new Map<string, Step>();
  let earlier = 0;
  for (const entry of entries) {
    if (entry.tool === "undo" && entry.undoes) continue;
    const id = entry.session ?? EARLIER;
    const session = sessions.get(id) ?? { id, client: entry.client, start: entry.at, last: entry.at, steps: [], calls: 0 };
    sessions.set(id, session);
    session.client ??= entry.client;
    session.clientVersion ??= entry.clientVersion;
    session.model = entry.model ?? session.model;
    session.last = entry.at;
    session.calls++;
    const n = entry.session ? entry.step ?? 0 : ++earlier;
    const key = `${id}#${n}`;
    let step = steps.get(key);
    if (!step) {
      step = { key, session: id, n, calls: [], targets: [], open: [], partial: false };
      steps.set(key, step);
      session.steps.push(step);
    }
    step.title ??= entry.stepTitle;
    step.calls.push(entry);
    if (entry.changes?.length) {
      if (entry.call && !undone.has(entry.call)) step.open.push(entry.call);
      if (!entry.undoable || !entry.call) step.partial = true;
    }
  }
  for (const step of steps.values()) {
    const changed = step.calls.filter((c) => c.changes?.length);
    step.targets = [...new Set((changed.length ? changed : step.calls).map((c) => c.target).filter((t): t is string => !!t))];
  }
  return { sessions: [...sessions.values()].sort((a, b) => b.last.localeCompare(a.last)), undone };
}

/** What the agent works on right now: the target of its latest call and the fields it last changed there. */
export function agentFocus(entries: ActivityEntry[], now: number, activeMs = 60_000): { target: string; fields: string[] } | undefined {
  const calls = entries.filter((e) => e.actor === "agent" && e.target && e.tool !== "undo");
  const last = calls.at(-1);
  if (!last || now - Date.parse(last.at) > activeMs) return undefined;
  const withFields = calls.filter((e) => e.target === last.target && e.fields?.length).at(-1);
  return { target: last.target!, fields: withFields && now - Date.parse(withFields.at) <= activeMs ? withFields.fields! : [] };
}
