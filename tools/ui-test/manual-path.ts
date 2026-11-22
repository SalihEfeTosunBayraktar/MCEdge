/**
 * Q251: an AI action shows how to do the same thing by hand (config/manual-paths.json).
 * - The in-app AI (a stub OpenAI-compatible server in place of a model) changes a field of item/ruby: its tool row says
 *   "By hand: Mod elements > ruby > <page> > <field>"; a read call shows no path.
 * - An outside agent (real `mcedge mcp`) creates an element and a texture and sets a field: each timeline row has its
 *   path, in the language of the UI, and the read call has none.
 * en and tr, dark and light. Screenshots in design/251/.
 *   node tools/ui-test/manual-path.ts
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/251");
const CTRL_SHIFT = 2 | 8;
const strings = (lang: string) => JSON.parse(readFileSync(`config/ui-strings/${lang}.json`, "utf8")) as Record<string, string>;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const answered = body.messages.some((m: any) => m.role === "tool");
    const tool = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
    const message = answered ? { role: "assistant", content: "Done." }
      : { role: "assistant", content: null, tool_calls: [tool("c1", "read_element", { type: "item", id: "ruby" }), tool("c2", "update_element", { type: "item", id: "ruby", values: { stackSize: 8 } })] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.MCEDGE_AI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
process.env.MCEDGE_AI_KEY = "stub-key";
process.env.MCEDGE_AI_MODEL = "stub-model";

const paths = (app: App, root: string) => app.eval<string[]>(`[...document.querySelectorAll(${JSON.stringify(root + " [data-testid=manual-path]")})].map((e) => e.textContent)`);

try {
  for (const language of ["en", "tr"]) {
    const s = strings(language);
    const project = exampleProject();
    await run(async (app) => {
      const mcp = await connect(project);
      try {
        // 1. The in-app AI.
        await app.waitFor(`document.querySelector(".tile, .rail")`, 60000);
        await app.key("A", CTRL_SHIFT);
        await app.waitFor(`document.querySelector("[data-testid=ai-input]")`, 10000);
        await app.type("make ruby stack to 8");
        await app.key("Enter");
        await app.waitFor(`document.querySelector("[data-testid=ai-text]")`, 60000);
        await app.waitFor(`!document.querySelector("[data-testid=ai-stop]")`, 30000);
        const rows = await app.eval<{ tool: string; manual: string | null }[]>(`[...document.querySelectorAll("[data-testid=ai-tool]")].map((r) => ({ tool: r.dataset.tool, manual: r.querySelector("[data-testid=manual-path]")?.textContent ?? null }))`);
        assert(rows.length === 2 && rows[0].tool === "read_element" && rows[0].manual === null, `a read shows no path: ${JSON.stringify(rows)}`);
        const update = rows[1].manual ?? "";
        assert(update.startsWith(`${s["manual.label"]}: ${s["section.elements"]} > ruby > `) && update.split(" > ").length === 4, `update_element shows section > element > page > field: ${update}`);
        await app.shot(`${OUT}/ai-${language}-dark.png`);
        await app.setTheme("light");
        await app.shot(`${OUT}/ai-${language}-light.png`);
        await app.setTheme("dark");
        console.log(`ok  ${language}: AI panel: ${update}`);

        // 2. An outside agent: the timeline.
        await mcp.call("read_element", { type: "item", id: "ruby" });
        await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
        await mcp.call("create_texture", { path: "textures/item/sapphire.png", width: 16, height: 16, fill: "#2e5c8a" });
        await app.waitFor(`[...document.querySelectorAll(".sitem.agent")].some((e) => e.textContent.includes("mcedge-test"))`, 15000);
        await app.eval(`[...document.querySelectorAll(".sitem.agent")].find((e) => e.textContent.includes("mcedge-test")).id = "outside-agent"`);
        await app.click("#outside-agent");
        await app.waitFor(`document.querySelectorAll(".tlcalls li").length >= 3`, 15000);
        const rowsOf = await app.eval<{ tool: string; manual: string | null }[]>(`[...document.querySelectorAll(".tlcalls > li")].map((r) => ({ tool: r.querySelector(".tltool").textContent, manual: r.querySelector("[data-testid=manual-path]")?.textContent ?? null }))`);
        const by = (tool: string) => rowsOf.find((r) => r.tool === tool)?.manual;
        assert(by("read_element") === null, `timeline: a read shows no path: ${JSON.stringify(rowsOf)}`);
        assert(by("create_element")?.endsWith(`${s["section.elements"]} > ${s["new.title"]} > ${language === "en" ? "Item" : by("create_element")!.split(" > ")[2]}`), `create_element: ${by("create_element")}`);
        assert(by("create_texture")?.endsWith(`${s["menu.resources"]} > ${s["menu.createTexture"]}`), `create_texture: ${by("create_texture")}`);
        await app.shot(`${OUT}/timeline-${language}-dark.png`);
        await app.setTheme("light");
        await app.shot(`${OUT}/timeline-${language}-light.png`);
        await app.setTheme("dark");
        console.log(`ok  ${language}: timeline: ${by("create_element")} | ${by("create_texture")}`);
      } finally {
        await mcp.close();
      }
    }, { project, language, width: 1440, height: 900 });
  }
} finally {
  server.close();
  server.closeAllConnections();
}
