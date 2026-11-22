/**
 * KUYRUK #63: a less crowded element view. The section rail shows icons only by default (names in the tooltips) and
 * opens up to show names, rare actions (Rename, Usages, Move) live in the right-click menu, and version control and
 * settings sit apart at the bottom of the rail. Since KUYRUK #119 the element actions are the section's one horizontal
 * toolbar (no action column).
 * Screenshots go to design/collapsible-ui/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/collapsible-ui");
const width = (app: App, selector: string) => app.eval<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width`);
/** Rendered width of the text of the first matching button (0 when it is clipped away). */
const labelWidth = (app: App, selector: string) => app.eval<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width`);

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 1`);

  // Default: icons only.
  assert(await width(app, ".rail") <= 40, `slim rail: ${await width(app, ".rail")}`);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".acol")`)), "no action column");
  assert((await labelWidth(app, ".rtab .rlabel")) <= 1, "rail names are hidden");
  const buttons = await app.eval<string[]>(`[...document.querySelectorAll(".view .actions .abtn:not(.compact)")].map((b) => b.textContent)`);
  // Q279: New in the bar, New folder and Unused in the path strip; Edit, Duplicate, Move and Delete selected only with a selection.
  assert(buttons.length === 3 && !buttons.some((b) => /Rename|Usages|Move/.test(b)), `fewer buttons: ${buttons.join(", ")}`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".rtab")].every((b) => b.title)`), "every tab has a tooltip");
  await app.shot(`${OUT}/slim.png`);

  // Rare actions are in the element menu.
  await app.click(".tile:not(.foldertile)", undefined, { button: "right" });
  const items = await app.eval<string[]>(`[...document.querySelectorAll(".menulist.ctx [role=menuitem]")].map((b) => b.textContent)`);
  assert(["Rename", "Usages", "Move"].every((i) => items.includes(i)), `rare actions in the menu: ${items.join("|")}`);
  await app.key("Escape");

  // Rail opens: names, and the settings group at the bottom.
  await app.click(".rtoggle");
  assert((await width(app, ".rail")) >= 140 && (await labelWidth(app, ".rtab .rlabel")) > 20, "the rail shows names");
  const ys = await app.eval<Record<string, number>>(`Object.fromEntries([...document.querySelectorAll(".rtab")].map((b) => [b.title, b.getBoundingClientRect().top]))`);
  const railBottom = await app.eval<number>(`document.querySelector(".rail").getBoundingClientRect().bottom`);
  assert(ys["Version control"] > ys["Localization"] + 100 && railBottom - ys["Workspace settings"] < 200, `settings group sits at the bottom: ${JSON.stringify(ys)}`);
  await app.shot(`${OUT}/rail-wide.png`);
  await app.click(".rtoggle");
  assert((await width(app, ".rail")) <= 40, "the rail closes again");
}, { project: exampleProject() });
