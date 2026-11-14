import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readActivity, readPresence, writePresence } from "../live/activity.ts";
import { readNotes } from "../live/notes.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Tools that only read; every other tool call is compared before and after for the timeline (src/mcp/activity.ts). */
export const READ_ONLY = /^(read_|list_|get_|validate_|search$|project_info$|collaborators$|element_type_schema$|procedure_blocks$|procedure_triggers$|coverage$|entity_models$|project_summary$|find_elements$|build_errors$|log_problems$|game_screenshot$|editor_screenshot$|client_log$|server_log$|debug_log$|git_status$|git_branches$|git_diff$|git_log$|git_show$)/;
/** Presence counts as current for this long after the last heartbeat. */
const ACTIVE_MS = 60_000;

/** What a call touched, from its arguments: "item/ruby", "textures/x.png", "gui/machine". */
export function targetOf(args: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (s(args.type) && s(args.id)) return `${args.type}/${args.id}`;
  if (s(args.entity)) return `living_entity/${args.entity}`;
  if (s(args.tab)) return `creative_tab/${args.tab}`;
  if (s(args.id)) return `procedure/${args.id}`;
  return s(args.path) ?? s(args.language) ?? (Array.isArray(args.paths) ? (args.paths as string[]).join(", ") : undefined);
}

/**
 * Live co-editing for agents: every tool call refreshes the agent's presence (the calls themselves are logged by
 * src/mcp/activity.ts), and `collaborators` tells the agent what the user has open. Must run before the tools are
 * registered.
 */
export function trackActivity(server: McpServer, root: string): void {
  const client = () => server.server.getClientVersion()?.name;
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, handler: unknown) => {
    const wrapped = async (args: Record<string, unknown>, extra: unknown) => {
      const result = (await (handler as (a: unknown, e: unknown) => Promise<Text> | Text)(args, extra)) as Text;
      try {
        const at = new Date().toISOString();
        writePresence(root, { who: "agent", at, client: client() });
      } catch {
        // Activity is a courtesy; a read-only folder must not fail the tool.
      }
      return result;
    };
    return original(name, config, wrapped);
  };

  server.registerTool("collaborators", {
    description: "Who else works on this project right now: what the user has open in the MCEdge app (if it is running) and the latest changes. "
      + "Edits are merged live field by field; avoid rewriting a field the user is editing at the same moment.",
  }, () => {
    const app = readPresence(root, "app");
    const appActive = !!app && Date.now() - Date.parse(app.at) < ACTIVE_MS;
    return { content: [{ type: "text" as const, text: JSON.stringify({ app: appActive ? { open: app!.open, at: app!.at } : null, recent: readActivity(root, 300).filter((e) => !e.read).slice(-20), notesWaiting: readNotes(root).filter((n) => !n.ack).length }, null, 2) }] };
  });
}
