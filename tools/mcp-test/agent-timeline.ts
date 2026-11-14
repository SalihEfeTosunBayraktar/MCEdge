/**
 * KUYRUK #144: the agent timeline over the real `mcedge mcp` server. A scripted agent reads and changes elements;
 * every call is logged with its session, step and a field-level diff, steps group the calls, undo takes a step or
 * the session back and refuses with a conflict when the user changed the same field since, and notes the user
 * leaves reach the agent (with every tool result and read_notes) and are acknowledged.
 *   node tools/mcp-test/agent-timeline.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readActivity } from "../../src/live/activity.ts";
import { addNote, readNotes } from "../../src/live/notes.ts";
import { undoCalls } from "../../src/live/timeline.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const rubyFile = join(project, "elements", "items", "ruby.json");
const ruby = () => JSON.parse(readFileSync(rubyFile, "utf8"));
const original = ruby();
const mcp = await connect(project);
try {
  assert(["begin_step", "read_notes", "ack_note"].every((t) => mcp.tools.includes(t)), "timeline tools are listed");

  // Step 1 (automatic): read, then change two fields of ruby.
  await mcp.call("read_element", { type: "item", id: "ruby" });
  await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16, name: "Red Ruby" } });
  // Step 2 (named): a new element and its texture.
  await mcp.call("begin_step", { title: "Add sapphire" });
  await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire" } });
  await mcp.call("create_texture", { path: "textures/item/sapphire.png", width: 16, height: 16, fill: "#2e5c8a" });

  const log = readActivity(project, 100);
  const calls = log.filter((e) => e.session);
  assert(calls.length === 5 && new Set(calls.map((e) => e.session)).size === 1, `every call is logged in one session (${calls.length})`);
  const read = calls.find((e) => e.tool === "read_element")!;
  assert(read.read && read.target === "item/ruby" && !read.changes, "a read is logged with its target and no changes");
  const update = calls.find((e) => e.tool === "update_element")!;
  const fields = update.changes?.[0].fields ?? [];
  assert(read.step === 1 && update.step === 1 && !update.stepTitle, `the read and the update of the same target form step 1: ${update.step}`);
  assert(fields.some((f) => f.key === "stackSize" && f.before === String(original.stackSize) && f.after === "16")
    && fields.some((f) => f.key === "name" && f.after === "Red Ruby"), `field-level diff: ${JSON.stringify(fields)}`);
  assert(update.fields?.join() === "stackSize,name" && update.undoable, "the call names the fields it worked on and can be undone");
  const create = calls.find((e) => e.tool === "create_element")!;
  assert(create.step === 2 && create.stepTitle === "Add sapphire" && create.changes?.[0].kind === "create" && create.changes[0].path === "elements/items/sapphire.json",
    `a new element is a create in the named step 2: ${create.step} ${create.stepTitle} ${JSON.stringify(create.changes)}`);
  const texture = calls.find((e) => e.tool === "create_texture")!;
  assert(texture.step === 2 && texture.changes?.some((c) => c.path === "textures/item/sapphire.png" && c.kind === "create") && texture.undoable, "binary files are tracked too");

  // Undo step 2: the element and the texture are gone; step 1 stays.
  const step2 = calls.filter((e) => e.step === 2).map((e) => e.call!);
  const undo2 = undoCalls(project, step2);
  assert(undo2.ok && !existsSync(join(project, "elements/items/sapphire.json")) && !existsSync(join(project, "textures/item/sapphire.png")), `undo of step 2: ${JSON.stringify(undo2)}`);
  assert(ruby().stackSize === 16, "step 1 is kept");
  assert(readActivity(project, 100).some((e) => e.tool === "undo" && e.actor === "user" && [...(e.undoes ?? [])].sort().join() === [create.call, texture.call].sort().join()), "the undo is logged with the calls that changed something");
  assert(undoCalls(project, step2).undone.length === 0, "an undone step is not undone twice");

  // The user edits the same field the agent wrote: undo shows a conflict and writes nothing.
  writeFileSync(rubyFile, JSON.stringify({ ...ruby(), stackSize: 32 }, null, 2) + "\n");
  const step1 = calls.filter((e) => e.step === 1).map((e) => e.call!);
  const blocked = undoCalls(project, step1);
  assert(!blocked.ok && blocked.conflicts.length === 1 && blocked.conflicts[0].field === "stackSize" && blocked.conflicts[0].agent === "16" && blocked.conflicts[0].now === "32",
    `conflict on the field the user changed: ${JSON.stringify(blocked.conflicts)}`);
  assert(ruby().stackSize === 32 && ruby().name === "Red Ruby", "nothing was written");
  // Another field the user changed does not block: only the agent's fields are compared.
  writeFileSync(rubyFile, JSON.stringify({ ...ruby(), stackSize: 16, fireproof: true }, null, 2) + "\n");
  const undo1 = undoCalls(project, step1);
  assert(undo1.ok && ruby().stackSize === original.stackSize && ruby().name === original.name && ruby().fireproof === true, `undo of step 1 keeps the user's other field: ${JSON.stringify(undo1)}`);

  // Notes: the next tool result mentions a new note once; read_notes lists it; ack_note answers it.
  addNote(project, "Use a darker red for the ruby texture", "item/ruby#texture");
  const withNote = await mcp.call("list_elements", { type: "item" });
  assert(typeof withNote === "string" && withNote.includes("Use a darker red") && withNote.includes("ack_note"), "a tool result tells the agent about the new note");
  const again = await mcp.call("list_elements", { type: "item" });
  assert(typeof again === "object", "only once");
  const notes = await mcp.call("read_notes");
  assert(notes.length === 1 && notes[0].target === "item/ruby#texture", "read_notes lists it");
  await mcp.call("ack_note", { id: notes[0].id, reply: "Done, darker now" });
  assert(readNotes(project)[0].ack?.reply === "Done, darker now" && readNotes(project)[0].ack?.client === "mcedge-test", "ack_note saves the reply");
  assert((await mcp.call("read_notes")).length === 0, "acknowledged notes are not listed again");
  assert(readActivity(project, 100).some((e) => e.tool === "ack_note" && !e.target), "a note id is not taken for a procedure target");
  assert((await mcp.call("collaborators")).notesWaiting === 0, "collaborators counts waiting notes");
  console.log("PASS");
} finally {
  await mcp.close();
}
