/**
 * KUYRUK 197: the Version control layout and the History branch graph. A copy of examples/hello gets main, a
 * feature/ore branch merged back with --no-ff (tag v1.0 on the merge) and an unmerged experiment branch, plus one
 * uncommitted file. Checks that every action sits by what it acts on (commit buttons in the commit form, stage /
 * unstage / discard on the changes table, New branch with the Branch field, only pull / push / refresh on the
 * toolbar) and that History draws three lanes, one merge curve, two fork curves, the branch and tag labels and HEAD.
 * Then commits from the form and checks HEAD moved. Screenshots go to design/197/ (LIGHT=1 light theme, TR=1 Turkish).
 *   node tools/ui-test/git-graph.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, exampleProject, run } from "./cdp.ts";

const OUT = "design/197";
const theme = process.env.LIGHT ? "light" : "dark";
const language = process.env.TR ? "tr" : "en";
const s = (language === "tr" ? tr : en) as Record<string, string>;
const suffix = `${language === "tr" ? "tr-" : ""}${theme}`;

const project = exampleProject();
let clock = 0;
/** Git in the project with a fixed, rising date per commit, so the history order is known. */
const sh = (...args: string[]) => {
  const date = `2026-01-0${1 + Math.floor(clock / 10)}T1${clock % 10}:00:00Z`;
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (message: string, file: string) => {
  clock++;
  writeFileSync(join(project, file), `${message}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", message);
};
sh("init", "-q", "-b", "main");
sh("config", "user.email", "test@mcedge.dev");
sh("config", "user.name", "MCEdge test");
clock++;
sh("add", "-A");
sh("commit", "-q", "-m", "Initial project");
sh("switch", "-q", "-c", "feature/ore");
commit("Ore block", "ore.txt");
sh("switch", "-q", "main");
commit("Smaller stacks", "stacks.txt");
sh("switch", "-q", "feature/ore");
commit("Ore texture", "ore-texture.txt");
sh("switch", "-q", "main");
clock++;
sh("merge", "-q", "--no-ff", "-m", "Merge feature/ore", "feature/ore");
sh("tag", "v1.0");
sh("switch", "-q", "-c", "experiment", "main~1");
commit("Try a new tool", "tool.txt");
sh("switch", "-q", "main");
writeFileSync(join(project, "notes.txt"), "uncommitted\n");

const count = (selector: string) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const texts = (selector: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent.trim())`;
/** Data of the graph row of the commit with this subject. */
const graphRow = (subject: string) => `[...document.querySelectorAll(".githistory tbody tr")].find((r) => r.textContent.includes(${JSON.stringify(subject)}))`;

await run(async (app) => {
  if (theme === "light") await app.setTheme("light");
  await app.click(".rtab", s["section.git"]);
  await app.waitFor(`document.querySelector('.gitchanges tr[data-key="notes.txt"]')`); // the app may also refresh schemas/ on open

  // Layout: view-wide actions only on the toolbar; the rest by what they act on.
  const toolbar = await app.eval<string[]>(texts(".gitview > .actions .abtn"));
  assert(toolbar.join() === [s["git.pull"], s["git.push"], s["git.refresh"]].join(), `toolbar keeps pull, push, refresh: ${toolbar}`);
  const form = await app.eval<string[]>(texts(".gitform .gitformact .abtn"));
  assert(form.join() === [s["git.commit"], s["git.commitPush"]].join(), `commit buttons under the message: ${form}`);
  assert(await app.eval<boolean>(`!!document.querySelector(".gitform .gitbranchrow select") && !!document.querySelector(".gitform .gitbranchrow .abtn")`), "New branch sits with the Branch field");
  const rowButtons = await app.eval<string[]>(`[...document.querySelectorAll('.gitchanges tr[data-key="notes.txt"] button')].map((b) => b.getAttribute("aria-label"))`);
  assert(rowButtons.join() === [s["git.stage"], s["git.discard"]].join(), `row buttons of an unstaged file: ${rowButtons}`);
  const bar = await app.eval<string[]>(texts(".gitchanges .gitbar .mbtn"));
  assert(bar.join() === [s["git.stageAll"], s["git.unstageAll"], s["git.discardAll"]].join(), `changes bar: ${bar}`);

  // Stage from the row, unstage from the bar.
  await app.click(`.gitchanges tr[data-key="notes.txt"] button[aria-label=${JSON.stringify(s["git.stage"])}]`);
  await app.waitFor(`${count(`.gitchanges tr[data-key="notes.txt"] button[aria-label=${JSON.stringify(s["git.unstage"])}]`)} === 1`);
  await app.waitFor(`[...document.querySelectorAll(".gitchanges .gitbar .mbtn")].some((b) => b.textContent === ${JSON.stringify(s["git.unstageAll"])} && !b.disabled)`);
  await app.click(".gitchanges .gitbar .mbtn", s["git.unstageAll"]);
  await app.waitFor(`${count(`.gitchanges tr[data-key="notes.txt"] button[aria-label=${JSON.stringify(s["git.stage"])}]`)} === 1`);
  await app.click(".gitchanges tbody tr", "notes.txt");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("uncommitted")`);
  await app.setField(s["git.message"], "Write notes", ".gitform");
  await app.shot(`${OUT}/changes-${suffix}.png`);

  // History: the branch graph of every branch.
  await app.click(".ltab", s["git.history"]);
  await app.waitFor(`${count(".githistory .ggraph")} === 6`);
  const lanes = await app.eval<number[]>(`[...document.querySelectorAll(".githistory .ggraph")].map((g) => Number(g.dataset.lane))`);
  assert(new Set(lanes).size === 3, `three lanes: ${lanes}`);
  assert((await app.eval<number>(count(".githistory .ggraph path.gmerge"))) === 1, "one merge curve");
  assert((await app.eval<number>(count(".githistory .ggraph path.gfork"))) === 2, "two fork curves (feature/ore and experiment start at their base)");
  assert((await app.eval<number>(count(".githistory .ggraph[data-head]"))) === 1, "one HEAD dot");
  assert(await app.eval<boolean>(`!!${graphRow("Merge feature/ore")}.querySelector(".ggraph[data-head] .gheadring")`), "HEAD ring on the merge");
  const mergeRefs = await app.eval<string[]>(`[...${graphRow("Merge feature/ore")}.querySelectorAll(".gref")].map((r) => r.className + "=" + r.textContent)`);
  assert(mergeRefs.join() === "gref head=HEAD,gref branch current=main,gref tag=v1.0", `merge labels: ${mergeRefs}`);
  assert(await app.eval<boolean>(`${graphRow("Try a new tool")}.querySelector(".gref.branch:not(.current)").textContent === "experiment"`), "experiment label");
  assert(await app.eval<boolean>(`${graphRow("Ore texture")}.querySelector(".gref.branch").textContent === "feature/ore"`), "feature/ore label");
  const colours = await app.eval<string[]>(`[...document.querySelectorAll(".githistory .ggraph .gdot")].map((d) => getComputedStyle(d).fill)`);
  assert(new Set(colours).size === 3, `a colour per lane: ${colours}`);
  // The lines of one row meet the next row's: each svg is as tall as its row.
  const fit = await app.eval<number[]>(`[...document.querySelectorAll(".githistory tbody tr")].map((r) => Math.round(r.getBoundingClientRect().height - r.querySelector(".ggraph").getBoundingClientRect().height))`);
  assert(fit.every((d) => d === 0), `graph rows fit the table rows: ${fit}`);

  // Selecting a commit shows it, as before.
  await app.click(".githistory tbody tr", "Ore texture");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("ore-texture.txt")`);
  await app.shot(`${OUT}/graph-${suffix}.png`);

  // Commit from the form: HEAD moves to the new commit on main.
  await app.click(".gitform .gitformact .abtn", s["git.commit"]);
  await app.waitFor(`${count(".githistory .ggraph")} === 7`);
  assert(await app.eval<boolean>(`!!${graphRow("Write notes")}.querySelector(".ggraph[data-head]")`), "HEAD on the new commit");
  assert(sh("log", "-1", "--format=%s") === "Write notes" && !sh("status", "--porcelain"), "the form committed everything");
}, { project, language });
