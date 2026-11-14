/**
 * KUYRUK #142: in Resources, a selected texture or file that the folder filter or the search hides is no longer
 * selected, so Edit, Delete and the details panel cannot reach an item the user cannot see (same rule as #112).
 * Runs on a copy of ETREconomy-MCEdge. Screenshots go to design/142/ (args: suffix, theme).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, copyProject, REPO, run, type App } from "./cdp.ts";

const OUT = "design/142";
const suffix = process.argv[2] ?? "after";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const etr = [resolve(REPO, "..", "ETREconomy-MCEdge"), resolve(REPO, "..", "..", "ETREconomy-MCEdge")].find(existsSync)!;
const project = copyProject(etr, "etr");

const enabled = (app: App, label: string) =>
  app.eval<boolean>(`!![...document.querySelectorAll(".actions .abtn")].find((b) => b.textContent.includes(${JSON.stringify(label)}) && !b.disabled)`);
// The "before" run records every failed check and fails at the end, so both screenshots are taken.
const failed: string[] = [];
const check = (ok: unknown, message: string) => (suffix === "before" ? ok || failed.push(message) : assert(ok, message));
const panelEmpty = (app: App) => app.eval<boolean>(`!!document.querySelector("aside.panel .panel-empty")`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.click(".rtab", "Resources");
  await app.waitFor(`document.querySelector(".texcell")`, 20000);

  // 1. Textures: select one in the first folder, then filter to another folder.
  const folders = await app.eval<string[]>(`[...document.querySelector(".findbar .fsel select").options].map((o) => o.value)`);
  check(folders.length > 2, "texture folders are listed");
  await app.setValue(".findbar .fsel select", folders[1]);
  await app.waitFor(`document.querySelector(".texcell")`);
  const texture = await app.eval<string>(`document.querySelector(".texcell:not(.draft)").title`);
  await app.click(".texcell:not(.draft)");
  check(await enabled(app, "Edit texture"), "Edit is enabled for the selected texture");
  check(!(await panelEmpty(app)), "the panel shows the selected texture");
  await app.setValue(".findbar .fsel select", folders[2]);
  await app.sleep(300);
  await app.shot(`${OUT}/142-texture-hidden-${theme}-${suffix}.png`);
  check(!(await app.eval<boolean>(`!![...document.querySelectorAll(".texcell")].find((c) => c.title === ${JSON.stringify(texture)})`)), "the filter hides the texture");
  check(!(await enabled(app, "Edit texture")), "Edit is disabled once the filter hides the selection");
  check(await panelEmpty(app), "the panel no longer shows the hidden texture");
  // Clearing the filter does not bring the selection back.
  await app.setValue(".findbar .fsel select", "all");
  await app.sleep(200);
  check(!(await app.eval<boolean>(`!!document.querySelector(".texcell.sel")`)), "the dropped texture selection stays dropped");

  // Search hides a selected texture too.
  await app.click(".texcell:not(.draft)");
  check(await enabled(app, "Edit texture"), "Edit is enabled again");
  await app.setValue(".findbar .search input", "zzz_no_such_texture");
  await app.sleep(300);
  check(!(await enabled(app, "Edit texture")), "Edit is disabled once the search hides the selection");
  check(await panelEmpty(app), "the panel is empty once the search hides the texture");
  await app.setValue(".findbar .search input", "");

  // 2. Models (FilesPane): select a model, then search so it is hidden, and press Delete selected.
  await app.click('[role="tab"]', "Models");
  await app.waitFor(`document.querySelector("[data-key]")`);
  const model = await app.eval<string>(`document.querySelector("[data-key]").dataset.key`);
  await app.click(`[data-key="${model}"] td:first-child`);
  check(await enabled(app, "Delete selected"), "Delete is enabled for the selected model");
  await app.setValue(".findbar .search input", "zzz_no_such_model");
  await app.sleep(300);
  await app.shot(`${OUT}/142-model-hidden-${theme}-${suffix}.png`);
  check(!(await app.eval<boolean>(`!!document.querySelector("[data-key]")`)), "the search hides the model");
  check(!(await enabled(app, "Delete selected")), "Delete is disabled once the search hides the selection");
  check(await panelEmpty(app), "the panel no longer shows the hidden model");
  await app.eval(`[...document.querySelectorAll(".actions .abtn.danger")].forEach((b) => b.click())`);
  await app.sleep(1000);
  check(existsSync(join(project, model)), "the hidden model was not deleted");
  await app.setValue(".findbar .search input", "");
  await app.waitFor(`document.querySelector("[data-key]")`);
  check(!(await app.eval<boolean>(`!!document.querySelector("[data-key].sel")`)), "the dropped model selection stays dropped");
  assert(failed.length === 0, `failed checks: ${failed.join("; ")}`);
  console.log(`hidden selection dropped for ${texture} and ${model}`);
}, { project });
