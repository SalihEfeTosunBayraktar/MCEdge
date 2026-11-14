/**
 * KUYRUK #114 (audit L4, L9): Show offers Missing in <each language>, Missing in any, Source empty, Placeholder
 * mismatch, Edited and From elements, with correct labels in en and tr. The rows each filter lists are counted on a
 * copy of ETREconomy-MCEdge and compared with a count made here from the language files and with the MCP
 * list_translation_keys tool. New keys are validated in the Add key dialog.
 *   node tools/ui-test/localization-filters.ts [en|tr]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { displayName, nameLangKey } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { generatedLangKeys } from "../../src/generator/langKeys.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, REPO, run } from "./cdp.ts";

const language = process.argv[2] ?? "en";
const etr = [resolve(REPO, "..", "ETREconomy-MCEdge"), resolve(REPO, "..", "..", "ETREconomy-MCEdge")].find(existsSync)!;
const project = copyProject(etr, "etr");

// A key whose Turkish text drops the %s, so the placeholder filter has a row; and new-key warnings over MCP.
const mcp = await connect(project);
const viaMcp: Record<string, number> = {};
{
  const warned = await mcp.call("set_translations", { language: "en_us", entries: { BadKey: "x", "gui.othermod.x": "y" } });
  assert(warned.warnings?.length === 2, `set_translations warns about new keys: ${JSON.stringify(warned.warnings)}`);
  await mcp.call("set_translations", { language: "en_us", entries: { BadKey: null, "gui.othermod.x": null, "gui.etreco.ui_test_coins": "Coins: %s" } });
  await mcp.call("set_translations", { language: "tr_tr", entries: { "gui.etreco.ui_test_coins": "Para" } });
}

// Expected rows, counted from the files: element keys fill en_us when it has no text.
const { localization, elements, mod } = loadProject(project);
const registry = typeRegistry();
const names: Record<string, string> = {};
for (const [typeId, list] of Object.entries(elements)) {
  for (const e of list) {
    const key = nameLangKey(registry.byId.get(typeId), mod.id, e);
    if (key) names[key] = displayName(registry.byId.get(typeId), e);
  }
}
// Plus what the generator of the app's default engine writes for elements (KUYRUK 117).
for (const [key, e] of Object.entries(generatedLangKeys(loadProject(project), project, listEngines()[0]))) names[key] = e.text;
const langs = ["en_us", ...Object.keys(localization).filter((l) => l !== "en_us").sort()];
const keys = [...new Set([...Object.keys(names), ...Object.values(localization).flatMap(Object.keys)])];
const shown = (l: string, k: string) => localization[l]?.[k] || (l === "en_us" ? names[k] ?? "" : "");
const args = (s: string) => (s.match(/%(\d+\$)?[sd]/g) ?? []).length;
const expected: Record<string, number> = {
  all: keys.length,
  missingAny: keys.filter((k) => langs.some((l) => !shown(l, k))).length,
  sourceEmpty: keys.filter((k) => !shown("en_us", k)).length,
  // A count check is enough here: a translation with a different number of %s/%d than its source.
  placeholder: keys.filter((k) => langs.slice(1).some((l) => shown(l, k) && shown("en_us", k) && args(shown(l, k)) !== args(shown("en_us", k)))).length,
  edited: keys.filter((k) => langs.some((l) => localization[l]?.[k])).length,
  elements: Object.keys(names).length,
  ...Object.fromEntries(langs.slice(1).map((l) => [`missing:${l}`, keys.filter((k) => !shown(l, k)).length])),
};

for (const filter of Object.keys(expected)) viaMcp[filter] = (await mcp.call("list_translation_keys", { filter, limit: 1 })).matching;
await mcp.close();

const labels: Record<string, Record<string, string>> = {
  en: { "missing:tr_tr": "Missing in tr_tr", missingAny: "Missing in any language", sourceEmpty: "Source text empty (en_us)", placeholder: "Placeholder mismatch", edited: "Edited (text typed in this project)", elements: "From elements" },
  tr: { "missing:tr_tr": "tr_tr çevirisi eksik", missingAny: "Herhangi bir dilde eksik", sourceEmpty: "Kaynak metin boş (en_us)", placeholder: "Yer tutucu uyuşmazlığı", edited: "Düzenlenmiş (bu projede yazılmış metin)", elements: "Öğelerden gelen" },
};

await run(async (app) => {
  await app.click(".rtab", language === "tr" ? "Yerelleştirme" : "Localization");
  await app.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`, 20000);
  const options = await app.eval<Record<string, string>>(`Object.fromEntries([...document.querySelector(".findbar .fsel select").options].map((o) => [o.value, o.textContent]))`);
  for (const [value, label] of Object.entries(labels[language])) assert(options[value] === label, `label of ${value}: "${options[value]}"`);

  const counts: Record<string, number> = {};
  for (const filter of Object.keys(expected)) {
    await app.setValue(".findbar .fsel select", filter);
    await app.sleep(200);
    counts[filter] = await app.eval<number>(`Number(document.querySelector(".locgrid").dataset.rows)`);
    const listed = await app.eval<number>(`document.querySelectorAll(".locgrid tbody tr[data-key]").length`);
    assert(listed <= counts[filter], `${filter}: at most the counted rows are in the table`);
  }
  console.table(Object.fromEntries(Object.keys(expected).map((f) => [f, { ui: counts[f], files: expected[f], mcp: viaMcp[f] }])));
  for (const filter of Object.keys(expected)) {
    assert(counts[filter] === expected[filter], `${filter}: ${counts[filter]} rows, ${expected[filter]} counted from the files`);
    assert(viaMcp[filter] === counts[filter], `${filter}: MCP lists ${viaMcp[filter]}`);
  }
  assert(counts["missing:tr_tr"] > 0 && counts.sourceEmpty > 0 && counts.elements > 0 && counts.placeholder > 0, "the filters find rows in ETR");

  await app.setValue(".findbar .fsel select", "missing:tr_tr");
  await app.sleep(200);
  await app.shot(`design/localization/114-missing-tr_tr-${language}.png`);
  await app.setValue(".findbar .fsel select", "sourceEmpty");
  await app.sleep(200);
  await app.shot(`design/localization/114-source-empty-${language}.png`);

  // New keys: upper case or no dots blocks Add; no mod id part only warns.
  await app.click(".actions .abtn.primary");
  await app.waitFor(`document.querySelector(".dialog input.mono")`);
  const okEnabled = () => app.eval<boolean>(`!document.querySelector(".dialog button[type=submit]").disabled`);
  await app.setValue(".dialog input.mono", "AdminBookBonus");
  assert(!(await okEnabled()) && await app.eval<boolean>(`!!document.querySelector(".dialog .error-text")`), "an upper case key without dots is refused");
  await app.shot(`design/localization/114-key-format-${language}.png`);
  await app.setValue(".dialog input.mono", "gui.othermod.title");
  assert(await okEnabled() && await app.eval<boolean>(`!!document.querySelector(".dialog .warn-text")`), "a key without the mod id is allowed with a warning");
  await app.setValue(".dialog input.mono", `gui.${mod.id}.new_title`);
  assert(await okEnabled() && await app.eval<boolean>(`!document.querySelector(".dialog .warn-text, .dialog .error-text")`), "a namespaced key is fine");
  await app.key("Escape");
}, { project, language, theme: (process.argv[3] ?? "dark") as "dark" | "light" });
