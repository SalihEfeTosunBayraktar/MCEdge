import { useMemo, useRef, useState } from "react";
import { quickItems, quickSearch, type QuickItem, type QuickKind } from "../../../../src/ir/quickSearch.ts";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { allElements, elementName } from "../model.ts";
import { language, t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { useDialogFocus } from "./ui.tsx";

/** The searchable items of a snapshot; lang keys show their text in the UI language when the project has it. */
export function snapshotItems(snapshot: ProjectSnapshot): QuickItem[] {
  const loc = snapshot.project.localization;
  const languages = [language() === "tr" ? "tr_tr" : "en_us", "en_us", ...Object.keys(loc)];
  const keys = [...new Set(Object.values(loc).flatMap((entries) => Object.keys(entries)))];
  return quickItems({
    elements: allElements(snapshot).map(({ typeId, element }) => ({ typeId, id: element.id, name: elementName(typeId, element), typeName: typeOf(typeId)?.name ?? typeId })),
    textures: snapshot.textures,
    sounds: snapshot.sounds,
    models: snapshot.models,
    structures: snapshot.structures,
    langKeys: keys.map((key) => ({ key, text: languages.map((l) => loc[l]?.[key]).find((text) => text) ?? "" })),
    variables: snapshot.project.variables.map((v) => ({ name: v.name, type: v.type, scope: v.scope })),
    tags: snapshot.tags.map((tag) => ({ type: tag.type, id: tag.id })),
  });
}

/**
 * Ctrl+K quick open (KUYRUK 136): one search box over the whole project. Up / Down choose, Enter or a click opens the
 * result where it lives (an element or texture in its editor, the rest in its section, searched for), Escape closes.
 */
export function QuickOpen({ snapshot, onOpen, onClose }: { snapshot: ProjectSnapshot; onOpen: (item: QuickItem) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const items = useMemo(() => snapshotItems(snapshot), [snapshot]);
  const hits = useMemo(() => quickSearch(items, query, 60), [items, query]);
  const at = Math.min(active, hits.length - 1);
  const open = (item: QuickItem | undefined) => item && (onClose(), onOpen(item));
  const kindLabel = (kind: QuickKind) => t(`quick.kind.${kind}`);
  return (
    <div className="backdrop quickback" onMouseDown={onClose}>
      <div ref={box} className="dialog quickopen" role="dialog" aria-label={t("quick.title")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.preventDefault(), onClose());
          if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), setActive(Math.max(0, Math.min(hits.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))));
          if (e.key === "Enter") (e.preventDefault(), open(hits[at]));
        }}>
        <input value={query} placeholder={t("quick.placeholder")} spellCheck={false} aria-label={t("quick.title")}
          onChange={(e) => (setQuery(e.target.value), setActive(0))} />
        <div className="quicklist" role="listbox" aria-label={t("quick.title")}>
          {hits.map((hit, i) => (
            <button key={`${hit.kind}|${hit.target}`} type="button" role="option" aria-selected={i === at} data-kind={hit.kind} data-target={hit.target}
              className={`quickrow ${i === at ? "on" : ""}`} onMouseMove={() => i !== at && setActive(i)} onClick={() => open(hit)}>
              <span className="quickkind">{kindLabel(hit.kind)}</span>
              <span className="quicklabel">{hit.label}</span>
              <span className="quickdetail">{hit.detail}</span>
            </button>
          ))}
          {query.trim() && !hits.length && <p className="empty-note">{t("quick.none")}</p>}
          {!query.trim() && <p className="hint quickhint">{t("quick.hint", { count: items.length })}</p>}
        </div>
      </div>
    </div>
  );
}
