/**
 * Workbench layout rules (design/WORKBENCH-RULES.md), measured on every rail section of a copy of examples/hello:
 * - the find bar at y=34 and one horizontal toolbar right under it at y=76 (KUYRUK 119);
 * - sub-tabs (Resources, Version control) sit below the toolbar and keep their counts (KUYRUK 120).
 * With a suffix argument ("before"/"after") screenshots go to design/<row>/ (args: suffix, theme).
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";

const suffix = process.argv[2];
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const shot = (app: App, file: string) => (suffix ? app.shot(`design/${file}-${theme}-${suffix}.png`) : Promise.resolve());
const FIND_Y = 34;
const TOOLBAR_Y = 76;

interface Metrics { find: number | null; toolbar: number | null; horizontal: boolean | null; columns: number; tabs: number | null; counts: string[] }
/** Find bar, toolbar and sub-tabs of the shown section. */
const MEASURE = `(() => {
  const view = document.querySelector(".content > .view, .content > section");
  const top = (e) => e ? Math.round(e.getBoundingClientRect().y) : null;
  const bar = [...(view?.querySelectorAll("[role=toolbar]") ?? [])].find((e) => e.offsetParent);
  const r = bar?.getBoundingClientRect();
  const tabs = view?.querySelector("[role=tablist]");
  return { find: top(view?.querySelector(".findbar")), toolbar: top(bar), horizontal: r ? r.width > r.height : null,
    columns: document.querySelectorAll(".acol").length, tabs: top(tabs), counts: [...(tabs?.querySelectorAll(".lpct") ?? [])].map((c) => c.textContent) };
})()`;
const measure = (app: App) => app.eval<Metrics>(MEASURE);
const offPattern = (m: Metrics) => m.find !== FIND_Y || m.toolbar !== TOOLBAR_Y || !m.horizontal || m.columns > 0
  || (m.tabs !== null && m.tabs <= TOOLBAR_Y) || m.counts.some((c) => !/^\d+$/.test(c ?? ""));

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 1`);
  await shot(app, "119/elements");
  const sections = await app.eval<string[]>(`[...document.querySelectorAll(".rail .rtab")].map((b) => b.title)`);
  const wrong: string[] = [];
  const check = (name: string, m: Metrics) => {
    console.log(`${name}: find bar y=${m.find}, toolbar y=${m.toolbar}${m.horizontal === false ? " (vertical)" : ""}${m.tabs !== null ? `, tabs y=${m.tabs} (${m.counts.join("/")})` : ""}`);
    if (offPattern(m)) wrong.push(`${name} ${JSON.stringify(m)}`);
  };
  for (const [i, name] of sections.entries()) {
    await app.eval(`document.querySelectorAll(".rail .rtab")[${i}].click()`);
    await app.sleep(500);
    check(name, await measure(app));
    if (name === "Resources") {
      // Every sub-tab keeps the same frame; the tabs and their counts sit under the toolbar.
      await shot(app, "120/resources");
      const tabs = await app.eval<number>(`document.querySelectorAll(".view [role=tablist] [role=tab]").length`);
      for (let k = 1; k < tabs; k++) {
        await app.eval(`document.querySelectorAll(".view [role=tablist] [role=tab]")[${k}].click()`);
        await app.sleep(200);
        check(`Resources tab ${k + 1}`, await measure(app));
      }
    }
    if (name === "Version control") {
      // A new repository shows the Changes / History tabs: under the toolbar too.
      await app.click(".view .actions .abtn.primary");
      await app.waitFor(`document.querySelector(".view [role=tablist]")`, 15000);
      check("Version control (repository)", await measure(app));
      await shot(app, "120/git");
    }
  }
  assert(sections.length >= 6, `sections found: ${sections.join(", ")}`);
  assert(wrong.length === 0, `sections off the pattern: ${wrong.join("; ")}`);
}, { project: exampleProject() });
