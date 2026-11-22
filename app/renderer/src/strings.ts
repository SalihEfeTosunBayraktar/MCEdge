import en from "../../../config/ui-strings/en.json" with { type: "json" };

export type StringKey = keyof typeof en;
/** Catalog entry ids that have a "catalog.<id>" label. */
export type CatalogId = StringKey extends infer K ? (K extends `catalog.${infer I}` ? I : never) : never;

/**
 * UI languages: every file in config/ui-strings/ is one (the file name is the code, "language.name" its own name).
 * English is complete; other languages may leave keys out and fall back to it.
 */
const files = (import.meta as unknown as { glob(pattern: string, options: object): Record<string, Partial<Record<StringKey, string>>> }).glob("../../../config/ui-strings/*.json", { eager: true, import: "default" });
export const LANGUAGES: Record<string, { name: string; strings: Partial<Record<StringKey, string>> }> = { en: { name: "English", strings: en } };
for (const [path, strings] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  const code = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  if (code !== "en") LANGUAGES[code] = { name: strings["language.name"] || code, strings };
}

let current: Partial<Record<StringKey, string>> = en;
let currentCode = "en";

export function setLanguage(code: string): void {
  currentCode = LANGUAGES[code] ? code : "en";
  current = LANGUAGES[currentCode].strings;
  document.documentElement.lang = currentCode;
}

export const language = () => currentCode;

/** Looks up a UI string in the current language (English when missing) and fills {placeholders}. */
export function t(key: StringKey, values: Record<string, string | number> = {}): string {
  return (current[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}

/** A problem in the UI language: field checks carry a code (KUYRUK 149), other problems their own text. */
export function issueText(issue: { message: string; code?: string; values?: Record<string, string | number | undefined> }): string {
  if (!issue.code) return issue.message;
  const values = Object.fromEntries(Object.entries(issue.values ?? {}).map(([k, v]) => [k, v ?? ""]));
  if (typeof values.kind === "string") values.kind = t(`check.kind.${values.kind}` as StringKey);
  if (typeof values.tagType === "string") values.tagType = t(`tags.type.${values.tagType}` as StringKey);
  return t(`check.${issue.code}` as StringKey, values);
}
