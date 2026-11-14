import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveTags } from "../tags/tags.ts";
import { loadReferenceInput } from "./referenceInput.ts";
import type { ElementRef } from "./references.ts";
import { planRename, type RenamePlan } from "./renamePlan.ts";
import { deleteElement, elementFile, loadProject, needsMigration, saveElement, saveFolders, saveLocalization } from "./storage.ts";

export interface RenameResult {
  type: string;
  from: string;
  to: string;
  referencesChanged: number;
  changedElements: string[];
  renamedKeys: number;
  texturesMoved: { from: string; to: string }[];
  folderKept: string | undefined;
  tagsChanged: boolean;
  datapackFiles: string[];
  warnings: string[];
}

/** What renameElement did: the plan, whether it was written, and every file it may have touched (absolute paths). */
export type RenameOutcome = RenamePlan & { applied: boolean; written: string[] };

/** One disk write of a rename; `files` are the paths it may change, snapshotted before any step runs. */
interface Step {
  files: string[];
  run: () => void;
}

/**
 * Renames an element and everything that names it (see planRename). All changes are computed first; then every file the
 * steps can touch is read into memory and, if any step fails, written back, so a failed rename leaves the project as it
 * was. `onStep(index)` runs before each step (tests use it to fail halfway).
 */
export function renameElement(dir: string, typeId: string, oldId: string, newId: string, options: { dryRun?: boolean; onStep?: (index: number) => void } = {}): RenameOutcome {
  if (needsMigration(dir)) throw new Error("this project uses an older layout; open it in MCEdge once (the first save migrates it) before renaming");
  // Locked code (KUYRUK 131) holds class names and ids of the old name; renaming would leave it broken.
  if (existsSync(join(dir, "locked-code", typeId, oldId))) throw new Error(`${typeId}/${oldId} has locked code; unlock it before renaming`);
  const plan = planRename(loadReferenceInput(dir), { type: typeId, id: oldId } as ElementRef, newId);
  if (options.dryRun) return { ...plan, applied: false, written: [] };

  const steps: Step[] = [];
  // Saving an element also writes its type's schema file when the project has none yet.
  const schema = (type: string) => join(dir, "schemas", "elements", `${type}.schema.json`);
  const oldFile = elementFile(dir, typeId, oldId);
  steps.push({ files: [elementFile(dir, typeId, newId), oldFile, schema(typeId)], run: () => (saveElement(dir, typeId, plan.element), deleteElement(dir, typeId, oldId)) });
  for (const { type, element } of plan.changedElements) steps.push({ files: [elementFile(dir, type, element.id), schema(type)], run: () => saveElement(dir, type, element) });
  if (plan.tags) steps.push({ files: [join(dir, "tags.json")], run: () => saveTags(dir, plan.tags!) });
  for (const file of plan.datapack) steps.push({ files: [join(dir, file.path)], run: () => writeFileSync(join(dir, file.path), file.text) });
  if (Object.keys(plan.localization).length) {
    const next = { ...loadProject(dir).localization, ...plan.localization };
    steps.push({ files: Object.keys(plan.localization).map((l) => join(dir, "localization", `${l}.json`)), run: () => saveLocalization(dir, next) });
  }
  if (plan.folders) steps.push({ files: [join(dir, "folders.json")], run: () => saveFolders(dir, plan.folders!) });
  for (const { from, to } of plan.textures) {
    const pairs = [[from, to], [`${from}.mcmeta`, `${to}.mcmeta`]].filter(([f]) => existsSync(join(dir, f)));
    steps.push({ files: pairs.flatMap(([f, t]) => [join(dir, f), join(dir, t)]), run: () => pairs.forEach(([f, t]) => renameSync(join(dir, f), join(dir, t))) });
  }

  const snapshot = new Map<string, Buffer | null>();
  for (const file of new Set(steps.flatMap((s) => s.files))) snapshot.set(file, existsSync(file) ? readFileSync(file) : null);
  try {
    steps.forEach((step, i) => {
      options.onStep?.(i);
      step.run();
    });
  } catch (error) {
    const undone: string[] = [];
    for (const [file, bytes] of snapshot) {
      try {
        if (bytes === null) rmSync(file, { force: true });
        else writeFileSync(file, bytes);
      } catch (restoreError) {
        undone.push(`${file}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(undone.length ? `rename failed (${reason}) and these files could not be restored: ${undone.join("; ")}` : `rename failed and was undone: ${reason}`);
  }
  return { ...plan, applied: true, written: [...snapshot.keys()] };
}

/** The short answer a tool or the app shows after a rename. */
export function renameSummary(plan: RenameOutcome): RenameResult {
  return {
    type: plan.target.type,
    from: plan.target.id,
    to: plan.newId,
    referencesChanged: plan.referencesChanged,
    changedElements: plan.changedElements.map((c) => `${c.type}/${c.element.id}`),
    renamedKeys: plan.renamedKeys.length,
    texturesMoved: plan.textures,
    folderKept: plan.folders?.placement[`${plan.target.type}/${plan.newId}`],
    tagsChanged: !!plan.tags,
    datapackFiles: plan.datapack.map((f) => f.path),
    warnings: plan.warnings.slice(0, 20),
  };
}
