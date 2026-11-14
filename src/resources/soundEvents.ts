import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_LANGUAGE } from "../ir/localization.ts";
import { loadProject, saveLocalization } from "../ir/storage.ts";
import type { ProjectIssue } from "../elements/model.ts";
import { DEFAULT_CATEGORY, SOUND_CATEGORIES, SOUND_EVENTS_FILE, subtitleKey, type SoundEvent } from "./soundEventTypes.ts";
export { DEFAULT_CATEGORY, SOUND_CATEGORIES, SOUND_EVENTS_FILE, subtitleKey, type SoundEvent };

/**
 * Sound events (KUYRUK 132): what elements and procedures play ("<modid>:<event>"). Every sounds/<name>.ogg is an event
 * of its own name until sound_events.json says otherwise; an event listed there has a category, a subtitle and one or
 * more files the game picks from at random. A file another event lists is no event by itself. The subtitle is a
 * lang key, "subtitles.<modid>.<event>", whose text lives in localization/ like every translation, so it is
 * translated in the Localization section.
 *
 *   sound_events.json   { "<event>": { "category": "block", "subtitle": true, "files": ["ding", "ding_2"] } }
 */

const NAME = /^[a-z0-9_]+$/;

interface StoredEvent { category?: string; subtitle?: boolean; files?: string[] }

const file = (dir: string) => join(dir, SOUND_EVENTS_FILE);

function readStored(dir: string): Record<string, StoredEvent> {
  if (!existsSync(file(dir))) return {};
  const value: unknown = JSON.parse(readFileSync(file(dir), "utf8"));
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, StoredEvent>) : {};
}


/** The project's sound events: the listed ones, then one per sound file no event lists. Sorted by name. */
export function soundEvents(dir: string, modId: string, soundFiles: string[]): SoundEvent[] {
  const stored = readStored(dir);
  const events: SoundEvent[] = Object.entries(stored).map(([name, e]) => ({
    name, category: e.category ?? DEFAULT_CATEGORY, files: Array.isArray(e.files) && e.files.length ? e.files.map(String) : [name],
    subtitleKey: e.subtitle ? subtitleKey(modId, name) : "", defined: true,
  }));
  const used = new Set(events.flatMap((e) => [e.name, ...e.files]));
  for (const name of soundFiles) if (!used.has(name)) events.push({ name, category: DEFAULT_CATEGORY, files: [name], subtitleKey: "", defined: false });
  return events.sort((a, b) => a.name.localeCompare(b.name));
}

/** Sound files of a project folder: names of sounds/<name>.ogg with a valid name. */
export function projectSoundFiles(dir: string): string[] {
  const folder = join(dir, "sounds");
  return existsSync(folder) ? soundFileNames(readdirSync(folder)) : [];
}

/** Sound file names of the project (sounds/<name>.ogg with a valid name). */
export function soundFileNames(paths: string[]): string[] {
  return paths.filter((p) => p.endsWith(".ogg")).map((p) => p.slice(p.lastIndexOf("/") + 1).slice(0, -4)).filter((n) => NAME.test(n)).sort();
}

/** Problems of the listed events: names, categories, files that are not in sounds/. */
export function soundEventProblems(events: SoundEvent[], soundFiles: string[]): Omit<ProjectIssue, "path">[] {
  const problems: Omit<ProjectIssue, "path">[] = [];
  for (const e of events.filter((x) => x.defined)) {
    if (!NAME.test(e.name)) problems.push({ message: `sound event "${e.name}": use lowercase letters, digits and _`, code: "soundEventName", values: { name: e.name } });
    if (!(SOUND_CATEGORIES as readonly string[]).includes(e.category)) problems.push({ message: `sound event "${e.name}": unknown category "${e.category}"`, code: "soundCategory", values: { name: e.name, value: e.category } });
    for (const f of e.files) if (!soundFiles.includes(f)) problems.push({ message: `sound event "${e.name}": no sound file sounds/${f}.ogg`, code: "soundFile", values: { name: e.name, file: f } });
  }
  return problems;
}

export interface SoundEventChange {
  name: string;
  category: string;
  files: string[];
  /** Subtitle text in the base language; "" removes the subtitle. */
  subtitle: string;
}

/**
 * Writes one event (renamed from `previous` when given). Its subtitle text goes to the base language's localization
 * under the event's subtitle key; a removed subtitle or a renamed event drops its old key there.
 */
export function saveSoundEvent(dir: string, change: SoundEventChange, previous?: string): void {
  if (!NAME.test(change.name)) throw new Error(`sound event "${change.name}": use lowercase letters, digits and _`);
  if (!(SOUND_CATEGORIES as readonly string[]).includes(change.category)) throw new Error(`unknown category "${change.category}"`);
  const files = [...new Set(change.files.filter(Boolean))];
  if (!files.length) throw new Error(`sound event "${change.name}" needs at least one sound file`);
  for (const f of files) if (!existsSync(join(dir, "sounds", `${f}.ogg`))) throw new Error(`no sound file sounds/${f}.ogg`);
  const stored = readStored(dir);
  if (previous !== change.name && change.name in stored) throw new Error(`sound event "${change.name}" already exists`);
  if (previous && previous !== change.name) delete stored[previous];
  const subtitle = change.subtitle.trim();
  stored[change.name] = { category: change.category, ...(subtitle ? { subtitle: true } : {}), files };
  writeFileSync(file(dir), JSON.stringify(Object.fromEntries(Object.entries(stored).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
  const project = loadProject(dir);
  const localization = structuredClone(project.localization);
  const base = (localization[BASE_LANGUAGE] ??= {});
  const key = subtitleKey(project.mod.id, change.name);
  if (previous && previous !== change.name) {
    // The translations of a renamed event's subtitle move with it.
    const old = subtitleKey(project.mod.id, previous);
    for (const entries of Object.values(localization)) if (old in entries) (subtitle && !(key in entries) && (entries[key] = entries[old]), delete entries[old]);
  }
  if (subtitle) base[key] = subtitle;
  else for (const entries of Object.values(localization)) delete entries[key];
  saveLocalization(dir, localization);
}

/** Removes an event from sound_events.json (its files stay; each becomes an event of its own name again) and its subtitle. */
export function deleteSoundEvent(dir: string, name: string): void {
  const stored = readStored(dir);
  if (!(name in stored)) throw new Error(`no listed sound event "${name}"`);
  delete stored[name];
  writeFileSync(file(dir), JSON.stringify(stored, null, 2) + "\n");
  const project = loadProject(dir);
  const localization = structuredClone(project.localization);
  const key = subtitleKey(project.mod.id, name);
  for (const entries of Object.values(localization)) delete entries[key];
  saveLocalization(dir, localization);
}
