/**
 * KUYRUK #131: locked generated code per element, on all 5 engines. Locking item/ruby keeps its own files
 * (not the shared registries or lang files) in locked-code/; a hand edit there survives regeneration and element
 * changes; rename is refused while locked; unlock warns about edits and needs force; after unlock the code is fresh.
 * `--build`: every engine builds with the hand-edited locked class (heavy: Gradle on 5 engines).
 *   node tools/mcp-test/locked-code.ts [--build]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const EDIT = "public static int handEdited() { return 42; }";
const project = exampleProject();
const mcp = await connect(project);
const engines = listEngines().map((e) => e.id);
const classOf = (files: string[]) => files.find((f) => f.endsWith("/RubyItem.java"))!;
try {
  for (const tool of ["lock_element_code", "unlock_element_code", "list_locked_code", "regenerate_code"]) assert(mcp.tools.includes(tool), `tool ${tool}`);

  // ---- lock ----
  const locked = await mcp.call("lock_element_code", { type: "item", id: "ruby" });
  assert(locked.engines.length === 5, `locked on all 5 engines (${locked.engines.map((e: any) => `${e.engine} ${e.files.length}`).join(", ")})`);
  for (const { engine, files } of locked.engines) {
    assert(classOf(files), `${engine}: RubyItem.java is locked`);
    assert(!files.some((f: string) => /lang\/|ModItems|Items\.java|HellomcedgeMod\.java/.test(f)), `${engine}: no shared file is locked (${files.length} files)`);
  }
  const again = await mcp.call("lock_element_code", { type: "item", id: "ruby" }, true);
  assert(String(again).includes("already locked"), "locking twice is refused");

  // ---- a hand edit survives regeneration and element changes ----
  for (const { engine, files } of locked.engines) {
    const file = join(project, "locked-code", "item", "ruby", engine, classOf(files));
    const text = readFileSync(file, "utf8");
    const at = text.lastIndexOf("}");
    writeFileSync(file, `${text.slice(0, at)}    ${EDIT}\n${text.slice(at)}`);
  }
  await mcp.call("update_element", { type: "item", id: "ruby", values: { name: "Polished Ruby", stackSize: 16 } });
  await mcp.call("set_translations", { language: "en_us", entries: { "item.hellomcedge.ruby": "Polished Ruby" } });
  const regen = await mcp.call("regenerate_code");
  assert(regen.length === 5 && regen.every((r: any) => r.lockedFiles > 0), "regenerate_code writes every engine with its locked files");
  for (const { engine, files } of locked.engines) {
    const out = readFileSync(join(project, "out", engine, classOf(files)), "utf8");
    assert(out.includes(EDIT), `${engine}: the hand edit is in the generated project`);
    const lang = readFileSync(join(project, "out", engine, "src/main/resources/assets/hellomcedge/lang/en_us.json"), "utf8");
    assert(lang.includes("Polished Ruby"), `${engine}: shared files still follow the element (lang has the new name)`);
    const map = JSON.parse(readFileSync(join(project, "out", engine, "mcedge-sourcemap.json"), "utf8"));
    assert(map.files[classOf(files)]?.locked === true && map.files[classOf(files)].element === "item/ruby", `${engine}: the source map marks the file locked`);
  }
  const rename = await mcp.call("rename_element", { type: "item", id: "ruby", newId: "gem" }, true);
  assert(String(rename).includes("locked code"), "rename is refused while locked");

  // ---- unlock ----
  const list = await mcp.call("list_locked_code", { changes: true });
  assert(list.length === 1 && list[0].exists && list[0].changes.filter((c: any) => c.status === "edited").length === 5, "list_locked_code shows the 5 edited classes");
  const refused = await mcp.call("unlock_element_code", { type: "item", id: "ruby" }, true);
  const edited = refused.changes.find((c: any) => c.status === "edited");
  assert(!refused.unlocked && edited.diff.lost.some((l: any) => l.text.includes("handEdited")), `unlock without force keeps the lock and shows the edit it would lose (${JSON.stringify(edited.diff.lost)})`);
  assert(existsSync(join(project, "locked-code", "item", "ruby")), "still locked");
  const done = await mcp.call("unlock_element_code", { type: "item", id: "ruby", force: true });
  assert(done.unlocked && !existsSync(join(project, "locked-code")), "unlock with force removes the lock folder");
  await mcp.call("regenerate_code");
  for (const { engine, files } of locked.engines) {
    assert(!readFileSync(join(project, "out", engine, classOf(files)), "utf8").includes(EDIT), `${engine}: fresh code after unlock`);
  }
  // An element without edits unlocks at once.
  await mcp.call("lock_element_code", { type: "block", id: "ruby_block" });
  const clean = await mcp.call("unlock_element_code", { type: "block", id: "ruby_block" });
  assert(clean.unlocked && clean.changes.length === 0, "an unedited lock unlocks without force");

  if (process.argv.includes("--build")) {
    if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on");
    const relocked = await mcp.call("lock_element_code", { type: "item", id: "ruby" });
    for (const { engine, files } of relocked.engines) {
      const file = join(project, "locked-code", "item", "ruby", engine, classOf(files));
      const text = readFileSync(file, "utf8");
      writeFileSync(file, `${text.slice(0, text.lastIndexOf("}"))}    ${EDIT}\n}\n`);
    }
    for (const engine of engines) {
      const built = String(await mcp.call("build", { engine }, true));
      const summary = JSON.parse(built.slice(0, built.indexOf("\n\n")));
      assert(summary.ok, `${engine}: builds with the hand-edited locked class${summary.ok ? "" : `\n${built.slice(0, 2000)}`}`);
    }
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
