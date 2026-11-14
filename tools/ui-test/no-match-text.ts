/**
 * KUYRUK #148: a list whose search (or filter) matches nothing says so, instead of the "nothing here yet, import or
 * create one" text of an empty project: Resources > Models, Sounds and Structures, Element tags, Variables and Agent
 * tasks. With nothing in the list the empty text still shows. Screenshots go to design/148/.
 *   node tools/ui-test/no-match-text.ts [before|after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTask } from "../../src/live/tasks.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const OUT = "design/148";
const suffix = process.argv[2] ?? "after";
const failed: string[] = [];
const check = (ok: unknown, message: string) => (suffix === "before" ? ok || failed.push(message) : assert(ok, message));
for (const [folder, file, data] of [["models", "gem.json", "{}"], ["sounds", "ping.ogg", "OggS"], ["structures", "hut.nbt", "x"]]) {
  mkdirSync(join(project, folder), { recursive: true });
  writeFileSync(join(project, folder, file), data);
}
writeFileSync(join(project, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "hellomcedge:gems", entries: ["ruby"] }] }, null, 2));
createTask(project, { title: "Add a sapphire", source: { kind: "free" } });

const NO_MATCH = "Nothing matches the search or the filter.";
const emptyText = (app: App, scope = "") => app.eval<string>(`document.querySelector(${JSON.stringify(`${scope} .table-empty`)})?.textContent ?? ""`);
const search = async (app: App, text: string, scope = "") => {
  await app.setValue(`${scope} .findbar .search input`, text);
  await app.sleep(300);
};

await run(async (app) => {
  await app.click(".rtab", "Resources");
  for (const tab of ["Models", "Sounds", "Structures"]) {
    await app.click(".ltab", tab);
    await app.waitFor(`document.querySelectorAll(".grid tbody tr").length === 1`);
    await search(app, "zzz");
    const text = await emptyText(app);
    check(text === NO_MATCH, `${tab}: a search with no match says so: ${text}`);
    if (tab === "Models") await app.shot(`${OUT}/148-models-dark-${suffix}.png`);
    await search(app, "");
  }
  await app.click(".rtab", "Element tags");
  await search(app, "zzz");
  check((await emptyText(app)) === NO_MATCH, `tags: ${await emptyText(app)}`);
  await app.click(".rtab", "Variables");
  await search(app, "zzz");
  check((await emptyText(app)) === NO_MATCH, `variables: ${await emptyText(app)}`);
  await app.click(".sitem.gradle");
  await app.click(".ptab", "Agents");
  await app.click(".agtasks");
  await search(app, "zzz", ".tasksview");
  check((await emptyText(app, ".tasksview")) === NO_MATCH, `tasks: ${await emptyText(app, ".tasksview")}`);
  await app.setTheme("light");
  await app.shot(`${OUT}/148-tasks-light-${suffix}.png`);
  if (failed.length) throw new Error(`failed checks:\n${failed.join("\n")}`);
}, { project });
