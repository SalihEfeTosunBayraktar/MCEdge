/**
 * KUYRUK #112 (audit L1): a selected key that the Show filter or the search hides is no longer selected, so
 * "Delete selected" cannot remove a key the user cannot see. Runs on a copy of ETREconomy-MCEdge.
 * Screenshots go to design/localization/ (pass a suffix as the first argument, e.g. "before").
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, copyProject, REPO, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/localization");
const suffix = process.argv[2] ?? "after";
// The ETR project sits next to the MCEdge checkout (one level higher from a worktree).
const etr = [resolve(REPO, "..", "ETREconomy-MCEdge"), resolve(REPO, "..", "..", "ETREconomy-MCEdge")].find(existsSync)!;
const project = copyProject(etr, "etr");
const KEY = "AdminBookSalary";
const onDisk = () => KEY in JSON.parse(readFileSync(join(project, "localization", "en_us.json"), "utf8"));

const row = `[...document.querySelectorAll("[data-key]")].find((r) => r.dataset.key === ${JSON.stringify(KEY)})`;
const select = (app: App) => app.eval(`${row}.scrollIntoView({ block: "center" })`).then(() => app.click(`[data-key="${KEY}"] td:first-child`));
/** True when anything on screen still names the key: a row, the detail strip, an input. */
const visible = (app: App) => app.eval<boolean>(`(() => {
  const view = document.querySelector("section.view");
  return view.innerText.includes(${JSON.stringify(KEY)}) || [...view.querySelectorAll("input")].some((i) => i.value === ${JSON.stringify(KEY)});
})()`);
const deleteEnabled = (app: App) => app.eval<boolean>(`!![...document.querySelectorAll(".actions .abtn.danger")].find((b) => !b.disabled)`);
const showSelect = `document.querySelector(".findbar .fsel select")`;

await run(async (app) => {
  await app.click(".rtab", "Yerelleştirme");
  await app.waitFor(`${row}`, 20000);

  // 1. Show filter: select a complete key, then show only missing keys.
  await select(app);
  assert(await deleteEnabled(app), "Delete is enabled for a selected custom key");
  const missing = await app.eval<string>(`[...${showSelect}.options].find((o) => /missing/i.test(o.value)).value`);
  await app.setValue(".findbar .fsel select", missing);
  await app.sleep(300);
  await app.shot(`${OUT}/112-hidden-by-filter-${suffix}.png`);
  assert(!(await app.eval<boolean>(`!!${row}`)), "the filter hides the key");
  assert(!(await visible(app)), "nothing on screen still shows the hidden key");
  assert(!(await deleteEnabled(app)), "Delete is disabled once the selection is hidden");
  await app.eval(`document.querySelector(".actions .abtn.danger")?.click()`);
  await app.sleep(1500);
  assert(onDisk(), "the hidden key was not deleted");

  // 2. Search: the same for a search that no longer matches the key.
  await app.setValue(".findbar .fsel select", "all");
  await app.waitFor(`${row}`);
  await select(app);
  assert(await deleteEnabled(app), "Delete is enabled again");
  await app.setValue(".findbar .search input", "zzz_no_such_key");
  await app.sleep(300);
  assert(!(await visible(app)), "nothing on screen shows the key the search hides");
  assert(!(await deleteEnabled(app)), "Delete is disabled once the search hides the selection");
  await app.eval(`document.querySelector(".actions .abtn.danger")?.click()`);
  await app.sleep(1500);
  assert(onDisk(), "the key hidden by the search was not deleted");

  // 3. Clearing the search does not bring back a selection the user did not make again.
  await app.setValue(".findbar .search input", "");
  await app.waitFor(`${row}`);
  assert(!(await app.eval<boolean>(`${row}.classList.contains("sel")`)), "the dropped selection stays dropped");
  console.log("hidden selection dropped for filter and search; key kept on disk");
}, { project, language: "tr", theme: (process.argv[3] ?? "dark") as "dark" | "light" });
