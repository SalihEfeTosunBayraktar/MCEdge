// KUYRUK 99: procedures read and write block slots and drain block energy on every engine.
// (1) 1.16.5 block entities answer the item handler for a null side (procedures ask without a side), as MCreator's
//     LockableTileEntity did; before, a null side got nothing and every machine saw empty slots.
// (2) block_energy_receive with a negative amount drains on every engine (MCreator behaviour) instead of throwing
//     (NeoForge 26.3 insert) or doing nothing (Fabric clamp), and goes past the per-call extract limit.
// usage: node tools/codegen-test/battery-energy-check.ts
import assert from "node:assert/strict";
import { legacyCapabilities } from "../../src/generator/blockInventory.ts";
import { HELPERS, helperCode } from "../../src/procedures/helpers.ts";

const caps = legacyCapabilities(true, false);
assert.ok(!/side != null && capability == net\.minecraftforge\.items\.CapabilityItemHandler/.test(caps), "1.16.5: a null side is not refused");
assert.ok(/side == null \? this\.unsidedHandler\.cast\(\)/.test(caps), "1.16.5: a null side gets the unsided handler");
assert.ok(/new net\.minecraftforge\.items\.wrapper\.InvWrapper\(this\)/.test(caps), "1.16.5: unsided handler wraps the whole inventory");
assert.ok(/this\.unsidedHandler\.invalidate\(\)/.test(caps), "1.16.5: unsided handler invalidated on removal");

const j = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, string>;
const slot = helperCode(HELPERS.blockSlotItem, "1.16.5", "forge")!(j);
assert.ok(/ITEM_HANDLER_CAPABILITY, null\)/.test(slot), "1.16.5: block_slot_item asks with a null side (what the block entity must answer)");

for (const [gen, loader, extract] of [["1.21.5", "neoforge", "extractEnergy(left, false)"], ["26.3", "neoforge", "extract(left, transaction)"], ["1.21.5", "fabric", "holder.extractEnergy(left)"], ["26.3", "fabric", "holder.extractEnergy(left)"]] as const) {
  const code = helperCode(HELPERS.receiveEnergy, gen, loader)!(j);
  assert.ok(/if \(amount < 0\)/.test(code), `${gen}/${loader}: negative amount handled`);
  assert.ok(code.includes(extract), `${gen}/${loader}: negative amount extracts`);
  assert.ok(/while \(left > 0\)/.test(code) && /if \(moved <= 0\) break;/.test(code), `${gen}/${loader}: repeats past the extract limit and stops when nothing moves`);
}
const insert = helperCode(HELPERS.receiveEnergy, "26.3", "neoforge")!(j);
assert.ok(/\} else \{\s*energy\.insert\(\(int\) amount, transaction\);/.test(insert), "26.3: insert only for amounts >= 0");
console.log("battery-energy-check OK");
