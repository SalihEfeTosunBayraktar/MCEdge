// ETR #73: on 1.16.5 an item has one ItemGroup, and an item without one is never listed for the search tab, so JEI
// (7.x builds its ingredient list from it) and creative search did not show it. ETR's items are only in mod tabs and
// got no group. An item now gets its first vanilla tab, else its first mod tab (the mod class's ItemGroup field).
// Generates the test project (no Gradle). Run tools/codegen-test/make.ts first when spec.ts changed.
// usage: node tools/codegen-test/item-tab-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", "forge-1.16.5", "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
assert.equal(gen.status, 0, `generate failed\n${gen.stdout}${gen.stderr}`);
const mod = readFileSync(join(T, "project/out/forge-1.16.5/src/main/java/dev/mcedge/wavethree/WavethreeMod.java"), "utf8");
const props = (cls: string) => new RegExp(`new dev\\.mcedge\\.wavethree\\.item\\.${cls}\\(new Item\\.Properties\\(\\)([^;]*)\\)\\);`).exec(mod)?.[1];
assert.equal(props("GemAItem"), ".tab(dev.mcedge.wavethree.WavethreeMod.GEM_TAB)", "only in a mod tab: that tab is its group");
assert.equal(props("GemCItem"), ".tab(net.minecraft.item.ItemGroup.TAB_MATERIALS)", "in a vanilla and a mod tab: the vanilla tab");
assert.ok(/public static final ItemGroup GEM_TAB = new ItemGroup\(/.test(mod), "the mod tab is a field of the mod class");
console.log("item-tab-check OK");
