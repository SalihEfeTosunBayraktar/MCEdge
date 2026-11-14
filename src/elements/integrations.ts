import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../paths.ts";
import type { ElementType, GroupDef } from "./model.ts";

/**
 * Optional mod integrations (KUYRUK 101), one data file each in config/integrations/<id>.json. A project turns one on
 * in its mod settings (`mod.integrations`); the generator then adds the other mod as an optional or required
 * dependency (Gradle and mod metadata, per engine) and the integration's code, and its element fields show in the
 * editor. A new integration is a new file: its engines (the mod, the Gradle lines and repositories) and its fields by
 * element type; only code generation needs a module (src/generator/integrations/).
 */
export interface IntegrationEngine {
  /** Name of the mod on this engine, for people: "JEI", "REI". */
  mod: string;
  modId: string;
  /** Version in the Dependency syntax: "*", "1.2.0" or ">=1.2.0". */
  version: string;
  /** Maven repositories the Gradle lines need. */
  repositories: string[];
  /** Lines for the build.gradle dependencies block, as written. */
  gradle: string[];
}

export interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  /** Turkish name and description. */
  tr?: { name: string; description: string };
  /** Engines it is available on, by engine id. */
  engines: Record<string, IntegrationEngine>;
  /** Fields it adds, a group per element type id. */
  groups: Record<string, GroupDef>;
}

/** The page integration groups are added on. */
export const INTEGRATION_PAGE = "integrations";

export const INTEGRATIONS_DIR = join(ROOT, "config", "integrations");

export function loadIntegrations(dir: string = INTEGRATIONS_DIR): { integrations: IntegrationDef[]; problems: string[] } {
  const integrations: IntegrationDef[] = [];
  const problems: string[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : []) {
    try {
      const def = JSON.parse(readFileSync(join(dir, name), "utf8")) as IntegrationDef;
      if (def.id !== name.slice(0, -5)) problems.push(`integration ${name}: id "${def.id}" does not match the file`);
      else if (!def.engines || !def.groups) problems.push(`integration ${name}: engines and groups are required`);
      else integrations.push(def);
    } catch (error) {
      problems.push(`integration ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { integrations, problems };
}

/** What the app and agents show of an integration: name and description in a language, the other mod per engine. */
export interface IntegrationInfo {
  id: string;
  name: string;
  description: string;
  /** "JEI", "REI" by engine id; an engine missing here does not offer the integration. */
  engines: Record<string, string>;
}

export function integrationInfo(def: IntegrationDef, language = "en"): IntegrationInfo {
  const tr = language.startsWith("tr") ? def.tr : undefined;
  return { id: def.id, name: tr?.name ?? def.name, description: tr?.description ?? def.description, engines: Object.fromEntries(Object.entries(def.engines).map(([e, on]) => [e, on.mod])) };
}

/** Types with each integration's group added on an Integrations page, the group marked with the integration's id. */
export function withIntegrationGroups(types: ElementType[], integrations: IntegrationDef[]): ElementType[] {
  return types.map((type) => {
    const groups = integrations.filter((i) => i.groups[type.id]).map((i): GroupDef => ({ ...i.groups[type.id], integration: i.id }));
    if (!groups.length) return type;
    return { ...type, pages: [...type.pages, { id: INTEGRATION_PAGE, title: "Integrations", groups }] };
  });
}
