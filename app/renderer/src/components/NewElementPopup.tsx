import { useEffect, useMemo, useRef, useState } from "react";
import { displayNameField, newElement, REGISTRY_PROVIDERS, typeFields, type ElementType } from "../../../../src/elements/model.ts";
import { pascal } from "../../../../src/generator/java.ts";
import { customStub } from "../../../../src/generator/types/custom_element.ts";
import type { Coverage, ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { catalog, type CatalogEntry } from "../catalog.ts";
import { elementsOf, idTaken, toRegistryId, type ElementRef } from "../model.ts";
import { language, t } from "../strings.ts";
import { typeGenerated, typeOf } from "../types.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { FormGroup, FormRow } from "./ui.tsx";

interface Props {
  snapshot: ProjectSnapshot;
  coverage?: Coverage;
  engineName: string;
  onCreated: (snapshot: ProjectSnapshot, ref: ElementRef) => void;
  onCancel: () => void;
}

/** Display label of a catalog entry: the type's own name once it has a type.json. */
const entryLabel = (entry: CatalogEntry) => typeOf(entry.typeId)?.name ?? (entry.label ? t(`catalog.${entry.label}`) : entry.typeId);

/**
 * Shortcut letters of the New popup (KUYRUK 137, U20): every type with MCreator's letter gets a letter of its shown
 * name, so Turkish names do not carry English letters. MCreator's letter stays where the name has it; the others take
 * the first free letter of their name (word starts first).
 */
function typeLetters(entries: CatalogEntry[]): Map<string, string> {
  const lang = language();
  const out = new Map<string, string>();
  const used = new Set<string>();
  const keyed = entries.filter((e) => e.key && typeOf(e.typeId));
  const nameOf = (e: CatalogEntry) => entryLabel(e).toLocaleLowerCase(lang);
  for (const e of keyed) {
    if (nameOf(e).includes(e.key) && !used.has(e.key)) (out.set(e.typeId, e.key), used.add(e.key));
  }
  for (const e of keyed) {
    if (out.has(e.typeId)) continue;
    const name = nameOf(e);
    const starts = name.split(/[^\p{L}]+/u).map((w) => w[0]).filter(Boolean);
    const pick = [...starts, ...name].find((c) => /\p{L}/u.test(c) && !used.has(c));
    if (pick) (out.set(e.typeId, pick), used.add(pick));
  }
  return out;
}

/**
 * Inventory-panel popup anchored to New: pick a type (click or its letter), then name it. Every type with a
 * type.json can be created; the rest are listed as coming soon.
 */
export function NewElementPopup({ snapshot, coverage, engineName, onCreated, onCancel }: Props) {
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<ElementType>();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.focus(), []);

  const all = catalog().sort((a, b) => entryLabel(a).localeCompare(entryLabel(b)));
  const letters = useMemo(() => typeLetters(all), [all.map((e) => e.typeId).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = filter.trim().toLowerCase();
  const entries = all.filter((e) => !q || entryLabel(e).toLowerCase().includes(q));
  const choose = (entry: CatalogEntry) => {
    const type = typeOf(entry.typeId);
    if (type) setChosen(type);
  };

  return (
    <div className="addpop" role="dialog" aria-label={t("new.title")}
      onKeyDown={(e) => e.key === "Escape" && (chosen ? setChosen(undefined) : onCancel())}>
      {chosen ? (
        <NameStep snapshot={snapshot} type={chosen} onBack={() => setChosen(undefined)} onCreated={onCreated}
          notGenerated={typeGenerated(coverage, chosen.id) === "no"} engineName={engineName} />
      ) : (
        <>
          <div className="pophead">
            <span>{t("new.title")}</span>
            <span className="pophint">{t("new.hint")}</span>
          </div>
          <label className="search popsearch">
            <Icon name="search" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("new.filter", { count: all.length })} />
          </label>
          <div ref={list} className="popcols" tabIndex={-1} style={{ gridTemplateRows: `repeat(${Math.ceil(entries.length / 2)}, auto)` }}
            onKeyDown={(e) => {
              const entry = all.find((c) => typeOf(c.typeId) && letters.get(c.typeId) === e.key.toLocaleLowerCase(language()));
              if (entry && !e.ctrlKey && !e.altKey) (e.preventDefault(), choose(entry));
            }}>
            {entries.map((entry) => {
              const type = typeOf(entry.typeId);
              const noCode = type && typeGenerated(coverage, type.id) === "no";
              return (
                <button key={entry.typeId} className="ptype" disabled={!type} onClick={() => choose(entry)}
                  title={!type ? t("new.soon") : noCode ? t("editor.typeNotGenerated", { engine: engineName, type: type.name }) : type.description}>
                  <span className="pslot"><Sprite name={entry.sprite} size={16} /></span>
                  <span className="pname">{entryLabel(entry)}</span>
                  {!type && <span className="psoon">{t("new.soonShort")}</span>}
                  {noCode && <span className="psoon nocode">{t("new.noCode")}</span>}
                  {letters.has(entry.typeId) && <kbd className="pkey">{letters.get(entry.typeId)!.toLocaleUpperCase(language())}</kbd>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function NameStep({ snapshot, type, notGenerated, engineName, onBack, onCreated }: {
  snapshot: ProjectSnapshot;
  type: ElementType;
  notGenerated: boolean;
  engineName: string;
  onBack: () => void;
  onCreated: Props["onCreated"];
}) {
  const [name, setName] = useState("");
  const id = toRegistryId(name);
  const taken = idTaken(snapshot, type.id, id);
  const canCreate = id.length > 0 && !taken;
  const create = async () => {
    const element = newElement(type, id);
    const fields = typeFields(type);
    const nameField = displayNameField(type);
    if (nameField) element[nameField.key] = name.trim();
    else element.title = name.trim();
    // A required texture starts as the project's first one so the element is usable right away.
    for (const field of fields) if (field.type === "texture" && field.required && snapshot.textures[0]) element[field.key] = snapshot.textures[0];
    // A required item or block (a tab's icon) starts as the mod's first one (KUYRUK 137, X2), so a new element has no problem yet.
    for (const field of fields) {
      if ((field.type === "item" || field.type === "block") && field.required && !element[field.key]) {
        const first = elementsOf(snapshot, REGISTRY_PROVIDERS[field.type])[0];
        if (first) element[field.key] = first.element.id;
      }
    }
    // Custom code starts from a stub class the user then owns.
    if (type.id === "custom_element") element.code = customStub(`${snapshot.project.mod.package}.custom`, pascal(id));
    onCreated(await api.saveElement(snapshot.dir, type.id, element), { typeId: type.id, id });
  };

  return (
    <form className="popform" onSubmit={(e) => (e.preventDefault(), canCreate && create())}>
      <div className="pophead">
        <span className="ptitle-inline">{t("new.titleKind", { kind: type.name })}</span>
      </div>
      <p className="popdesc">{type.description}</p>
      <FormGroup title={t("group.element")}>
        <FormRow label={t("new.name")}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label={t("new.registryName")}>
          <div className="fval"><code>{snapshot.project.mod.id}:{id || "..."}</code></div>
        </FormRow>
      </FormGroup>
      {taken && <p className="error-text">{t("new.duplicate")}</p>}
      {notGenerated && <p className="notice">{t("editor.typeNotGenerated", { engine: engineName, type: type.name })}</p>}
      <div className="dlg-buttons">
        <button type="submit" className="abtn primary" disabled={!canCreate}><Icon name="plus" /><span>{t("new.create")}</span></button>
        <button type="button" className="abtn" onClick={onBack}><Icon name="back" /><span>{t("new.back")}</span></button>
      </div>
    </form>
  );
}
