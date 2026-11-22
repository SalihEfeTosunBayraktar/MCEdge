/**
 * KUYRUK #92: branches in Version control. The panel shows the current branch, New branch creates one and
 * switches to it, the Branch field switches back, and the commit box can commit on a new branch.
 * Screenshots go to design/git-panel/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/git-panel");
const sh = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
sh("init", "-q", "-b", "main");
sh("config", "user.email", "test@mcedge.dev");
sh("config", "user.name", "MCEdge test");
sh("add", "-A");
sh("commit", "-q", "-m", "Initial project");

const current = (app: App) => app.eval<string>(`document.querySelector(".gitform select[aria-label='Branch']").value`);
const options = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".gitform select[aria-label='Branch'] option")].map((o) => o.value)`);
const act = async (app: App, label: string) => {
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent.includes(${JSON.stringify(label)}) && !b.disabled)`);
  await app.click(".abtn", label);
};

await run(async (app) => {
  await app.click(".rtab", "Version control");
  await app.waitFor(`document.querySelector(".gitform select[aria-label='Branch']")?.dataset.branches === "1"`);
  assert((await current(app)) === "main", "current branch shown");
  assert((await app.eval<string>(`document.querySelector(".findbar .fmeta").textContent`)).includes("main"), "find bar names the branch");

  // New branch beside the Branch field (KUYRUK 197): created from the current commit and switched to.
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".gitform .gitbranchrow .abtn")].some((b) => b.textContent.includes("New branch"))`), "New branch sits with the Branch field");
  await act(app, "New branch");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.setField("Branch name", "main", ".dialog");
  assert(await app.eval<boolean>(`document.querySelector(".dialog .abtn.primary").disabled`), "an existing name cannot be created");
  await app.setField("Branch name", "bad name", ".dialog");
  assert(await app.eval<boolean>(`document.querySelector(".dialog .abtn.primary").disabled`), "an invalid name cannot be created");
  await app.setField("Branch name", "feature/ore", ".dialog");
  await app.shot(`${OUT}/new-branch-dark.png`);
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".gitform select[aria-label='Branch']").value === "feature/ore"`);
  assert(sh("branch", "--show-current") === "feature/ore", "git is on the new branch");
  assert((await options(app)).sort().join() === "feature/ore,main", `branch list: ${await options(app)}`);

  // Commit box: commit a change on another new branch.
  writeFileSync(join(project, "notes.txt"), "side work\n"); // a change to commit
  await app.click(".abtn", "Refresh");
  await app.waitFor(`document.querySelectorAll(".gitmain tbody tr").length > 0`);
  await app.setField("Message", "Work on a side branch", ".gitform");
  await app.click(".gitform label.check", "A new branch");
  await app.waitFor(`[...document.querySelectorAll(".gitform .frow label")].some((l) => l.textContent.trim() === "Branch name")`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".abtn")].find((b) => b.textContent.includes("Commit")).disabled`), "commit waits for a branch name");
  await app.setField("Branch name", "feature/side", ".gitform");
  await app.shot(`${OUT}/commit-new-branch-dark.png`);
  await act(app, "Commit");
  await app.waitFor(`document.querySelector(".gitform select[aria-label='Branch']").value === "feature/side"`);
  assert(sh("log", "-1", "--format=%s") === "Work on a side branch", "commit landed on the new branch");
  assert(sh("log", "-1", "--format=%s", "main") === "Initial project", "main is untouched");

  // Switch back with the Branch field.
  await app.setField("Branch", "main", ".gitform");
  await app.waitFor(`document.querySelector(".gitform select[aria-label='Branch']").value === "main"`);
  assert(sh("branch", "--show-current") === "main", "switched back to main");
  assert(!existsSync(join(project, "notes.txt")), "switching rewrote the files");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".gitout.bad")`)), "no git error");
  await app.setTheme("light");
  await app.shot(`${OUT}/branches-light.png`);
}, { project });
