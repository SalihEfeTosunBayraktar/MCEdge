/**
 * Q255: an agent that wants to run something heavy over MCP asks in the app. The test plays the MCP server (it writes
 * .mcedge/live/approval-<id>.json the way src/live/approval.ts does) and answers with real clicks.
 * 1. The app's heartbeat (presence-app.json) says agentRuns "ask" by default.
 * 2. A request opens a modal dialog naming the agent, the tool, what it does and its arguments; Allow once, Allow for
 *    this agent session and Deny each write their answer file; Deny has the focus; a second request waits behind the first.
 * 3. Preferences > AI agent runs > Allow without asking is saved and shows in the heartbeat as "allow".
 * Screenshots in design/255/ (en/tr, dark/light). No game or Gradle is started.
 *   node tools/ui-test/agent-run-approval.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LIVE_DIR, readPresence } from "../../src/live/activity.ts";
import { assert, copyProject, launchApp, REPO, evidence } from "./cdp.ts";

const OUT = evidence("design/255");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    const project = copyProject(join(REPO, "examples", "hello"), "hello");
    const live = join(project, LIVE_DIR);
    const request = (id: string, tool: string, summary: string) => {
      mkdirSync(live, { recursive: true });
      writeFileSync(join(live, `approval-${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), tool, summary, client: "claude-code", session: "s1" }) + "\n");
    };
    const answer = (id: string) => {
      const file = join(live, `approval-${id}.answer.json`);
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { answer: string }).answer : undefined;
    };
    const app = await launchApp({ project, language: lang, theme, width: 1280, height: 720 });
    try {
      for (let i = 0; i < 60 && !readPresence(project, "app"); i++) await sleep(250);
      assert(readPresence(project, "app")?.agentRuns === "ask", "the heartbeat says agent runs ask by default");
      assert(!(await app.eval<boolean>(`!!document.querySelector("[data-testid=agent-run]")`)), "no dialog without a request");

      // Allow once; a second request waits behind it.
      request("a1", "run_client", JSON.stringify({ engine: "neoforge-1.21.5" }));
      await app.waitFor(`document.querySelector("[data-testid=agent-run]")`);
      request("a2", "gradle_task", JSON.stringify({ tasks: ["dependencies"] }));
      await app.waitFor(`document.querySelector("[data-testid=agent-run] .hint")?.textContent.includes("1")`);
      const text = await app.eval<string>(`document.querySelector("[data-testid=agent-run]").innerText`);
      assert(text.includes("claude-code") && text.includes("run_client") && text.includes(strings["agentRun.tool.run_client"]) && text.includes("neoforge-1.21.5"), `the dialog names agent, tool, effect and arguments: ${text}`);
      assert(await app.eval<boolean>(`document.activeElement?.getAttribute("data-testid") === "agent-run-deny"`), "Deny has the focus");
      const fit = await app.eval<{ right: number; bottom: number; w: number; h: number; sw: number }>(`(() => { const d = document.querySelector("[data-testid=agent-run]"); const r = d.getBoundingClientRect(); return { right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, sw: d.scrollWidth - d.clientWidth }; })()`);
      assert(fit.right <= fit.w && fit.bottom <= fit.h && fit.sw <= 0, `the dialog fits the window: ${JSON.stringify(fit)}`);
      await app.shot(`${OUT}/dialog-${lang}-${theme}.png`);
      // A click outside does not answer.
      await app.mouse("mousePressed", 5, 300, 1);
      await app.mouse("mouseReleased", 5, 300, 0);
      await sleep(300);
      assert(answer("a1") === undefined, "a click outside does not answer");
      await app.click("[data-testid=agent-run-once]");
      for (let i = 0; i < 40 && !answer("a1"); i++) await sleep(100);
      assert(answer("a1") === "once", `Allow once is written: ${answer("a1")}`);

      // The waiting request is next: Deny.
      await app.waitFor(`document.querySelector("[data-testid=agent-run]")?.innerText.includes("gradle_task")`);
      await app.click("[data-testid=agent-run-deny]");
      for (let i = 0; i < 40 && !answer("a2"); i++) await sleep(100);
      assert(answer("a2") === "deny", `Deny is written: ${answer("a2")}`);
      await app.waitFor(`!document.querySelector("[data-testid=agent-run]")`);

      // Allow for this agent session.
      request("a3", "build", "{}");
      await app.waitFor(`document.querySelector("[data-testid=agent-run]")`);
      assert(!(await app.eval<boolean>(`!!document.querySelector("[data-testid=agent-run] .agentrun-args")`)), "empty arguments show no box");
      await app.click("[data-testid=agent-run-session]");
      for (let i = 0; i < 40 && !answer("a3"); i++) await sleep(100);
      assert(answer("a3") === "session", `Allow for this session is written: ${answer("a3")}`);
      await app.waitFor(`!document.querySelector("[data-testid=agent-run]")`);

      // Escape denies.
      request("a4", "run_server", "{}");
      await app.waitFor(`document.querySelector("[data-testid=agent-run]")`);
      await app.key("Escape");
      for (let i = 0; i < 40 && !answer("a4"); i++) await sleep(100);
      assert(answer("a4") === "deny", `Escape denies: ${answer("a4")}`);

      // Preferences: Allow without asking reaches the heartbeat.
      await app.click(".menubar .menu", strings["menu.window"]);
      await app.click(".menulist button", strings["menu.preferences"]);
      await app.waitFor(`document.querySelector("[data-testid=pref-agent-runs]")`);
      assert(await app.eval<boolean>(`document.querySelector("[data-testid=pref-agent-runs]").value === "ask"`), "Preferences starts on ask");
      await app.eval(`document.querySelector("[data-testid=pref-agent-runs]").scrollIntoView({ block: "center" })`);
      await sleep(200);
      await app.shot(`${OUT}/preferences-${lang}-${theme}.png`);
      await app.setValue("[data-testid=pref-agent-runs]", "allow");
      for (let i = 0; i < 80 && readPresence(project, "app")?.agentRuns !== "allow"; i++) await sleep(250);
      assert(readPresence(project, "app")?.agentRuns === "allow", "the heartbeat says allow after the change");
      const saved = (JSON.parse(readFileSync(join(app.userData, "app-state.json"), "utf8")) as { preferences: { agentRuns?: string } }).preferences.agentRuns;
      assert(saved === "allow", `saved in the preferences: ${saved}`);
    } finally {
      await app.close();
    }
  }
}
console.log("PASS");
