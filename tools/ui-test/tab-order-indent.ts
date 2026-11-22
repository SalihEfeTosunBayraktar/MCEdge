/**
 * KUYRUK 165: rows inside a section of the creative tab order editor are indented with a guide line (rows before the
 * first section and section headers are not), and while dragging the drop line says where the rows land: indented
 * with "into <section>", or flush with "outside sections"; a dragged section shows a flush line without a label.
 * Args: theme, language. Screenshots go to design/165/.
 */
import { assert, run, type App, evidence } from "./cdp.ts";
import { openTab, savedOrder, tabOrderProject, waitSaved } from "./tabOrderFixture.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const tr = lang === "tr";
const project = tabOrderProject();
const row = (entry: string) => `.taborder .torow[data-entry="${entry}"]`;
const textX = (app: App, entry: string) => app.eval<number>(`document.querySelector('${row(entry)} .ltxt').getBoundingClientRect().x`);
const dropLine = (app: App) => app.eval<{ cls: string; label: string; left: number } | null>(`(() => {
  const d = document.querySelector("[data-testid=drop-line]"); if (!d) return null;
  return { cls: d.className, label: d.textContent, left: d.getBoundingClientRect().x - d.closest(".torows").getBoundingClientRect().x };
})()`);
const over = async (app: App, x: number, entry: string, where: "top" | "bottom") => {
  const r = await app.rect(row(entry));
  await app.mouse("mouseMoved", x, where === "top" ? r.y + 3 : r.y + r.height - 3, 1);
  await app.sleep(120);
};

await run(async (app) => {
  await app.setTheme(theme);
  await openTab(app);

  // 1. Indentation and guide lines.
  const indented = await app.eval<string[]>(`[...document.querySelectorAll(".taborder .torow.insection")].map((r) => r.dataset.entry)`);
  assert(JSON.stringify(indented) === JSON.stringify(["ruby", "gem_a", "gem_b", "ruby_block", "ruby_pickaxe", "_", "gem_c"]), `rows inside sections: ${indented}`);
  assert((await app.eval<number>(`document.querySelectorAll(".taborder .torow .toindent").length`)) === 7, "each has a guide line");
  assert((await textX(app, "gem_a")) > (await textX(app, "ruby_apple")) + 8, "rows in a section start further right than rows outside");
  await app.shot(evidence(`design/165/tab-order-${theme}-${lang}-after.png`));

  // 2. Dragging ruby_apple: the line says where it lands.
  const [gx, gy] = await app.center(`${row("ruby_apple")} .tograb`);
  await app.mouse("mouseMoved", gx, gy, 0);
  await app.mouse("mousePressed", gx, gy);
  await over(app, gx, "ruby_block", "top");
  let line = await dropLine(app);
  assert(!!line && line.cls.includes("inside") && line.label.includes("Gems") && line.left > 10, `inside Gems: ${JSON.stringify(line)}`);
  await app.shot(evidence(`design/165/tab-order-drop-inside-${theme}-${lang}-after.png`));
  await over(app, gx, "#Tools", "top");
  line = await dropLine(app);
  assert(!!line && line.label.includes("Gems"), `before the Tools header the row still lands at the end of Gems: ${JSON.stringify(line)}`);
  await over(app, gx, "#Gems", "top");
  line = await dropLine(app);
  // Dropping right where it is (before Gems, its own place) changes nothing: no line.
  assert(line === null, `no line where nothing would change: ${JSON.stringify(line)}`);
  await over(app, gx, "#Tools", "top");
  await app.mouse("mouseReleased", gx, gy, 0);
  await waitSaved(app);
  assert(JSON.stringify(savedOrder(project).slice(0, 6)) === JSON.stringify(["#Gems", "ruby", "gem_a", "gem_b", "ruby_block", "ruby_apple"]), `landed at the end of Gems: ${savedOrder(project)}`);

  // 3. Outside: dragging gem_a above the Gems header puts it outside every section.
  const [ax, ay] = await app.center(`${row("gem_a")} .tograb`);
  await app.mouse("mouseMoved", ax, ay, 0);
  await app.mouse("mousePressed", ax, ay);
  await over(app, ax, "#Gems", "top");
  line = await dropLine(app);
  assert(!!line && line.cls.includes("outside") && line.label === (tr ? "bölümlerin dışına" : "outside sections") && line.left < 4, `outside: ${JSON.stringify(line)}`);
  await app.shot(evidence(`design/165/tab-order-drop-outside-${theme}-${lang}-after.png`));
  await app.mouse("mouseReleased", ax, ay, 0);
  await waitSaved(app);
  assert(savedOrder(project)[0] === "gem_a" && !(await app.eval<boolean>(`document.querySelector('${row("gem_a")}').classList.contains("insection")`)), "gem_a outside, not indented");

  // 4. A dragged section: a flush line without a label.
  const [sx, sy] = await app.center(`${row("#Food")} .tograb`);
  await app.mouse("mouseMoved", sx, sy, 0);
  await app.mouse("mousePressed", sx, sy);
  await over(app, sx, "#Tools", "top");
  line = await dropLine(app);
  assert(!!line && line.cls.includes("outside") && line.label === "", `section drop line: ${JSON.stringify(line)}`);
  await app.mouse("mouseReleased", sx, sy, 0);
  await waitSaved(app);
  const order = savedOrder(project);
  assert(order.indexOf("#Food") < order.indexOf("#Tools") && order[order.indexOf("#Food") + 1] === "gem_c", `Food moved above Tools with its row: ${order}`);
  console.log(`tab order indentation OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
