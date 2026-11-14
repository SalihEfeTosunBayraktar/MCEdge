// KUYRUK #98: creative tab order. Checks the pure rules (src/elements/tabOrder.ts), then generates the test project on
// every engine (no Gradle) and reads gem_tab's contents: the order of spec.ts on all five, sections and spacers as empty
// slots on 1.16.5 only, an element that left the tab dropped, an unordered member last. KUYRUK 172: a section end
// starts a new row on 1.16.5 (gem_b after it), an end that closes no section is dropped.
// usage: node tools/codegen-test/make.ts && node tools/codegen-test/tab-order-check.ts
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveTabOrder, tabSlots, type TabEntry } from "../../src/elements/tabOrder.ts";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

// ---- rules ----
const members = [{ type: "item", id: "a" }, { type: "item", id: "b" }, { type: "armor", id: "c" }];
const order: TabEntry[] = [{ kind: "element", type: "item", id: "b" }, { kind: "section", title: "S" }, { kind: "element", type: "item", id: "gone" }, { kind: "element", type: "item", id: "b" }];
const resolved = resolveTabOrder(order, members);
check(JSON.stringify(resolved) === JSON.stringify([{ kind: "element", type: "item", id: "b" }, { kind: "section", title: "S" }, { kind: "element", type: "item", id: "a" }, { kind: "element", type: "armor", id: "c" }]),
  "resolve: order kept, a non-member and a repeat dropped, unordered members appended");
const stacks = (m: { id: string }) => (m.id === "c" ? ["c1", "c2"] : [m.id]);
const slots = (entries: TabEntry[]) => tabSlots(entries, stacks).map((s) => s ?? "_").join("");
check(slots([{ kind: "element", type: "item", id: "a" }, { kind: "section", title: "" }, { kind: "element", type: "item", id: "b" }]) === "a________b", "a section starts a new row");
check(slots([{ kind: "element", type: "item", id: "a" }, { kind: "spacer", slots: 2 }, { kind: "element", type: "armor", id: "c" }]) === "a__c1c2", "a spacer leaves its slots empty; an armor element has several stacks");
check(slots([{ kind: "spacer" }, { kind: "element", type: "item", id: "a" }, { kind: "spacer" }]) === "_________a", "a row spacer at a row start is a blank row; trailing empty slots are dropped");
check(slots([{ kind: "section", title: "" }, { kind: "element", type: "item", id: "a" }]) === "a", "a section at the start adds nothing");
check(slots([{ kind: "section", title: "" }, { kind: "element", type: "item", id: "a" }, { kind: "end" }, { kind: "element", type: "item", id: "b" }]) === "a________b", "a section end starts a new row");
const ends = resolveTabOrder([{ kind: "end" }, { kind: "element", type: "item", id: "a" }, { kind: "section", title: "S" }, { kind: "end" }, { kind: "end" }, { kind: "element", type: "item", id: "b" }], members);
check(ends.map((e) => (e.kind === "element" ? e.id : e.kind)).join(",") === "a,section,end,b,c", `resolve: ends that close no section dropped (${ends.map((e) => (e.kind === "element" ? e.id : e.kind)).join(",")})`);

// ---- generated tabs ----
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith("Mod.java") ? [join(dir, n)] : []));
const want = ["gem_c", "gem_a", "ruby_armor_helmet", "ruby_armor_chestplate", "ruby_armor_leggings", "ruby_armor_boots", "gem_b"];
for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${engine.id}: generate\n${gen.stderr}`); continue; }
  const source = walk(join(T, "project/out", engine.id, "src/main/java")).map((f) => readFileSync(f, "utf8")).join("\n");
  const start = source.indexOf("GEM_TAB =");
  const body = source.slice(start, source.indexOf(engine.id === "forge-1.16.5" ? "};" : ".build()", start));
  const lines = body.split("\n").filter((l) => /items\.add|output\.accept/.test(l));
  const ids = lines.map((l) => (l.includes("ItemStack.EMPTY") ? "_" : (l.match(/wavethree:(\w+)/)?.[1] ?? "?")));
  const expected = engine.id === "forge-1.16.5"
    ? ["gem_c", ..."_".repeat(8 + 2), "gem_a", ..."_".repeat(6), ...want.slice(2, 6), ..."_".repeat(5), "gem_b"]
    : want;
  check(JSON.stringify(ids) === JSON.stringify(expected), `${engine.id}: gem_tab ${ids.join(" ")}`);
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
