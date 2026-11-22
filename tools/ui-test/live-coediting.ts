/**
 * KUYRUK #10: the user in the app and an AI agent over MCP (the real `mcedge mcp` server) edit the same project.
 * The agent sees what the user has open; the user's open element takes the agent's changes live; simultaneous
 * edits of different fields both survive; the same field keeps the user's value; new elements and the agent's
 * activity show up without a refresh; a save racing an agent's write merges it (KUYRUK 159). Screenshots go to design/live-coediting/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/live-coediting");
const ruby = () => JSON.parse(readFileSync(join(project, "elements", "items", "ruby.json"), "utf8"));
const field = (app: App, label: string) => app.eval<string>(`[...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)})?.querySelector("input, select")?.value`);
const settle = async (app: App) => {
  await app.sleep(700);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  await app.sleep(400);
};

await run(async (app) => {
  const mcp = await connect(project);
  try {
    await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Ruby").id = "rubytile"`);
    await app.click("#rubytile", undefined, { double: true });
    await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby"`);
    await app.click(".ltab", "Properties");
    await app.sleep(500);
    const who = await mcp.call("collaborators");
    assert(who.app?.open === "item/ruby", `the agent sees what the user has open: ${JSON.stringify(who.app)}`);

    // The agent changes a field of the open element: it shows up in the form.
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
    await app.waitFor(`document.querySelector(".livechip")`, 10000);
    assert((await field(app, "Max stack size")) === "16", "agent change appears in the open form");
    await app.waitFor(`document.querySelector(".sitem.agent.on")`, 10000);
    await app.shot(`${OUT}/editor-updated-dark.png`);

    // Both at once on different fields: the user renames while the agent changes the stack size.
    await app.setField("Display name", "Ruby Gem");
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 8 } });
    await settle(app);
    let disk = ruby();
    assert(disk.name === "Ruby Gem" && disk.stackSize === 8, `both edits survive: name=${disk.name} stackSize=${disk.stackSize}`);
    assert((await field(app, "Display name")) === "Ruby Gem" && (await field(app, "Max stack size")) === "8", "the form shows both");

    // Both at once on the same field: the user's value wins and is saved.
    await app.setField("Max stack size", "20");
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 30 } });
    await app.waitFor(`document.querySelector(".livechip.conflict")`, 10000);
    await settle(app);
    disk = ruby();
    assert(disk.stackSize === 20 && (await field(app, "Max stack size")) === "20", `the user's edit of the same field is kept: ${disk.stackSize}`);
    await app.shot(`${OUT}/editor-conflict-dark.png`);

    // The agent creates an element: it appears in Mod elements, marked.
    await app.click(".abtn", "Back to elements");
    await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
    await app.waitFor(`[...document.querySelectorAll(".tile.live")].some((t) => t.textContent.includes("Sapphire"))`, 10000);
    await app.shot(`${OUT}/workspace-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/workspace-light.png`);

    // Agent activity panel.
    await app.click(".sitem.agent");
    await app.waitFor(`document.querySelectorAll(".timeline .tlcalls li").length >= 4`);
    const lines = await app.eval<string>(`document.querySelector(".timeline .tlsteps").textContent`);
    assert(lines.includes("create_element") && lines.includes("item/sapphire"), "activity lists the agent's changes");
    await app.shot(`${OUT}/activity-light.png`);
    await app.setTheme("dark");
    await app.shot(`${OUT}/activity-dark.png`);

    // KUYRUK 159: a save that left before the file watcher reported an agent's write merges that write instead of
    // overwriting it with the editor's older copy. Under load the watcher is late, so this is driven directly: the agent
    // writes, then a save based on the copy from before arrives.
    const stale = ruby();
    delete stale.$schema;
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 5 } });
    const raced = await app.eval<{ merged?: { taken: string[] } }>(`window.mcedge.saveElement(${JSON.stringify(project)}, "item", ${JSON.stringify({ ...stale, name: "Raced" })}, false, ${JSON.stringify(stale)})`);
    disk = ruby();
    assert(disk.name === "Raced" && disk.stackSize === 5, `a late save keeps the agent's write: name=${disk.name} stackSize=${disk.stackSize}`);
    assert(raced.merged?.taken.includes("stackSize"), `the save reports what it merged: ${JSON.stringify(raced.merged)}`);

    // Screens with their own drafts reload: variables set by the agent show up.
    await app.click(".rtab", "Variables");
    await mcp.call("set_variables", { variables: [{ name: "mana", type: "number", scope: "player_persistent", initial: "20" }] });
    await app.waitFor(`[...document.querySelectorAll(".grid td")].some((td) => td.textContent === "mana")`, 10000);
  } finally {
    await mcp.close();
  }
}, { project });
