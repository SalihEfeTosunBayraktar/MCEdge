import { displayNameField, nameLangKey } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import type { Engine } from "../engines/registry.ts";
import type { ElementKey } from "../ir/localization.ts";
import type { ModProject } from "../ir/types.ts";
import { generatedElements, genEnv } from "./generate.ts";
import { TYPE_MODULES } from "./typeModule.ts";

/**
 * Every en_us text the generator writes for the project's elements on this engine, with the element that writes it:
 * display names, and what the type modules add (GUI titles and labels, tooltips, advancement texts, subtitles, music
 * disc descriptions, spawn eggs...). Runs the element modules the way a build does and writes nothing (KUYRUK 117).
 * An element whose module fails here is left out; the build reports it.
 */
export function generatedLangKeys(project: ModProject, projectDir: string, engine: Engine): Record<string, ElementKey> {
  const { generated } = generatedElements(project, engine);
  const env = genEnv(project, projectDir, engine, generated);
  const registry = typeRegistry();
  const out: Record<string, ElementKey> = {};
  for (const [typeId, elements] of Object.entries(generated)) {
    const type = registry.byId.get(typeId);
    const field = displayNameField(type);
    const own = TYPE_MODULES.get(typeId)!;
    const module = own.renderAs ? TYPE_MODULES.get(own.renderAs.type)! : own;
    for (const element of elements) {
      const name = nameLangKey(type, project.mod.id, element);
      if (name && field) out[name] = { key: name, typeId, id: element.id, text: String(element[field.key]) };
      try {
        const lang = module.element(own.renderAs ? own.renderAs.element(element, env) : element, env).lang ?? {};
        for (const [key, text] of Object.entries(lang)) out[key] = { key, typeId, id: element.id, text: String(text) };
      } catch {
        // left to the build to report
      }
    }
  }
  return out;
}
