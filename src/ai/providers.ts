/**
 * The AI panel's model side (Q239, docs/AI-PANEL.md): two provider adapters (Anthropic Messages API, OpenAI-compatible
 * chat completions, which covers LM Studio) and the tool loop that runs a reply. Pure of Electron and of MCP: the main
 * process hands in the tools and a function that calls one, so this file is tested against a stub HTTP server.
 */

export interface AiConfig {
  provider: "anthropic" | "openai";
  /** OpenAI-compatible: the base URL ("http://localhost:1234/v1"); Anthropic: left empty for api.anthropic.com. */
  baseUrl?: string;
  model: string;
  apiKey?: string;
}

/** An MCP tool as the provider sees it. */
export interface ToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** The model's arguments were not valid JSON; the call is answered with an error instead of being run. */
  badArgs?: string;
}

export interface ToolResult {
  id: string;
  name: string;
  text: string;
  error: boolean;
}

/** The conversation in a provider-neutral shape; each adapter converts it on every round. */
export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface Turn {
  text: string;
  calls: ToolCall[];
}

export interface Provider {
  turn(system: string, messages: Msg[], tools: ToolDef[], signal?: AbortSignal): Promise<Turn>;
}

/** What the panel shows, in order: the loop emits these as a reply goes. */
export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown>; status: "running" | "ok" | "error"; result?: string; call?: string }
  | { type: "error"; message: string; code?: "rounds" }
  | { type: "done"; stopped?: boolean };

export const MAX_ROUNDS = 25;
export const MAX_RESULT_CHARS = 20_000;

export class ProviderError extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  const text = await response.text();
  if (!response.ok) throw new ProviderError(`${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`not JSON: ${text.slice(0, 200)}`);
  }
}

const stripSlash = (url: string) => url.replace(/\/+$/, "");

export function anthropicProvider(config: AiConfig): Provider {
  const base = stripSlash(config.baseUrl || "https://api.anthropic.com");
  return {
    async turn(system, messages, tools, signal) {
      const body = {
        model: config.model, max_tokens: 8192, system,
        tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema })),
        messages: messages.map((m) =>
          m.role === "user" ? { role: "user", content: m.text }
          : m.role === "assistant" ? { role: "assistant", content: [
            ...(m.text ? [{ type: "text", text: m.text }] : []),
            ...m.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args })),
          ] }
          : { role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text, ...(r.error ? { is_error: true } : {}) })) }),
      };
      const data = await post(`${base}/v1/messages`, { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" }, body, signal);
      const blocks = (Array.isArray(data?.content) ? data.content : []) as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"),
        calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id ?? "", name: b.name ?? "", args: b.input ?? {} })),
      };
    },
  };
}

export function openaiProvider(config: AiConfig): Provider {
  const base = stripSlash(config.baseUrl || "http://localhost:1234/v1");
  return {
    async turn(system, messages, tools, signal) {
      const body = {
        model: config.model,
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } })),
        messages: [
          { role: "system", content: system },
          ...messages.flatMap((m): Record<string, unknown>[] =>
            m.role === "user" ? [{ role: "user", content: m.text }]
            : m.role === "assistant" ? [{ role: "assistant", content: m.text || null,
              ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) }]
            : m.results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.text }))),
        ],
      };
      const data = await post(`${base}/chat/completions`, config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}, body, signal);
      const message = data?.choices?.[0]?.message ?? {};
      const calls: ToolCall[] = ((message.tool_calls ?? []) as { id?: string; function?: { name?: string; arguments?: string } }[]).map((c, i) => {
        const raw = c.function?.arguments ?? "";
        const call: ToolCall = { id: c.id || `call_${i}`, name: c.function?.name ?? "", args: {} };
        try {
          const parsed = raw.trim() ? JSON.parse(raw) : {};
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) call.args = parsed;
          else call.badArgs = raw;
        } catch {
          call.badArgs = raw;
        }
        return call;
      });
      return { text: typeof message.content === "string" ? message.content : "", calls };
    },
  };
}

export const providerFor = (config: AiConfig): Provider => (config.provider === "anthropic" ? anthropicProvider(config) : openaiProvider(config));

export interface ReplyOptions {
  provider: Provider;
  system: string;
  /** The conversation so far; the reply appends to it. */
  history: Msg[];
  /** The user's message, with the editor context already added. */
  user: string;
  tools: ToolDef[];
  /** Runs one tool; `call` is the id the project's activity log gave the call, when known. */
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; error: boolean; call?: string }>;
  emit(event: AiEvent): void;
  signal: AbortSignal;
}

const cut = (text: string) => (text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[result cut: ${text.length - MAX_RESULT_CHARS} more characters not shown]` : text);

/** One reply: rounds of model turn then tool calls until the model answers without a tool call, an error, or Stop. */
export async function runReply(o: ReplyOptions): Promise<void> {
  o.history.push({ role: "user", text: o.user });
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const turn = await o.provider.turn(o.system, o.history, o.tools, o.signal);
      o.history.push({ role: "assistant", text: turn.text, calls: turn.calls });
      if (turn.text) o.emit({ type: "text", text: turn.text });
      if (!turn.calls.length) return void o.emit({ type: "done" });
      const results: ToolResult[] = [];
      for (const call of turn.calls) {
        if (o.signal.aborted) throw new DOMException("stopped", "AbortError");
        o.emit({ type: "tool", id: call.id, name: call.name, args: call.args, status: "running" });
        let outcome: { text: string; error: boolean; call?: string };
        if (call.badArgs !== undefined) outcome = { text: `The arguments were not valid JSON: ${call.badArgs.slice(0, 200)}`, error: true };
        else {
          try {
            outcome = await o.callTool(call.name, call.args, o.signal);
          } catch (error) {
            if (o.signal.aborted) throw error;
            outcome = { text: error instanceof Error ? error.message : String(error), error: true };
          }
        }
        const text = cut(outcome.text);
        results.push({ id: call.id, name: call.name, text, error: outcome.error });
        o.emit({ type: "tool", id: call.id, name: call.name, args: call.args, status: outcome.error ? "error" : "ok", result: text, ...(outcome.call ? { call: outcome.call } : {}) });
      }
      o.history.push({ role: "tool", results });
    }
    o.emit({ type: "error", message: `more than ${MAX_ROUNDS} tool rounds`, code: "rounds" });
    o.emit({ type: "done" });
  } catch (error) {
    // Tool calls the model made but that never ran are answered, or the next request would be rejected.
    const last = o.history.at(-1);
    if (last?.role === "assistant" && last.calls.length) o.history.push({ role: "tool", results: last.calls.map((c) => ({ id: c.id, name: c.name, text: "Not run: the reply was stopped.", error: true })) });
    if (o.signal.aborted) return void o.emit({ type: "done", stopped: true });
    o.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    o.emit({ type: "done" });
  }
}
