// KUYRUK 104: NeoForge outputs register the item capability for every generated block entity, so other mods' pipes
// reach it: a side gets the block's face rules (SidedInvWrapper / WorldlyContainerWrapper), no side the whole
// inventory (InvWrapper / VanillaContainerWrapper), as 1.16.5 answers in getCapability (KUYRUK 99).
// Generates the test project (no Gradle) on both NeoForge engines. Run tools/codegen-test/make.ts first when spec.ts changed.
// usage: node tools/codegen-test/item-capability-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
const expected = {
  "neoforge-1.21.5": ["Capabilities.ItemHandler.BLOCK", "new net.neoforged.neoforge.items.wrapper.InvWrapper(entity)", "new net.neoforged.neoforge.items.wrapper.SidedInvWrapper(entity, side)"],
  "neoforge-26.3": ["Capabilities.Item.BLOCK", "net.neoforged.neoforge.transfer.item.VanillaContainerWrapper.of(entity)", "new net.neoforged.neoforge.transfer.item.WorldlyContainerWrapper(entity, side)"],
};
for (const [engine, [cap, unsided, sided]] of Object.entries(expected)) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(gen.status, 0, `${engine}: generate failed\n${gen.stdout}${gen.stderr}`);
  const out = join(T, "project/out", engine, "src/main/java/dev/mcedge/wavethree");
  // Every generated block entity is a WorldlyContainer, so every one is registered.
  const withInventory = [...readFileSync(join(out, "init/WavethreeModBlockEntities.java"), "utf8").matchAll(/ ([A-Z0-9_]+) = REGISTRY\.register\(/g)].map((m) => m[1]);
  assert.ok(withInventory.length > 1, `${engine}: the test project has block entities`);
  const mod = readFileSync(join(out, "WavethreeMod.java"), "utf8");
  const lines = mod.split("\n").filter((l) => l.includes(cap));
  assert.equal(lines.length, withInventory.length, `${engine}: one item registration per block entity (${withInventory.join(", ")})`);
  for (const id of withInventory) {
    const line = lines.find((l) => l.includes(`.${id}.get()`));
    assert.ok(line, `${engine}: ${id} registered`);
    assert.ok(line.includes(`side == null ? ${unsided} : ${sided}`), `${engine}: ${id} sided by face, whole inventory without a side`);
  }
}
console.log("item-capability-check OK");
