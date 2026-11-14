/**
 * KUYRUK #116 (audit L3): Export writes CSV (chosen languages, all/listed/selected keys) or one language as lang JSON;
 * Import reads either and shows a preview (added / changed / unchanged / unknown keys) before writing. On a copy of
 * ETREconomy-MCEdge a CSV round trip changes no byte of the language files, over the app and over MCP.
 *   node tools/ui-test/localization-io.ts [en|tr] [dark|light]
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, REPO, run, type App } from "./cdp.ts";

const language = process.argv[2] ?? "en";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const OUT = "design/localization";
const etr = [resolve(REPO, "..", "ETREconomy-MCEdge"), resolve(REPO, "..", "..", "ETREconomy-MCEdge")].find(existsSync)!;
const project = copyProject(etr, "etr");
const out = mkdtempSync(join(tmpdir(), "mcedge-loc-io-"));
const locDir = join(project, "localization");
const snapshot = () => Object.fromEntries(readdirSync(locDir).map((f) => [f, readFileSync(join(locDir, f))]));
const same = (a: Record<string, Buffer>, b: Record<string, Buffer>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((f) => b[f]?.equals(a[f]));
const original = snapshot();
const tr = (k: string) => JSON.parse(readFileSync(join(locDir, "tr_tr.json"), "utf8"))[k];

// ---- MCP: export, import without apply, byte-stable ----
{
  const mcp = await connect(project);
  try {
    const csv = join(out, "mcp.csv");
    await mcp.call("export_translations", { path: csv, format: "csv" });
    const plan = await mcp.call("import_translations", { path: csv, apply: true });
    assert(plan.totalChanges === 0 && plan.unknownKeys.length === 0, `MCP CSV round trip: ${plan.totalChanges} changes`);
    assert(same(original, snapshot()), "MCP CSV round trip leaves every language file byte for byte");
    const json = join(out, "tr_tr.json");
    await mcp.call("export_translations", { path: json, format: "json", language: "tr_tr" });
    const jsonPlan = await mcp.call("import_translations", { path: json });
    assert(jsonPlan.totalChanges === 0 && jsonPlan.languages[0].code === "tr_tr", "lang JSON round trip, language from the file name");
  } finally {
    await mcp.close();
  }
}

const exportVia = async (app: App, file: string, setup: () => Promise<void>) => {
  await app.mockDialogs({ save: file });
  await app.click(".actions .abtn", language === "tr" ? "Dışa aktar" : "Export");
  await app.waitFor(`document.querySelector(".dialog")`);
  await setup();
  await app.click(".dialog button[type=submit]");
  for (let i = 0; i < 50 && !existsSync(file); i++) await app.sleep(100);
  assert(existsSync(file), `exported ${file}`);
};
const importVia = async (app: App, file: string) => {
  await app.mockDialogs({ open: [file] });
  await app.click(".actions .abtn", language === "tr" ? "İçe aktar" : "Import");
  await app.waitFor(`document.querySelector(".dialog .importsum, .dialog .error-text")`);
};
const row = (app: App, lang: string) => app.eval<number[]>(`[...document.querySelectorAll('.importsum tr[data-lang="${lang}"] td')].slice(1).map((td) => Number(td.textContent))`);

await run(async (app) => {
  await app.click(".rtab", language === "tr" ? "Yerelleştirme" : "Localization");
  await app.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`, 20000);

  // CSV of every language and key, then the same file back: nothing to apply, no byte changes.
  const csv = join(out, `all-${language}.csv`);
  await exportVia(app, csv, async () => {
    await app.shot(`${OUT}/116-export-${language}-${theme}.png`);
  });
  const text = readFileSync(csv, "utf8");
  assert(text.startsWith("﻿key,en_us,tr_tr\r\n") && text.split("\r\n").length > 600, "CSV header and rows");
  await importVia(app, csv);
  assert(await app.eval<boolean>(`document.querySelector(".dialog button[type=submit]").disabled`), "a round trip has nothing to apply");
  const [added, changed, unchanged] = await row(app, "tr_tr");
  assert(added === 0 && changed === 0 && unchanged > 600, `tr_tr unchanged: ${added}/${changed}/${unchanged}`);
  await app.key("Escape");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".dialog")`)), "Escape closes the preview");
  await app.sleep(800);
  assert(same(original, snapshot()), "the CSV round trip changed no byte");

  // A translator's edit: one changed text, one filled gap, one key the project does not have.
  const lines = text.split("\r\n");
  const missing = lines.findIndex((l) => /,$/.test(l));
  const changedLine = lines.findIndex((l, i) => i > 0 && l.startsWith("AdminBookSalary,"));
  const missingKey = lines[missing].split(",")[0];
  lines[changedLine] = "AdminBookSalary,Salary amount,Maaş tutarı";
  lines[missing] = lines[missing] + "Çevrildi";
  lines.splice(lines.length - 1, 0, "gui.etreco.from_csv,From CSV,CSV'den");
  const edited = join(out, `edited-${language}.csv`);
  writeFileSync(edited, lines.join("\r\n"));
  await importVia(app, edited);
  const [a2, c2] = await row(app, "tr_tr");
  assert(a2 === 1 && c2 === 1, `preview: 1 added, 1 changed in tr_tr (${a2}, ${c2})`);
  assert(await app.eval<boolean>(`!!document.querySelector(".importunknown")`), "the unknown key is offered");
  await app.click(".importunknown input");
  await app.shot(`${OUT}/116-import-preview-${language}-${theme}.png`);
  await app.click(".dialog button[type=submit]");
  await app.sleep(800);
  assert(tr("AdminBookSalary") === "Maaş tutarı" && tr(missingKey) === "Çevrildi" && tr("gui.etreco.from_csv") === "CSV'den", "applied to tr_tr");
  const keys = Object.keys(JSON.parse(readFileSync(join(locDir, "tr_tr.json"), "utf8")));
  const before = Object.keys(JSON.parse(original["tr_tr.json"].toString("utf8")));
  assert(before.every((k, i) => keys[i] === k), "existing keys keep their order (KUYRUK 107)");

  // Lang JSON of the listed rows (Missing in tr_tr) in one language.
  const json = join(out, `en_us-${language}.json`);
  await app.setValue(".findbar .fsel select", "missing:tr_tr");
  await app.sleep(200);
  const listed = await app.eval<number>(`Number(document.querySelector(".locgrid").dataset.rows)`);
  await exportVia(app, json, async () => {
    await app.setValue(".dialog select", "json");
    await app.eval(`(() => { const s = document.querySelectorAll(".dialog select")[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "en_us"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await app.eval(`(() => { const s = document.querySelectorAll(".dialog select")[2]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "listed"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  });
  const exported = JSON.parse(readFileSync(json, "utf8"));
  assert(Object.keys(exported).length <= listed && Object.keys(exported).length > 0, `lang JSON of the listed keys: ${Object.keys(exported).length} of ${listed}`);
  console.log(`CSV and lang JSON in ${language}/${theme}`);
}, { project, language, theme });
