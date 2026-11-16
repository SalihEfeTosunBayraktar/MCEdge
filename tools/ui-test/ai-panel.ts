/**
 * Q239: the AI panel, with a stub OpenAI-compatible server in place of a model ($MCEDGE_AI_* point the app at it).
 * - No provider set: Ctrl+Shift+A opens the Agents panel on the AI assistant with one line and a button to Preferences.
 * - With a provider: Ctrl+Shift+A, a typed request, Enter; the stub answers with an update_element call on item/ruby, then a
 *   final text. The tool row shows ok, the element file on disk changed, the activity log holds the call under the client
 *   name mcedge-panel, the request carried the editor context and the MCP tools; "Undo this reply" restores the file;
 *   New conversation clears it. The in-app AI is one node of the Agents view.
 * Screenshots in design/239/ (en and tr, dark and light). Needs `npx electron-vite build && npx vite build -c vite.cli.config.ts`.
 *   node tools/ui-test/ai-panel.ts
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/239";
const CTRL_SHIFT = 2 | 8;
const PANEL = "[data-testid=ai-panel]";

interface Request { tools: string[]; user: string }
const requests: Request[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const users = body.messages.filter((m: any) => m.role === "user");
    requests.push({ tools: body.tools.map((t: any) => t.function.name), user: users.at(-1).content });
    const answered = body.messages.some((m: any) => m.role === "tool");
    const message = answered ? { role: "assistant", content: "I renamed the ruby item to Ruby AI." }
      : { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "update_element", arguments: JSON.stringify({ type: "item", id: "ruby", values: { name: "Ruby AI" } }) } }] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const stub = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

const elementName = (project: string) => JSON.parse(readFileSync(join(project, "elements", "items", "ruby.json"), "utf8")).name as string;
const activity = (project: string) => readFileSync(join(project, ".mcedge", "live", "activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { client?: string; tool: string; target?: string; changes?: unknown[]; call?: string });

const openPanel = async (app: App) => {
  await app.waitFor(`document.querySelector(".tile, .rail")`, 60000);
  await app.key("A", CTRL_SHIFT);
  await app.waitFor(`document.querySelector("${PANEL}")`, 10000);
  // It is the Agents panel with the AI assistant selected, and the input box has the focus (when a provider is set).
  assert(await app.eval<boolean>(`!!document.querySelector(".agentsview [data-testid=agent-ai-node][aria-selected=true]")`), "Ctrl+Shift+A shows the Agents panel with the AI assistant selected");
};

try {
  for (const language of ["en", "tr"]) {
    // 1. No provider.
    for (const key of ["MCEDGE_AI_BASE_URL", "MCEDGE_AI_KEY", "MCEDGE_AI_MODEL"]) delete process.env[key];
    await run(async (app) => {
      await openPanel(app);
      await app.waitFor(`document.querySelector("[data-testid=ai-no-provider]")`);
      assert(!(await app.eval<boolean>(`!!document.querySelector("[data-testid=ai-input]")`)), "no input without a provider");
      await app.sleep(300);
      await app.shot(`${OUT}/no-provider-${language}-dark.png`);
      await app.setTheme("light");
      await app.sleep(200);
      await app.shot(`${OUT}/no-provider-${language}-light.png`);
      await app.click("[data-testid=ai-no-provider] button");
      await app.waitFor(`document.querySelector("[data-testid=pref-ai-model]")`, 10000);
      console.log(`ok  ${language}: no provider: one line, and its button opens Preferences with the AI settings`);
    }, { project: exampleProject(), language, width: 1440, height: 900 });

    // 2. A reply that edits the project.
    process.env.MCEDGE_AI_BASE_URL = stub;
    process.env.MCEDGE_AI_KEY = "stub-key";
    process.env.MCEDGE_AI_MODEL = "stub-model";
    requests.length = 0;
    const project = exampleProject();
    await run(async (app) => {
      assert(elementName(project) === "Ruby", "the element starts as Ruby");
      await openPanel(app);
      await app.waitFor(`document.activeElement?.dataset.testid === "ai-input"`, 5000);
      await app.type("make the ruby item's name Ruby AI");
      await app.key("Enter");

      await app.waitFor(`document.querySelector("[data-testid=ai-text]")`, 60000);
      await app.waitFor(`!document.querySelector("[data-testid=ai-stop]")`, 30000);
      const tool = await app.eval<{ name: string; ok: boolean; text: string } | null>(
        `(() => { const e = document.querySelector("[data-testid=ai-tool]"); return e && { name: e.dataset.tool, ok: e.classList.contains("ok"), text: e.textContent }; })()`);
      assert(tool?.name === "update_element" && tool.ok && tool.text.includes("item/ruby"), `the tool row shows update_element on item/ruby, ok: ${JSON.stringify(tool)}`);
      const said = await app.eval<string>(`[...document.querySelectorAll("[data-testid=ai-text]")].at(-1).textContent`);
      assert(said.includes("Ruby AI"), `the final text shows: ${said}`);
      assert(elementName(project) === "Ruby AI", `the element file changed on disk: ${elementName(project)}`);
      const mine = activity(project).filter((e) => e.client === "mcedge-panel" && e.tool === "update_element");
      assert(mine.length === 1 && mine[0].target === "item/ruby" && !!mine[0].changes?.length && !!mine[0].call, `the activity log holds the call under mcedge-panel: ${JSON.stringify(mine)}`);
      assert(requests.length === 2 && requests[0].tools.length > 100 && requests[0].tools.includes("update_element"), `the model was given the MCP tools (${requests[0].tools.length})`);
      assert(requests[0].user.includes("[Editor context]") && requests[0].user.includes("Open in the editor:") && requests[0].user.endsWith("Ruby AI"), "the user turn carries the editor context");
      console.log(`ok  ${language}: reply ran: tool row, file changed, activity under mcedge-panel, context and tools sent`);

      await app.click("[data-testid=ai-tool] button");
      await app.sleep(300);
      await app.shot(`${OUT}/reply-${language}-dark.png`);
      await app.setTheme("light");
      await app.sleep(300);
      await app.shot(`${OUT}/reply-${language}-light.png`);

      // 3. Undo this reply.
      await app.waitFor(`document.querySelector("[data-testid=ai-undo]")`, 15000);
      await app.click("[data-testid=ai-undo]");
      await app.waitFor(`document.querySelector("[data-testid=ai-undone]")`, 15000);
      assert(elementName(project) === "Ruby", `Undo this reply restored the file: ${elementName(project)}`);
      await app.sleep(300);
      await app.shot(`${OUT}/undone-${language}-light.png`);
      await app.setTheme("dark");
      console.log(`ok  ${language}: Undo this reply restored the element`);

      // 4. New conversation.
      await app.click("[data-testid=ai-new]");
      await app.waitFor(`!document.querySelector("[data-testid=ai-reply]")`);
      console.log(`ok  ${language}: New conversation clears it`);
    }, { project, language, width: 1440, height: 900 });
  }
} finally {
  server.close();
  server.closeAllConnections();
}
