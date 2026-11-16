/**
 * Q211 (reopened): the texture_folders tool with `kind` sounds, models and structures, on a copy of examples/hello with
 * four files of each kind, one named by an element: create, color, move many items, list, a dry run and remove with
 * deleteContents (the file an element names stays and moves up; a listed sound event is removed, its file stays), and
 * remove keeping the contents. The Textures part of texture-folders.json stays untouched.
 *   node tools/mcp-test/resource-folders-kinds.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { addElement } from "../ui-test/fixtures.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
for (const dir of ["sounds", "models", "structures"]) mkdirSync(join(project, dir), { recursive: true });
for (const n of ["a", "b", "c", "used"]) {
  writeFileSync(join(project, `sounds/snd_${n}.ogg`), "OggS");
  writeFileSync(join(project, `models/mdl_${n}.json`), '{"elements": []}');
  writeFileSync(join(project, `structures/str_${n}.nbt`), "nbt");
}
addElement(project, "block", "noisy", { breakSound: "hellomcedge:snd_used" });
addElement(project, "armor", "worn", { helmetModelName: "mdl_used" });
addElement(project, "structure", "tower", { structure: "hellomcedge:str_used" });
// A listed sound event over snd_b, so deleting folder contents removes the event, not the file.
writeFileSync(join(project, "sound_events.json"), JSON.stringify({ chime: { category: "block", files: ["snd_b"] } }, null, 2));
const whole = () => JSON.parse(readFileSync(join(project, "texture-folders.json"), "utf8")) as { folders: string[]; resources?: Record<string, { folders: string[]; placement: Record<string, string>; colors?: Record<string, string> }> };
const mcp = await connect(project);
try {
  const lists: Record<string, { items: string[]; used: string; file: (k: string) => string }> = {
    models: { items: ["models/mdl_a.json", "models/mdl_b.json", "models/mdl_c.json", "models/mdl_used.json"], used: "models/mdl_used.json", file: (k) => k },
    structures: { items: ["structures/str_a.nbt", "structures/str_b.nbt", "structures/str_c.nbt", "structures/str_used.nbt"], used: "structures/str_used.nbt", file: (k) => k },
    sounds: { items: ["snd_a", "chime", "snd_c", "snd_used"], used: "snd_used", file: (k) => `sounds/${k}.ogg` },
  };
  for (const [kind, { items, used, file }] of Object.entries(lists)) {
    await mcp.call("texture_folders", { kind, action: "create", path: "Pack/Sub" });
    await mcp.call("texture_folders", { kind, action: "color", path: "Pack/Sub", color: "#B02E26" });
    const moved = await mcp.call("texture_folders", { kind, action: "move", items, folder: "Pack/Sub" });
    assert(moved.moved === 4, `${kind} moved: ${JSON.stringify(moved)}`);
    const bad = await mcp.call("texture_folders", { kind, action: "move", items: ["nope"], folder: "Pack" }, true);
    assert(String(bad).includes("no project"), `${kind} unknown item refused: ${bad}`);
    const listed = await mcp.call("texture_folders", { kind });
    assert(JSON.stringify(listed.folders) === JSON.stringify([{ path: "Pack", [kind]: 0, total: 4 }, { path: "Pack/Sub", [kind]: 4, total: 4, color: "#b02e26" }]), `${kind} list: ${JSON.stringify(listed)}`);
    assert(whole().resources?.[kind]?.placement[items[0]] === "Pack/Sub", `${kind} stored under resources: ${JSON.stringify(whole())}`);
    const dry = await mcp.call("texture_folders", { kind, action: "remove", path: "Pack", deleteContents: true, dryRun: true });
    assert(dry.kept.join() === used && dry.wouldDelete.length === 3, `${kind} dry run: ${JSON.stringify(dry)}`);
    const done = await mcp.call("texture_folders", { kind, action: "remove", path: "Pack", deleteContents: true });
    assert(done.kept.join() === used && done.deleted.length === 3, `${kind} remove: ${JSON.stringify(done)}`);
    assert(existsSync(join(project, file(used))), `${kind}: the file an element names stays`);
    if (kind === "sounds") {
      assert(existsSync(join(project, "sounds/snd_b.ogg")), "the file of a removed sound event stays");
      assert(!existsSync(join(project, "sounds/snd_a.ogg")) && !existsSync(join(project, "sounds/snd_c.ogg")), "plain unused sounds are deleted");
    } else for (const k of items.filter((i) => i !== used)) assert(!existsSync(join(project, file(k))), `${kind}: ${k} deleted`);
    const after = whole().resources?.[kind];
    assert(!after?.folders.length && !(used in (after?.placement ?? {})), `${kind} all gone: ${JSON.stringify(after)}`);
  }
  // Keeping the contents: they go up to the parent.
  await mcp.call("texture_folders", { kind: "models", action: "create", path: "Keep/Inner" });
  await mcp.call("texture_folders", { kind: "models", action: "move", items: ["models/mdl_used.json"], folder: "Keep/Inner" });
  await mcp.call("texture_folders", { kind: "models", action: "remove", path: "Keep/Inner" });
  assert(whole().resources?.models?.placement["models/mdl_used.json"] === "Keep", `keep: ${JSON.stringify(whole())}`);
  // The Textures list is a separate state in the same file and still works.
  await mcp.call("texture_folders", { action: "create", path: "Gems" });
  assert(whole().folders.join() === "Gems" && whole().resources?.models?.folders.join() === "Keep", `kinds do not mix: ${JSON.stringify(whole())}`);
  console.log("PASS");
} finally {
  await mcp.close();
}
