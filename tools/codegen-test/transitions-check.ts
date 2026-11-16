// Q228, Q229: the show / hide timing model and the animated-image frames the bubble and radial runtime get.
// Model (src/elements/transitions.ts): easing curves, transition states, the timeline, old `animation` values mapped to
// the new fields. Data: a bubble saved before Q228 loads as the new fields; the test project's bubbles.json and
// radial_menus.json carry timing and frame lists (playback modes of bubble and radial icons).
// usage: node tools/codegen-test/make.ts && node tools/codegen-test/transitions-check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ease, timelineAt, timelineLengths, timingJson, timingOf, transitionState, upgradeTimingFields } from "../../src/elements/transitions.ts";
import { withDefaults } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { loadElement } from "../../src/ir/storage.ts";

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

// Easing: every curve starts at 0 and ends at 1; back overshoots on the way.
for (const easing of ["linear", "ease_out", "ease_in_out", "back"] as const) {
  near(ease(easing, 0), 0, `${easing}(0)`);
  near(ease(easing, 1), 1, `${easing}(1)`);
}
assert.ok(ease("back", 0.6) > 1, "back overshoots");
assert.ok(ease("ease_out", 0.5) > 0.5, "ease out is ahead of linear");
near(ease("ease_in_out", 0.5), 0.5, "ease in-out middle");

// Transition states: appear fades in / grows / rises; the disappear is the same curve backwards, slides keep their direction.
const appear = { effects: ["fade", "scale", "slide_up"] as const, ticks: 10, easing: "linear" as const };
const a0 = transitionState({ ...appear, effects: [...appear.effects] }, 0, false);
assert.deepEqual([a0.alpha, a0.scale, a0.offset], [0, 0, -0.5], "appear starts hidden, below its place");
const a1 = transitionState({ ...appear, effects: [...appear.effects] }, 10, false);
assert.deepEqual([a1.alpha, a1.scale, a1.offset], [1, 1, 0], "appear ends in place");
const gone = transitionState({ ...appear, effects: [...appear.effects] }, 10, true);
assert.deepEqual([gone.alpha, gone.scale, gone.offset], [0, 0, 0.5], "slide up moves up and away when leaving");
const half = transitionState({ effects: ["slide_down"], ticks: 10, easing: "linear" }, 5, true);
near(half.offset, -0.25, "slide down moves down when leaving");
assert.deepEqual(transitionState({ effects: [], ticks: 10, easing: "back" }, 0, false), { alpha: 1, scale: 1, offset: 0 }, "no effects: instant");

// The timeline: appear, hold until the active time, disappear, gone.
const timing = timingOf({ appear: ["fade"], appearTicks: 4, appearEasing: "linear", disappear: ["scale"], disappearTicks: 6, disappearEasing: "linear", duration: 20 });
assert.deepEqual(timelineLengths(timing), { appear: 4, hold: 16, disappear: 6, total: 26 });
assert.equal(timelineAt(timing, 2).phase, "appear");
assert.equal(timelineAt(timing, 10).phase, "hold");
assert.equal(timelineAt(timing, 20).phase, "disappear");
near(timelineAt(timing, 23).state.scale, 0.5, "half way out");
assert.equal(timelineAt(timing, 26).phase, "gone");
assert.equal(timelineAt({ ...timing, active: 0 }, 1000).phase, "hold", "active 0: until cleared never leaves");

// Old fields: `animation` + `animationTicks` become the same look for showing and hiding.
const legacy = { animation: "fade", animationTicks: 10, duration: 60 };
const mapped = timingOf(legacy);
assert.deepEqual(timingJson(mapped), { appear: { effects: ["fade"], ticks: 10, easing: "linear" }, disappear: { effects: ["fade"], ticks: 10, easing: "linear" }, active: 60 });
assert.deepEqual(timingOf({ animation: "pop", animationTicks: 5 }).appear, { effects: ["scale"], ticks: 5, easing: "back" });
assert.deepEqual(timingOf({ animation: "none" }).appear.effects, []);
const upgraded = upgradeTimingFields({ id: "x", ...legacy }) as Record<string, unknown>;
assert.ok(!("animation" in upgraded) && !("animationTicks" in upgraded), "the old fields are gone");
assert.deepEqual([upgraded.appear, upgraded.appearTicks, upgraded.appearEasing, upgraded.disappear], [["fade"], 10, "linear", ["fade"]]);
assert.equal(upgradeTimingFields({ appear: ["scale"], animation: "fade" }).appear?.[0], "scale", "new fields win");

// A bubble file saved before Q228 loads with the new fields (what the editor shows), a radial menu too.
const project = mkdtempSync(join(tmpdir(), "mcedge-transitions-"));
try {
  writeFileSync(join(project, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "old", name: "Old", version: "1", package: "dev.old", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }));
  mkdirSync(join(project, "elements", "bubbles"), { recursive: true });
  writeFileSync(join(project, "elements", "bubbles", "old_fade.json"), JSON.stringify({ id: "old_fade", caption: "Hi", animation: "fade", animationTicks: 8, duration: 40 }));
  mkdirSync(join(project, "elements", "radial_menus"), { recursive: true });
  writeFileSync(join(project, "elements", "radial_menus", "old_wheel.json"), JSON.stringify({ id: "old_wheel", animation: "none", animationTicks: 4 }));
  const bubble = loadElement(project, "bubble", "old_fade")!;
  assert.deepEqual([bubble.appear, bubble.appearTicks, bubble.appearEasing, bubble.disappear, bubble.duration], [["fade"], 8, "linear", ["fade"], 40]);
  assert.ok(!("animation" in bubble), "no old field is kept");
  const wheel = loadElement(project, "radial_menu", "old_wheel")!;
  assert.deepEqual(wheel.appear, [], "a wheel with the old animation none opens at once");
  const type = typeRegistry().byId.get("bubble")!;
  assert.deepEqual(withDefaults(type, { id: "fresh" }).appear, ["scale"], "a new bubble pops by default");
} finally {
  rmSync(project, { recursive: true, force: true });
}

// The test project's generated data (run make.ts first, then a generation): timing, frame lists and playback modes.
const out = join(import.meta.dirname, "project", "out", "neoforge-1.21.5", "src", "main", "resources", "assets", "wavethree");
let data: { styles: Record<string, Record<string, unknown>>; icons: Record<string, Record<string, unknown>> } | undefined;
try {
  data = JSON.parse(readFileSync(join(out, "bubbles.json"), "utf8"));
} catch {
  console.log("note: no generated neoforge-1.21.5 output; run the generator (regenerate_code) to check the data files too");
}
if (data) {
  const trade = data.styles.trade_offer, timed = data.styles.timed_note, note = data.styles.plain_note;
  assert.deepEqual(trade.timing, { appear: { effects: ["fade", "scale"], ticks: 6, easing: "back" }, disappear: { effects: ["fade", "slide_up"], ticks: 8, easing: "ease_out" }, active: 0 }, "trade_offer timing");
  assert.equal((note.timing as { active: number }).active, 60, "plain_note active time");
  // Playback (Q229): the ping-pong background plays its frames back, the hold-last icon stays on its last one.
  assert.deepEqual(timed.backgroundSeq, [[0, 10], [1, 10], [2, 10], [3, 10], [2, 10], [1, 10]], "ping-pong background frame list");
  assert.equal(timed.backgroundHold, -1);
  assert.equal(timed.iconHold, 3, "hold_last icon holds frame 3");
  assert.equal((timed.iconSeq as number[][]).length, 4);
  assert.equal(trade.iconFrames, 4, "wave icon keeps its frame count");
  const radial = JSON.parse(readFileSync(join(out, "radial_menus.json"), "utf8")) as { menus: Record<string, { timing: unknown; tabs: { slices: { id: string; iconSeq?: unknown; iconHold?: number }[] }[] }> };
  assert.deepEqual(radial.menus.wheel.timing, { appear: { effects: ["fade", "slide_up"], ticks: 6, easing: "ease_out" }, disappear: { effects: [], ticks: 4, easing: "linear" }, active: 0 }, "wheel opening timing");
  const run = radial.menus.wheel.tabs[0].slices.find((s) => s.id === "run")!;
  assert.deepEqual(run.iconSeq, [[0, 10], [1, 10], [2, 10], [3, 10], [2, 10], [1, 10]], "radial slice icon plays ping-pong");
}
console.log("PASS transitions-check");
