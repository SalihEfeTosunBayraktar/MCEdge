/**
 * KUYRUK #144/#146 in Turkish: the Agent activity timeline (steps, diff, notes, a conflict) and the Agent tasks panel
 * (statuses, the task panel, the new task dialog) with a scripted agent, no English left in them.
 * Screenshots go to design/144/ and design/146/ (*-tr-*).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTask } from "../../src/live/tasks.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const rubyFile = join(project, "elements", "items", "ruby.json");
/** Words of the English UI that must not show in these panels in Turkish. */
const ENGLISH = /\b(Undo step|Undo session|Show reads|Notes for the agent|New note|Step \d|Changed|New task|Accept|Reopen|Status|About|Agent tasks|Agents|Nobody yet|In progress|Done, to review|Undo stopped|Agent wrote)\b/;
const textOf = (app: App, selector: string) => app.eval<string>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent).join("\\n")`);

await run(async (app) => {
  const mcp = await connect(project);
  try {
    await mcp.call("begin_step", { title: "Yakutu ayarla" });
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
    const task = createTask(project, { title: "Yakut 16'lık yığılsın", source: { kind: "field", target: "item/ruby", field: "stackSize" } });
    createTask(project, { title: "Safir ekle", source: { kind: "free" } });
    await mcp.call("claim_task", { id: task.id });
    await mcp.call("update_task", { id: task.id, progress: "Yığın boyutu değişiyor" });
    await mcp.call("complete_task", { id: task.id, result: "Yakut artık 16'lık yığılıyor" });

    // Timeline.
    await app.waitFor(`document.querySelector(".sitem.agent")`, 10000);
    await app.click(".sitem.agent");
    await app.waitFor(`document.querySelectorAll(".tlstep").length >= 1`, 10000);
    await app.click(".tlstep .tlstephead");
    await app.setValue(".tlnoteform textarea", "Rengi biraz koyulaştır");
    await app.click(".tlnoteform .mbtn");
    await app.waitFor(`document.querySelector(".tlnotelist li.waiting")`);
    let text = await textOf(app, ".timeline");
    assert(text.includes("Adımı geri al") && text.includes("Adım 1") && text.includes("Ajana notlar") && !ENGLISH.test(text), `timeline is Turkish: ${text.match(ENGLISH)?.[0]}`);
    await app.shot("design/144/144-timeline-tr-dark.png");
    // A conflict: the file changed after the agent wrote it.
    writeFileSync(rubyFile, JSON.stringify({ ...JSON.parse(readFileSync(rubyFile, "utf8")), stackSize: 20 }, null, 2) + "\n");
    await app.sleep(800);
    await app.click(".timeline .abtn", "Adımı geri al");
    await app.waitFor(`document.querySelector(".tlconflictdlg")`, 10000);
    text = await textOf(app, ".tlconflictdlg");
    assert(text.includes("Geri alma durduruldu") && !ENGLISH.test(text), `conflict dialog is Turkish: ${text}`);
    await app.shot("design/144/144-conflict-tr-dark.png");
    await app.key("Escape");
    await app.setTheme("light");
    await app.shot("design/144/144-timeline-tr-light.png");
    await app.setTheme("dark");

    // Tasks.
    await app.click(".agtasks");
    await app.waitFor(`document.querySelectorAll(".tasksview .grid tbody tr").length === 2`);
    await app.eval(`[...document.querySelectorAll(".tasksview .grid tbody tr")].find((r) => r.textContent.includes("Yakut"))?.click()`);
    await app.waitFor(`document.querySelector("[data-testid=task-result]")`);
    text = await textOf(app, ".tasksview");
    assert(text.includes("Bitti, incele") && text.includes("Henüz kimse") && !ENGLISH.test(text), `tasks panel is Turkish: ${text.match(ENGLISH)?.[0]}`);
    await app.shot("design/146/146-tasks-tr-dark.png");
    await app.setTheme("light");
    await app.shot("design/146/146-tasks-tr-light.png");
    await app.click(".tasksview .abtn", "Yeni görev");
    await app.waitFor(`document.querySelector(".newtask")`);
    text = await textOf(app, ".dialog");
    assert(text.includes("Ajan için yeni görev") && !ENGLISH.test(text), `new task dialog is Turkish: ${text}`);
    await app.shot("design/146/146-new-task-tr-light.png");
  } finally {
    await mcp.close();
  }
}, { project, language: "tr" });
