import { useEffect, useState } from "react";
import type { ProjectSnapshot, ValidationIssue } from "../../../shared/api.ts";
import { api } from "../api.ts";

/**
 * The Problems entries of unused translation keys (Q222), one per language. They need the generator, which takes a moment
 * on a large project, so they are fetched only while `active` (the Problems tab is open) and a moment after the project
 * last changed, not with every snapshot.
 */
export function useUnusedTranslations(snapshot: ProjectSnapshot | undefined, engineId: string, active: boolean): { shown: ValidationIssue[]; ignored: ValidationIssue[] } {
  const [found, setFound] = useState<{ dir: string; shown: ValidationIssue[]; ignored: ValidationIssue[] }>();
  useEffect(() => {
    if (!snapshot || !active) return;
    let live = true;
    const timer = setTimeout(() => void api.unusedTranslations(snapshot.dir, engineId || undefined).then((r) => live && setFound({ dir: snapshot.dir, ...r }), () => undefined), 600);
    return () => (live = false, clearTimeout(timer));
  }, [snapshot, engineId, active]);
  return found && found.dir === snapshot?.dir ? found : { shown: [], ignored: [] };
}
