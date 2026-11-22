/**
 * KUYRUK 164: several rows of the creative tab order editor are selected (Ctrl+click toggles, Shift+click takes a
 * range) and move together with Up / Down, Alt+Up / Alt+Down and dragging, in their relative order, and stay
 * selected; a selected section takes its rows along, also folded (with row 163). Args: theme, language.
 * Screenshots go to design/164/.
 */
import { assert, run, type App, evidence } from "./cdp.ts";
import { openTab, savedOrder, tabOrderProject, visibleRows, waitSaved } from "./tabOrderFixture.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const tr = lang === "tr";
const project = tabOrderProject();
const row = (entry: string) => `.taborder .torow[data-entry="${entry}"]`;
const click = async (app: App, entry: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) => {
  await app.eval(`document.querySelector(${JSON.stringify(row(entry))}).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: ${!!modifiers.ctrl}, shiftKey: ${!!modifiers.shift} }))`);
  await app.sleep(80);
};
const selected = async (app: App) => (await visibleRows(app)).filter((r) => r.startsWith("+")).map((r) => r.slice(1));
const mbtn = (en: string, trText: string) => `[...document.querySelectorAll(".taborder .mbtn")].find((b) => b.textContent === ${JSON.stringify(tr ? trText : en)})`;
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

await run(async (app) => {
  await app.setTheme(theme);
  await openTab(app);

  // 1. Ctrl+click selects rows apart; Up moves each one step (the first row cannot), both stay selected.
  await click(app, "ruby_apple");
  await click(app, "gem_c", { ctrl: true });
  assert(same(await selected(app), ["ruby_apple", "gem_c"]), `two rows selected: ${await selected(app)}`);
  assert((await app.eval<string>(`document.querySelector(".taborder .minibar .fmeta").textContent`)).includes("2"), "the bar counts the selection");
  await app.shot(evidence(`design/164/tab-order-${theme}-${lang}-after.png`));
  await app.eval(`${mbtn("Up", "Yukarı")}.click()`);
  await waitSaved(app);
  assert(same(savedOrder(project), ["ruby_apple", "#Gems", "ruby", "gem_a", "gem_b", "ruby_block", "#Tools", "ruby_pickaxe", "_", "gem_c", "#Food"]),
    `gem_c stepped out of Food, ruby_apple stayed: ${savedOrder(project)}`);
  assert(same(await selected(app), ["ruby_apple", "gem_c"]), "still selected after the move");

  // 2. Shift+click takes a range; Alt+Down moves it in order into the next section.
  await click(app, "gem_a");
  await click(app, "ruby_block", { shift: true });
  assert(same(await selected(app), ["gem_a", "gem_b", "ruby_block"]), `range: ${await selected(app)}`);
  await app.eval(`document.querySelector(${JSON.stringify(row("gem_a"))}).focus()`);
  await app.key("ArrowDown", 1);
  await waitSaved(app);
  assert(same(savedOrder(project).slice(0, 7), ["ruby_apple", "#Gems", "ruby", "#Tools", "gem_a", "gem_b", "ruby_block"]), `range moved into Tools in order: ${savedOrder(project)}`);
  assert(same(await selected(app), ["gem_a", "gem_b", "ruby_block"]), "the range stays selected");

  // 3. Dragging one selected row moves every selected row to the drop point, in order.
  await click(app, "ruby");
  await click(app, "gem_c", { ctrl: true });
  const from = await app.center(`${row("gem_c")} .tograb`);
  const top = await app.rect(row("ruby_apple"));
  await app.drag(from, [from[0], top.y + 2], 10);
  await waitSaved(app);
  assert(same(savedOrder(project).slice(0, 3), ["ruby", "gem_c", "ruby_apple"]), `dragged together to the top: ${savedOrder(project)}`);
  assert(same(await selected(app), ["ruby", "gem_c"]), "dragged rows stay selected");

  // 4. A folded section in the selection moves with its rows; a row inside a selected section moves with it.
  await app.eval(`document.querySelector('${row("#Tools")} .tofold').click()`);
  await click(app, "#Tools");
  await click(app, "#Food", { ctrl: true });
  await app.eval(`${mbtn("Up", "Yukarı")}.click()`);
  await waitSaved(app);
  const order = savedOrder(project);
  assert(order.indexOf("#Tools") < order.indexOf("#Gems") && order.indexOf("#Food") < order.indexOf("#Gems")
    && same(order.slice(order.indexOf("#Tools"), order.indexOf("#Tools") + 7), ["#Tools", "gem_a", "gem_b", "ruby_block", "ruby_pickaxe", "_", "#Food"]),
    `both sections moved above Gems with their rows: ${order}`);
  assert(await app.eval<boolean>(`document.querySelector('${row("#Tools")}').classList.contains("folded")`), "Tools is still folded");
  await app.shot(evidence(`design/164/tab-order-sections-${theme}-${lang}-after.png`));
  console.log(`tab order multi-select OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
