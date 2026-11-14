/**
 * KUYRUK 124: action wording (design/WORKBENCH-RULES.md section 4). The element list and Tags toolbars follow the verb
 * rule, and the tag entry actions live in the side panel's own bar, not in the section toolbar. Runs on a copy of
 * examples/hello with one tag. Args: language (en|tr), theme, suffix ("before" only takes the screenshots).
 * Screenshots go to design/124/. The string table is checked by tools/ui-test/strings-check.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const suffix = process.argv[4] ?? "after";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
writeFileSync(join(project, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "hellomcedge:gems", entries: ["ruby", "minecraft:diamond"] }] }, null, 2));
const toolbar = (app: App) => app.eval<string[]>(`[...document.querySelector(".view .actions").querySelectorAll(".abtn")].map((b) => b.textContent)`);
const shot = (app: App, name: string) => app.shot(`design/124/${name}-${lang}-${theme}-${suffix}.png`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 1`);
  await shot(app, "elements");
  await app.click(".rtab", s["section.tags"]);
  await app.click(".view .grid tbody tr");
  await app.sleep(200);
  await shot(app, "tags");
  if (suffix === "before") return;

  await app.click(".rtab", s["section.elements"]);
  const elements = await toolbar(app);
  assert(JSON.stringify(elements) === JSON.stringify([s["action.new"], s["folders.new"], s["action.edit"], s["action.duplicate"], s["folders.move"], s["refs.unused"], s["action.deleteSelected"]]),
    `element toolbar: ${elements.join(" | ")}`);

  await app.click(".rtab", s["section.tags"]);
  await app.click(".view .grid tbody tr");
  const tags = await toolbar(app);
  assert(JSON.stringify(tags) === JSON.stringify([s["tags.add"], s["tags.common"], s["action.deleteSelected"]]), `tags toolbar holds tag actions only: ${tags.join(" | ")}`);
  const bar = await app.eval<string[]>(`[...document.querySelectorAll("aside.panel .minibar .mbtn")].map((b) => b.textContent)`);
  assert(JSON.stringify(bar) === JSON.stringify([s["tags.addEntry"], s["tags.removeEntry"]]), `entry actions in the panel: ${bar.join(" | ")}`);
  // Add and remove an entry from the panel bar.
  await app.setValue("aside.panel .tagform input[list]", "minecraft:emerald");
  await app.click("aside.panel .minibar .mbtn", s["tags.addEntry"]);
  await app.waitFor(`[...document.querySelectorAll(".tagentries .lrow")].some((r) => r.textContent.includes("minecraft:emerald"))`);
  await app.click(".tagentries .lrow", "minecraft:diamond");
  await app.click("aside.panel .minibar .mbtn", s["tags.removeEntry"]);
  await app.sleep(1000);
  const saved = JSON.parse(readFileSync(join(project, "tags.json"), "utf8")).tags[0].entries;
  assert(JSON.stringify(saved) === JSON.stringify(["ruby", "minecraft:emerald"]), `entries saved: ${JSON.stringify(saved)}`);
  await shot(app, "tags-entries");
  console.log(`${lang}: element and tag toolbars follow the verb rule; entry actions in the panel`);
}, { project, language: lang });
