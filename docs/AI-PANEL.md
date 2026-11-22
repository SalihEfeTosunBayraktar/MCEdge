# In-app AI panel (Q239)

## What exists

Live co-editing already works for agents outside the app: they connect over MCP, and the app shows them.
- `.mcedge/live/activity.jsonl` records every call: who, tool, target, field diff.
- `presence-*.json` heartbeats say what the user has open and which agent is connected.
- `changes.jsonl` with `undoCalls()` undoes an agent's calls. It refuses when the user changed the same field later.
- The Agents view (`AgentsView`, `AgentTimeline`) and `api.liveUndo(dir, calls)` sit on top of these files.

What is missing is an AI that runs inside the app, on the user's own API key or a local model (LM Studio).

## Decision: the panel is one more MCP client

The panel does not get its own editing path. The main process starts the project's MCP server as a child process, the
same command an outside agent uses (`out/cli/index.js mcp <dir>`; dev: `src/cli.ts`), and connects to it as an MCP
client with clientInfo `mcedge-panel`. Everything the panel does then goes through the same 150+ tools. Activity,
presence, field diffs, the Agents view and per-call undo all work without new code, and the panel's calls appear there
under its own name. User/AI histories stay separate because undo works per call, and the panel's calls are the ones
from its session.

The provider loop runs in the main process, so keys never reach the renderer.
- `anthropic`: the Messages API with tool use (`x-api-key`, model from Preferences).
- `openai`: OpenAI-compatible `/chat/completions` with `tools`. This covers LM Studio (default base URL
  `http://localhost:1234/v1`, no key), OpenAI, and any compatible server.
- MCP tools become provider tools as name, description and the input JSON schema. A result over 20,000 characters is
  cut, with a note saying so.
- One loop has at most 25 tool rounds. Stop ends the request and the loop at once.
- Every user turn carries the user's context: what they have open (`presence-app.json`: view, element, field) and their
  last edits (the newest user lines of `activity.jsonl`). This is how the AI sees the selection and recent changes.

## Settings (this computer, Preferences > AI)

These go in `ai: { provider, baseUrl?, model, apiKey? }`, never in a project:
- provider: Anthropic, or OpenAI-compatible / LM Studio.
- base URL: OpenAI-compatible only.
- model.
- API key: empty is allowed for LM Studio.

`$MCEDGE_AI_BASE_URL`, `$MCEDGE_AI_KEY` and `$MCEDGE_AI_MODEL` override these settings (used by the tests).

## Panel (renderer)

There is no separate drawer: the chat is a node of the Agents panel (`AgentsView`, bottom panel), the first one in its
tree, so the in-app AI sits next to outside agents, and its calls show in the same timeline under `mcedge-panel`.
Window > AI assistant or Ctrl+Shift+A opens the Agents panel on that node with the input box focused.
- Messages: the user's text, the AI's text, and each tool call as one compact row (tool, target, ok/error) that expands
  to its arguments and result.
- Input box: Enter sends, Shift+Enter makes a new line. Send turns into Stop while a reply runs.
- "Undo this reply" on an AI reply calls `api.liveUndo` with the call ids of that reply. On a conflict the panel lists
  the conflicts and does not overwrite anything.
- Other parts of the app can put a message into the input box without sending it (Ask the AI on an explained build error, Q246: `draft` of the `ai` props); the user reads it and presses Enter.
- With no provider set, the node shows one line with a button to Preferences > AI.
- The conversation lives in memory, per project. "New conversation" clears it.
- All text is in `config/ui-strings` (en, tr).

## Not in this step

- Streaming tokens: a reply appears when its round ends.
- Images.
- A per-model limit on the tool list.
- Saving conversations to disk.
- Running two panel replies at once.
