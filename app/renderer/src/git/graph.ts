/**
 * Lane layout of the History branch graph (KUYRUK 197). Pure, so it is unit tested without the app
 * (tools/ui-test/git-graph-check.ts).
 *
 * Commits come newest first with children before their parents (git log --date-order). Each row draws its commit dot
 * in one lane and the lines through the row in two halves: `top` runs from the row's top edge to its middle, `bottom`
 * from the middle to the bottom edge, each from lane `from` to lane `to`. A lane keeps its place until the commit it
 * waits for arrives, so a branch that forked off joins its base at the fork commit itself.
 */
export interface GraphEdge {
  from: number;
  to: number;
  /** Colour index of the lane the line belongs to. */
  color: number;
  /** line: straight down a lane; fork: a branch running into the commit it started from; merge: a merge commit to a parent other than its first. */
  kind: "line" | "fork" | "merge";
}

export interface GraphRow {
  /** Lane of the commit dot. */
  lane: number;
  color: number;
  top: GraphEdge[];
  bottom: GraphEdge[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Lanes the widest row needs. */
  width: number;
}

export function layoutGraph(commits: readonly { hash: string; parents: readonly string[] }[]): GraphLayout {
  /** The commit each lane waits for; undefined for a free lane. */
  const lanes: (string | undefined)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let width = 0;
  const free = () => {
    const i = lanes.indexOf(undefined);
    return i < 0 ? lanes.length : i;
  };
  const rows = commits.map(({ hash, parents }): GraphRow => {
    let lane = lanes.indexOf(hash);
    const top: GraphEdge[] = [];
    lanes.forEach((waiting, i) => {
      if (waiting === undefined) return;
      const to = waiting === hash ? lane : i;
      top.push({ from: i, to, color: colors[i], kind: to === i ? "line" : "fork" });
    });
    if (lane < 0) {
      // A branch tip nobody waits for: a new lane with a new colour.
      lane = free();
      colors[lane] = nextColor++;
    }
    const color = colors[lane];
    const bottom: GraphEdge[] = [];
    lanes.forEach((waiting, i) => {
      if (waiting === hash) lanes[i] = undefined;
      else if (waiting !== undefined) bottom.push({ from: i, to: i, color: colors[i], kind: "line" });
    });
    if (parents.length) {
      lanes[lane] = parents[0];
      bottom.push({ from: lane, to: lane, color, kind: "line" });
    }
    for (const parent of parents.slice(1)) {
      let target = lanes.indexOf(parent);
      if (target < 0) {
        target = free();
        lanes[target] = parent;
        colors[target] = nextColor++;
      }
      bottom.push({ from: lane, to: target, color: colors[target], kind: "merge" });
    }
    width = Math.max(width, lane + 1, ...top.map((e) => Math.max(e.from, e.to) + 1), ...bottom.map((e) => Math.max(e.from, e.to) + 1));
    while (lanes.length && lanes[lanes.length - 1] === undefined) (lanes.pop(), colors.pop());
    return { lane, color, top, bottom };
  });
  return { rows, width };
}

export interface GraphRef {
  name: string;
  kind: "head" | "branch" | "remote" | "tag";
  /** The checked-out branch (HEAD points at it). */
  current?: boolean;
}

/** Git's decorations ("HEAD -> main", "origin/main", "tag: v1") as labels; HEAD first, then branches, remotes, tags. */
export function parseRefs(refs: readonly string[], remotes: readonly string[]): GraphRef[] {
  const out: GraphRef[] = [];
  for (const ref of refs) {
    if (ref === "HEAD") out.push({ name: "HEAD", kind: "head" });
    else if (ref.startsWith("HEAD -> ")) out.push({ name: "HEAD", kind: "head" }, { name: ref.slice(8), kind: "branch", current: true });
    else if (ref.startsWith("tag: ")) out.push({ name: ref.slice(5), kind: "tag" });
    else out.push({ name: ref, kind: remotes.some((r) => ref.startsWith(`${r}/`)) ? "remote" : "branch" });
  }
  const order = { head: 0, branch: 1, remote: 2, tag: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
