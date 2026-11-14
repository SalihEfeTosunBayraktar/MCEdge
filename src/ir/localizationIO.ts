/**
 * Translations in and out of the project: CSV (one row per key, one column per language, for spreadsheets and
 * translators) and Minecraft lang JSON (one language). Imports are planned first (added, changed, unchanged, unknown
 * keys) and applied only on request; an empty cell never clears a text.
 */
import { LANGUAGE_CODE } from "./languages.ts";
import { BASE_LANGUAGE, type TranslationTable } from "./localization.ts";
import type { ModProject } from "./types.ts";

type Localization = ModProject["localization"];
/** Texts read from a file: language -> key -> text. */
export type Incoming = Record<string, Record<string, string>>;

const BOM = "﻿";
const quote = (value: string) => (/[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * CSV of the keys in the given languages: "key,en_us,tr_tr", UTF-8 with a byte order mark (spreadsheets read it as
 * UTF-8) and CRLF line ends. en_us holds what the game shows, so element names are in it.
 */
export function exportCsv(table: TranslationTable, keys: readonly string[], languages: readonly string[]): string {
  const lines = [["key", ...languages], ...keys.map((key) => [key, ...languages.map((l) => table.shown(l, key))])];
  return BOM + lines.map((cells) => cells.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"', i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

/** Texts of a CSV export: the header names the languages ("key" first). */
export function csvTranslations(text: string): Incoming {
  const [header, ...rows] = parseCsv(text);
  if (!header || header[0].trim().toLowerCase() !== "key") throw new Error('the first column must be "key"');
  const languages = header.slice(1).map((h) => h.trim().toLowerCase());
  const bad = languages.filter((l) => !LANGUAGE_CODE.test(l));
  if (bad.length) throw new Error(`not language codes: ${bad.join(", ")}`);
  const out: Incoming = Object.fromEntries(languages.map((l) => [l, {}]));
  for (const row of rows) {
    const key = row[0]?.trim();
    if (!key) continue;
    languages.forEach((l, i) => {
      const value = row[i + 1] ?? "";
      if (value) out[l][key] = value;
    });
  }
  return out;
}

/** One language as a Minecraft lang file; en_us includes the element names, like the generated file. */
export function exportLangJson(table: TranslationTable, keys: readonly string[], language: string): string {
  return JSON.stringify(Object.fromEntries(keys.flatMap((key) => (table.shown(language, key) ? [[key, table.shown(language, key)]] : []))), null, 2) + "\n";
}

/** Texts of a lang JSON file for `language`; values that are not text are refused. */
export function jsonTranslations(text: string, language: string): Incoming {
  if (!LANGUAGE_CODE.test(language)) throw new Error(`"${language}" is not a language code like tr_tr`);
  const data = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("a lang file is one JSON object of key: text");
  const entries = Object.entries(data as Record<string, unknown>);
  const notText = entries.filter(([, v]) => typeof v !== "string").map(([k]) => k);
  if (notText.length) throw new Error(`values that are not text: ${notText.slice(0, 5).join(", ")}`);
  return { [language]: Object.fromEntries(entries.filter(([, v]) => v !== "")) as Record<string, string> };
}

/** The language of a lang file name ("tr_tr.json"), if it is one. */
export function languageOfFile(name: string): string | undefined {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.json$/i, "").toLowerCase();
  return LANGUAGE_CODE.test(base) ? base : undefined;
}

export interface ImportChange { key: string; language: string; from: string; to: string; kind: "added" | "changed" | "unknown" }
export interface ImportPlan {
  languages: { code: string; isNew: boolean; added: number; changed: number; unchanged: number }[];
  /** Keys the project does not have. */
  unknownKeys: string[];
  /** Every text that would be written, unknown keys included. */
  changes: ImportChange[];
}

/** What an import would do, cell by cell: same text (or the inherited element name) is unchanged. */
export function planImport(table: TranslationTable, incoming: Incoming): ImportPlan {
  const known = new Set(table.keys);
  const unknown = new Set<string>();
  const changes: ImportChange[] = [];
  const languages = Object.entries(incoming).map(([code, entries]) => {
    const counts = { code, isNew: !table.languages.includes(code), added: 0, changed: 0, unchanged: 0 };
    for (const [key, to] of Object.entries(entries)) {
      const from = table.shown(code, key);
      if (!known.has(key)) {
        unknown.add(key);
        changes.push({ key, language: code, from: "", to, kind: "unknown" });
      } else if (from === to) counts.unchanged++;
      else {
        counts[from ? "changed" : "added"]++;
        changes.push({ key, language: code, from, to, kind: from ? "changed" : "added" });
      }
    }
    return counts;
  });
  return { languages, unknownKeys: [...unknown], changes };
}

/**
 * The project's translations after an import: changed and added texts are written (new keys go last, existing ones
 * keep their place: KUYRUK 107), new languages are added, unknown keys only with `addUnknown`.
 */
export function applyImport(localization: Localization, table: TranslationTable, incoming: Incoming, addUnknown: boolean): Localization {
  const next: Localization = { ...localization };
  const copied = new Set<string>();
  for (const change of planImport(table, incoming).changes) {
    if (change.kind === "unknown" && !addUnknown) continue;
    if (!copied.has(change.language)) (copied.add(change.language), (next[change.language] = { ...(next[change.language] ?? {}) }));
    next[change.language][change.key] = change.to;
  }
  for (const code of Object.keys(incoming)) if (code !== BASE_LANGUAGE) next[code] ??= {};
  return next;
}
