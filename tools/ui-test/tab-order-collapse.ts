/**
 * KUYRUK 163: sections of the creative tab order editor collapse and expand (editor-only: the stored order does not
 * change), show how many rows they hide, Collapse all / Expand all, Left / Right on a selected section; Up, Down,
 * Alt+Up/Down and dragging move a collapsed section with everything in it, and a selection the fold hides goes to its
 * section. Args: theme (dark/light), language (en/tr). Screenshots go to design/163/.
 */
import { assert, run, evidence } from "./cdp.ts";
import { openTab, savedOrder, tabOrderProject, visibleRows, waitSaved } from "./tabOrderFixture.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const tr = lang === "tr";
const project = tabOrderProject();
const row = (entry: string) => `[...document.querySelectorAll(".taborder .torow")].find((r) => r.dataset.entry === ${JSON.stringify(entry)})`;
const fold = (entry: string) => `${row(entry)}.querySelector(".tofold").click()`;
const mbtn = (en: string, trText: string) => `[...document.querySelectorAll(".taborder .mbtn")].find((b) => b.textContent === ${JSON.stringify(tr ? trText : en)})`;
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

await run(async (app) => {
  await app.setTheme(theme);
  await openTab(app);
  const start = savedOrder(project);
  assert((await visibleRows(app)).length === 11, "eleven rows");

  // 1. Folding a section hides its rows and shows their count; the order is not changed.
  await app.eval(fold("#Gems"));
  await app.sleep(100);
  assert(same(await visibleRows(app), ["ruby_apple", "#Gems", "#Tools", "ruby_pickaxe", "_", "#Food", "gem_c"]), `Gems folded: ${await visibleRows(app)}`);
  assert((await app.eval<string>(`${row("#Gems")}.textContent`)).includes("4"), "the folded section says how many rows it hides");
  await app.sleep(1200);
  assert(same(savedOrder(project), start), "folding does not change the stored order");
  await app.shot(evidence(`design/163/tab-order-${theme}-${lang}-after.png`));

  // 2. Down moves the folded section with its four rows past the whole next section.
  await app.eval(`${row("#Gems")}.click()`);
  await app.eval(`${mbtn("Down", "Aşağı")}.click()`);
  await waitSaved(app);
  assert(same(savedOrder(project), ["ruby_apple", "#Tools", "ruby_pickaxe", "_", "#Gems", "ruby", "gem_a", "gem_b", "ruby_block", "#Food", "gem_c"]),
    `Gems moved with its rows past the whole Tools section: ${savedOrder(project)}`);
  assert(await app.eval<boolean>(`${row("#Gems")}.classList.contains("folded") && ${row("#Gems")}.classList.contains("sel")`), "still folded and selected");

  // 3. Alt+Up brings it back the same way.
  await app.eval(`${row("#Gems")}.focus()`);
  await app.key("ArrowUp", 1);
  await waitSaved(app);
  assert(same(savedOrder(project), start), `Alt+Up undid the move: ${savedOrder(project)}`);

  // 4. Dragging the folded section to the top moves the whole block.
  const from = await app.center(`.taborder .torow[data-entry="#Gems"] .tograb`);
  const top = await app.rect(`.taborder .torow[data-entry="ruby_apple"]`);
  await app.drag(from, [from[0], top.y + 2], 10);
  await waitSaved(app);
  assert(same(savedOrder(project).slice(0, 6), ["#Gems", "ruby", "gem_a", "gem_b", "ruby_block", "ruby_apple"]), `dragged block first: ${savedOrder(project)}`);

  // 5. Expand all / Collapse all; a hidden selection goes to its section.
  await app.eval(`${mbtn("Expand all", "Tümünü genişlet")}.click()`);
  await app.sleep(100);
  assert((await visibleRows(app)).length === 11, "expand all shows every row");
  await app.eval(`${row("gem_a")}.click()`);
  await app.eval(`${mbtn("Collapse all", "Tümünü daralt")}.click()`);
  await app.sleep(100);
  const folded = await visibleRows(app);
  assert(same(folded, ["+#Gems", "#Tools", "#Food"]), `collapse all: ${folded}`);

  // 6. Right unfolds and Left folds the selected section.
  await app.eval(`${row("#Gems")}.focus()`);
  await app.key("ArrowRight");
  assert((await visibleRows(app)).length === 8, `Right unfolded Gems: ${await visibleRows(app)}`);
  await app.key("ArrowLeft");
  assert((await visibleRows(app)).length === 3, "Left folded it again");
  console.log(`tab order collapse OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
