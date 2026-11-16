import { app, ipcMain } from "electron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { providerFor, runReply, type AiConfig, type Msg, type ToolDef } from "../../src/ai/providers.ts";
import { readActivity, readPresence } from "../../src/live/activity.ts";
import { readAppState } from "./appState.ts";
import { mcpCommand } from "./tools.ts";

/** The MCP client name of the panel: its calls show under it in the activity log and the Agents view. */
const CLIENT = "mcedge-panel";

const SYSTEM = [
  "You are the assistant inside MCEdge, a Minecraft mod editor. You edit the user's open project together with the user, through the tools you are given.",
  "Look before you change: read the element or list what exists, then change only what was asked. Keep answers short and say what you changed.",
  "Answer in the language the user writes in. Each user message starts with a block saying what the user has open and what they changed last; use it to resolve \"this\" and \"here\".",
].join(" ");

interface Session {
  client: Client;
  tools: ToolDef[];
  history: Msg[];
  /** Call ids of the panel's client already seen in the activity log, so a tool call finds its own. */
  known: Set<string>;
  abort?: AbortController;
}

const sessions = new Map<string, Session>();

/** Preferences > AI, with $MCEDGE_AI_BASE_URL, $MCEDGE_AI_KEY and $MCEDGE_AI_MODEL on top; undefined while no model is set. */
function aiConfig(): AiConfig | undefined {
  const saved = readAppState().preferences?.ai;
  const baseUrl = process.env.MCEDGE_AI_BASE_URL || saved?.baseUrl || undefined;
  const apiKey = process.env.MCEDGE_AI_KEY || saved?.apiKey || undefined;
  const model = process.env.MCEDGE_AI_MODEL || saved?.model || "";
  const provider = saved?.provider ?? (process.env.MCEDGE_AI_BASE_URL ? "openai" : undefined);
  if (!provider || !model.trim()) return undefined;
  // Anthropic needs a key; a local OpenAI-compatible server (LM Studio) does not.
  if (provider === "anthropic" && !apiKey) return undefined;
  return { provider, baseUrl, model: model.trim(), apiKey };
}

async function connect(dir: string): Promise<Session> {
  const existing = sessions.get(dir);
  if (existing) return existing;
  const server = mcpCommand();
  const client = new Client({ name: CLIENT, version: app.getVersion() });
  await client.connect(new StdioClientTransport({
    command: server.command, args: [...server.args, "mcp", dir], stderr: "ignore",
    env: { ...getDefaultEnvironment(), ...server.env },
  }));
  const tools: ToolDef[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> })));
    cursor = page.nextCursor;
  } while (cursor);
  const known = new Set(readActivity(dir, Number.MAX_SAFE_INTEGER).filter((e) => e.client === CLIENT && e.call).map((e) => e.call!));
  const session: Session = { client, tools, history: [], known };
  sessions.set(dir, session);
  return session;
}

async function close(dir: string): Promise<void> {
  const session = sessions.get(dir);
  sessions.delete(dir);
  session?.abort?.abort();
  await session?.client.close().catch(() => undefined);
}

/** What the user has open (presence-app.json) and their newest edits (the user's lines of activity.jsonl). */
function editorContext(dir: string): string {
  const open = readPresence(dir, "app")?.open;
  const edits = readActivity(dir, 200).filter((e) => e.actor === "user").slice(-5);
  return [
    "[Editor context]",
    `Open in the editor: ${open || "nothing"}`,
    ...(edits.length ? ["The user's latest changes:", ...edits.map((e) => `- ${e.tool}${e.target ? ` ${e.target}` : ""}`)] : []),
    "[User message]",
  ].join("\n");
}

const textOf = (content: unknown): string =>
  (Array.isArray(content) ? (content as { type: string; text?: string }[]) : []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

/** The panel's chat: one MCP client per open project (the project's own server, so every call is logged and undoable), and the provider loop. */
export function registerAiPanel(): void {
  ipcMain.handle("ai:status", () => ({ configured: !!aiConfig(), client: CLIENT }));
  ipcMain.handle("ai:send", async (event, dir: string, reply: string, text: string) => {
    const emit = (e: import("../../src/ai/providers.ts").AiEvent) => !event.sender.isDestroyed() && event.sender.send("ai:event", { dir, reply, event: e });
    const config = aiConfig();
    if (!config) return void emit({ type: "done" });
    let session = sessions.get(dir);
    if (session?.abort) return void emit({ type: "error", message: "a reply is already running" });
    try {
      session = await connect(dir);
    } catch (error) {
      emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      return void emit({ type: "done" });
    }
    const live = session;
    const abort = new AbortController();
    live.abort = abort;
    try {
      await runReply({
        provider: providerFor(config), system: SYSTEM, history: live.history, user: `${editorContext(dir)}\n${text}`, tools: live.tools, emit, signal: abort.signal,
        async callTool(name, args, signal) {
          const result = await live.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 20 * 60_000, resetTimeoutOnProgress: true });
          // The call's entry is in the log before its result comes back; the newest one of this client not seen yet is it.
          const entry = readActivity(dir, 50).filter((e) => e.client === CLIENT && e.call && !live.known.has(e.call)).at(-1);
          if (entry?.call) live.known.add(entry.call);
          return { text: textOf(result.content), error: !!result.isError, call: entry?.call };
        },
      });
    } finally {
      live.abort = undefined;
    }
  });
  ipcMain.handle("ai:stop", (_e, dir: string) => sessions.get(dir)?.abort?.abort());
  ipcMain.handle("ai:reset", async (_e, dir: string, closeServer?: boolean) => {
    if (closeServer) return close(dir);
    const session = sessions.get(dir);
    session?.abort?.abort();
    if (session) session.history = [];
  });
  app.on("before-quit", () => void Promise.all([...sessions.keys()].map(close)));
}
