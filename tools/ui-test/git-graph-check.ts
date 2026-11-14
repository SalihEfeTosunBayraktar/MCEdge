/**
 * KUYRUK 197: lane layout of the History branch graph (app/renderer/src/git/graph.ts). No app is started.
 *   node tools/ui-test/git-graph-check.ts
 */
import { layoutGraph, parseRefs, type GraphLayout } from "../../app/renderer/src/git/graph.ts";

const problems: string[] = [];
const check = (ok: unknown, message: string) => void (ok || problems.push(message));
/** Commits newest first as "hash:parent,parent". */
const graph = (...commits: string[]) => layoutGraph(commits.map((c) => {
  const [hash, parents = ""] = c.split(":");
  return { hash, parents: parents ? parents.split(",") : [] };
}));
const count = (g: GraphLayout, kind: string) => g.rows.reduce((n, r) => n + [...r.top, ...r.bottom].filter((e) => e.kind === kind).length, 0);
/** Lines leaving a row at the bottom are the lines entering the next one at the top, lane for lane, colour for colour. */
const continuous = (name: string, g: GraphLayout) => {
  for (let i = 0; i + 1 < g.rows.length; i++) {
    const out = g.rows[i].bottom.map((e) => `${e.to}/${e.color}`).sort().filter((v, j, a) => a.indexOf(v) === j).join();
    const into = g.rows[i + 1].top.map((e) => `${e.from}/${e.color}`).sort().join();
    check(out === into, `${name}: row ${i} leaves ${out} but row ${i + 1} takes ${into}`);
  }
};
const lanes = (g: GraphLayout) => g.rows.map((r) => r.lane).join("");

// Linear history: one lane, straight lines only.
const linear = graph("c:b", "b:a", "a");
continuous("linear", linear);
check(linear.width === 1 && lanes(linear) === "000", `linear lanes ${lanes(linear)} width ${linear.width}`);
check(count(linear, "fork") === 0 && count(linear, "merge") === 0, "linear has no curves");
check(linear.rows[2].bottom.length === 0, "a root commit ends its lane");

// A feature branch merged back: m merges b (first parent) and f2; the branch forked off at a.
const merged = graph("m:b,f2", "f2:f1", "b:a", "f1:a", "a");
continuous("merge", merged);
check(merged.width === 2 && lanes(merged) === "01010", `merge lanes ${lanes(merged)} width ${merged.width}`);
check(count(merged, "merge") === 1 && merged.rows[0].bottom.some((e) => e.kind === "merge" && e.from === 0 && e.to === 1), "one merge curve from m to the branch lane");
check(count(merged, "fork") === 1 && merged.rows[4].top.some((e) => e.kind === "fork" && e.from === 1 && e.to === 0), "one fork curve into a");
check(merged.rows[0].color !== merged.rows[1].color, "the branch has its own colour");

// Two branches beside main, all from a: three lanes, two of them run into a.
const parallel = graph("y:a", "x:a", "m:a", "a");
continuous("parallel", parallel);
check(parallel.width === 3 && lanes(parallel) === "0120", `parallel lanes ${lanes(parallel)} width ${parallel.width}`);
check(count(parallel, "fork") === 2 && count(parallel, "merge") === 0, "parallel: two forks, no merge");
check(new Set(parallel.rows.slice(0, 3).map((r) => r.color)).size === 3, "parallel: three colours");

// Octopus merge of three branches.
const octopus = graph("o:a,b,c", "a:r", "b:r", "c:r", "r");
continuous("octopus", octopus);
check(octopus.width === 3 && count(octopus, "merge") === 2 && count(octopus, "fork") === 2, `octopus width ${octopus.width}, ${count(octopus, "merge")} merges, ${count(octopus, "fork")} forks`);

// Criss-cross: two merges of the same pair of commits.
const criss = graph("m1:a,b", "m2:b,a", "a:r", "b:r", "r");
continuous("criss-cross", criss);
check(criss.width === 3 && count(criss, "merge") === 2, `criss-cross width ${criss.width}, ${count(criss, "merge")} merges`);
check(lanes(criss) === "02010", `criss-cross lanes ${lanes(criss)}`);

// A lane freed by a finished branch is reused by the next tip.
const reuse = graph("p:a", "a", "q:z", "z");
check(lanes(reuse) === "0000" && reuse.width === 1, `reuse lanes ${lanes(reuse)}`);

// History cut by the limit: parents outside the list leave their lanes open at the bottom.
const cut = graph("m:b,f", "b:x");
continuous("cut", cut);
check(cut.rows[1].bottom.length === 2, "lanes waiting for unlisted parents run off the bottom");

// Decorations.
const refs = parseRefs(["tag: v1", "origin/main", "HEAD -> main", "feature/x"], ["origin"]);
check(refs.map((r) => `${r.kind}:${r.name}${r.current ? "*" : ""}`).join() === "head:HEAD,branch:main*,branch:feature/x,remote:origin/main,tag:v1", `refs ${JSON.stringify(refs)}`);
check(parseRefs(["HEAD"], []).map((r) => r.kind).join() === "head", "a detached HEAD");

if (problems.length) {
  console.error(`FAIL\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else console.log("PASS (linear, merge, parallel, octopus, criss-cross, lane reuse, cut history, refs)");
