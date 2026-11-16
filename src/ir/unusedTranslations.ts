/**
 * The unused-translation report of a project folder (Q222), shared by the MCP tool and the app: reads the project, asks the
 * generator of one engine for the keys it writes, and applies the rules of src/ir/translationUse.ts.
 */
import { typeRegistry } from "../elements/registry.ts";
import { listEngines, type Engine } from "../engines/registry.ts";
import { generatedLangKeys } from "../generator/langKeys.ts";
import { projectSoundFiles, soundEvents } from "../resources/soundEvents.ts";
import { loadProject, saveLocalization } from "./storage.ts";
import { unusedTranslations, withoutKeys, type UnusedTranslations } from "./translationUse.ts";

export function projectUnusedTranslations(dir: string, engine: Engine = listEngines()[0]): UnusedTranslations {
  const project = loadProject(dir);
  const subtitleKeys = soundEvents(dir, project.mod.id, projectSoundFiles(dir)).map((e) => e.subtitleKey).filter(Boolean);
  return unusedTranslations(project, (id) => typeRegistry().byId.get(id), generatedLangKeys(project, dir, engine), subtitleKeys);
}

/** Removes the unused keys from the language files (`languages` limits it); returns how many were removed per language. */
export function removeUnusedTranslations(dir: string, engine?: Engine, languages?: readonly string[]): Record<string, number> {
  const report = projectUnusedTranslations(dir, engine);
  const removed = Object.fromEntries(Object.entries(report.languages).filter(([language]) => !languages || languages.includes(language)).map(([language, rows]) => [language, rows.length]));
  if (!Object.keys(removed).length) return removed;
  const project = loadProject(dir);
  let next = project.localization;
  for (const language of Object.keys(removed)) next = withoutKeys(next, new Set(report.languages[language].map((r) => r.key)), [language]);
  saveLocalization(dir, next);
  return removed;
}
