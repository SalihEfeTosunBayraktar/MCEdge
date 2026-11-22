/**
 * Q235: the divider between the Git view's table and its diff. A real mouse drag moves it, both parts keep their
 * minimum height, the arrow keys move it while it has the focus, the size survives a restart of the app and a double
 * click restores the default split. Args: theme. Screenshots go to design/235/.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App, evidence } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const project = exampleProject();
const height = (app: App, selector: string) => app.eval<number>(`Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().height)`);
const table = (app: App) => height(app, ".gitmain > :first-child");
const near = (a: number, b: number) => Math.abs(a - b) <= 2;
const openGit = async (app: App) => {
  await app.click(".rtab", "Version control");
  await app.waitFor(`!!document.querySelector(".gitgrip")`);
};
const dragBy = async (app: App, dy: number) => {
  const [x, y] = await app.center(".gitgrip");
  await app.drag([x, y], [x, y + dy]);
};

// Our own profile folder, so it outlives the first app run (launchApp removes the folders it makes).
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-split-"));
let app = await launchApp({ project, theme, userData });
try {
  await app.click(".rtab", "Version control");
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent.includes("Initialize repository"))`);
  await app.click(".abtn", "Initialize repository");
  await app.waitFor(`document.querySelectorAll(".gitmain tbody tr").length > 3`);
  await app.click(".gitmain tbody tr", "mcedge.json");
  await app.waitFor(`document.querySelector(".gitdiff").textContent.includes("hellomcedge")`);
  const main = await height(app, ".gitmain");
  const start = await table(app);
  await app.shot(evidence(`design/235/default-${theme}.png`));

  await dragBy(app, 150);
  const lower = await table(app);
  assert(near(lower, start + 150), `dragging down 150px grows the table (${start} -> ${lower})`);
  assert(near(lower + 6 + await height(app, ".gitdiff"), main), "the diff takes the rest");
  await app.shot(evidence(`design/235/dragged-${theme}.png`));

  await dragBy(app, 2000);
  assert(near(await height(app, ".gitdiff"), 60), `the diff keeps its minimum (${await height(app, ".gitdiff")})`);
  await dragBy(app, -4000);
  assert(near(await table(app), 80), `the table keeps its minimum (${await table(app)})`);

  await app.eval(`document.querySelector(".gitgrip").focus()`);
  await app.key("ArrowDown");
  await app.key("ArrowDown");
  assert(near(await table(app), 80 + 48), `ArrowDown moves it 24px a press (${await table(app)})`);
  await dragBy(app, 200);
  const kept = await table(app);
  // close() kills the app; Chromium writes localStorage to disk a few seconds after a change (a normal quit flushes it).
  await app.sleep(7000);
  await app.close();

  app = await launchApp({ project, theme, userData });
  await openGit(app);
  assert(near(await table(app), kept), `the size survives a restart (${kept} -> ${await table(app)})`);

  await app.click(".gitgrip", undefined, { double: true });
  assert(near(await table(app), start), `a double click restores the default (${await table(app)}, default ${start})`);
  console.log("PASS git-diff-split");
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
