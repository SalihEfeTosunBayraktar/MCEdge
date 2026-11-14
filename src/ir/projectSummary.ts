import { defaultValue, typeFields, visibility } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { engineCoverage } from "../engines/coverage.ts";
import { listEngines } from "../engines/registry.ts";
import { generatedElements, genEnv } from "../generator/generate.ts";
import { procedureBuild } from "../generator/procedures.ts";
import { asProgram, countBlocks } from "../procedures/model.ts";
import { PROGRAM_FIELD } from "../procedures/project.ts";
import { loadTags, validateTags } from "../tags/tags.ts";
import { loadProblemSettings, loadProject } from "./storage.ts";
import { classify } from "./problems.ts";
import { validateProject } from "./validate.ts";

/** At most this many examples per list in the summary; counts are always complete. */
const EXAMPLES = 15;

export interface EngineGaps {
  engine: string;
  /** Elements the engine leaves out, with the reason. */
  skippedElements: { element: string; reason: string }[];
  /** Fields set away from their default that the engine does not generate: "type.field" -> elements. */
  ignoredFields: Record<string, string[]>;
  /** Procedure blocks and triggers the engine does not generate. */
  procedureWarnings: string[];
  counts: { skippedElements: number; ignoredFields: number; procedureWarnings: number };
}

/**
 * One look at a whole project for an agent: element types and counts, problems (grouped by element), what each
 * engine leaves out of this project (not the type catalog: only elements and fields the project really uses) and
 * the biggest procedures. Generates nothing on disk.
 */
export function projectSummary(dir: string, engineIds?: string[]) {
  const project = loadProject(dir);
  const registry = typeRegistry();
  const counts: Record<string, number> = {};
  for (const [typeId, list] of Object.entries(project.elements)) if (list.length) counts[typeId] = list.length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const issues = classify([...validateProject(project, dir), ...validateTags(loadTags(dir), project)], loadProblemSettings(dir)).shown;
  const byElement: Record<string, number> = {};
  for (const issue of issues) {
    const key = /^[a-z_]+\/[a-z0-9_]+/.exec(issue.path)?.[0] ?? issue.path.split(/[.[]/)[0];
    byElement[key] = (byElement[key] ?? 0) + 1;
  }

  const engines = listEngines().filter((e) => !engineIds?.length || engineIds.includes(e.id));
  if (engineIds?.length && engines.length !== engineIds.length) throw new Error(`unknown engine; one of: ${listEngines().map((e) => e.id).join(", ")}`);
  const gaps: EngineGaps[] = engines.map((engine) => {
    const { generated, skipped } = generatedElements(project, engine);
    const coverage = engineCoverage(engine);
    const ignored: Record<string, string[]> = {};
    for (const [typeId, list] of Object.entries(generated)) {
      const type = registry.byId.get(typeId)!;
      const fields = typeFields(type);
      for (const element of list) {
        const visible = visibility({ fields, values: element });
        for (const field of fields) {
          if (coverage[typeId]?.[field.key] || !visible(field.key) || !(field.key in element)) continue;
          if (JSON.stringify(element[field.key]) === JSON.stringify(defaultValue(field))) continue;
          (ignored[`${typeId}.${field.key}`] ??= []).push(element.id);
        }
      }
    }
    const warnings = procedureBuild(genEnv(project, dir, engine, generated)).warnings;
    return {
      engine: engine.id,
      skippedElements: skipped.slice(0, EXAMPLES).map((s) => ({ element: `${s.typeId}/${s.id}`, reason: s.reason })),
      ignoredFields: Object.fromEntries(Object.entries(ignored).map(([k, ids]) => [k, ids.slice(0, EXAMPLES)])),
      procedureWarnings: warnings.slice(0, EXAMPLES),
      counts: { skippedElements: skipped.length, ignoredFields: Object.values(ignored).reduce((a, ids) => a + ids.length, 0), procedureWarnings: warnings.length },
    };
  });

  const procedures = (project.elements.procedure ?? [])
    .map((p) => ({ id: p.id, blocks: countBlocks(asProgram(p[PROGRAM_FIELD])), globalTrigger: p.globalTrigger ?? "no_ext_trigger" }))
    .sort((a, b) => b.blocks - a.blocks);

  return {
    mod: { id: project.mod.id, name: project.mod.name, version: project.mod.version },
    elements: { total, byType: counts },
    variables: project.variables.length,
    languages: Object.keys(project.localization ?? {}),
    problems: {
      total: issues.length,
      byElement: Object.fromEntries(Object.entries(byElement).sort((a, b) => b[1] - a[1]).slice(0, EXAMPLES * 2)),
      first: issues.slice(0, EXAMPLES),
    },
    engines: gaps,
    biggestProcedures: procedures.slice(0, 10),
    procedureBlocks: procedures.reduce((a, p) => a + p.blocks, 0),
  };
}
