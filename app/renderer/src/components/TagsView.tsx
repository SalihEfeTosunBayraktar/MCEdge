import { useEffect, useRef, useState } from "react";
import { TAG_PROVIDERS, TAG_TYPES, qualifyTagRef, type TagType } from "../../../../src/tags/model.ts";
import { OFFERED_TAGS, suggestedEntries, type OfferedTag } from "../../../../src/tags/offered.ts";
import { Icon } from "./Icon.tsx";
import type { ElementTag, ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { useAutosave } from "../hooks/useAutosave.ts";
import { elementName, elementsOf } from "../model.ts";
import { t, type StringKey } from "../strings.ts";
import { MiniBar, RefDatalists } from "./ElementFields.tsx";
import { ActionBar, ActionButton, DataTable, FindBar, FindSelect, FormGroup, FormRow, PanelEmpty, Problems, Separator, SidePanel, useDialogFocus } from "./ui.tsx";
import { useRevealQuery } from "../hooks/reveal.ts";

/** Autocomplete list (ElementFields' RefDatalists) per tag type; types without one get this mod's elements only. */
const REF_LIST: Partial<Record<TagType, string>> = {
  item: "ref-item", block: "ref-block", entity_type: "ref-entity", biome: "ref-biome", damage_type: "ref-damage_type", enchantment: "ref-enchantment",
};

interface Props {
  snapshot: ProjectSnapshot;
  onSaved: (snapshot: ProjectSnapshot) => void;
}

/**
 * Element tags: lists of items, blocks, entities, biomes, functions, ... that the mod defines ("mymod:gems") or adds
 * its elements to ("minecraft:logs"). The selected tag and its entries are edited in the side panel.
 */
export function TagsView({ snapshot, onSaved }: Props) {
  const [tags, setTags] = useAutosave<ElementTag[]>(snapshot.tags, async (next) => onSaved(await api.saveTags(snapshot.dir, next)));
  const [query, setQuery] = useState("");
  useRevealQuery("tags", setQuery);
  const [filter, setFilter] = useState<"all" | TagType>("all");
  const [selected, setSelected] = useState<number>();
  const [entry, setEntry] = useState<number>();
  const [newEntry, setNewEntry] = useState("");
  const [common, setCommon] = useState(false);
  const modId = snapshot.project.mod.id;
  const q = query.trim().toLowerCase();
  const rows = tags.map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => (filter === "all" || tag.type === filter) && (!q || tag.id.includes(q) || tag.entries.some((e) => e.includes(q))));
  // The selection follows what is listed (KUYRUK 112/147): a tag the filter or search hides is dropped, and stays
  // dropped when they are cleared, so the panel and Delete selected never reach a tag the user cannot see. Only a
  // change of the filter or search drops it: editing the selected tag's id or type in the panel keeps it.
  const shown = selected !== undefined && rows.some((r) => r.index === selected);
  useEffect(() => {
    if (!shown) (setSelected(undefined), setEntry(undefined));
  }, [query, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = selected !== undefined ? tags[selected] : undefined;

  const update = (patch: Partial<ElementTag>) => selected !== undefined && setTags(tags.map((tag, i) => (i === selected ? { ...tag, ...patch } : tag)));
  const add = () => {
    let n = 1;
    while (tags.some((tag) => tag.id === `${modId}:tag_${n}`)) n++;
    setTags([...tags, { type: filter === "all" ? "item" : filter, id: `${modId}:tag_${n}`, entries: [] }]);
    // Shown at once: it takes the filtered type, and a search it would not match is cleared.
    if (q && !`${modId}:tag_${n}`.includes(q)) setQuery("");
    setSelected(tags.length);
    setEntry(undefined);
  };
  /** Tags > Common tags: a picked common tag, added with the ticked entries or merged into the same tag already listed. */
  const addCommon = (tag: ElementTag) => {
    const at = tags.findIndex((x) => x.type === tag.type && qualifyTagRef(modId, x.id) === tag.id);
    if (at >= 0) setTags(tags.map((x, i) => (i === at ? { ...x, entries: [...new Set([...x.entries, ...tag.entries])] } : x)));
    else setTags([...tags, tag]);
    setCommon(false);
    setFilter("all");
    setQuery("");
    setSelected(at >= 0 ? at : tags.length);
    setEntry(undefined);
  };
  const remove = () => {
    setTags(tags.filter((_, i) => i !== selected));
    setSelected(undefined);
  };
  const addEntry = () => {
    const value = newEntry.trim();
    if (!current || !value || current.entries.includes(value)) return;
    update({ entries: [...current.entries, value] });
    setEntry(current.entries.length);
    setNewEntry("");
  };
  const removeEntry = () => {
    if (!current || entry === undefined) return;
    update({ entries: current.entries.filter((_, i) => i !== entry) });
    setEntry(undefined);
  };
  const issues = snapshot.issues.filter((i) => selected !== undefined && i.path.startsWith(`tags[${selected}]`));
  const own = current ? elementsOf(snapshot, TAG_PROVIDERS[current.type]) : [];
  const listId = current ? REF_LIST[current.type] ?? "ref-tag-own" : undefined;
  const typeLabel = (type: TagType) => t(`tags.type.${type}` as StringKey);

  return (
    <section className="view">
      <FindBar query={query} onQuery={setQuery} placeholder={t("tags.search")} meta={t("tags.count", { count: tags.length })}>
        <FindSelect icon="filter" label={t("find.filter")} value={filter} onChange={setFilter} options={[
          { value: "all", label: t("tags.allTypes") }, ...TAG_TYPES.map((type) => ({ value: type, label: typeLabel(type) })),
        ]} />
      </FindBar>
      <ActionBar>
        <ActionButton icon="plus" label={t("tags.add")} tone="primary" onClick={add} />
        <ActionButton icon="tag" label={t("tags.common")} onClick={() => setCommon(true)} />
        <Separator />
        <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" disabled={!current} onClick={remove} />
      </ActionBar>
      {common && <CommonTagsDialog snapshot={snapshot} tags={tags} onAdd={addCommon} onClose={() => setCommon(false)} />}
      <RefDatalists snapshot={snapshot} />
      <datalist id="ref-tag-own">{own.map(({ typeId, element }) => <option key={element.id} value={element.id}>{elementName(typeId, element)}</option>)}</datalist>
      <div className="split">
        <DataTable rows={rows} rowKey={(r) => String(r.index)} selected={selected === undefined ? undefined : String(selected)}
          onSelect={(key) => (setSelected(Number(key)), setEntry(undefined))} empty={tags.length ? t("list.noMatch") : t("tags.empty")}
          columns={[
            { label: t("tags.col.type"), width: "18%", cell: (r) => typeLabel(r.tag.type) },
            { label: t("tags.col.id"), width: "34%", cell: (r) => <code>#{qualifyTagRef(modId, r.tag.id)}</code> },
            { label: t("tags.col.kind"), width: "18%", cell: (r) => <span className="dim">{t(qualifyTagRef(modId, r.tag.id).startsWith(`${modId}:`) ? "tags.kind.own" : "tags.kind.extends")}</span> },
            { label: t("tags.col.entries"), cell: (r) => <span>{r.tag.entries.join(", ") || <span className="dim">{t("tags.noEntries")}</span>}</span> },
          ]} />
        <SidePanel title={t("tags.edit")}>
          {current ? (
            <div className="form tagform">
              <FormGroup title={t("tags.group")}>
                <FormRow label={t("tags.col.type")}>
                  <select value={current.type} onChange={(e) => update({ type: e.target.value as TagType })}>
                    {TAG_TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
                  </select>
                </FormRow>
                <FormRow label={t("tags.col.id")} top>
                  <input value={current.id} spellCheck={false} onChange={(e) => update({ id: e.target.value.trim().toLowerCase() })} />
                  <p className="fhelp">{t("tags.idHint", { mod: modId })}</p>
                </FormRow>
              </FormGroup>
              <FormGroup title={t("tags.entries")}>
                {/* Entry actions belong to the entry list, so they sit in its own bar, not in the section toolbar (KUYRUK 124). */}
                <MiniBar meta={t("list.count", { count: current.entries.length })} actions={[
                  { icon: "plus", label: t("tags.addEntry"), onClick: newEntry.trim() ? addEntry : undefined },
                  { icon: "trash", label: t("tags.removeEntry"), tone: "danger", onClick: entry !== undefined ? removeEntry : undefined },
                ]} />
                <FormRow label={t("tags.newEntry")}>
                  <input list={listId} value={newEntry} spellCheck={false} placeholder={t("tags.entryHint")}
                    onChange={(e) => setNewEntry(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEntry())} />
                </FormRow>
                {current.entries.length === 0 ? <p className="listempty">{t("tags.noEntries")}</p> : (
                  <div className="listrows tagentries" role="listbox" aria-label={t("tags.entries")}>
                    {current.entries.map((value, i) => (
                      <button key={value} type="button" role="option" aria-selected={i === entry} className={`lrow ${i === entry ? "sel" : ""}`} onClick={() => setEntry(i)}>
                        <span className="lnum">{i + 1}</span><code className="ltxt">{value}</code>
                        <span className="dim gxy">{value.startsWith("#") ? t("tags.entryTag") : qualifyTagRef(modId, value).startsWith(`${modId}:`) ? t("tags.entryMod") : t("tags.entryVanilla")}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="hint">{t(current.type === "biome" || current.type === "damage_type" || current.type === "enchantment" || current.type === "game_event" ? "tags.modernOnly" : "tags.allVersions")}</p>
              </FormGroup>
              <Problems issues={issues} />
            </div>
          ) : <PanelEmpty text={t("tags.selectHint")} />}
        </SidePanel>
      </div>
    </section>
  );
}

/** Tags > Common tags (KUYRUK 135): a common tag from config/common-tags.json with this mod's elements it suggests. */
function CommonTagsDialog({ snapshot, tags, onAdd, onClose }: { snapshot: ProjectSnapshot; tags: ElementTag[]; onAdd: (tag: ElementTag) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<OfferedTag>();
  const [chosen, setChosen] = useState<string[]>([]);
  const modId = snapshot.project.mod.id;
  const q = query.trim().toLowerCase();
  const offered = OFFERED_TAGS.filter((x) => !q || x.id.includes(q));
  const suggested = picked ? suggestedEntries(picked, snapshot.project.elements) : [];
  const pick = (tag: OfferedTag) => (setPicked(tag), setChosen(suggestedEntries(tag, snapshot.project.elements)));
  const exists = picked && tags.some((x) => x.type === picked.type && qualifyTagRef(modId, x.id) === picked.id);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog commontags" role="dialog" data-testid="common-tags" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("commonTags.title")}</div>
        <input value={query} placeholder={t("commonTags.search")} aria-label={t("commonTags.search")} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        <ul className="plain commontag-list" role="listbox">
          {offered.map((x) => (
            <li key={`${x.type} ${x.id}`}>
              <button type="button" role="option" aria-selected={picked === x} className={`lrow ${picked === x ? "sel" : ""}`} onClick={() => pick(x)}>
                <span className="dim">{t(`tags.type.${x.type}` as StringKey)}</span><code>#{x.id}</code>
              </button>
            </li>
          ))}
        </ul>
        {picked && (
          <FormGroup title={t("commonTags.suggested")}>
            {suggested.length ? (
              <div className="check-list">
                {suggested.map((id) => (
                  <label key={id} className="check">
                    <input type="checkbox" checked={chosen.includes(id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, id] : chosen.filter((c) => c !== id))} />
                    <code>{id}</code>
                  </label>
                ))}
              </div>
            ) : <p className="hint">{t("commonTags.none")}</p>}
            {exists && <p className="hint">{t("commonTags.exists")}</p>}
          </FormGroup>
        )}
        <p className="hint">{t("commonTags.hint")}</p>
        <div className="dlg-buttons">
          <button type="button" className="abtn primary" disabled={!picked} onClick={() => picked && onAdd({ type: picked.type, id: picked.id, entries: chosen })}>
            <Icon name="plus" /><span>{t("commonTags.add")}</span>
          </button>
          <button type="button" className="abtn" onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </div>
    </div>
  );
}
