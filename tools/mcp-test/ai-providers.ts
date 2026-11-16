/**
 * Q239: the AI panel's provider adapters and tool loop against a local stub HTTP server (no network, no real key).
 * For the OpenAI-compatible format and the Anthropic one:
 * - a model turn asks for a tool, the loop runs it, and the result goes back the way the provider expects (tool_call_id /
 *   tool_use_id, the result text, the error flag), then the model's final text ends the reply;
 * - an HTTP error status surfaces as an error event, then done;
 * - a result over 20,000 characters is cut with a note; invalid JSON arguments are answered without running the tool;
 * - Stop (abort) ends the reply as stopped.
 *   node tools/mcp-test/ai-providers.ts
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { providerFor, runReply, type AiEvent, type Msg } from "../../src/ai/providers.ts";
import { assert } from "./client.ts";

interface Seen { path: string; headers: IncomingMessage["headers"]; body: any }
const seen: Seen[] = [];
let mode = "";

const TOOLS = [{ name: "update_element", description: "Change an element", inputSchema: { type: "object", properties: { id: { type: "string" } } } }];

/** The stub answers by path and by whether the request already holds a tool result. */
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    seen.push({ path: req.url ?? "", headers: req.headers, body });
    const send = (status: number, payload: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(payload)));
    if (mode === "error") return send(401, { error: { message: "bad key" } });
    if (mode === "hang") return void setTimeout(() => send(200, {}), 5000);
    const openai = req.url === "/v1/chat/completions";
    const answered = openai ? body.messages.some((m: any) => m.role === "tool") : body.messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result"));
    const args = mode === "badargs" ? "{not json" : JSON.stringify({ id: "ruby" });
    if (openai) {
      return send(200, { choices: [{ message: answered ? { role: "assistant", content: "Done: ruby changed." }
        : { role: "assistant", content: "Changing it.", tool_calls: [{ id: "call_1", type: "function", function: { name: "update_element", arguments: args } }] } }] });
    }
    return send(200, { content: answered ? [{ type: "text", text: "Done: ruby changed." }]
      : [{ type: "text", text: "Changing it." }, { type: "tool_use", id: "toolu_1", name: "update_element", input: mode === "badargs" ? {} : { id: "ruby" } }] });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function reply(provider: "openai" | "anthropic", tool: (name: string, args: Record<string, unknown>) => { text: string; error: boolean }, signal = new AbortController().signal) {
  const events: AiEvent[] = [];
  const history: Msg[] = [];
  const ran: { name: string; args: Record<string, unknown> }[] = [];
  const config = { provider, baseUrl: provider === "openai" ? `${base}/v1` : base, model: "stub-model", apiKey: "stub-key" };
  await runReply({
    provider: providerFor(config), system: "system text", history, user: "make ruby better", tools: TOOLS, signal, emit: (e) => events.push(e),
    callTool: async (name, args) => (ran.push({ name, args }), { ...tool(name, args), call: "s.1" }),
  });
  return { events, history, ran };
}

for (const provider of ["openai", "anthropic"] as const) {
  console.log(`-- ${provider}`);
  seen.length = 0;
  mode = "";
  let { events, ran } = await reply(provider, () => ({ text: '{"ok":true}', error: false }));
  assert(ran.length === 1 && ran[0].name === "update_element" && ran[0].args.id === "ruby", `${provider}: the requested tool ran once with its arguments`);
  assert(events.map((e) => e.type).join() === "text,tool,tool,text,done", `${provider}: events in order (text, tool running, tool ok, final text, done): ${events.map((e) => e.type).join()}`);
  const toolEvents = events.filter((e) => e.type === "tool") as Extract<AiEvent, { type: "tool" }>[];
  assert(toolEvents[0].status === "running" && toolEvents[1].status === "ok" && toolEvents[1].call === "s.1" && toolEvents[1].result === '{"ok":true}', `${provider}: the tool row ends ok with its result and call id`);
  assert((events.at(-2) as { text: string }).text === "Done: ruby changed.", `${provider}: the final text arrives`);
  assert(seen.length === 2, `${provider}: two requests (tool round, then final)`);
  const [first, second] = seen;
  if (provider === "openai") {
    assert(first.path === "/v1/chat/completions" && first.headers.authorization === "Bearer stub-key", "openai: path and bearer key");
    assert(first.body.model === "stub-model" && first.body.messages[0].role === "system" && first.body.messages[1].content === "make ruby better", "openai: model, system and user message");
    assert(first.body.tools[0].type === "function" && first.body.tools[0].function.name === "update_element" && first.body.tools[0].function.parameters.type === "object", "openai: tools as functions with the input schema");
    const tail = second.body.messages.slice(-2);
    assert(tail[0].role === "assistant" && tail[0].tool_calls[0].id === "call_1" && tail[0].tool_calls[0].function.arguments === '{"id":"ruby"}', "openai: the assistant's tool call is sent back");
    assert(tail[1].role === "tool" && tail[1].tool_call_id === "call_1" && tail[1].content === '{"ok":true}', "openai: the tool result goes back with its tool_call_id");
  } else {
    assert(first.path === "/v1/messages" && first.headers["x-api-key"] === "stub-key" && first.headers["anthropic-version"] === "2023-06-01", "anthropic: path, x-api-key and version");
    assert(first.body.system === "system text" && first.body.max_tokens > 0 && first.body.tools[0].input_schema.type === "object", "anthropic: system, max_tokens and tools with input_schema");
    const tail = second.body.messages.slice(-2);
    assert(tail[0].role === "assistant" && tail[0].content.some((c: any) => c.type === "tool_use" && c.id === "toolu_1" && c.input.id === "ruby"), "anthropic: the assistant's tool_use is sent back");
    assert(tail[1].role === "user" && tail[1].content[0].type === "tool_result" && tail[1].content[0].tool_use_id === "toolu_1" && tail[1].content[0].content === '{"ok":true}' && !tail[1].content[0].is_error, "anthropic: the result goes back as a tool_result with its tool_use_id");
  }

  // A failing tool: the model is told, the row shows the error.
  seen.length = 0;
  ({ events } = await reply(provider, () => ({ text: "no such element", error: true })));
  assert((events.find((e) => e.type === "tool" && e.status === "error") as { result: string } | undefined)?.result === "no such element", `${provider}: a failed tool shows as an error row`);
  const failed = seen[1].body.messages.at(-1);
  assert(provider === "openai" ? failed.content === "no such element" : failed.content[0].is_error === true, `${provider}: the failure is passed to the model`);

  // An error status.
  mode = "error";
  ({ events, ran } = await reply(provider, () => ({ text: "", error: false })));
  const error = events.find((e) => e.type === "error") as { message: string } | undefined;
  assert(!!error && error.message.startsWith("401") && error.message.includes("bad key") && events.at(-1)?.type === "done" && !ran.length, `${provider}: HTTP 401 surfaces as an error event, then done: ${error?.message}`);

  // Invalid arguments are answered, not run.
  mode = "badargs";
  ({ events, ran } = await reply(provider, () => ({ text: "", error: false })));
  // Anthropic sends the input already parsed, so only the OpenAI format can carry invalid JSON.
  if (provider === "openai") assert(!ran.length && events.some((e) => e.type === "tool" && e.status === "error"), "openai: invalid JSON arguments are not run and show as an error row");

  // A long result is cut.
  mode = "";
  seen.length = 0;
  ({ events } = await reply(provider, () => ({ text: "x".repeat(25_000), error: false })));
  const long = (events.filter((e) => e.type === "tool").at(-1) as { result: string }).result;
  assert(long.length < 20_300 && long.includes("5000 more characters"), `${provider}: a 25,000 character result is cut to 20,000 with a note`);

  // Stop.
  mode = "hang";
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 200);
  ({ events } = await reply(provider, () => ({ text: "", error: false }), abort.signal));
  assert(events.length === 1 && events[0].type === "done" && (events[0] as { stopped?: boolean }).stopped === true, `${provider}: Stop ends the reply as stopped`);
}

server.close();
server.closeAllConnections();
console.log("PASS ai-providers");
