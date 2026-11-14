import type { Session } from "./timeline.ts";

/** Agent folders of the Agents panel (KUYRUK 195), in the order they are listed. */
export const PROVIDERS = ["claude", "codex", "gemini", "antigravity", "deepseek", "cursor", "kiro", "other"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Names an MCP client or a model goes by, per folder; the client decides first, the model when the client is unknown. */
const NAMES: [Provider, RegExp][] = [
  ["antigravity", /antigravity/i],
  ["claude", /claude|anthropic/i],
  ["codex", /codex|openai|chatgpt|\bgpt/i],
  ["gemini", /gemini|google/i],
  ["deepseek", /deepseek/i],
  ["cursor", /cursor/i],
  ["kiro", /kiro/i],
];

/** The folder of an agent, from how it introduced itself: its MCP client name, else the model it named. */
export function providerOf(client?: string, model?: string): Provider {
  for (const name of [client, model]) {
    const hit = name && NAMES.find(([, re]) => re.test(name));
    if (hit) return hit[0];
  }
  return "other";
}

export type DateRange = "today" | "yesterday" | "week" | `month:${string}`;

const dayStart = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

/** Today, Yesterday, earlier this week (from Monday), else the month ("month:2026-10"); local time. */
export function dateRangeOf(at: string, now: number): DateRange {
  const day = dayStart(new Date(at));
  const today = dayStart(new Date(now));
  if (day >= today) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day >= yesterday.getTime()) return "yesterday";
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  if (day >= monday.getTime()) return "week";
  const date = new Date(at);
  return `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export interface AgentFolder {
  provider: Provider;
  /** Date ranges, newest first, each with its sessions newest first. */
  ranges: { range: DateRange; sessions: Session[] }[];
  sessions: number;
}

/** Sessions (newest first, from groupTimeline) filed by agent and then by date range of their last call. */
export function agentFolders(sessions: Session[], now: number): AgentFolder[] {
  const folders = new Map<Provider, AgentFolder>();
  for (const session of sessions) {
    const provider = providerOf(session.client, session.model);
    const folder = folders.get(provider) ?? { provider, ranges: [], sessions: 0 };
    folders.set(provider, folder);
    const range = dateRangeOf(session.last, now);
    let group = folder.ranges.find((r) => r.range === range);
    if (!group) folder.ranges.push((group = { range, sessions: [] }));
    group.sessions.push(session);
    folder.sessions++;
  }
  return PROVIDERS.flatMap((p) => folders.get(p) ?? []);
}
