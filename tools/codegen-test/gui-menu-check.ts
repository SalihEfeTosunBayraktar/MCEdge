// KUYRUK 43: a GUI tick procedure that writes a slot must not recurse (onTick runs in broadcastChanges, setGuiSlotItem
// calls broadcastChanges again): the menu guards the tick with a flag that is reset in finally.
// KUYRUK 44: an unbound menu empties its keepOnClose slots before clearContainer, so display items are not given back.
// KUYRUK 191: shift click must not top up a slot whose mayPlace is false: the menu's moveItemStackTo checks mayPlace in
// the merge loop too.
// Generates the test project (no Gradle) on every engine and reads RubyGuiMenu.java (ruby_gui: onTick gui_tick_write,
// slot 4 keepOnClose). Run tools/codegen-test/make.ts first when spec.ts changed.
// usage: node tools/codegen-test/gui-menu-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
for (const engine of ["forge-1.16.5", "neoforge-1.21.5", "neoforge-26.3", "fabric-1.21.5", "fabric-26.3"]) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(gen.status, 0, `${engine}: generate failed\n${gen.stdout}${gen.stderr}`);
  const out = join(T, "project/out", engine, "src/main/java/dev/mcedge/wavethree");
  const menu = readFileSync(join(out, "world/inventory/RubyGuiMenu.java"), "utf8");
  const tick = menu.slice(menu.indexOf("public void broadcastChanges()"));
  assert.ok(menu.includes("private boolean ticking;"), `${engine}: tick guard field`);
  assert.ok(/super\.broadcastChanges\(\);\s*if \(this\.world\.isClientSide\(\) \|\| this\.ticking\) return;\s*this\.ticking = true;\s*try \{\s*\S*GuiTickWrite\S*\(/.test(tick), `${engine}: tick runs once, behind the guard`);
  assert.ok(/\} finally \{\s*this\.ticking = false;\s*\}/.test(tick), `${engine}: guard reset in finally`);
  const program = readFileSync(join(out, "procedures/GuiTickWriteProcedure.java"), "utf8");
  assert.ok(program.includes("setGuiSlotItem("), `${engine}: the tick procedure writes a GUI slot (the recursion case)`);
  const removed = menu.slice(menu.indexOf("public void removed("));
  const keep = removed.indexOf("this.container.removeItemNoUpdate(4);");
  assert.ok(keep > 0 && keep < removed.indexOf("this.clearContainer("), `${engine}: kept slot 4 emptied before clearContainer`);
  assert.ok(!/removeItemNoUpdate\((0|1|2|3)\)/.test(removed), `${engine}: other slots still given back`);
  const move = menu.slice(menu.indexOf("protected boolean moveItemStackTo("), menu.indexOf("public boolean clickMenuButton("));
  const [merge, fill] = move.split("if (!stack.isEmpty()) {");
  assert.ok(merge && fill && /continue;/.test(merge) && merge.includes("!slot.mayPlace(stack)"), `${engine}: merge loop checks mayPlace`);
  assert.ok(fill.includes("!slot.mayPlace(stack)"), `${engine}: empty-slot loop checks mayPlace`);
}
console.log("gui-menu-check OK");
