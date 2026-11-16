import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { elementIdLookup, validateElement, type CheckCode, type CheckValues, type ValidationContext } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { loadIntegrations } from "../elements/integrations.ts";
import { listEngines } from "../engines/registry.ts";
import { gameRuleIssues } from "./gameRules.ts";
import { translatedStoreIssues } from "./translatedStores.ts";
import type { Severity } from "./problems.ts";
import { registryIdIssues } from "./registryIds.ts";
import { projectSoundFiles, SOUND_EVENTS_FILE, soundEventProblems, soundEvents } from "../resources/soundEvents.ts";
import { VARIABLE_SCOPES, VARIABLE_TYPES, type ModProject } from "./types.ts";

const RESOURCE_ID = /^[a-z][a-z0-9_]*$/;
const JAVA_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const MOD_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const DEPENDENCY_VERSION = /^(\*|>=?\s*[\w.+-]+|[\w.+-]+)$/;
const JAVA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LANG_CODE = /^[a-z]{2,3}_[a-z]{2,3}$/;

/** Issue path prefix of an element: "item/ruby"; field paths follow after a dot. */
export const elementPath = (typeId: string, id: string) => `${typeId}/${id}`;

export interface ValidationIssue {
  path: string;
  message: string;
  /** A field check (src/elements/model.ts): the app shows it in its own language (KUYRUK 149). */
  code?: CheckCode;
  values?: CheckValues;
  /** Set by classify (src/ir/problems.ts) where the project's problems.json applies. */
  severity?: Severity;
}

/** Checks the rules every target generator relies on; returns all issues instead of throwing. */
export function validateProject(project: ModProject, projectDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // The English message is what MCP and the CLI show; the code and values let the app show it in its language (KUYRUK 157).
  const check = (ok: boolean, path: string, message: string, code?: CheckCode, values?: CheckValues) => {
    if (!ok) issues.push({ path, message, ...(code ? { code, ...(values ? { values } : {}) } : {}) });
  };

  check(project.schemaVersion === 2, "schemaVersion", "unsupported schema version", "schemaVersion");
  check(RESOURCE_ID.test(project.mod.id), "mod.id", "must be lowercase snake_case", "snakeCase");
  check(JAVA_PACKAGE.test(project.mod.package), "mod.package", "must be a lowercase Java package", "javaPackage");
  const knownEngines = new Set(listEngines().map((e) => e.id));
  for (const engine of project.mod.engines ?? []) check(knownEngines.has(engine), "mod.engines", `unknown engine "${engine}"`, "unknownEngine", { value: engine });

  // Recipes live in their own registry, so a recipe may share its id with the item it makes.
  const registry = typeRegistry();
  const seen = { recipe: new Set<string>(), shared: new Set<string>() };
  const ctx: ValidationContext = {
    elementIds: elementIdLookup(project.elements),
    fileExists: (path) => existsSync(resolve(projectDir, path)),
  };
  for (const [typeId, elements] of Object.entries(project.elements)) {
    const type = registry.byId.get(typeId);
    for (const element of elements) {
      const path = elementPath(typeId, element.id);
      if (!type) {
        check(false, path, `unknown element type "${typeId}"`, "unknownType", { value: typeId });
        continue;
      }
      const ids = typeId === "recipe" ? seen.recipe : seen.shared;
      check(RESOURCE_ID.test(element.id), `${path}.id`, "must be lowercase snake_case", "snakeCase");
      check(!ids.has(element.id), `${path}.id`, `duplicate id "${element.id}"`, "duplicateId", { value: element.id });
      ids.add(element.id);
      for (const issue of validateElement(type, element, ctx)) issues.push({ ...issue, path: `${path}.${issue.path}` });
    }
  }

  // Ids the generators derive (a bucket, a spawn egg, a wall sign) must not collide with another element's ids.
  issues.push(...registryIdIssues(project));
  // A world_game_rule_* block must name a Minecraft rule or a game_rule element of the project.
  issues.push(...gameRuleIssues(project.elements));
  // text_translate in a server procedure written into a text store the clients read (KUYRUK 204).
  issues.push(...translatedStoreIssues(project.elements, project.variables, registry.byId));

  // Sound events (sound_events.json, KUYRUK 132).
  try {
    const files = projectSoundFiles(projectDir);
    for (const problem of soundEventProblems(soundEvents(projectDir, project.mod.id, files), files)) issues.push({ path: SOUND_EVENTS_FILE, ...problem });
  } catch (e) {
    issues.push({ path: SOUND_EVENTS_FILE, message: (e as Error).message });
  }

  const { mod } = project;
  check(!mod.logo || existsSync(resolve(projectDir, mod.logo)), "mod.logo", `file not found: ${mod.logo}`, "fileNotFound", { path: mod.logo });
  const integrationIds = new Set(loadIntegrations().integrations.map((i) => i.id));
  (mod.integrations ?? []).forEach((integration, i) => check(integrationIds.has(integration.id), `mod.integrations[${i}].id`, `no integration "${integration.id}"`, "unknownIntegration", { value: integration.id }));
  mod.dependencies.forEach((dep, i) => {
    check(MOD_ID.test(dep.modId), `mod.dependencies[${i}].modId`, "must be a valid mod id", "modId");
    check(DEPENDENCY_VERSION.test(dep.version.trim()), `mod.dependencies[${i}].version`, 'use "*", "1.2.0" or ">=1.2.0"', "dependencyVersion");
  });

  const names = new Set<string>();
  project.variables.forEach((v, i) => {
    const path = `variables[${i}]`;
    check(JAVA_IDENTIFIER.test(v.name), `${path}.name`, "must be a Java identifier", "javaIdentifier");
    check(!names.has(v.name), `${path}.name`, `duplicate variable "${v.name}"`, "duplicateVariable", { value: v.name });
    names.add(v.name);
    check(VARIABLE_TYPES.includes(v.type), `${path}.type`, "unknown type", "unknownVariableType");
    check(VARIABLE_SCOPES.includes(v.scope), `${path}.scope`, "unknown scope", "unknownScope");
    if (v.type === "number") check(v.initial.trim() !== "" && !Number.isNaN(Number(v.initial)), `${path}.initial`, "must be a number", "number");
    if (v.type === "logic") check(v.initial === "true" || v.initial === "false", `${path}.initial`, "must be true or false", "boolean");
  });

  for (const lang of Object.keys(project.localization)) check(LANG_CODE.test(lang), `localization.${lang}`, "language code like en_us", "languageCode");
  return issues;
}
