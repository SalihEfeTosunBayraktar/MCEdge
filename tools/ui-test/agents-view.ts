/**
 * KUYRUK #195: the Agents panel. Sessions of five agents (two live over the real `mcedge mcp` server as claude-code
 * and codex, older ones of Antigravity, Gemini, a DeepSeek model in another client and an unknown agent written to
 * the activity log as earlier days left them) are filed in a folder per agent with date ranges; selecting a session
 * shows its timeline with the task it held; the old panel names still open the panel; folders stay open or closed
 * after a restart. Dark, light and Turkish; screenshots go to design/195/.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateRangeOf } from "../../app/renderer/src/live/agents.ts";
import { readActivity, type ActivityEntry } from "../../src/live/activity.ts";
import { createTask } from "../../src/live/tasks.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, launchApp, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/195");
const DAY = 24 * 60 * 60_000;
const at = (daysAgo: number, hour: number) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};
/** Earlier sessions as the server logged them; `model` only where the agent named one. */
const earlier: { session: string; client: string; version: string; model?: string; at: string }[] = [
  { session: "ccyday", client: "claude-code", version: "2.0.14", model: "claude-sonnet-4-5", at: at(1, 10) },
  { session: "agyday", client: "antigravity-client", version: "1.0.3", at: at(1, 16) },
  { session: "gmold", client: "gemini-cli-mcp-client", version: "0.9.0", at: at(45, 11) },
  { session: "dsweek", client: "cline", version: "3.30.1", model: "deepseek-chat", at: at(3, 9) },
  { session: "oddbot", client: "my-agent", version: "0.1.0", at: at(2, 14) },
];
const lines: ActivityEntry[] = earlier.flatMap((s) => [
  { at: s.at, actor: "agent", client: s.client, clientVersion: s.version, ...(s.model ? { model: s.model } : {}), session: s.session, call: `${s.session}.1`, tool: "read_element", target: "item/ruby", read: true, step: 1 },
  { at: s.at, actor: "agent", client: s.client, clientVersion: s.version, ...(s.model ? { model: s.model } : {}), session: s.session, call: `${s.session}.2`, tool: "list_elements", read: true, step: 1 },
]);
mkdirSync(join(project, ".mcedge", "live"), { recursive: true });
writeFileSync(join(project, ".mcedge", "live", "activity.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

const text = (app: App, selector: string) => app.eval<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
const folder = (provider: string) => `.agfolder[data-provider="${provider}"]`;
const rangeOf = (s: { at: string }) => dateRangeOf(s.at, Date.now());
const openPanel = async (app: App) => {
  await app.waitFor(`document.querySelector(".sitem.agent")`, 10000);
  await app.click(".sitem.agent");
  await app.waitFor(`document.querySelector(".agentsview .agfolder")`, 10000);
};

const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
let app = await launchApp({ project, userData });
let failed = false;
try {
  // Two live agents: claude-code names its model, codex works on a task.
  const claude = await connect(project, undefined, { name: "claude-code", version: "2.0.30" });
  const codex = await connect(project, undefined, { name: "codex-mcp-client", version: "0.46.0" });
  try {
    await claude.call("begin_step", { title: "Stack rubies by 16", model: "claude-opus-4-5" });
    await claude.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
    const task = createTask(project, { title: "Add a sapphire", source: { kind: "free" } });
    await codex.call("claim_task", { id: task.id });
    await codex.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
    await codex.call("complete_task", { id: task.id, result: "Sapphire added" });
  } finally {
    await claude.close();
    await codex.close();
  }
  const logged = readActivity(project, 100).filter((e) => e.client === "claude-code" && e.tool === "update_element");
  assert(logged.length === 1 && logged[0].clientVersion === "2.0.30" && logged[0].model === "claude-opus-4-5", `the log keeps the client's version and the model it named: ${JSON.stringify(logged[0])}`);

  // The status bar opens the Agents panel (old "activity") at the newest session: codex's.
  await openPanel(app);
  assert((await text(app, ".ptab.on")).includes("Agents"), "one Agents tab");
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".ptab")].some((t) => /Agent activity|Agent tasks/.test(t.textContent))`)), "the old tabs are gone");
  const providers = await app.eval<string[]>(`[...document.querySelectorAll(".agfolder")].map((f) => f.dataset.provider)`);
  assert(providers.join() === "claude,codex,gemini,antigravity,deepseek,other", `a folder per agent, in order: ${providers.join()}`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".agfolder")].every((f) => f.querySelector(".aghead .agentmark"))`), "every folder has its mark");
  assert((await text(app, `${folder("claude")} .aghead .agcount`)) === "2", "Claude: two sessions");
  const claudeRanges = await app.eval<string[]>(`[...document.querySelectorAll('${folder("claude")} .agrange')].map((r) => r.dataset.range)`);
  assert(claudeRanges.join() === ["today", rangeOf(earlier[0])].join(), `Claude's date ranges, newest first: ${claudeRanges.join()}`);
  for (const s of earlier) {
    const provider = { ccyday: "claude", agyday: "antigravity", gmold: "gemini", dsweek: "deepseek", oddbot: "other" }[s.session]!;
    assert(await app.eval<boolean>(`!!document.querySelector('${folder(provider)} .agrange[data-range="${rangeOf(s)}"]')`), `${s.session} is under ${provider} / ${rangeOf(s)}`);
  }
  const month = rangeOf(earlier[2]);
  assert(month.startsWith("month:") && (await app.eval<boolean>(`document.querySelector('${folder("gemini")} .agrange[data-range="${month}"]').getAttribute("aria-expanded") === "false"`)),
    "an older month starts closed");
  assert((await text(app, `${folder("gemini")} .agrangehead`)).includes(new Date(earlier[2].at).getFullYear().toString()), "a month range names month and year");
  assert((await text(app, `${folder("deepseek")} .agsession .agname`)) === "deepseek-chat", "the DeepSeek session is named by its model");

  const selected = await text(app, ".agsession.on");
  assert(selected.includes("codex-mcp-client"), `the newest session is selected: ${selected}`);
  await app.waitFor(`document.querySelector(".agsessiontasks")?.textContent.includes("Add a sapphire")`);
  assert((await text(app, ".agsessiontasks")).includes("Sapphire added"), "the session shows the task it held, with its result");
  assert((await text(app, ".timeline .tlsteps")).includes("create_element"), "and its timeline");

  // Claude's session of today: its step and change.
  await app.click(`${folder("claude")} .agrange[data-range="today"] .agsession`);
  await app.waitFor(`document.querySelector(".tlstep")?.textContent.includes("Stack rubies by 16")`);
  assert((await text(app, ".agsession.on .agname")) === "claude-opus-4-5", "a session reads as the model the agent named");
  assert((await app.eval<string[]>(`[...document.querySelectorAll(".tlfield")].map((f) => f.textContent)`)).some((f) => f.startsWith("stackSize") && f.includes("16")), "with its field diff");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".agsessiontasks")`)), "no tasks for a session that held none");

  // A task in a session's timeline opens it under Tasks.
  await app.click(`${folder("codex")} .agsession`);
  await app.click(".agsessiontasks .linkbtn", "Add a sapphire");
  await app.waitFor(`document.querySelector(".agtasks.on") && document.querySelector("[data-testid=task-result]")?.textContent === "Sapphire added"`);
  assert((await text(app, ".agtasks .pcount")) === "1" && (await text(app, ".ptab .pcount")) === "1", "Tasks and the tab count the task to review");

  // The old panel names: "activity" (status bar) opens the newest session, "tasks" (a new task) the tasks.
  await app.click(`${folder("deepseek")} .agsession`);
  await app.click(".sitem.agent");
  await app.waitFor(`document.querySelector(".agsession.on")?.textContent.includes("codex-mcp-client")`);
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").id = "rubytile"`);
  await app.click("#rubytile", undefined, { button: "right" });
  await app.click(".menulist.ctx button", "New task for the agent");
  await app.waitFor(`document.querySelector(".newtask")`);
  await app.setValue(".newtask input", "Ruby glows");
  await app.click(".dialog .abtn", "Create");
  await app.waitFor(`document.querySelector(".agtasks.on") && [...document.querySelectorAll(".tasksview .grid tbody tr")].some((r) => r.textContent.includes("Ruby glows"))`);

  // Fold Antigravity, open Gemini's month; then shots.
  await app.click(`${folder("antigravity")} .aghead`);
  await app.click(`${folder("gemini")} .agrange[data-range="${month}"] .agrangehead`);
  await app.waitFor(`document.querySelector('${folder("antigravity")}').getAttribute("aria-expanded") === "false" && document.querySelector('${folder("gemini")} .agsession')`);
  await app.click(`${folder("claude")} .agrange[data-range="today"] .agsession`);
  await app.waitFor(`document.querySelector(".tlstep")`);
  await app.eval(`document.querySelector(".agtree").scrollTop = 0`);
  await app.shot(`${OUT}/195-agents-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/195-agents-light.png`);
  await app.click(".agtasks");
  await app.waitFor(`document.querySelector(".tasksview")`);
  await app.shot(`${OUT}/195-tasks-light.png`);
  await app.setTheme("dark");
  // Chromium writes localStorage to disk a few seconds after a change, and the test ends the app with a hard kill.
  await app.sleep(8000);
} catch (error) {
  failed = true;
  console.error("FAIL", error);
  await app.shot("tools/ui-test/last-failure.png").catch(() => {});
} finally {
  await app.close();
}

// After a restart the folders are as the user left them.
if (!failed) {
  app = await launchApp({ project, userData });
  try {
    await openPanel(app);
    assert(await app.eval<boolean>(`document.querySelector('${folder("antigravity")}').getAttribute("aria-expanded") === "false" && !document.querySelector('${folder("antigravity")} .agsession')`), "Antigravity stays closed after a restart");
    assert(await app.eval<boolean>(`!!document.querySelector('${folder("gemini")} .agsession')`), "Gemini's month stays open");
    assert(await app.eval<boolean>(`document.querySelector('${folder("claude")}').getAttribute("aria-expanded") === "true"`), "the others stay open");
  } catch (error) {
    failed = true;
    console.error("FAIL", error, await app.eval(`JSON.stringify(Object.entries(localStorage))`).catch(String));
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
  } finally {
    await app.close();
  }
}

// Turkish.
if (!failed) {
  app = await launchApp({ project, language: "tr" });
  try {
    await app.waitFor(`document.querySelector(".sitem.agent")`, 10000);
    await app.click(".sitem.agent");
    await app.waitFor(`document.querySelector(".agentsview .agfolder")`, 10000);
    const tree = await text(app, ".agtree");
    assert((await text(app, ".ptab.on")).includes("Ajanlar") && tree.includes("Görevler") && tree.includes("Bugün") && tree.includes("Diğer ajanlar"), `the tree is Turkish: ${tree}`);
    assert(!/\b(Agents|Tasks|Today|Yesterday|This week|Other agents)\b/.test(tree), `no English in the tree: ${tree}`);
    await app.click(`${folder("codex")} .agsession`);
    await app.waitFor(`document.querySelector(".agsessiontasks")?.textContent.includes("Bu oturumun görevleri")`);
    await app.shot(`${OUT}/195-agents-tr-dark.png`);
  } catch (error) {
    failed = true;
    console.error("FAIL", error);
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
  } finally {
    await app.close();
  }
}
console.log(failed ? "FAIL" : "PASS");
if (failed) process.exitCode = 1;
