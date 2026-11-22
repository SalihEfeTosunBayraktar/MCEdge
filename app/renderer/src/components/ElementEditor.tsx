import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayNameField, elementIdLookup, newElement, typeFields, typeForProject, validateElement, visibility, type FieldDef } from "../../../../src/elements/model.ts";
import { hidden } from "../experience.ts";
import type { Coverage, Element, EngineInfo, ProjectSnapshot, TaskSource } from "../../../shared/api.ts";
import { GuiLayoutPage } from "../gui/GuiLayoutPage.tsx";
import { ProcedurePage } from "../procedures/ProcedurePage.tsx";
import { PROGRAM_FIELD } from "../../../../src/procedures/project.ts";
import { merge3, same } from "../live/merge.ts";
import { api } from "../api.ts";
import { spriteFor } from "../catalog.ts";
import { duplicateElement } from "../elementActions.ts";
import { useAutosave } from "../hooks/useAutosave.ts";
import { elementName, elementTexture, findElement, freeId, issuePrefix, toRegistryId, type ElementRef } from "../model.ts";
import { issueText, t } from "../strings.ts";
import { usePerformance } from "../preferences.ts";
import { typeGenerated, typeOf } from "../types.ts";
import { FieldList, RefDatalists, type FormContext } from "./ElementFields.tsx";
import { BubblePreview } from "./BubblePreview.tsx";
import { RadialPreview } from "./RadialPreview.tsx";
import { DeleteElementDialog } from "./DeleteElementDialog.tsx";
import { InspectorToggle, ViewShell, type DockSection } from "../dock/Dock.tsx";
import { Icon } from "./Icon.tsx";
import { PageTabs } from "./PageTabs.tsx";
import { FormPreview } from "./FormPreview.tsx";
import { SeatPreview } from "../models/SeatPreview.tsx";
import { Sprite } from "./Sprite.tsx";
import { Texture } from "./Texture.tsx";
import { ActionBar, ActionButton, ContextMenu, Dialog, FormGroup, MenuList, Problems, Separator, TabList } from "./ui.tsx";

interface Props {
  snapshot: ProjectSnapshot;
  target: ElementRef;
  coverage?: Coverage;
  engineName: string;
  engine?: EngineInfo;
  onSaved: (snapshot: ProjectSnapshot) => void;
  onClose: () => void;
  onOpen: (ref: ElementRef) => void;
  /** Name of the element Back returns to (this one was opened from it); without it Back goes to the element list. */
  backName?: string;
  /** The element was deleted on disk while open without unsaved edits; the editor should close. */
  onDeleted: (name: string) => void;
  /** Fields the AI agent works on right now (KUYRUK 144): their rows are highlighted. */
  agentFields?: string[];
  /** Right-click on a field > New task for the agent (KUYRUK 146). */
  onNewTask?: (source: TaskSource) => void;
  /** A field to show (a build error points at it, Q246): its page opens, the row scrolls into view and is highlighted for a moment. */
  reveal?: { field: string; n: number };
}

/** Last page shown per element type, so reopening an element of that type returns to it. */
const lastPage = new Map<string, string>();

/**
 * Form editor for every element type, built from its type.json: page tabs, groups and fields. Only the
 * active page is rendered. Every change is validated live and saved to the element's JSON file shortly after.
 * Mount it with a key per element: the draft is taken from the snapshot once.
 */
export function ElementEditor({ snapshot, target, coverage, engineName, engine, onSaved, onClose, onOpen, backName, onDeleted, agentFields, onNewTask, reveal }: Props) {
  const { previews } = usePerformance();
  const baseType = typeOf(target.typeId);
  // Fields of optional mod integrations show only while the project uses them (mod settings > Integrations).
  const type = baseType && typeForProject(baseType, snapshot.project.mod.integrations);
  const external = findElement(snapshot, target);
  /** What this editor last loaded or saved: the base of the three-way merge with outside changes. */
  const base = useRef(external);
  /** The element was deleted on disk while open with unsaved edits: the user chooses Restore or Discard. */
  const [deleted, setDeleted] = useState(false);
  /** The user chose to bring back an element deleted on disk: the next save may recreate its file. */
  const restoring = useRef(false);
  const [draft, setDraft, , replaceDraft] = useAutosave<Element | undefined>(external, async (next) => {
    if (!next) return;
    try {
      const saved = await api.saveElement(snapshot.dir, target.typeId, next, restoring.current, base.current);
      restoring.current = false;
      base.current = next;
      // The save merged an agent's write the watcher had not reported yet: the merged element comes back as an outside
      // change of `next` (taken into the draft by the effect below); the chip says what happened now.
      if (saved.merged) setLive({ taken: saved.merged.taken, conflicts: saved.merged.conflicts, at: Date.now() });
      onSaved(saved);
    } catch {
      // Refused: the file was deleted on disk meanwhile. The edits stay in the draft and the user decides.
      setDeleted(true);
    }
  });
  const [pageId, setPageId] = useState(() => lastPage.get(target.typeId) ?? type?.pages[0]?.id ?? "");
  const [live, setLive] = useState<{ taken: string[]; conflicts: string[]; at: number }>();
  /** Right-click menu on a field row: a task for the agent about that field. */
  const [fieldMenu, setFieldMenu] = useState<{ x: number; y: number; field: string }>();
  /** Bumped when an outside change replaced the block program, so the Blockly canvas reloads it. */
  const [programRev, setProgramRev] = useState(0);

  useEffect(() => {
    if (!reveal || !type) return;
    const key = reveal.field.split(/[.[]/)[0];
    const page = type.pages.find((p) => p.groups.some((g) => g.fields.some((f) => f.key === key)));
    if (page) (lastPage.set(type.id, page.id), setPageId(page.id));
    // The page renders first; then its row is found.
    const timer = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`.form .frow[data-field="${CSS.escape(key)}"], .form .frow[data-field^="${CSS.escape(key)}["], .form .frow[data-field^="${CSS.escape(key)}."]`);
      row?.scrollIntoView({ block: "center" });
      row?.classList.add("revealed");
      setTimeout(() => row?.classList.remove("revealed"), 3000);
    }, 60);
    return () => clearTimeout(timer);
    // Runs when a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n]);

  // Field changes go through refs so FieldList callbacks stay stable while typing.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Live co-editing: the element changed on disk (an AI agent over MCP). Merge it into the draft field by field;
  // a field both sides changed keeps the user's value, which is then saved over the agent's.
  useEffect(() => {
    if (!external || !draftRef.current || same(external, base.current)) return;
    const result = merge3(base.current, draftRef.current, external);
    base.current = external;
    if (!result.taken.length && !result.conflicts.length) return;
    if (same(result.value, external)) replaceDraft(result.value);
    else setDraft(result.value);
    if (result.taken.some((p) => p === "." || p.split(".")[0] === PROGRAM_FIELD || (type ? typeFields(type) : []).some((f) => f.type === "blockly" && p.split(".")[0] === f.key))) {
      setProgramRev((n) => n + 1);
    }
    setLive({ taken: result.taken, conflicts: result.conflicts, at: Date.now() });
    // Runs when the snapshot brings a new version of this element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external]);
  // The element was deleted on disk (by an agent, git, another program). Nothing is written back silently: a waiting
  // save is dropped; with unsaved edits the user chooses, otherwise the editor closes and says why.
  const deletingSelf = useRef(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (external || !base.current || !draftRef.current || deletingSelf.current) return;
    const unsaved = !same(draftRef.current, base.current);
    replaceDraft(draftRef.current);
    if (unsaved) setDeleted(true);
    else onDeleted(elementName(target.typeId, draftRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external]);
  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => setLive(undefined), 8000);
    return () => clearTimeout(timer);
  }, [live]);
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;
  const setField = useCallback((key: string, value: unknown) => {
    const next = { ...draftRef.current!, [key]: value };
    draftRef.current = next;
    setDraftRef.current(next);
  }, []);

  const textures = snapshot.textures;
  const issues = useMemo(() => {
    if (!type || !draft) return [];
    // Problems the project ignores (problems.json, KUYRUK 196) are not shown on the fields either.
    const ignored = new Set(snapshot.ignoredIssues.map((i) => `${i.code} ${i.path}`));
    return validateElement(type, draft, { elementIds: elementIdLookup(snapshot.project.elements), fileExists: (p) => textures.includes(p) })
      .filter((i) => !ignored.has(`${i.code} ${target.typeId}/${target.id}.${i.path}`));
  }, [type, draft, snapshot.project.elements, snapshot.ignoredIssues, textures, target.typeId, target.id]);
  // Keyed by content: unchanged issues keep the map (and the memoized field rows) stable while typing.
  const issueKey = JSON.stringify(issues);
  const issueMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of JSON.parse(issueKey) as typeof issues) map.set(issue.path, [...(map.get(issue.path) ?? []), issueText(issue)]);
    return map;
  }, [issueKey]);
  // The element only travels with the context for block programs, which need it for their checks.
  const hasProgram = !!type && typeFields(type).some((f) => f.type === "blockly");
  const programElement = hasProgram ? draft : undefined;
  const itemDisplay = target.typeId === "block" && typeof draft?.itemDisplay === "string" ? draft.itemDisplay : undefined;
  // Keyed by content, like the issues: the memoized field rows only re-render when the mapping changes.
  const modelTexturesKey = target.typeId === "block" ? JSON.stringify(draft?.customModelTextures ?? {}) : "{}";
  const modelTextures = useMemo(() => JSON.parse(modelTexturesKey) as Record<string, string>, [modelTexturesKey]);
  /** An empty procedure with a free id from `base`, saved right away so the field can name it. */
  const createProcedure = async (base: string) => {
    const procedureType = typeOf("procedure")!;
    const id = freeId(snapshot, "procedure", toRegistryId(base));
    const element = newElement(procedureType, id);
    const nameField = displayNameField(procedureType);
    if (nameField) element[nameField.key] = id;
    onSaved(await api.saveElement(snapshot.dir, "procedure", element));
    return id;
  };
  const ctx: FormContext = useMemo(
    () => ({ snapshot, typeId: target.typeId, coverage, engineName, issues: issueMap, element: programElement, engine, itemDisplay, modelTextures,
      openElement: (typeId: string, id: string) => onOpen({ typeId, id }), createProcedure, elementId: target.id }),
    // createProcedure reads the snapshot it is given; it changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, target.typeId, target.id, coverage, engineName, issueMap, programElement, engine, itemDisplay, modelTextures, onOpen],
  );

  if (!draft) return null;
  if (!type) return <p className="empty-note">{t("editor.unknownType", { type: target.typeId })}</p>;
  const fields = typeFields(type);
  const texture = elementTexture(snapshot, target.typeId, draft);
  const notGenerated = typeGenerated(coverage, type.id) === "no";
  const issuesOnPage = (fieldsOfPage: FieldDef[]) =>
    issues.filter((i) => fieldsOfPage.some((f) => i.path === f.key || i.path.startsWith(`${f.key}[`) || i.path.startsWith(`${f.key}.`))).length;
  // Simple mode hides advanced pages (Q244); one with a problem stays, so the problem can be fixed.
  const pages = type.pages.filter((p, i) => i === 0 || !hidden("pages", p.id) || issuesOnPage(p.groups.flatMap((g) => g.fields)) > 0);
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const hasNameField = !!displayNameField(type);

  const duplicate = async () => {
    const [next, copy] = await duplicateElement(snapshot, target);
    onSaved(next);
    onOpen(copy);
  };
  const remove = () => {
    deletingSelf.current = true;
    setDeleting(true);
  };
  const deleteDialog = deleting && (
    <DeleteElementDialog snapshot={snapshot} target={target} engineId={engine?.id} onDone={(next) => {
      deletingSelf.current = !!next;
      setDeleting(false);
      if (next) (onSaved(next), onClose());
    }} />
  );
  const showPage = (id: string) => {
    lastPage.set(type.id, id);
    setPageId(id);
  };

  const deletedDialog = deleted && (
    <Dialog title={t("editor.deletedTitle")} okLabel={t("editor.restore")} cancelLabel={t("editor.discardDeleted")} canOk explicit
      onOk={() => ((restoring.current = true), setDeleted(false), setDraft({ ...draft }))} onCancel={onClose}>
      <p className="hint">{t("editor.deletedOnDisk", { name: elementName(type.id, draft) })}</p>
    </Dialog>
  );
  const identityParts = (description: boolean) => (
    <>
      <span className="slot small">
        {texture ? <Texture dir={snapshot.dir} path={texture} size={24} /> : <Sprite name={spriteFor(type.id)} size={24} />}
      </span>
      <span className="edname" title={description ? undefined : type.description}>{elementName(type.id, draft)}</span>
      <span className="ttype">{type.name}</span>
      {notGenerated && <span className="genbadge" title={t("editor.typeNotGenerated", { engine: engineName, type: type.name })}>{t("editor.notGenerated")}</span>}
      {live && <LiveChip live={live} />}
      {description && <span className="fmeta" title={type.description}>{type.description}</span>}
      <AgentFieldMarks fields={agentFields} />
    </>
  );
  const head = (
    <div className="findbar edhead">
      {deletedDialog}{deleteDialog}
      {identityParts(true)}
    </div>
  );
  // Duplicate and Delete of the whole element sit in one Element menu in every editor (KUYRUK 125): the GUI and
  // procedure editors have their own red Remove beside it, so the two cannot be mixed up.
  const elementActions = (
    <>
      <ActionButton icon="back" label={backName ? t("editor.backTo", { name: backName }) : t("editor.back")} onClick={onClose} />
      <Separator />
      <ElementMenu onDuplicate={duplicate} onDelete={remove} />
    </>
  );
  // Procedures get a page of their own: the block canvas with its settings beside it.
  if (type.id === "procedure") {
    const settings = type.pages.flatMap((p) => p.groups).filter((g) => !g.fields.some((f) => f.type === "blockly")).flatMap((g) => g.fields);
    return (
      <section className="view">
        {head}
        <RefDatalists snapshot={snapshot} />
        <ProcedurePage key={programRev} snapshot={snapshot} draft={draft} engine={engine} ctx={ctx} settings={settings} all={fields} onChange={setField}
          elementActions={elementActions} />
      </section>
    );
  }
  // GUIs and overlays: the layout canvas with the widget properties and the other settings beside it.
  const layout = fields.find((f) => f.type === "gui_layout");
  if (layout) {
    return (
      <section className="view">
        {/* The identity of the element sits in the editor's own top bar (Q278), not in a header row of its own. */}
        {deletedDialog}{deleteDialog}
        <RefDatalists snapshot={snapshot} />
        <GuiLayoutPage snapshot={snapshot} typeId={type.id} draft={draft} ctx={ctx} layout={layout} groups={type.pages.flatMap((p) => p.groups)}
          all={fields} onChange={setField} elementActions={elementActions} identity={identityParts(false)} />
      </section>
    );
  }

  // The generic form page (Q279): one 40 px bar (back, identity, Element menu, inspector toggle), one row of page tabs, the
  // form as sections and the inspector with the live preview and the problems of the element.
  const generic = type.id !== "bubble" && type.id !== "radial_menu" && !(type.id === "block" && ((page.id === "seat" && draft.seatable === true) || (page.id === "bounding_boxes" && draft.multiBlock === true)));
  const sections: DockSection[] = [
    ...(previews && generic ? [{ id: "editor.preview", icon: "image" as const, title: t("dock.preview"), body: <FormPreview snapshot={snapshot} type={type} draft={draft} name={elementName(type.id, draft)} /> }] : []),
    { id: "editor.problems", icon: "warn" as const, title: t("dock.problems"), badge: issues.length ? String(issues.length) : undefined, defaultOpen: issues.length > 0,
      body: issues.length ? <ul className="gi-list probs">{issues.map((i, k) => <li key={k}><Icon name="warn" size={12} /><span title={i.path}>{issueText(i)}</span></li>)}</ul> : <p className="hint">{t("dock.noProblemsHere")}</p> },
  ];
  const formArea = (
    <div className="formscroll" onContextMenu={onNewTask && ((e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".frow[data-field]");
      // Text fields keep their own menu (copy, paste); the label and the row around them offer the task.
      if (!row || (e.target as HTMLElement).closest("input, textarea, select")) return;
      e.preventDefault();
      setFieldMenu({ x: e.clientX, y: e.clientY, field: row.dataset.field!.replace(/[.[].*$/, "") });
    })}>
      {fieldMenu && onNewTask && (
        <ContextMenu x={fieldMenu.x} y={fieldMenu.y} onClose={() => setFieldMenu(undefined)}
          items={[{ label: t("newTask.menu"), onClick: () => onNewTask({ kind: "field", target: `${target.typeId}/${target.id}`, field: fieldMenu.field }) }]} />
      )}
      <RefDatalists snapshot={snapshot} />
      <div className={`formcols${generic ? "" : " beside"}`}>
        <div className="form wide-labels" key={`${page.id}:${programRev}`}>
          {notGenerated && <p className="notice">{t("editor.typeNotGenerated", { engine: engineName, type: type.name })}</p>}
          {page.id === type.pages[0].id && (
            <FormGroup title={t("group.element")} collapsible>
              <div className="frow efrow">
                <label>{t("field.id")}</label>
                <div className="fval"><code>{snapshot.project.mod.id}:{draft.id}</code></div>
              </div>
              {!hasNameField && (
                <div className="frow efrow">
                  <label>{t("field.title")}</label>
                  <div className="fctl">
                    <input value={draft.title ?? ""} placeholder={draft.id} onChange={(e) => setField("title", e.target.value)} />
                    <p className="fhelp">{t("field.titleHelp")}</p>
                  </div>
                </div>
              )}
            </FormGroup>
          )}
          {page.groups.map((group) => (
            <GroupView key={group.title} title={group.title} fields={group.fields} all={fields} draft={draft} ctx={ctx} onChange={setField} />
          ))}
          <Problems issues={issues.map((i) => ({ path: `${issuePrefix(target)}.${i.path}`, message: issueText(i) }))} />
        </div>
        {/* Bubbles are designed on a canvas like a small overlay (Q216) and radial menus show their wheel (Q227); seats and
            multi-block cells sit on the block's model (Q225, Q226). Those stay beside the form; the other types show their
            textures in the inspector. */}
        {type.id === "bubble" ? <BubblePreview snapshot={snapshot} draft={draft} onChange={setField} />
          : type.id === "radial_menu" ? (previews ? <RadialPreview snapshot={snapshot} draft={draft} /> : null)
          : type.id === "block" && page.id === "seat" && draft.seatable === true ? <SeatPreview snapshot={snapshot} draft={draft} onChange={setField} />
          : type.id === "block" && page.id === "bounding_boxes" && draft.multiBlock === true ? <SeatPreview snapshot={snapshot} draft={draft} onChange={setField} cellsOnly />
          : null}
      </div>
    </div>
  );
  return (
    <section className="view">
      <div className="findbar edhead dk-bar actions">
        {deletedDialog}{deleteDialog}
        <ActionButton hideLabel icon="back" label={backName ? t("editor.backTo", { name: backName }) : t("editor.back")} onClick={onClose} />
        <span className="slot small">
          {texture ? <Texture dir={snapshot.dir} path={texture} size={24} /> : <Sprite name={spriteFor(type.id)} size={24} />}
        </span>
        <span className="edname">{elementName(type.id, draft)}</span>
        <span className="ttype" title={type.description}>{type.name}</span>
        {notGenerated && <span className="genbadge" title={t("editor.typeNotGenerated", { engine: engineName, type: type.name })}>{t("editor.notGenerated")}</span>}
        {live && <LiveChip live={live} />}
        <AgentFieldMarks fields={agentFields} />
        <Separator />
        {/* The same Element menu as the GUI and procedure editors (KUYRUK 125). */}
        <ElementMenu onDuplicate={duplicate} onDelete={remove} />
        <span className="dk-grow" />
        {generic && <InspectorToggle />}
      </div>
      {pages.length > 1 && (
        <PageTabs label={t("editor.pages")} active={page.id} onShow={showPage}
          pages={pages.map((p) => ({ id: p.id, title: p.title, count: issuesOnPage(p.groups.flatMap((g) => g.fields)) }))} />
      )}
      {generic ? <ViewShell sections={sections} inspectorLabel={t("dock.inspector")}>{formArea}</ViewShell> : formArea}
    </section>
  );
}

/** Duplicate and Delete of the open element, behind one button. */
function ElementMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menuwrap elementmenu">
      <ActionButton icon="more" popup label={t("editor.elementMenu")} title={t("editor.elementMenuTip")} pressed={open} onClick={() => setOpen(!open)} />
      {open && (
        <MenuList onClose={() => setOpen(false)} items={[
          { label: t("action.duplicate"), onClick: onDuplicate },
          { label: "", separator: true },
          { label: t("action.delete"), danger: true, onClick: onDelete },
        ]} />
      )}
    </div>
  );
}

/** A group whose fields are all hidden by showIf is left out entirely. */
function GroupView({ title, fields, all, draft, ctx, onChange }: {
  title: string;
  fields: FieldDef[];
  all: FieldDef[];
  draft: Element;
  ctx: FormContext;
  onChange: (key: string, value: unknown) => void;
}) {
  // showIf may read fields of other groups, so the scope is the whole element.
  const scope = { fields: all, values: draft };
  const visible = visibility(scope);
  if (!fields.some((f) => visible(f.key))) return null;
  return (
    <FormGroup title={title} titleLang="en" collapsible>
      <FieldList fields={fields} scope={scope} ctx={ctx} prefix="" coveragePrefix="" onChange={onChange} />
    </FormGroup>
  );
}

/** Shown for a while after an outside change (an AI agent) was merged into the open element. */
function LiveChip({ live }: { live: { taken: string[]; conflicts: string[] } }) {
  const fields = live.taken.map((p) => (p === "." ? t("live.everything") : p)).join(", ");
  return (
    <span className={`livechip ${live.conflicts.length ? "conflict" : ""}`}
      title={live.conflicts.length ? t("live.keptYours", { fields: live.conflicts.join(", ") }) : t("live.updatedFields", { fields })}>
      <i className="liveled" />{t(live.conflicts.length ? "live.mergedConflict" : "live.updated")}
    </span>
  );
}

/**
 * Highlights the rows of the fields the AI agent works on (rows carry data-field) without re-rendering the form,
 * and names them in the header.
 */
function AgentFieldMarks({ fields }: { fields?: string[] }) {
  if (!fields?.length) return null;
  const rows = fields.map((f) => `.form .frow[data-field="${CSS.escape(f)}"]`).join(", ");
  return (
    <>
      <style>{`${rows} { box-shadow: inset 3px 0 0 #5fb8f0; background: rgba(95, 184, 240, .10); } ${fields.map((f) => `.form .frow[data-field="${CSS.escape(f)}"] > label::after`).join(", ")} { content: "${t("timeline.agentFieldMark").replaceAll('"', "")}"; margin-left: 6px; padding: 0 4px; font-size: 9.5px; letter-spacing: .05em; text-transform: uppercase; color: #fff; background: #3a86c4; }`}</style>
      <span className="agentchip" title={t("timeline.agentFieldsHint", { fields: fields.join(", ") })}><i className="liveled" />{t("timeline.agentFields", { fields: fields.join(", ") })}</span>
    </>
  );
}
