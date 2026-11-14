/**
 * Translation helpers shared by the Localization screen and the MCP tools: the key table (typed translations plus the
 * keys elements create), key filters, placeholder checks and key validation.
 */
import { displayName, nameLangKey, type ElementType } from "../elements/model.ts";
import { LANGUAGE_CODE } from "./languages.ts";
import type { ModProject } from "./types.ts";

type Localization = ModProject["localization"];

/** Language that always exists; element names fill it when no translation overrides them. */
export const BASE_LANGUAGE = "en_us";

/** Java format specifiers Minecraft fills in lang texts: %s, %d, %1$s. "%%" is a literal percent sign. */
const PLACEHOLDER = /%(?:(\d+)\$)?([sd%])/g;

/** The placeholders of a text, each with the argument it reads ("1$s"), in text order. */
export function placeholders(text: string): { arg: string; raw: string }[] {
  const out: { arg: string; raw: string }[] = [];
  let next = 1;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m[2] === "%") continue;
    out.push({ arg: `${m[1] ? Number(m[1]) : next++}$${m[2]}`, raw: m[0] });
  }
  return out;
}

/**
 * Placeholders the translation lacks (written as in the source) and ones it has that the source does not. An empty
 * translation is not checked: it is missing, not mismatched.
 */
export function placeholderMismatch(source: string, translation: string): { missing: string[]; extra: string[] } {
  if (!source || !translation) return { missing: [], extra: [] };
  const a = placeholders(source);
  const b = placeholders(translation);
  const left = [...b];
  const missing: string[] = [];
  for (const p of a) {
    const i = left.findIndex((q) => q.arg === p.arg);
    if (i < 0) missing.push(p.raw);
    else left.splice(i, 1);
  }
  return { missing, extra: left.map((q) => q.raw) };
}

/** A lang key an element's display name creates, the name it gets and the element. */
export interface ElementKey { key: string; typeId: string; id: string; text: string }

/** Element name keys of a project ("item.mymod.ruby" -> "Ruby"), as the generator writes them into en_us. */
export function elementNameKeys(project: Pick<ModProject, "mod" | "elements">, typeOf: (id: string) => ElementType | undefined): Record<string, ElementKey> {
  const out: Record<string, ElementKey> = {};
  for (const [typeId, elements] of Object.entries(project.elements)) {
    const type = typeOf(typeId);
    for (const element of elements) {
      const key = nameLangKey(type, project.mod.id, element);
      if (key) out[key] = { key, typeId, id: element.id, text: displayName(type, element) };
    }
  }
  return out;
}

/** Translations plus the keys elements create: what the Localization screen and the MCP key listing show. */
export interface TranslationTable {
  /** en_us first, then the other codes in order. */
  languages: string[];
  /** Every key, sorted. */
  keys: string[];
  /** Text typed in the project for the key (empty when none). */
  text(lang: string, key: string): string;
  /** What the game shows: typed text, or the element's name in en_us. */
  shown(lang: string, key: string): string;
  element(key: string): ElementKey | undefined;
}

export function translationTable(localization: Localization, elementKeys: Record<string, ElementKey>): TranslationTable {
  const languages = [BASE_LANGUAGE, ...Object.keys(localization).filter((l) => l !== BASE_LANGUAGE).sort()];
  const keys = [...new Set([...Object.keys(elementKeys), ...Object.values(localization).flatMap(Object.keys)])].sort();
  const text = (l: string, key: string) => localization[l]?.[key] ?? "";
  return {
    languages,
    keys,
    text,
    shown: (l, key) => text(l, key) || (l === BASE_LANGUAGE ? elementKeys[key]?.text ?? "" : ""),
    element: (key) => elementKeys[key],
  };
}

/**
 * Key filters of the Show menu and of list_translation_keys: "missing:<lang>" (no text in that language), "missingAny",
 * "sourceEmpty" (no en_us text), "placeholder" (a translation's %s/%d do not match en_us), "edited" (text typed in the
 * project in any language, so element keys whose name was overridden or translated) and "elements" (keys elements create).
 */
export type KeyFilter = "all" | "missingAny" | "sourceEmpty" | "placeholder" | "edited" | "elements" | `missing:${string}`;

export function keyMatches(table: TranslationTable, key: string, filter: KeyFilter): boolean {
  const { languages, shown, text } = table;
  if (filter.startsWith("missing:")) return !shown(filter.slice("missing:".length), key);
  switch (filter) {
    case "missingAny": return languages.some((l) => !shown(l, key));
    case "sourceEmpty": return !shown(BASE_LANGUAGE, key);
    case "placeholder": return hasPlaceholderIssue(table, key);
    case "edited": return languages.some((l) => text(l, key));
    case "elements": return !!table.element(key);
    default: return true;
  }
}

/** Whether any translation of the key adds or lacks a placeholder of its en_us text. */
export function hasPlaceholderIssue(table: TranslationTable, key: string, lang?: string): boolean {
  const source = table.shown(BASE_LANGUAGE, key);
  return (lang ? [lang] : table.languages.filter((l) => l !== BASE_LANGUAGE)).some((l) => {
    const { missing, extra } = placeholderMismatch(source, table.shown(l, key));
    return missing.length + extra.length > 0;
  });
}

/** Whether a search matches the key or any of its texts (case-insensitive). */
export function keySearch(table: TranslationTable, key: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || key.toLowerCase().includes(q) || table.languages.some((l) => table.shown(l, key).toLowerCase().includes(q));
}

/** Lower case parts separated by dots: "gui.mymod.shop.title". */
const KEY_FORMAT = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

/**
 * Problem with a new key: "format" (not lower case dot-separated parts) blocks it; "namespace" (no part is the mod id,
 * so another mod's key can clash) is only a warning. Existing keys are never checked: imported mods keep theirs.
 */
export function keyProblem(key: string, modId: string): "format" | "namespace" | undefined {
  if (!KEY_FORMAT.test(key)) return "format";
  if (!key.split(".").includes(modId)) return "namespace";
  return undefined;
}

/**
 * Adds a language, optionally starting with another language's texts (en_us copies include the element names it
 * inherits, so the copy is complete). Throws for a bad or taken code.
 */
export function addLanguage(localization: Localization, code: string, copyFrom: string | undefined, elementKeys: Record<string, ElementKey>): Localization {
  if (!LANGUAGE_CODE.test(code)) throw new Error(`"${code}" is not a language code like tr_tr`);
  if (code === BASE_LANGUAGE || localization[code]) throw new Error(`${code} already exists`);
  if (copyFrom && copyFrom !== BASE_LANGUAGE && !localization[copyFrom]) throw new Error(`no language ${copyFrom}`);
  const source = copyFrom === BASE_LANGUAGE
    ? { ...Object.fromEntries(Object.values(elementKeys).map((e) => [e.key, e.text])), ...(localization[BASE_LANGUAGE] ?? {}) }
    : copyFrom ? localization[copyFrom] : {};
  return { ...localization, [code]: { ...source } };
}

/** Moves a language's texts to another code; en_us stays (the game falls back to it). */
export function renameLanguage(localization: Localization, from: string, to: string): Localization {
  if (from === BASE_LANGUAGE) throw new Error(`${BASE_LANGUAGE} cannot be renamed`);
  if (!localization[from]) throw new Error(`no language ${from}`);
  if (!LANGUAGE_CODE.test(to)) throw new Error(`"${to}" is not a language code like tr_tr`);
  if (to === BASE_LANGUAGE || localization[to]) throw new Error(`${to} already exists`);
  return Object.fromEntries(Object.entries(localization).map(([code, entries]) => [code === from ? to : code, entries]));
}

/** Drops a language and its texts; en_us stays. */
export function removeLanguage(localization: Localization, code: string): Localization {
  if (code === BASE_LANGUAGE) throw new Error(`${BASE_LANGUAGE} cannot be removed`);
  if (!localization[code]) throw new Error(`no language ${code}`);
  const { [code]: _, ...rest } = localization;
  return rest;
}
