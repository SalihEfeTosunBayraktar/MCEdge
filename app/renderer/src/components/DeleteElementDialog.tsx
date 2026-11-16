import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import type { DeletePlan } from "../../../../src/ir/deleteCascade.ts";
import { api } from "../api.ts";
import { elementName, findElement, type ElementRef } from "../model.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { Dialog, FormGroup } from "./ui.tsx";

interface Props {
  snapshot: ProjectSnapshot;
  target: ElementRef;
  engineId?: string;
  /** The snapshot after the delete; undefined when the user cancelled. */
  onDone: (next?: ProjectSnapshot) => void;
}

/** One group of the plan: its rows (key, label, folder), what the user ticked is deleted with the element. */
type Rows = { key: string; label: string; folder?: string }[];

/**
 * Delete confirmation (Q220). Besides the element it lists what only that element used (procedures and GUIs nobody else
 * calls or opens, recipes that make it, textures and models no other element names, translation keys) with a checkbox each,
 * off by default. The ticked ones are deleted in the same step, with the folder entries of everything deleted. The app
 * has no undo for deleted elements, so this is the one confirmation.
 */
export function DeleteElementDialog({ snapshot, target, engineId, onDone }: Props) {
  const [plan, setPlan] = useState<DeletePlan>();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const element = findElement(snapshot, target);
  useEffect(() => {
    let live = true;
    api.deletePlan(snapshot.dir, target.typeId, target.id, engineId).then((p) => live && setPlan(p), () => live && setPlan({ element: { type: target.typeId, id: target.id }, elements: [], textures: [], models: [], langKeys: [] }));
    return () => void (live = false);
  }, [snapshot.dir, target.typeId, target.id, engineId]);

  const groups: { id: "elements" | "textures" | "models" | "langKeys"; rows: Rows }[] = plan ? [
    { id: "elements", rows: plan.elements.map((e) => {
      const other = findElement(snapshot, { typeId: e.type, id: e.id });
      return { key: `${e.type}/${e.id}`, label: `${typeOf(e.type)?.name ?? e.type}: ${other ? elementName(e.type, other) : e.id}`, folder: e.folder };
    }) },
    { id: "textures", rows: plan.textures.map((x) => ({ key: x.path, label: x.path, folder: x.folder })) },
    { id: "models", rows: plan.models.map((x) => ({ key: x.path, label: x.path, folder: x.folder })) },
    { id: "langKeys", rows: plan.langKeys.map((k) => ({ key: k.key, label: `${k.key} (${k.languages.join(", ")})` })) },
  ] : [];
  const toggle = (name: string, on: boolean) => setTicked((s) => { const next = new Set(s); if (on) next.add(name); else next.delete(name); return next; });
  const toggleGroup = (id: string, rows: Rows, on: boolean) => setTicked((s) => { const next = new Set(s); rows.forEach((r) => (on ? next.add(`${id}:${r.key}`) : next.delete(`${id}:${r.key}`))); return next; });

  const remove = async () => {
    setBusy(true);
    const picked = (id: string) => [...ticked].filter((n) => n.startsWith(`${id}:`)).map((n) => n.slice(id.length + 1));
    const selection = plan && ticked.size ? { elements: picked("elements"), textures: picked("textures"), models: picked("models"), langKeys: picked("langKeys") } : undefined;
    try {
      onDone(await api.deleteElement(snapshot.dir, target.typeId, target.id, selection, engineId));
    } catch (e) {
      setBusy(false);
      throw e;
    }
  };
  const shown = groups.filter((g) => g.rows.length);
  return (
    <Dialog title={t("element.deleteTitle")} okLabel={t("action.delete")} danger canOk={!!plan && !busy} onOk={() => void remove()} onCancel={() => onDone(undefined)}>
      <p>{t("element.confirmDelete", { name: element ? elementName(target.typeId, element) : target.id })}</p>
      {!plan && <p className="hint">{t("element.deleteChecking")}</p>}
      {shown.length > 0 && (
        <div data-testid="delete-dependents">
          <p className="hint">{t("element.deleteExclusive")}</p>
          {shown.map(({ id, rows }) => {
            const all = rows.every((r) => ticked.has(`${id}:${r.key}`));
            return (
              <FormGroup key={id} title={t(`element.deleteGroup.${id}`)}>
                <div className="check-list">
                  {rows.length > 1 && (
                    <label className="check"><input type="checkbox" checked={all} onChange={(e) => toggleGroup(id, rows, e.target.checked)} /><b>{t("export.selectAll")}</b></label>
                  )}
                  {rows.map((r) => (
                    <label key={r.key} className="check" data-key={r.key}>
                      <input type="checkbox" checked={ticked.has(`${id}:${r.key}`)} onChange={(e) => toggle(`${id}:${r.key}`, e.target.checked)} />
                      <span>{r.label}</span>
                      {r.folder && <span className="dim">{r.folder}</span>}
                    </label>
                  ))}
                </div>
              </FormGroup>
            );
          })}
          <p className="hint">{t("element.deleteFolders")}</p>
        </div>
      )}
    </Dialog>
  );
}
