/**
 * KUYRUK #9: the Version control screen on a copy of the example: init, diff, stage/unstage, commit, an MCP
 * edit showing up live, discard, history, revert, push and pull against a local bare remote. Since KUYRUK 197 stage,
 * unstage and discard are row buttons of the changes table and revert sits on the history bar.
 * Screenshots go to design/git-panel/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/git-panel");
const sh = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".gitmain tbody tr")].map((r) => r.textContent)`);
const diff = (app: App) => app.eval<string>(`document.querySelector(".gitdiff").textContent`);
/** Clicks a toolbar button once it is enabled (the previous git action has finished). */
const act = async (app: App, label: string) => {
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent.includes(${JSON.stringify(label)}) && !b.disabled)`);
  await app.click(".abtn", label);
};
/**
 * Clicks a row button of the changes table (Stage, Unstage, Discard changes) with a real mouse click, once it is
 * enabled; `underHeader` first scrolls the row to the top edge of the table, under the sticky header. The point
 * clicked must hit the button itself (KUYRUK 197: a row scrolled under the header once took the click).
 */
const rowAct = async (app: App, path: string, label: string, underHeader = false) => {
  const button = `.gitmain tr[data-key=${JSON.stringify(path)}] button[aria-label=${JSON.stringify(label)}]`;
  await app.waitFor(`document.querySelector(${JSON.stringify(button)}) && !document.querySelector(${JSON.stringify(button)}).disabled`);
  if (underHeader) {
    await app.eval(`(() => { const w = document.querySelector(".gitmain .tablewrap"), r = document.querySelector(${JSON.stringify(button)}).closest("tr");
      w.scrollTop += r.getBoundingClientRect().top - w.getBoundingClientRect().top; })()`);
    const covered = await app.eval<string>(`(() => { const b = document.querySelector(${JSON.stringify(button)}).getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.tagName; })()`);
    assert(covered === "TH", `${path} sits under the sticky header before the click (${covered})`);
  }
  const [x, y] = await app.center(button); // scrolls it into view the way app.click does
  const hit = await app.eval<string>(`(() => { const e = document.elementFromPoint(${x}, ${y}); return document.querySelector(${JSON.stringify(button)}).contains(e) ? "button" : e?.tagName ?? "nothing"; })()`);
  assert(hit === "button", `${label} on ${path}${underHeader ? " (under the header)" : ""}: the click lands on ${hit}`);
  await app.click(button);
};
const stagedText = (path: string) => `document.querySelector('.gitmain tr[data-key=${JSON.stringify(path)}]')?.children[2].textContent`;
const commitWith = async (app: App, message: string) => {
  await app.setField("Message", message, ".gitform");
  await act(app, "Commit");
  await app.waitFor(`!document.querySelector(".gitform textarea").value`);
};

await run(async (app) => {
  await app.click(".rtab", "Version control");
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent.includes("Initialize repository"))`);
  await app.click(".abtn", "Initialize repository");
  await app.waitFor(`document.querySelectorAll(".gitmain tbody tr").length > 3`);
  sh(project, "config", "user.email", "test@mcedge.dev");
  sh(project, "config", "user.name", "MCEdge test");

  await app.click(".gitmain tbody tr", "mcedge.json");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("hellomcedge")`);
  await rowAct(app, "mcedge.json", "Stage");
  await app.waitFor(`[...document.querySelectorAll(".gitmain tbody tr")].find((r) => r.textContent.includes("mcedge.json")).textContent.includes("yes")`);
  await rowAct(app, "mcedge.json", "Unstage");
  await app.waitFor(`[...document.querySelectorAll(".gitmain tbody tr")].find((r) => r.textContent.includes("mcedge.json")).textContent.includes("no")`);
  // Real clicks on the first row, the last row and a row scrolled under the sticky header: Stage, Unstage, Discard.
  for (const name of ["!first.txt", "#second.txt", "zzz-last.txt"]) writeFileSync(join(project, name), "scratch\n");
  await act(app, "Refresh");
  await app.waitFor(`document.querySelector('.gitmain tr[data-key="zzz-last.txt"]')`);
  const keys = await app.eval<string[]>(`[...document.querySelectorAll(".gitmain tbody tr")].map((r) => r.dataset.key)`);
  assert(keys[0] === "!first.txt" && keys.at(-1) === "zzz-last.txt", `rows sorted by path: ${keys[0]} .. ${keys.at(-1)}`);
  for (const [path, underHeader] of [["!first.txt", false], ["zzz-last.txt", false], ["#second.txt", true]] as const) {
    await rowAct(app, path, "Stage", underHeader);
    await app.waitFor(`${stagedText(path)} === "yes"`);
    await rowAct(app, path, "Unstage", underHeader);
    await app.waitFor(`${stagedText(path)} === "no"`);
    await rowAct(app, path, "Discard changes", underHeader);
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`!document.querySelector('.gitmain tr[data-key=${JSON.stringify(path)}]')`);
    assert(!existsSync(join(project, path)), `discard deleted ${path}`);
  }
  await commitWith(app, "Initial project");
  await app.waitFor(`document.querySelector(".gitmain .table-empty")`);
  assert((await rows(app)).length === 0, "commit all leaves a clean tree");

  // An agent changes an element over MCP: the change shows up without a refresh.
  const mcp = await connect(project);
  try {
    await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 16 } });
  } finally {
    await mcp.close();
  }
  await app.waitFor(`document.querySelectorAll(".gitmain tbody tr").length === 1`, 10000);
  await app.click(".gitmain tbody tr", "ruby.json");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("stackSize")`);
  await app.shot(`${OUT}/changes-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/changes-light.png`);
  await app.setTheme("dark");
  assert((await diff(app)).includes("+  \"stackSize\": 16"), "diff shows the agent's change");

  await rowAct(app, "elements/items/ruby.json", "Discard changes");
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".gitmain .table-empty")`);
  assert(!sh(project, "status", "--porcelain"), "discard restores the file");

  // Commit a change, then revert it from History.
  await app.click(".rtab", "Mod elements");
  await (async () => {
    const m = await connect(project);
    await m.call("update_element", { type: "item", id: "ruby", values: { stackSize: 32 } });
    await m.close();
  })();
  await app.click(".rtab", "Version control");
  await app.waitFor(`document.querySelectorAll(".gitmain tbody tr").length === 1`, 10000);
  await commitWith(app, "Smaller ruby stacks");
  await app.click(".ltab", "History");
  await app.click(".gitmain tbody tr", "Smaller ruby stacks");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("stackSize")`);
  await app.shot(`${OUT}/history-dark.png`);
  await app.waitFor(`[...document.querySelectorAll(".gitbar .mbtn")].some((b) => b.textContent.includes("Revert commit") && !b.disabled)`);
  await app.click(".gitbar .mbtn", "Revert commit");
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".gitmain tbody tr").textContent.includes("Revert")`);
  assert(sh(project, "show", "HEAD:elements/items/ruby.json").includes("\"stackSize\": 64"), "revert commit restores the value");

  // Push to a fresh bare remote, then pull a commit made elsewhere.
  const remote = join(mkdtempSync(join(tmpdir(), "mcedge-remote-")), "remote.git");
  spawnSync("git", ["init", "--bare", remote]);
  sh(project, "remote", "add", "origin", remote);
  await act(app, "Refresh"); // waits until the revert has finished (Refresh is disabled while git works)
  await app.waitFor(`![...document.querySelectorAll(".abtn")].find((b) => b.textContent.includes("Push")).disabled`);
  await app.click(".abtn", "Push");
  await app.waitFor(`document.querySelector(".gitout") && !document.querySelector(".gitout.bad")`, 20000);
  assert(sh(remote, "log", "--oneline").includes("Revert"), "push reached the remote");
  const other = join(mkdtempSync(join(tmpdir(), "mcedge-clone-")), "clone");
  spawnSync("git", ["clone", remote, other]);
  sh(other, "-c", "user.email=a@b.c", "-c", "user.name=Teammate", "commit", "--allow-empty", "-m", "From a teammate");
  sh(other, "push");
  await act(app, "Pull");
  await app.waitFor(`[...document.querySelectorAll(".gitmain tbody tr")].some((r) => r.textContent.includes("From a teammate"))`, 20000);
  await app.setTheme("light");
  await app.shot(`${OUT}/history-light.png`);
}, { project });
