/**
 * Q246: a failed build shows each recognised error as what happened, where and how to fix it, with buttons to go to the
 * element (or field) and to ask the AI. The errors come from a real failing Gradle build (headless, no game) of a copy of
 * examples/hello with a procedure of broken Java; the app window is hidden, and the build events are replayed to it from
 * that build's real log (the app is not asked to start Gradle, which would open a console window).
 * - en and tr, dark and light: three-part cards, the raw log still below, an error no rule knows has no card;
 * - level new reads the plain text, the others the technical one;
 * - Go to the element opens the procedure; with a field (stubbed explanation of a field) the editor shows its page and highlights the row;
 * - Ask the AI opens the AI assistant with the error in its input box, and Enter sends it.
 * Screenshots in design/246/. Needs `npm run build:app`.
 *   node tools/ui-test/build-explain.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";
import { connect } from "../mcp-test/client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on; Gradle must not start");
const OUT = evidence("design/246");
const ENGINE = "neoforge-1.21.5";

// A stub model: the Ask the AI test only needs to see what arrives.
const received: string[] = [];
const stub = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    received.push(body.messages.filter((m: any) => m.role === "user").at(-1).content);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Looking at it." } }] }));
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
process.env.MCEDGE_AI_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
process.env.MCEDGE_AI_KEY = "stub-key";
process.env.MCEDGE_AI_MODEL = "stub-model";

// 1. The real failing build.
const java = (code: string) => ({ block: "java_code", fields: { code, deps: "", imports: "", gen: "1.21.5" } });
const project = exampleProject();
const mcp = await connect(project);
let log: string[];
try {
  await mcp.call("write_procedure", { id: "broken", program: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" },
    java('undefinedHelper("x");'), java('int a = "text";'), java('System.out.println(System.out.println("x"));')] }] } });
  const built = String(await mcp.call("build", { engine: ENGINE }, true));
  assert(JSON.parse(built.slice(0, built.indexOf("\n\n"))).ok === false, "the real build fails");
  log = readFileSync(join(project, "out", ENGINE, "build", "mcedge-build.log"), "utf8").split("\n");
} finally {
  await mcp.close();
}

const ipc = (code: string) => `(() => { const { BrowserWindow, ipcMain } = (process.mainModule ? process.mainModule.require : require)("electron"); ${code} })()`;
/** Replays a build of the engine to the window: start, every line, done (failed). */
const replay = (app: App, lines: string[]) => app.mainEval(ipc(`
  const web = BrowserWindow.getAllWindows()[0].webContents;
  web.send("build:event", { type: "start", engineId: ${JSON.stringify(ENGINE)} });
  for (const line of ${JSON.stringify(lines)}) web.send("build:event", { type: "line", engineId: ${JSON.stringify(ENGINE)}, line });
  web.send("build:event", { type: "done", engineId: ${JSON.stringify(ENGINE)}, ok: false });
  return true;`));
const texts = (app: App, testid: string) => app.eval<string[]>(`[...document.querySelectorAll("[data-testid=${testid}]")].map((e) => e.textContent)`);
const strings = (language: string) => JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${language}.json`), "utf8")) as Record<string, string>;
/** Replays the real failed build and opens the Build output tab (Window menu), where the explained errors show. */
const open = async (app: App, language = "en") => {
  const t = strings(language);
  await app.waitFor(`document.querySelector(".tile, .rail")`, 60000);
  await replay(app, log);
  await app.click(".menu", t["menu.window"]);
  await app.click(".menulist button", t["panel.build"]);
  await app.waitFor(`document.querySelector("[data-testid=build-explain]")`, 15000);
};

try {
  for (const language of ["en", "tr"]) {
    // Cards, in two themes; the raw log stays.
    await run(async (app) => {
      await open(app, language);
      const ids = await app.eval<string[]>(`[...document.querySelectorAll("[data-testid=build-explain-item]")].map((e) => e.dataset.explain)`);
      assert(JSON.stringify(ids) === JSON.stringify(["cannotFindSymbol", "incompatibleTypes"]), `${language}: the recognised errors have cards, the unknown one does not: ${ids}`);
      const parts = await app.eval<string[][]>(`[...document.querySelectorAll("[data-testid=build-explain-item]")].map((c) => [...c.querySelectorAll("dt, dd")].map((e) => e.textContent))`);
      const [what, where, fix] = [1, 3, 5].map((i) => parts[0][i]);
      assert(parts[0].length === 6 && what && where && fix, `${language}: what, where and how to fix are three parts: ${JSON.stringify(parts[0])}`);
      assert(where.includes("procedure/broken") && where.includes("java_code"), `${language}: where names the procedure and block: ${where}`);
      assert(what.includes("undefinedHelper"), `${language}: what names the missing name: ${what}`);
      if (language === "tr") assert(/[ğüşıöçĞÜŞİÖÇ]/.test(parts[0].join(" ")), "the texts are Turkish");
      else assert(parts[0][0] === "What happened", `en label: ${parts[0][0]}`);
      const raw = await app.eval<string>(`document.querySelector(".build-view .log").textContent`);
      assert(raw.includes("error: cannot find symbol") && raw.includes("'void' type not allowed here"), `${language}: the raw output is still shown, with the unknown error`);
      const overflow = await app.eval<boolean>(`(() => { const p = document.querySelector("[data-testid=build-explain]"); return [...p.querySelectorAll("*")].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible" && e.clientWidth > 0 && e.tagName !== "CODE"); })()`);
      assert(!overflow, `${language}: no horizontal overflow in the cards`);
      await app.sleep(300);
      await app.shot(`${OUT}/cards-${language}-dark.png`);
      await app.setTheme("light");
      await app.sleep(300);
      await app.shot(`${OUT}/cards-${language}-light.png`);
      console.log(`ok  ${language}: three-part cards for recognised errors, raw output kept`);
    }, { project, language, width: 1440, height: 900 });
  }

  // Level new reads the plain text.
  let technical = "";
  await run(async (app) => {
    await open(app);
    technical = (await texts(app, "build-explain-what"))[0];
  }, { project, level: "java", width: 1440, height: 900 });
  await run(async (app) => {
    await open(app);
    const plain = (await texts(app, "build-explain-what"))[0];
    assert(plain && plain !== technical && plain.includes("undefinedHelper"), `level new reads the plain text: "${plain}" instead of "${technical}"`);
    await app.shot(`${OUT}/cards-level-new.png`);
    console.log("ok  level new: plain wording");
  }, { project, level: "new", mode: "simple", width: 1440, height: 900 });

  // Go to the element; a field; Ask the AI.
  await run(async (app) => {
    await open(app);
    await app.click("[data-testid=build-explain-go]");
    await app.waitFor(`document.querySelector(".edhead .edname")`, 15000);
    const name = await app.eval<string>(`document.querySelector(".edhead .edname").textContent`);
    assert(name === "broken", `Go to opens the procedure: ${name}`);
    await app.shot(`${OUT}/go-element-en.png`);
    console.log("ok  Go to opens the element of the error");

    // A field: the explanation names item/ruby.stackSize (the real builds of hello only fail inside procedure blocks).
    await app.mainEval(ipc(`
      ipcMain.removeHandler("build:explain");
      ipcMain.handle("build:explain", () => ({ diagnostics: [{ severity: "error", message: "cannot find symbol", file: "RubyItem.java", line: 3, detail: [],
        element: "item/ruby", fields: ["stackSize"], explain: { id: "cannotFindSymbol", params: { symbol: "stackSize" }, fix: "" } }], failures: [] }));
      return true;`));
    await replay(app, ["error: stub"]);
    await app.waitFor(`document.querySelector("[data-testid=build-explain-go]")?.textContent.includes("stackSize")`, 15000);
    await app.click("[data-testid=build-explain-go]");
    await app.waitFor(`document.querySelector(".formscroll .frow[data-field=stackSize]")`, 15000);
    await app.waitFor(`document.querySelector(".frow[data-field=stackSize]")?.classList.contains("revealed")`, 5000);
    await app.shot(`${OUT}/go-field-en.png`);
    console.log("ok  Go to field shows the field's page and highlights its row");
  }, { project, width: 1440, height: 900 });

  await run(async (app) => {
    await open(app);
    await app.click("[data-testid=build-explain-ask]");
    await app.waitFor(`document.querySelector(".agentsview [data-testid=agent-ai-node][aria-selected=true]")`, 10000);
    await app.waitFor(`document.querySelector("[data-testid=ai-input]")?.value.includes("cannot find symbol")`, 10000);
    const value = await app.eval<string>(`document.querySelector("[data-testid=ai-input]").value`);
    assert(value.includes("undefinedHelper") && value.includes("procedure/broken"), `the AI input holds the error and where it is: ${value}`);
    await app.shot(`${OUT}/ask-en.png`);
    await app.key("Enter");
    await app.waitFor(`document.querySelector("[data-testid=ai-text]")`, 30000);
    assert(received.length === 1 && received[0].includes("undefinedHelper"), "Enter sends the error to the AI");
    console.log("ok  Ask the AI opens the assistant with the error; Enter sends it");
  }, { project, width: 1440, height: 900 });
} finally {
  stub.close();
  stub.closeAllConnections();
}
