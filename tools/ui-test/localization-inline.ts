/**
 * KUYRUK #113 (audit L2, L7): localization cells are edited in place. Click edits a cell, Enter saves and goes down,
 * Tab goes to the next language, Esc cancels, Ctrl+Enter goes to the next missing cell of the language. There is no
 * side panel and no State column; a detail strip shows the key, what uses it and a placeholder check.
 *   node tools/ui-test/localization-inline.ts [en|tr] [dark|light] [suffix]
 * Screenshots go to design/localization/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const language = process.argv[2] ?? "en";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const suffix = process.argv[4] ?? "after";
const OUT = evidence("design/localization");
const project = exampleProject();
const lang = (code: string) => JSON.parse(readFileSync(join(project, "localization", `${code}.json`), "utf8")) as Record<string, string>;

const td = (key: string, code: string) => `document.querySelector('.locgrid td[data-row="${key}"][data-lang="${code}"]')`;
const editor = `document.querySelector(".locgrid .celledit")`;
const editingAt = (app: App) => app.eval<string | null>(`(() => { const e = ${editor}; const td = e?.closest("td"); return td ? td.dataset.row + "|" + td.dataset.lang : null; })()`);
const clickCell = async (app: App, key: string, code: string) => {
  await app.eval(`${td(key, code)}.scrollIntoView({ block: "nearest" })`);
  await app.click(`.locgrid td[data-row="${key}"][data-lang="${code}"]`);
};
const typeInto = async (app: App, text: string) => {
  // Replace the editor's text the way typing over a selection does.
  await app.eval(`${editor}.select()`);
  await app.type(text);
};
const CTRL = 2;
const SHIFT = 8;

await run(async (app) => {
  const section = language === "tr" ? "Yerelleştirme" : "Localization";
  await app.click(".rtab", section);
  await app.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`);
  assert(await app.eval<boolean>(`!document.querySelector("section.view .panel")`), "no side panel");
  const heads = await app.eval<string[]>(`[...document.querySelectorAll(".locgrid th")].map((th) => th.textContent)`);
  assert(heads.length === 3, `key + two languages, no State column: ${JSON.stringify(heads)}`);
  assert(await app.eval<boolean>(`!!document.querySelector(".locdetail")`), "a detail strip");
  await app.shot(`${OUT}/113-grid-${language}-${theme}-${suffix}.png`);

  // Click edits; Enter saves and edits the cell below.
  const rows = await app.eval<string[]>(`[...document.querySelectorAll(".locgrid tbody tr[data-key]")].map((r) => r.dataset.key)`);
  const [first, second] = rows;
  await clickCell(app, first, "tr_tr");
  assert(await editingAt(app) === `${first}|tr_tr`, "a click opens the cell editor");
  await typeInto(app, "Birinci");
  await app.shot(`${OUT}/113-cell-editor-${language}-${theme}-${suffix}.png`);
  await app.key("Enter");
  assert(await editingAt(app) === `${second}|tr_tr`, `Enter goes down: ${await editingAt(app)}`);

  // Esc cancels: the typed text is dropped and the editor closes on that cell.
  const before = await app.eval<string>(`${editor}.value`);
  await typeInto(app, "iptal");
  await app.key("Escape");
  assert(!(await editingAt(app)), "Esc closes the editor");
  assert(await app.eval<string>(`${td(second, "tr_tr")}.textContent`) === before, "Esc keeps the old text");
  assert(await app.eval<boolean>(`${td(second, "tr_tr")}.classList.contains("cur")`), "the cell stays current after Esc");

  // Enter on the current cell edits it again; Shift+Tab goes to the previous language.
  await app.key("Enter");
  assert(await editingAt(app) === `${second}|tr_tr`, "Enter edits the current cell");
  await app.key("Tab", SHIFT);
  assert(await editingAt(app) === `${second}|en_us`, `Shift+Tab goes to en_us: ${await editingAt(app)}`);
  await app.key("Tab");
  assert(await editingAt(app) === `${second}|tr_tr`, "Tab goes back to tr_tr");

  // A placeholder the translation lacks shows in the strip and tints the cell.
  await app.key("Tab", SHIFT);
  await typeInto(app, "Coins: %s");
  await app.key("Tab");
  await typeInto(app, "Para");
  // Clicking the key saves the cell (blur) and selects the row.
  await app.click(`.locgrid tr[data-key="${second}"] td.lockey`);
  await app.sleep(100);
  assert(!(await editingAt(app)), "leaving the cell closes the editor");
  const strip = await app.eval<string>(`document.querySelector(".locdetail").innerText`);
  assert(strip.includes(second) && strip.includes("%s"), `the strip names the key and the missing %s: ${strip}`);
  assert(await app.eval<boolean>(`${td(second, "tr_tr")}.classList.contains("ph")`), "the cell is marked");
  await app.shot(`${OUT}/113-editing-${language}-${theme}-${suffix}.png`);

  // Ctrl+Enter: the next row whose tr_tr has no text. Add a key that has only English text, then jump to it.
  await app.eval(`document.querySelector(".findbar .search input").blur()`);
  const missingKey = await app.eval<string | null>(`[...document.querySelectorAll(".locgrid td.miss[data-lang=tr_tr]")].map((c) => c.dataset.row)[0] ?? null`);
  assert(missingKey, "the example has a key without tr_tr text");
  await clickCell(app, first, "tr_tr");
  await app.key("Enter", CTRL);
  assert(await editingAt(app) === `${missingKey}|tr_tr`, `Ctrl+Enter goes to the next missing cell: ${await editingAt(app)} (expected ${missingKey})`);
  await typeInto(app, "Eksik değil");
  await app.key("Escape");
  assert(await app.eval<boolean>(`${td(missingKey, "tr_tr")}.classList.contains("miss")`), "Esc did not save");
  await app.key("Enter");
  await typeInto(app, "Artık var");
  await app.key("Enter");

  // Saved to disk, key order kept (KUYRUK 107).
  await app.sleep(1200);
  const tr = lang("tr_tr");
  assert(tr[first] === "Birinci" && tr[missingKey] === "Artık var" && tr[second] === "Para", `saved: ${JSON.stringify(tr)}`);
  assert(lang("en_us")[second] === "Coins: %s", "the en_us text was saved");
  console.log(`edited in place in ${language}/${theme}`);
}, { project, language, theme });
