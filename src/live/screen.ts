/** Screens an agent can ask the app to show (KUYRUK 153); shared by the MCP server and the app, so no Node imports. */
export const SHOW_SECTIONS = ["elements", "resources", "tags", "variables", "localization", "git", "settings"] as const;
export const SHOW_RESOURCE_TABS = ["textures", "sounds", "models", "animations", "structures"] as const;
export const SHOW_DIALOGS = ["preferences", "about", "docs", "shortcuts"] as const;
/** "activity" and "tasks" open the Agents panel (KUYRUK 195) at the latest session or at the tasks. */
export const SHOW_PANELS = ["problems", "build", "gradle", "agents", "activity", "tasks"] as const;
/** Requests older than this are not acted on (an app started later must not jump to a stale screen). */
export const SHOW_FRESH_MS = 30_000;

export type Screen =
  | { kind: "section"; section: (typeof SHOW_SECTIONS)[number] }
  | { kind: "resources"; tab: (typeof SHOW_RESOURCE_TABS)[number] }
  | { kind: "dialog"; dialog: (typeof SHOW_DIALOGS)[number] }
  | { kind: "panel"; panel: (typeof SHOW_PANELS)[number] }
  | { kind: "element"; typeId: string; id: string };

export interface ShowRequest {
  id: string;
  at: string;
  screen: string;
}

const has = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/** "tags", "resources/models", "dialog/preferences", "panel/agents", or an element "item/ruby". */
export function parseScreen(screen: string): Screen | undefined {
  const [head, rest, extra] = screen.trim().split("/");
  if (extra !== undefined || !head) return undefined;
  if (rest === undefined) return has(SHOW_SECTIONS, head) ? { kind: "section", section: head } : undefined;
  if (head === "resources") return has(SHOW_RESOURCE_TABS, rest) ? { kind: "resources", tab: rest } : undefined;
  if (head === "dialog") return has(SHOW_DIALOGS, rest) ? { kind: "dialog", dialog: rest } : undefined;
  if (head === "panel") return has(SHOW_PANELS, rest) ? { kind: "panel", panel: rest } : undefined;
  return /^[a-z0-9_]+$/.test(head) && /^[a-z0-9_]+$/.test(rest) ? { kind: "element", typeId: head, id: rest } : undefined;
}

