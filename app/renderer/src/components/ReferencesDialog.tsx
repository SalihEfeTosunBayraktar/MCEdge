import { useEffect, useRef, useState } from "react";
import type { Reference, ReferenceReport } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { elementName, findElement, type ElementRef } from "../model.ts";
import { t, type StringKey } from "../strings.ts";
import { typeOf } from "../types.ts";
import { FormGroup, useDialogFocus } from "./ui.tsx";
import type { ProjectSnapshot } from "../../../shared/api.ts";

/** Places shown per row before "N more places". */
const PLACES_SHOWN = 4;

interface Row {
  key: string;
  /** The element to open when the row names one. */
  ref?: ElementRef;
  label: string;
  form: string;
  places: string[];
}

function rows(snapshot: ProjectSnapshot, refs: Reference[], side: "from" | "to"): Row[] {
  const found = new Map<string, Row>();
  for (const r of refs) {
    const source = side === "from" ? r.from : { kind: "element" as const, type: r.to.type, id: r.to.id };
    const ref = source.kind === "element" ? { typeId: source.type, id: source.id } : undefined;
    const element = ref && findElement(snapshot, ref);
    const label = ref
      ? `${typeOf(ref.typeId)?.name ?? ref.typeId}: ${element ? elementName(ref.typeId, element) : ref.id}`
      : t(source.kind === "tag" ? "refs.tag" : "refs.file", { id: source.id });
    const key = `${source.kind}|${source.id}|${"type" in source ? source.type : ""}|${r.form}`;
    const row = found.get(key) ?? { key, ref, label, form: r.form, places: [] };
    row.places.push(r.path);
    found.set(key, row);
  }
  return [...found.values()];
}

/** Find usages: the elements, tags and datapack files that name an element, and what the element names. */
export function ReferencesDialog({ snapshot, target, onClose, onOpen }: {
  snapshot: ProjectSnapshot;
  target: ElementRef;
  onClose: () => void;
  onOpen: (ref: ElementRef) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const [report, setReport] = useState<ReferenceReport>();
  const [error, setError] = useState("");
  useEffect(() => {
    api.findReferences(snapshot.dir, target.typeId, target.id).then(setReport, (e: Error) => setError(e.message));
  }, [snapshot, target]);
  const element = findElement(snapshot, target);
  const list = (title: string, items: Row[]) => (
    <FormGroup title={`${title} (${items.length})`}>
      {items.length === 0 ? <p className="empty-note">{t("refs.none")}</p> : (
        <ul className="refs">
          {items.map((row) => (
            <li key={row.key}>
              {row.ref ? <button type="button" className="linkbtn" onClick={() => onOpen(row.ref!)}>{row.label}</button> : <span>{row.label}</span>}
              <span className="reform">{t(`refs.form.${row.form}` as StringKey)}</span>
              <code>{row.places.slice(0, PLACES_SHOWN).join("  ")}</code>
              {row.places.length > PLACES_SHOWN && <span className="reform">{t("refs.more", { count: row.places.length - PLACES_SHOWN })}</span>}
            </li>
          ))}
        </ul>
      )}
    </FormGroup>
  );
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog refdialog" role="dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("refs.title", { name: element ? elementName(target.typeId, element) : target.id })}</div>
        {error ? <p className="usage">{error}</p> : !report ? <p className="empty-note">{t("refs.loading")}</p> : (
          <>
            {report.usedBy.length === 0 && <p className="empty-note" data-testid="refs-none">{t("refs.unusedNote")}</p>}
            {list(t("refs.usedBy"), rows(snapshot, report.usedBy, "from"))}
            {list(t("refs.uses"), rows(snapshot, report.uses, "to"))}
          </>
        )}
        <div className="dlg-buttons">
          <button type="button" className="abtn" autoFocus onClick={onClose}><span>{t("refs.close")}</span></button>
        </div>
      </div>
    </div>
  );
}
