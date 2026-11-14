/**
 * KUYRUK 129: the element list's Details view (name, type, id, folder, problems, generated) and the With problems /
 * Not generated filters, on a copy of the real ETREconomy project plus two fixtures: a creative tab naming a missing
 * item (a problem) and an armor trim (not generated on Forge 1.16.5). The view mode is remembered after a restart.
 * Args: theme (dark/light), language (en/tr). Screenshots go to design/129/.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assert, copyProject, launchApp, REPO, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
addElement(project, "creative_tab", "zz_broken_tab", { name: "Broken Tab", icon: "no_such_item" });
addElement(project, "armor_trim", "zz_trim");
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
const shot = (app: App, name: string) => app.shot(`design/129/${name}-${theme}-${lang}-after.png`);
const rows = (app: App) => app.eval<{ key: string; cells: string[]; problems: number }[]>(`[...document.querySelectorAll(".elemtable tbody tr")].map((r) => ({
  key: r.dataset.key, cells: [...r.cells].map((c) => c.textContent), problems: Number(r.querySelector("[data-problems]")?.dataset.problems) }))`);
const filter = (app: App, value: string) => app.setValue(".view .findbar select", value);
const view = (app: App, value: string) => app.eval(`(() => { const s = [...document.querySelectorAll(".view .findbar select")].at(-1); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);

let app = await launchApp({ project, theme, language: lang, userData });
try {
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
  const total = await app.eval<number>(`Number(document.querySelector(".view .fmeta").textContent.match(/(\\d+)\\D*$/)[1])`);

  // 1. Details: one row per element of every folder, with the six columns.
  await view(app, "details");
  await app.waitFor(`document.querySelector(".elemtable tbody tr")`, 15000);
  const all = await rows(app);
  assert(all.length === total, `details lists every element (${all.length} of ${total})`);
  assert((await app.eval<number>(`document.querySelectorAll(".elemtable thead th").length`)) === 6, "six columns");
  assert(all.some((r) => r.cells[3] !== "—"), "the folder column shows folders");
  await shot(app, "details");

  // 2. With problems: only elements with problems, the fixture among them.
  await filter(app, "@problems");
  await app.sleep(300);
  const problems = await rows(app);
  assert(problems.length > 0 && problems.every((r) => r.problems > 0), `with problems: ${problems.length} rows, each with a count`);
  assert(problems.some((r) => r.key === "creative_tab/zz_broken_tab"), "the broken tab is listed");
  assert(problems.length === all.filter((r) => r.problems > 0).length, "the filter keeps exactly the rows with problems");
  await shot(app, "details-problems");

  // 3. Not generated: on Forge 1.16.5 the armor trim is not generated.
  await filter(app, "@notgenerated");
  await app.sleep(200);
  assert((await rows(app)).length === 0, "Fabric 1.21.5 generates every type");
  await app.click(".enginebtn");
  await app.click(".menulist button", "Forge 1.16.5");
  await app.sleep(300);
  const notGenerated = await rows(app);
  assert(notGenerated.length > 0 && notGenerated.every((r) => r.key.startsWith("armor_trim/") || r.key.startsWith("banner_pattern/") || r.key.startsWith("feature/")),
    `not generated on 1.16.5: ${notGenerated.map((r) => r.key).join(", ")}`);
  assert(notGenerated.some((r) => r.key === "armor_trim/zz_trim"), "the armor trim is listed");
  await shot(app, "details-not-generated");

  // 4. Keys in the table: Enter opens, F2 renames.
  await filter(app, "@problems");
  await app.sleep(200);
  await app.click(".elemtable tbody tr", "zz_broken_tab");
  await app.key("F2");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".dialog")`);
  await app.click(".elemtable tbody tr", "zz_broken_tab");
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.key("w", 2);
  await app.waitFor(`document.querySelector(".elemtable")`);

  // 5. Tiles with the With problems filter show the same elements.
  await view(app, "tiles");
  await app.waitFor(`document.querySelector(".tiles")`);
  assert((await app.eval<number>(`document.querySelectorAll(".tiles .tile:not(.foldertile)").length`)) === problems.length, "tiles show the same filtered elements");
  await view(app, "details");
} finally {
  await app.close();
}

// 6. The view mode is remembered after a restart.
app = await launchApp({ project, theme, language: lang, userData });
try {
  await app.waitFor(`document.querySelector(".elemtable tbody tr")`, 30000);
  console.log(`element details and filters OK (${theme}, ${lang})`);
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error, await app.eval(`(() => { try { return localStorage.getItem("mcedge.elements.view"); } catch (e) { return String(e); } })()`).catch(String));
  await app.shot("tools/ui-test/last-failure.png");
  process.exitCode = 1;
} finally {
  await app.close();
}
