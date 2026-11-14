// Checks the translation helpers (src/ir/localization.ts) the Localization screen and the MCP tools share.
// usage: node tools/codegen-test/localization-check.ts
import assert from "node:assert/strict";
import { addLanguage, keyMatches, keyProblem, removeLanguage, renameLanguage, placeholderMismatch, placeholders, translationTable } from "../../src/ir/localization.ts";

// Placeholders: %s and %d read the next argument, %1$s names one, %% is a literal percent sign.
assert.deepEqual(placeholders("Shop: %s coins, %d left, 100%%").map((p) => p.arg), ["1$s", "2$d"]);
assert.deepEqual(placeholders("%2$s by %1$s").map((p) => p.arg), ["2$s", "1$s"]);
assert.deepEqual(placeholderMismatch("Shop: %s", "Dükkan"), { missing: ["%s"], extra: [] });
assert.deepEqual(placeholderMismatch("Shop", "Dükkan %d"), { missing: [], extra: ["%d"] });
// Reordered arguments are fine when they name the same ones.
assert.deepEqual(placeholderMismatch("%s by %s", "%2$s, %1$s"), { missing: [], extra: [] });
// An empty translation is missing, not mismatched.
assert.deepEqual(placeholderMismatch("Shop: %s", ""), { missing: [], extra: [] });

// The key table: element names fill en_us; filters per language.
const table = translationTable(
  { en_us: { "gui.m.shop": "Shop: %s", "gui.m.empty": "" }, tr_tr: { "gui.m.shop": "Dükkan", "item.m.ruby": "Yakut" } },
  { "item.m.ruby": { key: "item.m.ruby", typeId: "item", id: "ruby", text: "Ruby" }, "item.m.gem": { key: "item.m.gem", typeId: "item", id: "gem", text: "Gem" } },
);
const rows = (filter: Parameters<typeof keyMatches>[2]) => table.keys.filter((k) => keyMatches(table, k, filter));
assert.deepEqual(table.languages, ["en_us", "tr_tr"]);
assert.equal(table.shown("en_us", "item.m.ruby"), "Ruby");
assert.deepEqual(rows("missing:tr_tr"), ["gui.m.empty", "item.m.gem"]);
assert.deepEqual(rows("sourceEmpty"), ["gui.m.empty"]);
assert.deepEqual(rows("placeholder"), ["gui.m.shop"]);
assert.deepEqual(rows("edited"), ["gui.m.shop", "item.m.ruby"]);
assert.deepEqual(rows("elements"), ["item.m.gem", "item.m.ruby"]);

// New keys: lower case dot-separated parts; a missing mod id part is only a warning.
assert.equal(keyProblem("AdminBookSalary", "etreco"), "format");
assert.equal(keyProblem("gui.Etreco.x", "etreco"), "format");
assert.equal(keyProblem("gui.other.title", "etreco"), "namespace");
assert.equal(keyProblem("gui.etreco.shop.title", "etreco"), undefined);

// Languages: add (empty or copied; en_us copies include element names), rename, remove; en_us is fixed.
const loc = { en_us: { "gui.m.shop": "Shop" }, tr_tr: { "gui.m.shop": "Dükkan" } };
const names = { "item.m.ruby": { key: "item.m.ruby", typeId: "item", id: "ruby", text: "Ruby" } };
assert.deepEqual(addLanguage(loc, "de_de", undefined, names).de_de, {});
assert.deepEqual(addLanguage(loc, "de_de", "en_us", names).de_de, { "item.m.ruby": "Ruby", "gui.m.shop": "Shop" });
assert.deepEqual(addLanguage(loc, "de_de", "tr_tr", names).de_de, { "gui.m.shop": "Dükkan" });
assert.throws(() => addLanguage(loc, "tr_tr", undefined, names));
assert.throws(() => addLanguage(loc, "Turkish", undefined, names));
assert.deepEqual(Object.keys(renameLanguage(loc, "tr_tr", "tr_cy")), ["en_us", "tr_cy"]);
assert.throws(() => renameLanguage(loc, "en_us", "en_gb"));
assert.throws(() => renameLanguage(loc, "tr_tr", "en_us"));
assert.deepEqual(Object.keys(removeLanguage(loc, "tr_tr")), ["en_us"]);
assert.throws(() => removeLanguage(loc, "en_us"));
console.log("PASS");

// ---- import / export (src/ir/localizationIO.ts) ----
{
  const io = await import("../../src/ir/localizationIO.ts");
  const loc = { en_us: { "gui.m.shop": "Shop: %s, \"best\"", "gui.m.multi": "line 1\nline 2" }, tr_tr: { "gui.m.shop": "Dükkan, %s" } };
  const names = { "item.m.ruby": { key: "item.m.ruby", typeId: "item", id: "ruby", text: "Ruby" } };
  const table = translationTable(loc, names);
  const csv = io.exportCsv(table, table.keys, table.languages);
  assert.ok(csv.startsWith("\uFEFFkey,en_us,tr_tr\r\n"));
  const back = io.csvTranslations(csv);
  assert.equal(back.en_us["gui.m.shop"], 'Shop: %s, "best"');
  assert.equal(back.en_us["gui.m.multi"], "line 1\nline 2");
  assert.equal(back.tr_tr["item.m.ruby"], undefined, "empty cells are not read");
  // A round trip changes nothing: element names in en_us count as unchanged.
  const plan = io.planImport(table, back);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(io.applyImport(loc, table, back, true), loc);
  // Changes, additions, unknown keys and new languages.
  const incoming = { tr_tr: { "gui.m.shop": "Mağaza, %s", "item.m.ruby": "Yakut", "gui.m.new": "Yeni" }, de_de: { "gui.m.shop": "Laden" } };
  const p2 = io.planImport(table, incoming);
  assert.deepEqual(p2.languages.map((l) => [l.code, l.isNew, l.added, l.changed, l.unchanged]), [["tr_tr", false, 1, 1, 0], ["de_de", true, 1, 0, 0]]);
  assert.deepEqual(p2.unknownKeys, ["gui.m.new"]);
  const applied = io.applyImport(loc, table, incoming, false);
  assert.deepEqual(Object.keys(applied.tr_tr), ["gui.m.shop", "item.m.ruby"], "order kept, new key last, unknown left out");
  assert.equal(applied.de_de["gui.m.shop"], "Laden");
  assert.equal(io.applyImport(loc, table, incoming, true).tr_tr["gui.m.new"], "Yeni");
  // Lang JSON.
  assert.equal(io.exportLangJson(table, table.keys, "en_us"), JSON.stringify({ "gui.m.multi": "line 1\nline 2", "gui.m.shop": 'Shop: %s, "best"', "item.m.ruby": "Ruby" }, null, 2) + "\n");
  assert.deepEqual(io.jsonTranslations('{"a.b":"x","c.d":""}', "tr_tr"), { tr_tr: { "a.b": "x" } });
  assert.throws(() => io.jsonTranslations('{"a.b":1}', "tr_tr"));
  assert.throws(() => io.csvTranslations("id,en_us\nx,y"));
  assert.equal(io.languageOfFile("C:/x/tr_tr.json"), "tr_tr");
  console.log("PASS io");
}
