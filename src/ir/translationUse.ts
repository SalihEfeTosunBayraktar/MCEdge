/**
 * Which translation keys the mod uses (Q222, Q220). Pure: the caller supplies the project and, for the keys the generator
 * writes besides the element names (GUI labels, tooltips, death messages...), what generatedLangKeys reports. A typed
 * key (text in a language file) is used when
 *
 *   - an element creates it: its display name key, a key the generator writes for it, or a key with "<mod id>.<element id>"
 *     as neighbouring segments ("item.mymod.ruby", "gui.mymod.shop.label_0"; rename_element moves keys by the same rule); a game
 *     rule's key is "gamerule.<mod>.<id>" on 26.x and "gamerule.<ruleName>" before, and both count, so no engine's text is reported;
 *   - an element names it as a string, as the key of a text_translate or translated message block does;
 *   - the engine needs it by name: a sound event's subtitle, a key binding category, or an override of a vanilla text
 *     ("item.minecraft.diamond").
 *
 * What a program builds from pieces ("shop." + name) is not seen, so a key used only that way is reported as unused.
 */
import { elementNameKeys, type ElementKey } from "./localization.ts";
import { checkIssue, type ElementType, type FieldIssue } from "../elements/model.ts";
import { ruleNameOf } from "./gameRules.ts";
import type { ModProject } from "./types.ts";

/** Element key ("item/ruby") -> the typed keys it uses; see keyUsers. */
export type KeyUsers = Map<string, Set<string>>;

const TOKEN = /[A-Za-z0-9_.:/-]+/g;

/** The strings inside any JSON value, depth first. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) yield* strings(item);
}

/** Keys of `keys` that appear in a string as a whole word of key characters ("shop.title", or inside a longer text). */
function mentioned(text: string, keys: ReadonlySet<string>): string[] {
  if (keys.has(text)) return [text];
  return (text.match(TOKEN) ?? []).filter((token) => keys.has(token));
}

/** Every typed key in the project's language files. */
export const typedKeys = (localization: ModProject["localization"]): Set<string> => new Set(Object.values(localization).flatMap(Object.keys));

/**
 * For each typed key, the elements ("type/id") that use it. A key no element uses is not in the map. `generated` is
 * what generatedLangKeys reports (may be left out: the name keys and the "<mod>.<id>" rule still apply).
 */
export function keyUsers(
  project: Pick<ModProject, "mod" | "elements" | "localization">,
  typeOf: (id: string) => ElementType | undefined,
  generated: Record<string, ElementKey> = {},
): KeyUsers {
  const keys = typedKeys(project.localization);
  const users: KeyUsers = new Map();
  const use = (key: string, element: string) => users.set(key, (users.get(key) ?? new Set()).add(element));
  const names = elementNameKeys(project, typeOf);
  for (const [key, e] of Object.entries({ ...names, ...generated })) if (keys.has(key)) use(key, `${e.typeId}/${e.id}`);
  const owners = new Map<string, string[]>();
  for (const [typeId, list] of Object.entries(project.elements)) for (const e of list) owners.set(e.id, [...(owners.get(e.id) ?? []), `${typeId}/${e.id}`]);
  for (const rule of project.elements.game_rule ?? []) {
    for (const key of [`gamerule.${ruleNameOf(rule)}`, `gamerule.${ruleNameOf(rule)}.description`]) if (keys.has(key)) use(key, `game_rule/${rule.id}`);
  }
  for (const key of keys) {
    const parts = key.split(".");
    for (let i = 0; i + 1 < parts.length; i++) if (parts[i] === project.mod.id) for (const owner of owners.get(parts[i + 1]) ?? []) use(key, owner);
  }
  for (const [typeId, list] of Object.entries(project.elements)) {
    for (const e of list) for (const text of strings(e)) for (const key of mentioned(text, keys)) use(key, `${typeId}/${e.id}`);
  }
  return users;
}

/** A key the engine looks up by name although no element is behind it. */
export function engineKept(key: string, subtitleKeys: readonly string[]): boolean {
  return subtitleKeys.includes(key) || key.startsWith("key.categories.") || key.split(".").includes("minecraft");
}

export interface UnusedTranslations {
  /** Language code -> its unused keys with their texts, sorted. */
  languages: Record<string, { key: string; text: string }[]>;
  /** Distinct unused keys over all languages. */
  keys: number;
}

/** Typed keys no element uses and the engine does not need by name, per language that has text for them. */
export function unusedTranslations(
  project: Pick<ModProject, "mod" | "elements" | "localization">,
  typeOf: (id: string) => ElementType | undefined,
  generated: Record<string, ElementKey>,
  subtitleKeys: readonly string[],
): UnusedTranslations {
  const users = keyUsers(project, typeOf, generated);
  const languages: UnusedTranslations["languages"] = {};
  const distinct = new Set<string>();
  for (const [language, entries] of Object.entries(project.localization)) {
    const unused = Object.keys(entries).filter((key) => !users.has(key) && !engineKept(key, subtitleKeys)).sort();
    if (!unused.length) continue;
    languages[language] = unused.map((key) => ({ key, text: entries[key] }));
    unused.forEach((key) => distinct.add(key));
  }
  return { languages, keys: distinct.size };
}

/** The language files without these keys (`only` limits it to some languages); empty languages stay as they are. */
export function withoutKeys(localization: ModProject["localization"], keys: ReadonlySet<string>, only?: readonly string[]): ModProject["localization"] {
  return Object.fromEntries(Object.entries(localization).map(([language, entries]) => [
    language,
    only && !only.includes(language) ? entries : Object.fromEntries(Object.entries(entries).filter(([key]) => !keys.has(key))),
  ]));
}

/** The Problems entries of a report: one per language, at "localization.<lang>", with the first keys as an example. */
export function unusedIssues(unused: UnusedTranslations): FieldIssue[] {
  return Object.entries(unused.languages).map(([language, rows]) =>
    checkIssue(`localization.${language}`, "unusedTranslation", { count: rows.length, keys: rows.slice(0, 3).map((r) => r.key).join(", ") + (rows.length > 3 ? ", ..." : "") }));
}
