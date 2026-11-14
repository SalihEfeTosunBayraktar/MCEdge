/**
 * KUYRUK 188: a huge procedure (ETREconomy copy, 4,985 blocks) suggests splitting it in its Details panel, a small one
 * does not; blocks far outside the view leave their field texts out of layout and their outline unpainted, while every
 * block on screen keeps its texts, also after zooming in and out with the wheel. The load itself is compared with
 * Blockly's own in procedure-load-identical.ts. Screenshots (dark, light, tr) go to design/188/.
 */
import { assert, copyProject, run, type App } from "./cdp.ts";

const OUT = "design/188";
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const BIG = "kullanicigui_while_this_g_u_i_is_open_tick";

async function open(app: App, id: string) {
  await app.waitFor(`document.querySelector(".tile")`, 30000);
  await app.setValue(".view input", id);
  await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.trim() === ${JSON.stringify(id)}) || document.querySelectorAll(".tile").length === 1`, 8000);
  await app.eval(`([...document.querySelectorAll(".tile")].find((t) => t.textContent.trim() === ${JSON.stringify(id)}) ?? document.querySelector(".tile")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`, 120000);
  await app.sleep(1500);
}

/** Texts of on-screen blocks that are not laid out, and culled blocks whose outline is on screen. */
const onScreen = (app: App) => app.eval<{ shown: number; hiddenOnScreen: number; culled: number; culledOnScreen: number; culledTextShown: number }>(`(() => {
  const v = document.querySelector(".blocklyhost .blocklySvg").getBoundingClientRect();
  const inView = (r) => r.width + r.height > 0 && r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
  const blocks = [...document.querySelectorAll(".blocklyhost .blocklyBlockCanvas g[data-id]")];
  const culled = blocks.filter((g) => g.classList.contains("blocklyCulled"));
  const visible = blocks.filter((g) => !g.classList.contains("blocklyCulled") && inView(g.querySelector(":scope > .blocklyPath").getBoundingClientRect()));
  const texts = (g) => [...g.querySelectorAll(":scope > g:not([data-id]) > text")];
  return {
    shown: visible.length,
    hiddenOnScreen: visible.flatMap(texts).filter((t) => getComputedStyle(t).display === "none").length,
    culled: culled.length,
    culledOnScreen: culled.filter((g) => inView(g.querySelector(":scope > .blocklyPath").getBoundingClientRect())).length,
    culledTextShown: culled.flatMap(texts).filter((t) => getComputedStyle(t).display !== "none").length,
  };
})()`);

async function checkView(app: App, when: string) {
  const s = await onScreen(app);
  console.log(when, JSON.stringify(s));
  assert(s.shown > 0 && s.hiddenOnScreen === 0, `${when}: every on-screen block shows its texts (${JSON.stringify(s)})`);
  assert(s.culled > 1000 && s.culledOnScreen === 0 && s.culledTextShown === 0, `${when}: far blocks culled, none on screen (${JSON.stringify(s)})`);
}

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await open(app, BIG);
  const hint = await app.eval<string>(`document.querySelector(".procbig")?.textContent ?? ""`);
  assert(hint.startsWith("A program this large"), `split hint shown: ${hint}`);
  await checkView(app, "opened");

  // Wheel zoom in and out over the canvas: the culling follows and on-screen texts stay.
  const [x, y] = await app.center(".blocklyhost .blocklySvg");
  for (let i = 0; i < 4; i++) await app.wheel(x, y, -120);
  await app.sleep(600);
  await checkView(app, "zoomed in");
  for (let i = 0; i < 6; i++) await app.wheel(x, y, 120);
  await app.sleep(600);
  await checkView(app, "zoomed out");
  await app.eval(`document.querySelector(".procbig").scrollIntoView({ block: "center" })`);
  await app.shot(`${OUT}/after-big-dark.png`);
  await app.setTheme("light");
  await app.sleep(600);
  await app.shot(`${OUT}/after-big-light.png`);
  await app.setTheme("dark");

  await app.click("button.abtn", "Back").catch(() => app.key("Escape"));
  await app.sleep(500);
  await open(app, "goldsellerleftclick");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".procbig")`)), "no split hint on a small procedure");
}, { project });

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await open(app, BIG);
  const hint = await app.eval<string>(`document.querySelector(".procbig")?.textContent ?? ""`);
  assert(hint.startsWith("Bu kadar büyük"), `tr split hint: ${hint}`);
  await app.eval(`document.querySelector(".procbig").scrollIntoView({ block: "center" })`);
  await app.shot(`${OUT}/after-big-tr-dark.png`);
}, { project, language: "tr" });
