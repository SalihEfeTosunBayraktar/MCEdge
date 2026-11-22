/**
 * KUYRUK #146: tasks for the agent in the app, with a scripted agent over the real `mcedge mcp` server. The user
 * creates tasks by right-clicking an element tile, a field of the open editor, a problem row and a build output line,
 * and a free one with New task; the agent claims one, reports progress, makes the change and completes it; the app
 * shows status, owner, progress, result and a link to the agent's timeline step; the user accepts one and reopens
 * another with a reason, which the agent reads. Dark and light; screenshots go to design/146/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/146");
const ruby = () => JSON.parse(readFileSync(join(project, "elements", "items", "ruby.json"), "utf8"));
const tag = (app: App, selector: string, text: string, id: string) =>
  app.eval(`document.getElementById(${JSON.stringify(id)})?.removeAttribute("id"); [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))?.setAttribute("id", ${JSON.stringify(id)})`);
/** Right-click `#id`, pick New task for the agent, check what the dialog says it is about, give it a title and create it. */
const newTaskFrom = async (app: App, id: string, about: string, title?: string) => {
  await app.click(`#${id}`, undefined, { button: "right" });
  await app.click(".menulist.ctx button", "New task for the agent");
  await app.waitFor(`document.querySelector(".newtask")`);
  const said = await app.eval<string>(`document.querySelector(".newtaskabout").textContent`);
  assert(said.includes(about), `the dialog says what the task is about: ${said}`);
  if (title) await app.setValue(".newtask input", title);
  await app.click(".dialog .abtn", "Create");
  await app.waitFor(`!document.querySelector(".newtask")`);
};
const row = (title: string) => `[...document.querySelectorAll(".tasksview .grid tbody tr")].find((r) => r.textContent.includes(${JSON.stringify(title)}))`;

await run(async (app) => {
  const mcp = await connect(project);
  try {
    // 1. From an element tile.
    await tag(app, ".tile", "Ruby Apple", "appletile");
    await newTaskFrom(app, "appletile", "Element item/ruby_apple", "Make the apple restore more hunger");
    await app.waitFor(`document.querySelector(".ptab.on")?.textContent.includes("Agents") && document.querySelector(".agtasks.on")`);
    await app.waitFor(`${row("Make the apple")}?.textContent.includes("Open")`);

    // 2. From a field of the open editor (its label).
    await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").id = "rubytile"`);
    await app.click("#rubytile", undefined, { double: true });
    await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby"`);
    await app.click(".ltab", "Properties");
    await app.eval(`document.querySelector('.frow[data-field="stackSize"] > label').id = "stacklabel"`);
    await newTaskFrom(app, "stacklabel", "Field stackSize of item/ruby", "Ruby should stack to 16");
    await app.shot(`${OUT}/146-from-field-dark.png`);

    // 3. From a problem row (an invalid value the agent wrote).
    await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire", stackSize: 500 } });
    await app.click(".abtn", "Back to elements");
    await app.click(".ptab", "Problems");
    await app.waitFor(`[...document.querySelectorAll(".problems li")].some((li) => li.textContent.includes("item/sapphire.stackSize"))`, 10000);
    await tag(app, ".problems li", "item/sapphire.stackSize", "problemrow");
    await newTaskFrom(app, "problemrow", "Problem: item/sapphire.stackSize");
    assert(await app.eval<boolean>(`${row("Fix:")} !== undefined`), "a problem task gets a Fix: title");

    // 4. From a build output line (a failed build's error, sent as the build runner does).
    const error = "src/main/java/com/example/Ruby.java:12: error: cannot find symbol";
    await app.mainEval(`(() => {
      const { BrowserWindow } = (process.mainModule ? process.mainModule.require : require)("electron");
      const send = (e) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("build:event", e));
      send({ type: "start", engineId: "fabric-1.21.5" });
      ["> Task :compileJava", ${JSON.stringify(error)}, "BUILD FAILED in 4s"].forEach((line) => send({ type: "line", engineId: "fabric-1.21.5", line }));
      send({ type: "done", engineId: "fabric-1.21.5", ok: false });
      return true;
    })()`);
    await app.click(".ptab", "Build output");
    await app.waitFor(`document.querySelector(".build-view .log")?.textContent.includes("cannot find symbol")`);
    const [x, y] = await app.eval<[number, number]>(`(() => {
      const pre = document.querySelector(".build-view .log");
      const node = pre.firstChild;
      const at = node.textContent.indexOf("cannot find");
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 6);
      const r = range.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    await app.eval(`document.querySelector(".build-view .log").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${x}, clientY: ${y} }))`);
    await app.click(".menulist.ctx button", "New task for the agent");
    await app.waitFor(`document.querySelector(".newtaskabout")?.textContent.includes(${JSON.stringify(error)})`);
    await app.click(".dialog .abtn", "Create");
    await app.waitFor(`!document.querySelector(".newtask")`);

    // 5. A free task.
    await app.click(".tasksview .abtn", "New task");
    await app.waitFor(`document.querySelector(".newtaskabout")?.textContent === "Nothing in particular"`);
    await app.setValue(".newtask input", "Add a sapphire block");
    await app.click(".dialog .abtn", "Create");
    await app.waitFor(`document.querySelectorAll(".tasksview .grid tbody tr").length === 5`);
    await app.shot(`${OUT}/146-list-dark.png`);

    // The scripted agent: told about the new tasks, claims the field task, reports progress, changes it, completes.
    const told = await mcp.call("read_element", { type: "item", id: "ruby" });
    // (Its create_element call above was already told about the first two.)
    assert(typeof told === "string" && told.includes("3 open task(s)") && told.includes("Add a sapphire block"), "the agent is told about the new tasks");
    const todo = await mcp.call("list_tasks");
    const stack = todo.find((t: { title: string }) => t.title === "Ruby should stack to 16");
    assert(stack.source.kind === "field" && stack.source.target === "item/ruby" && stack.source.field === "stackSize", `the field task names the field: ${JSON.stringify(stack.source)}`);
    assert(todo.some((t: { source: { kind: string; text?: string } }) => t.source.kind === "build" && t.source.text === error), "the build task carries the error line");
    await mcp.call("claim_task", { id: stack.id });
    await app.waitFor(`${row("Ruby should stack")}?.textContent.includes("In progress") && ${row("Ruby should stack")}.textContent.includes("mcedge-test")`, 10000);
    await mcp.call("update_task", { id: stack.id, progress: "Setting the stack size" });
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
    await mcp.call("complete_task", { id: stack.id, result: "Ruby stacks to 16 now" });
    assert(ruby().stackSize === 16, "the agent made the change");
    await app.waitFor(`${row("Ruby should stack")}?.textContent.includes("Done, to review")`, 10000);
    assert((await app.eval<string>(`document.querySelector(".ptab .pcount")?.textContent`)) === "1", "the tab counts tasks to review");

    // The app shows progress, result and the step link; the link opens the step in the timeline.
    await app.eval(`${row("Ruby should stack")}.click()`);
    await app.waitFor(`document.querySelector("[data-testid=task-result]")?.textContent === "Ruby stacks to 16 now"`);
    assert((await app.eval<string>(`document.querySelector(".taskprogress").textContent`)).includes("Setting the stack size"), "progress shows");
    await app.shot(`${OUT}/146-done-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/146-done-light.png`);
    await app.setTheme("dark");
    await app.click(".tasksteps .linkbtn");
    await app.waitFor(`document.querySelector(".agsession.on") && document.querySelector(".tlstep.on")?.textContent.includes("update_element")`, 10000);
    await app.shot(`${OUT}/146-step-link-dark.png`);

    // Accept it; reopen the apple task after the agent says it is done, with a reason the agent reads.
    await app.click(".agtasks");
    await app.eval(`${row("Ruby should stack")}.click()`);
    await app.click(".tasksview .abtn", "Accept");
    await app.waitFor(`${row("Ruby should stack")}?.textContent.includes("Accepted")`, 10000);
    const apple = todo.find((t: { title: string }) => t.title.startsWith("Make the apple"));
    await mcp.call("claim_task", { id: apple.id });
    await mcp.call("complete_task", { id: apple.id, result: "Nutrition 6" });
    await app.waitFor(`${row("Make the apple")}?.textContent.includes("Done")`, 10000);
    await app.eval(`${row("Make the apple")}.click()`);
    await app.click(".tasksview .abtn", "Reopen");
    await app.waitFor(`document.querySelector(".dialog textarea")`);
    await app.setValue(".dialog textarea", "Saturation too, please");
    await app.click(".dialog .abtn", "Reopen");
    await app.waitFor(`${row("Make the apple")}?.textContent.includes("Reopened")`, 10000);
    const reopened = (await mcp.call("list_tasks")).find((t: { id: string }) => t.id === apple.id);
    assert(reopened.status === "open" && reopened.review.comment === "Saturation too, please", "the agent reads why it was reopened");
    await app.shot(`${OUT}/146-reopened-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/146-reopened-light.png`);
  } finally {
    await mcp.close();
  }
}, { project });
