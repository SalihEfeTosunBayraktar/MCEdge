import { useEffect, useState } from "react";
import type { ProjectSnapshot, RenameResult } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { elementName, findElement, type ElementRef } from "../model.ts";
import { t } from "../strings.ts";
import { Dialog, FormGroup } from "./ui.tsx";

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: message". */
const plain = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** Rename an element: previews what follows the new id, then renames everything that names it. */
export function RenameDialog({ snapshot, target, onCancel, onRenamed }: {
  snapshot: ProjectSnapshot;
  target: ElementRef;
  onCancel: () => void;
  onRenamed: (snapshot: ProjectSnapshot, ref: ElementRef) => void;
}) {
  const [newId, setNewId] = useState(target.id);
  const [preview, setPreview] = useState<RenameResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const element = findElement(snapshot, target);

  // What would change, asked of the same code that renames (dry run); a refused id shows its reason.
  useEffect(() => {
    setPreview(undefined);
    if (newId === target.id || !newId) return setError("");
    let current = true;
    const timer = setTimeout(() => {
      api.renameElement(snapshot.dir, target.typeId, target.id, newId, true).then(
        ({ result }) => current && (setPreview(result), setError("")),
        (e: Error) => current && setError(plain(e)),
      );
    }, 200);
    return () => ((current = false), clearTimeout(timer));
  }, [newId, snapshot, target]);

  const rename = async () => {
    setBusy(true);
    try {
      const { snapshot: next } = await api.renameElement(snapshot.dir, target.typeId, target.id, newId);
      if (next) onRenamed(next, { typeId: target.typeId, id: newId });
    } catch (e) {
      setError(plain(e as Error));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("rename.title", { name: element ? elementName(target.typeId, element) : target.id })} okLabel={t("rename.ok")}
      canOk={!!preview && !error && !busy} onOk={() => void rename()} onCancel={onCancel}>
      <FormGroup title={t("rename.newId")}>
        <input value={newId} autoFocus spellCheck={false} aria-label={t("rename.newId")} onChange={(e) => setNewId(e.target.value.trim())} />
        <p className="hint">{t("rename.hint")}</p>
        {error && <p className="usage" data-testid="rename-error">{error}</p>}
        {preview && (
          <>
            <p data-testid="rename-preview">{t("rename.preview", { places: preview.referencesChanged, elements: preview.changedElements.length, keys: preview.renamedKeys, textures: preview.texturesMoved.length })}</p>
            {preview.warnings.length > 0 && (
              <>
                <p>{t("rename.notes")}</p>
                <ul className="issues">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </>
            )}
          </>
        )}
      </FormGroup>
    </Dialog>
  );
}
