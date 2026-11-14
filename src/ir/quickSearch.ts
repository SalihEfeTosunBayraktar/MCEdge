/**
 * Quick open across the project (KUYRUK 136, audit P15): one search over elements, textures, sounds, models,
 * structures, lang keys, variables and tags. Pure (no Node imports), shared by the app's Ctrl+K dialog and the MCP
 * quick_search tool.
 */

export const QUICK_KINDS = ["element", "texture", "sound", "model", "structure", "langKey", "variable", "tag"] as const;
export type QuickKind = (typeof QUICK_KINDS)[number];

export interface QuickItem {
  kind: QuickKind;
  /** What opens it: "item/ruby", "textures/ruby.png", "sounds/ding.ogg", a lang key, a variable name, "item:mymod:gems". */
  target: string;
  /** Shown name: element display name, file name, lang key, variable name, tag id. */
  label: string;
  /** A second line: element type and id, the folder, a lang key's text, a variable's type and scope, a tag's type. */
  detail: string;
}

export interface QuickHit extends QuickItem {
  score: number;
}

export interface QuickInput {
  elements: { typeId: string; id: string; name: string; typeName: string }[];
  textures: string[];
  sounds: string[];
  models: string[];
  structures: string[];
  /** Lang keys with their text in the language to show (the first language that has one). */
  langKeys: { key: string; text: string }[];
  variables: { name: string; type: string; scope: string }[];
  tags: { type: string; id: string }[];
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Every searchable item of a project. */
export function quickItems(input: QuickInput): QuickItem[] {
  const files = (kind: QuickKind, paths: string[]) => paths.map((path) => ({ kind, target: path, label: fileName(path), detail: path }));
  return [
    ...input.elements.map((e) => ({ kind: "element" as const, target: `${e.typeId}/${e.id}`, label: e.name, detail: `${e.typeName} · ${e.id}` })),
    ...files("texture", input.textures),
    ...files("sound", input.sounds),
    ...files("model", input.models),
    ...files("structure", input.structures),
    ...input.langKeys.map((k) => ({ kind: "langKey" as const, target: k.key, label: k.key, detail: k.text })),
    ...input.variables.map((v) => ({ kind: "variable" as const, target: v.name, label: v.name, detail: `${v.type} · ${v.scope}` })),
    ...input.tags.map((t) => ({ kind: "tag" as const, target: `${t.type}:${t.id}`, label: t.id, detail: t.type })),
  ];
}

/**
 * How well `text` matches `query` (both lower case): 100 equal, 80 starts with it, 60 a word starts with it, 40
 * contains it, 20 holds its letters in order; 0 no match.
 */
export function matchScore(text: string, query: string): number {
  if (!query) return 1;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  const at = text.indexOf(query);
  if (at > 0 && /[^a-z0-9]/.test(text[at - 1])) return 60;
  if (at >= 0) return 40;
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length && query.length > 2 ? 20 : 0;
}

/**
 * The items matching `query`, best first: the label counts fully, the target and detail a little less; ties keep
 * the kind order (elements first) and then the label.
 */
export function quickSearch(items: QuickItem[], query: string, limit = 50): QuickHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: QuickHit[] = [];
  for (const item of items) {
    const score = Math.max(matchScore(item.label.toLowerCase(), q), matchScore(item.target.toLowerCase(), q) - 5, matchScore(item.detail.toLowerCase(), q) - 15);
    if (score > 0) hits.push({ ...item, score });
  }
  hits.sort((a, b) => b.score - a.score || QUICK_KINDS.indexOf(a.kind) - QUICK_KINDS.indexOf(b.kind) || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
}
