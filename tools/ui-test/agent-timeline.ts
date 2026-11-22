/**
 * KUYRUK #144: the agent timeline in the app, with a scripted agent over the real `mcedge mcp` server. The element and
 * field the agent works on are highlighted in the list and the open editor; the Agents panel (KUYRUK 195) shows the
 * session, its steps and a field-level diff; Undo step takes a step back, Undo step on a field the user changed
 * since shows a conflict and writes nothing, Undo session restores the rest; a note reaches the agent and its reply
 * shows. Dark and light. Screenshots go to design/144/.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/144");
const ruby = () => JSON.parse(readFileSync(join(project, "elements", "items", "ruby.json"), "utf8"));
const field = (app: App, label: string) => app.eval<string>(`[...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)})?.querySelector("input, select")?.value`);
const settle = async (app: App) => {
  await app.sleep(700);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  await app.sleep(400);
};
const openRuby = async (app: App) => {
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").id = "rubytile"`);
  await app.click("#rubytile", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby"`);
  await app.click(".ltab", "Properties");
};
const stepHead = (n: number) => `.tlstep[data-step="${n}"] .tlstephead`;

await run(async (app) => {
  const mcp = await connect(project);
  try {
    const original = ruby();
    await openRuby(app);

    // Step 1: the agent reads and changes the open element; the field it works on is highlighted in the editor.
    await mcp.call("read_element", { type: "item", id: "ruby" });
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
    await app.waitFor(`document.querySelector(".agentchip")?.textContent.includes("stackSize")`, 10000);
    await app.waitFor(`(() => { const r = document.querySelector('.frow[data-field="stackSize"]'); return r && getComputedStyle(r).boxShadow.includes("95, 184, 240"); })()`, 10000);
    assert(!(await app.eval<boolean>(`getComputedStyle(document.querySelector('.frow[data-field="name"]')).boxShadow.includes("95, 184, 240")`)), "only the agent's field is highlighted");
    await app.waitFor(`document.querySelector('.frow[data-field="stackSize"] input')?.value === "16"`, 10000);
    assert((await field(app, "Max stack size")) === "16", "the agent's change is in the form");
    await app.shot(`${OUT}/144-editor-field-dark.png`);

    // Step 2 (named): a new element and its texture; the list marks the element the agent is on.
    await app.click(".abtn", "Back to elements");
    await mcp.call("begin_step", { title: "Add sapphire" });
    await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
    await mcp.call("create_texture", { path: "textures/item/sapphire.png", width: 16, height: 16, fill: "#2e5c8a" });
    await mcp.call("update_element", { type: "item", id: "sapphire", values: { texture: "textures/item/sapphire.png" } });
    await app.waitFor(`[...document.querySelectorAll(".tile.agenthere")].some((t) => t.textContent.includes("Sapphire"))`, 10000);
    assert((await app.eval<number>(`document.querySelectorAll(".tile.agenthere").length`)) === 1, "one element is marked as the agent's current one");
    await app.shot(`${OUT}/144-list-agent-here-dark.png`);

    // The timeline: one session, two steps, every call with its target, a field-level diff.
    await app.click(".sitem.agent");
    await app.waitFor(`document.querySelectorAll(".tlstep").length === 2`, 10000);
    assert((await app.eval<number>(`document.querySelectorAll(".agentsview .agsession").length`)) === 1, "one session");
    const step1 = await app.eval<string>(`document.querySelector('.tlstep[data-step="1"]').textContent`);
    assert(step1.includes("read_element") && step1.includes("update_element") && step1.includes("item/ruby"), `step 1 lists the read and the change: ${step1}`);
    const diff = await app.eval<string[]>(`[...document.querySelectorAll('.tlstep[data-step="1"] .tlfield')].map((f) => f.textContent)`);
    assert(diff.some((d) => d.startsWith("stackSize") && d.includes("64") && d.includes("16")), `field diff stackSize 64 -> 16: ${diff.join(" | ")}`);
    const step2 = await app.eval<string>(`document.querySelector('.tlstep[data-step="2"]').textContent`);
    assert(step2.includes("Add sapphire") && step2.includes("textures/item/sapphire.png") && step2.includes("New"), `step 2 has its title and new files: ${step2}`);
    assert((await app.eval<string>(`document.querySelector("[data-testid=agent-focus]").textContent`)).includes("item/sapphire"), "the panel says what the agent works on");
    await app.shot(`${OUT}/144-timeline-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/144-timeline-light.png`);
    await app.setTheme("dark");

    // Undo step 2: the element and its texture go.
    assert(await app.eval<boolean>(`document.querySelector(".timeline .actions .abtn").disabled`), "Undo step needs a selected step");
    await app.click(stepHead(2));
    await app.click(".timeline .abtn", "Undo step");
    await app.waitFor(`![...document.querySelectorAll(".tile")].some((t) => t.textContent.includes("Sapphire"))`, 10000);
    await app.waitFor(`document.querySelector('.tlstep[data-step="2"]').classList.contains("undone")`, 10000);
    assert(!existsSync(join(project, "elements/items/sapphire.json")) && !existsSync(join(project, "textures/item/sapphire.png")), "files of step 2 are gone");

    // The user changes the field the agent wrote: Undo step 1 shows the conflict and writes nothing.
    await openRuby(app);
    await app.setField("Max stack size", "20");
    await settle(app);
    await app.click(stepHead(1));
    await app.click(".timeline .abtn", "Undo step");
    await app.waitFor(`document.querySelector(".tlconflictdlg")`, 10000);
    const conflict = await app.eval<string>(`document.querySelector(".tlconflicts tbody").textContent`);
    assert(conflict.includes("stackSize") && conflict.includes("16") && conflict.includes("20"), `the conflict names the field and both values: ${conflict}`);
    assert(ruby().stackSize === 20, "nothing was written");
    await app.shot(`${OUT}/144-conflict-dark.png`);
    // The dialog's backdrop covers the theme button: switch the theme attribute directly for the light shot.
    await app.eval(`document.documentElement.dataset.theme = "light"`);
    await app.shot(`${OUT}/144-conflict-light.png`);
    await app.eval(`document.documentElement.dataset.theme = "dark"`);
    await app.click(".tlconflictdlg .abtn", "Close");

    // Back to the agent's value: Undo session restores the element in the open editor.
    await app.setField("Max stack size", "16");
    await settle(app);
    await app.click(".timeline .abtn", "Undo session");
    await app.waitFor(`document.querySelector('.tlstep[data-step="1"]').classList.contains("undone")`, 10000);
    await app.waitFor(`(() => { const r = [...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.trim() === "Max stack size"); return r?.querySelector("input")?.value === "${original.stackSize}"; })()`, 10000);
    await settle(app);
    assert(ruby().stackSize === original.stackSize, `the file is back to ${original.stackSize}: ${ruby().stackSize}`);

    // A note for the agent: it gets it with its next call, reads and answers it; the reply shows.
    await app.setValue(".tlnoteform textarea", "Make the ruby stack to 32 instead");
    await app.click(".tlnoteform .mbtn", "New note");
    await app.waitFor(`document.querySelector(".tlnotelist li.waiting")?.textContent.includes("stack to 32")`, 10000);
    const told = await mcp.call("list_elements", { type: "item" });
    assert(typeof told === "string" && told.includes("stack to 32"), "the next tool result carries the note");
    const [note] = await mcp.call("read_notes");
    assert(note.target === "item/ruby", `the note is about the selected step's element: ${note.target}`);
    await mcp.call("ack_note", { id: note.id, reply: "On it" });
    await app.waitFor(`document.querySelector(".tlnotelist li.seen .tlreply")?.textContent === "On it"`, 10000);
    await app.shot(`${OUT}/144-notes-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/144-notes-light.png`);
  } finally {
    await mcp.close();
  }
}, { project });
