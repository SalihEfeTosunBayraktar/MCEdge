/**
 * KUYRUK 172: a section end in the creative tab order editor. "Add section end" puts an end marker after the selected
 * row (disabled outside sections); the rows after it are drawn flush (outside sections), the marker itself indented as
 * "end of <section>"; a drag over those rows says "outside sections"; the marker steps down with the Down button (the
 * row it passes joins the section), a folded section hides its marker, and removing the marker puts the rows back in.
 * Args: theme, language. Screenshots go to design/172/.
 */
import { assert, run, type App } from "./cdp.ts";
import { openTab, savedOrder, tabOrderProject, waitSaved } from "./tabOrderFixture.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const tr = lang === "tr";
const project = tabOrderProject();
const row = (entry: string) => `.taborder .torow[data-entry="${entry}"]`;
const button = (en: string, trText: string) => `[...document.querySelectorAll(".taborder .minibar .mbtn")].find((b) => b.textContent.trim() === ${JSON.stringify(tr ? trText : en)})`;
const press = async (app: App, en: string, trText: string) => {
  await app.eval(`${button(en, trText)}.click()`);
  await app.sleep(150);
};
const indented = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".taborder .torow.insection")].map((r) => r.dataset.entry)`);

await run(async (app) => {
  await app.setTheme(theme);
  await openTab(app);
  const order0 = savedOrder(project).join(",");

  // Outside sections there is nothing to end.
  await app.click(row("ruby_apple"));
  assert(await app.eval<boolean>(`${button("Add section end", "Bölüm sonu ekle")}.disabled`), "Add section end is disabled outside sections");

  // After gem_b: ruby_block stands outside Gems.
  await app.click(row("gem_b"));
  await press(app, "Add section end", "Bölüm sonu ekle");
  await waitSaved(app);
  const order = savedOrder(project);
  assert(order.slice(0, 7).join(",") === "ruby_apple,#Gems,ruby,gem_a,gem_b,/,ruby_block", `end marker stored after gem_b: ${order}`);
  const inside = await indented(app);
  assert(inside.includes("/") && !inside.includes("ruby_block") && inside.includes("gem_b"), `ruby_block is drawn outside sections, the marker inside: ${inside}`);
  const endText = await app.eval<string>(`document.querySelector('${row("/")} .ltxt').textContent`);
  assert(endText === (tr ? "Gems sonu" : "end of Gems"), `marker names its section: ${endText}`);
  assert(await app.eval<boolean>(`document.querySelector(".taborder .listform .hint")?.textContent.includes(${JSON.stringify(tr ? "Üstteki bölümü bitirir" : "Ends the section above")})`), "the marker's hint shows when it is selected");
  await app.shot(`design/172/tab-order-end-${theme}-${lang}.png`);

  // Dragging ruby_apple over ruby_block: it would land outside sections.
  const [gx, gy] = await app.center(`${row("ruby_apple")} .tograb`);
  await app.mouse("mouseMoved", gx, gy, 0);
  await app.mouse("mousePressed", gx, gy);
  const r = await app.rect(row("#Tools"));
  await app.mouse("mouseMoved", gx, r.y + 3, 1);
  await app.sleep(150);
  const line = await app.eval<{ cls: string; label: string } | null>(`(() => { const d = document.querySelector("[data-testid=drop-line]"); return d && { cls: d.className, label: d.textContent }; })()`);
  assert(!!line && line.cls.includes("outside") && line.label === (tr ? "bölümlerin dışına" : "outside sections"), `drop after the end is outside sections: ${JSON.stringify(line)}`);
  await app.shot(`design/172/tab-order-end-drop-${theme}-${lang}.png`);
  await app.mouse("mouseMoved", gx, gy, 1);
  await app.mouse("mouseReleased", gx, gy, 0);
  await app.sleep(200);

  // The marker steps down past ruby_block, which joins Gems again.
  await app.click(row("/"));
  await press(app, "Down", "Aşağı");
  await waitSaved(app);
  assert(savedOrder(project).slice(4, 7).join(",") === "gem_b,ruby_block,/", `marker stepped down: ${savedOrder(project)}`);
  assert((await indented(app)).includes("ruby_block"), "ruby_block is inside again");

  // Folding Gems hides its marker.
  await app.eval(`document.querySelector('${row("#Gems")} .tofold').click()`);
  await app.sleep(150);
  assert(await app.eval<boolean>(`!document.querySelector('${row("/")}')`), "a folded section hides its end marker");
  await app.eval(`document.querySelector('${row("#Gems")} .tofold').click()`);
  await app.sleep(150);

  // Removing the marker gives the old order back.
  await app.click(row("/"));
  await press(app, "Remove", "Kaldır");
  await waitSaved(app);
  assert(savedOrder(project).join(",") === order0, `removed: ${savedOrder(project)} (was ${order0})`);
}, { project, theme, language: lang });
