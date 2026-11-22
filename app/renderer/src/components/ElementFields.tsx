import { memo, useEffect, useMemo, useState } from "react";
import vanillaIds from "../../../../config/vanilla-ids.json" with { type: "json" };
import {
  defaultValues,
  REGISTRY_FIELD_TYPES,
  REGISTRY_PROVIDERS,
  visibility,
  type FieldDef,
  type OptionValue,
  type RegistryKind,
  type Scope,
  type Values,
} from "../../../../src/elements/model.ts";
import { FACES, type FaceName } from "../../../../src/resources/blockModel.ts";
import type { Coverage, Element, EngineInfo, ProjectSnapshot } from "../../../shared/api.ts";
import { ModelPreview } from "../models/ModelPreview.tsx";
import { ModelTexturesInput } from "../models/ModelTextures.tsx";
import { BlockFacesCube, faceSources } from "../models/BlockFaces.tsx";
import { useBlockbench } from "../models/Blockbench.tsx";
import { ProcedurePicker } from "./ProcedurePicker.tsx";
import { RegistryPicker } from "./RegistryPicker.tsx";
import { EmbeddedProgram } from "../procedures/EmbeddedProgram.tsx";
import { elementName, elementsOf } from "../model.ts";
import { t } from "../strings.ts";
import { usePerformance } from "../preferences.ts";
import { fieldGenerated } from "../types.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { TabOrderInput } from "./TabOrderInput.tsx";
import { TexturePicker } from "./TexturePicker.tsx";

/* Generic form engine: renders any element type's fields from its type.json definition. */

export interface FormContext {
  snapshot: ProjectSnapshot;
  typeId: string;
  coverage?: Coverage;
  engineName: string;
  /** Validation messages by field path ("stackSize", "repairItems[0].item"). */
  issues: Map<string, string[]>;
  /** The element being edited and the selected engine, for block programs. */
  element?: Element;
  engine?: EngineInfo;
  /** A block's item display field (JSON text), which the model preview shows as the block item's display contexts. */
  itemDisplay?: string;
  /** A block's model texture slot mapping (customModelTextures), which the model preview draws with. */
  modelTextures?: Record<string, string>;
  /** Opens another element (a procedure a field names) in the editor. */
  openElement?: (typeId: string, id: string) => void;
  /** Creates an empty procedure with a free id made from `base` and returns its id (MCreator's "+" by a procedure field). */
  createProcedure?: (base: string) => Promise<string>;
  /** Registry id of the element being edited, for names derived from it. */
  elementId?: string;
}

type Change = (key: string, value: unknown) => void;

/** Fields of one group (or list row) with live showIf; hidden fields are not rendered at all. */
export function FieldList({ fields, scope, ctx, prefix, coveragePrefix, onChange, parentVisible }: {
  fields: FieldDef[];
  scope: Scope;
  ctx: FormContext;
  /** Issue path prefix of this level: "" or "repairItems[0].". */
  prefix: string;
  /** Coverage path prefix: "" or "repairItems.". */
  coveragePrefix: string;
  onChange: Change;
  parentVisible?: (key: string) => boolean;
}) {
  const visible = visibility(scope, parentVisible);
  const shown = fields.filter((field) => visible(field.key));
  // A block's face textures sit together on one 3D cube (KUYRUK 187); a lone main texture (custom model) stays a row.
  const faces = shown.filter((field) => field.cubeFace);
  return (
    <>
      {shown.map((field) => faces.length > 1 && field.cubeFace ? (
        field === faces[0] && <CubeFacesRow key="cubefaces" fields={faces} values={scope.values} ctx={ctx} prefix={prefix} coveragePrefix={coveragePrefix} onChange={onChange} />
      ) : (
        <FieldRow key={field.key} field={field} value={scope.values[field.key]} onChange={onChange} ctx={ctx}
          path={prefix + field.key} coveragePath={coveragePrefix + field.key}
          errors={ctx.issues.get(prefix + field.key)?.join("; ") ?? ""}
          scope={isNested(field) ? scope : undefined} visible={isNested(field) ? visible : undefined} />
      ))}
    </>
  );
}

// A list reads its rows' showIf from the enclosing scope; a model's texture slots read the model field beside them.
const isNested = (field: FieldDef) => field.type === "list" || (field.type === "map" && !!field.modelField);
const TOP_ALIGNED = new Set(["list", "map", "recipe_grid", "multiselect", "multiline", "gui_layout", "blockly", "tab_order"]);

interface RowProps {
  field: FieldDef;
  value: unknown;
  onChange: Change;
  ctx: FormContext;
  path: string;
  coveragePath: string;
  errors: string;
  /** Only for lists: the enclosing scope their rows' showIf may read. */
  scope?: Scope;
  visible?: (key: string) => boolean;
}

/** One aligned row: label, control, generation badge, help and validation messages. */
const FieldRow = memo(function FieldRow({ field, value, onChange, ctx, path, coveragePath, errors, scope, visible }: RowProps) {
  const set = (next: unknown) => onChange(field.key, next);
  return (
    <div className={`frow efrow ${TOP_ALIGNED.has(field.type) ? "top" : ""}`} data-field={path}>
      <label title={field.label}>{field.label}{field.required && <span className="req" aria-hidden="true">*</span>}</label>
      <div className="fctl">
        <FieldControl field={field} value={value} set={set} ctx={ctx} path={path} coveragePath={coveragePath} scope={scope} visible={visible} />
        {field.help && <p className="fhelp">{field.help}</p>}
        {errors && <p className="ferr"><Icon name="warn" size={12} />{errors}</p>}
      </div>
      <GenBadge ctx={ctx} path={coveragePath} />
    </div>
  );
});

/**
 * The face textures of a block on a 3D cube (KUYRUK 187): each face shows its texture and name, a click on a face opens
 * the texture grid of the field that draws it, and the fields stay listed beside the cube as normal rows (keyboard,
 * screen readers, validation messages, generation markers). Faces the block's shape draws with another field (a slab's
 * sides with the front texture) open that field; a field the shape does not draw says so.
 */
function CubeFacesRow({ fields, values, ctx, prefix, coveragePrefix, onChange }: {
  fields: FieldDef[];
  values: Values;
  ctx: FormContext;
  prefix: string;
  coveragePrefix: string;
  onChange: Change;
}) {
  const { dir, textures } = ctx.snapshot;
  const { render3d } = usePerformance();
  const [hovered, setHovered] = useState<FaceName>();
  const [focused, setFocused] = useState<string>();
  const [requests, setRequests] = useState<Record<string, number>>({});
  const fieldOf = (face: FaceName) => fields.find((f) => f.cubeFace === face) ?? fields.find((f) => f.cubeFace === "down") ?? fields[0];
  const sources = faceSources(typeof values.blockBase === "string" ? values.blockBase : "", Number(values.renderType));
  const main = String(values[fieldOf("down").key] ?? "");
  const drawn = Object.fromEntries(FACES.map((face) => [face, String(values[fieldOf(sources[face]).key] ?? "") || main])) as Record<FaceName, string>;
  const names = Object.fromEntries(FACES.map((face) => [face, drawn[face] ? fileBase(drawn[face]) : t("field.none")])) as Record<FaceName, string>;
  const used = new Set(FACES.map((face) => fieldOf(sources[face]).key));
  const editing = hovered ? fieldOf(sources[hovered]).key : focused;
  const active = FACES.filter((face) => fieldOf(sources[face]).key === editing);
  const pick = (face: FaceName) => {
    const key = fieldOf(sources[face]).key;
    setRequests((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
  };
  return (
    <div className="frow efrow top cuberow">
      <label title={t("cubeFaces.title")}>{t("cubeFaces.title")}</label>
      <div className="fctl cubefaces">
        <div className="cubeside">
          <BlockFacesCube dir={dir} files={textures} textures={drawn} active={active} names={names} onPick={pick} onHover={setHovered} />
          {render3d && <p className="fhelp">{t("cubeFaces.help")}</p>}
        </div>
        <div className="cubefields">
          {fields.map((field) => {
            const path = prefix + field.key;
            const value = String(values[field.key] ?? "");
            const errors = ctx.issues.get(path)?.join("; ") ?? "";
            return (
              <div key={field.key} className={`frow efrow${field.key === editing ? " on" : ""}`} data-field={path}
                onMouseEnter={() => setFocused(field.key)} onMouseLeave={() => setFocused(undefined)}
                onFocus={() => setFocused(field.key)} onBlur={() => setFocused(undefined)}>
                <label title={field.label}>{field.label}{field.required && <span className="req" aria-hidden="true">*</span>}</label>
                <div className="fctl">
                  <TexturePicker dir={dir} textures={textures} value={value} allowNone={!field.required || !value} label={field.label}
                    openRequest={requests[field.key]} onChange={(next) => onChange(field.key, next)} />
                  {!used.has(field.key) ? <p className="fhelp">{t("cubeFaces.unused")}</p> : field.help && <p className="fhelp">{field.help}</p>}
                  {errors && <p className="ferr"><Icon name="warn" size={12} />{errors}</p>}
                </div>
                <GenBadge ctx={ctx} path={coveragePrefix + field.key} />
              </div>
            );
          })}
        </div>
      </div>
      <span />
    </div>
  );
}

const fileBase = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.png$/i, "");

function GenBadge({ ctx, path }: { ctx: FormContext; path: string }) {
  const [head] = path.split(".");
  // Sub-fields of a list are badged only when the engine lists some sub-fields but not this one.
  if (path.includes(".") && !Object.keys(ctx.coverage?.[ctx.typeId] ?? {}).some((key) => key.startsWith(`${head}.`))) return <span />;
  const { state, values } = fieldGenerated(ctx.coverage, ctx.typeId, path);
  if (state === "yes") return <span />;
  if (state === "partly") {
    const title = t("editor.partlyGeneratedTitle", { engine: ctx.engineName, values: values!.map(String).join(", ") });
    return <span className="genmark part" role="img" title={title} aria-label={title} />;
  }
  // One quiet marker per field (KUYRUK 137, X1); the tooltip says which engine does not generate it.
  const title = t("editor.notGeneratedTitle", { engine: ctx.engineName });
  return <span className="genmark" role="img" title={title} aria-label={title} />;
}

interface ControlProps {
  field: FieldDef;
  value: unknown;
  set: (value: unknown) => void;
  ctx: FormContext;
  path: string;
  coveragePath: string;
  scope?: Scope;
  visible?: (key: string) => boolean;
}

function FieldControl(props: ControlProps) {
  const { field, value, set, ctx } = props;
  const str = typeof value === "string" ? value : "";
  switch (field.type) {
    case "text":
      return <input value={str} maxLength={field.maxLength} spellCheck={false} onChange={(e) => set(e.target.value)} />;
    case "multiline":
      return <textarea rows={3} value={str} onChange={(e) => set(e.target.value)} />;
    case "integer":
    case "number":
      return <NumberInput value={value} integer={field.type === "integer"} step={field.step} min={field.min} max={field.max} onChange={set} />;
    case "boolean":
      return <label className="check"><input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} /></label>;
    case "select":
      return <SelectInput field={field} value={value} set={set} ctx={ctx} />;
    case "multiselect":
      return <ChoiceList choices={choicesOf(field, ctx)} value={Array.isArray(value) ? value : []} set={set} />;
    case "texture":
      return <TextureInput value={str} required={!!field.required} set={set} ctx={ctx} />;
    case "color":
      return (
        <div className="fpair">
          <input type="color" className="swatch" value={/^#[0-9a-f]{6}$/i.test(str) ? str : "#000000"} onChange={(e) => set(e.target.value)} />
          <input value={str} placeholder={t("field.vanillaDefault")} spellCheck={false} onChange={(e) => set(e.target.value.trim())} />
        </div>
      );
    case "tag":
      return <input list="ref-tag" value={str} placeholder={t("field.tagHint")} spellCheck={false} onChange={(e) => set(e.target.value.trim())} />;
    case "sound":
      return <input list="ref-sound" value={str} placeholder={t("field.refHint")} spellCheck={false} onChange={(e) => set(e.target.value.trim())} />;
    case "model":
      return <ModelInput value={str} set={set} ctx={ctx} />;
    case "procedure":
      return <ProcedureInput field={field} value={str} set={set} ctx={ctx} />;
    case "element":
      return <ElementInput field={field} value={value} set={set} ctx={ctx} />;
    case "range":
      return <RangeInput field={field} value={value} set={set} />;
    case "vector":
      return <VectorInput value={value} set={set} />;
    case "recipe_grid":
      return <RecipeGrid size={field.size ?? 3} value={Array.isArray(value) ? value.map(String) : []} set={set} ctx={ctx} />;
    case "item":
    case "block":
    case "entity":
      return <RegistryPicker kind={field.type} value={str} onChange={set} snapshot={ctx.snapshot} minecraft={ctx.engine?.minecraft}
        allowTags={!!field.allowTags} allowNone={!field.required || !str} />;
    case "list":
      return <ListInput {...props} />;
    case "map":
      if (field.modelField && props.scope) {
        return <ModelTexturesInput snapshot={ctx.snapshot} model={String(props.scope.values[field.modelField] ?? "")} renderType={Number(props.scope.values.renderType)}
          value={value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {}} set={set} />;
      }
      return <MapInput {...props} />;
    case "gui_layout":
      return <DedicatedEditor kind={field.type} value={value} />;
    case "tab_order":
      return <TabOrderInput tabId={ctx.elementId ?? ""} value={value} set={set} snapshot={ctx.snapshot} label={field.label} />;
    case "blockly":
      return ctx.element
        ? <EmbeddedProgram value={value} set={set} snapshot={ctx.snapshot} element={ctx.element} engine={ctx.engine} label={field.label} />
        : <DedicatedEditor kind={field.type} value={value} />;
    default:
      if ((REGISTRY_FIELD_TYPES as readonly string[]).includes(field.type)) {
        return <input list={`ref-${field.type}`} value={str} placeholder={t("field.refHint")} spellCheck={false} onChange={(e) => set(e.target.value.trim())} />;
      }
      return <input value={str} onChange={(e) => set(e.target.value)} />;
  }
}

/**
 * Number field with a text input: numbers always show and parse with a dot, whatever the system locale
 * (a native number input would format 1.5 as "1,5" on a Turkish system). A comma typed by habit is read
 * as a dot. While the text is not a number yet ("", "-", "1.") the stored value stays unchanged.
 */
function NumberInput({ value, integer, step, min, max, onChange }: {
  value: unknown;
  integer: boolean;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const format = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const [text, setText] = useState(format(value));
  useEffect(() => {
    if (Number(text.replace(",", ".")) !== value || text.trim() === "") setText(format(value));
    // Only an outside change of the value rewrites the text; typing keeps what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    const cleaned = raw.replace(",", ".");
    setText(cleaned);
    const n = Number(cleaned);
    if (cleaned.trim() !== "" && Number.isFinite(n)) onChange(n);
  };
  const nudge = (direction: number) => {
    const current = typeof value === "number" ? value : 0;
    let next = Math.round((current + direction * (step ?? 1)) * 1e6) / 1e6;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    commit(String(next));
  };
  return (
    <input className="num" inputMode={integer ? "numeric" : "decimal"} value={text} spellCheck={false}
      onChange={(e) => commit(e.target.value)} onBlur={() => setText(format(value))}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") (e.preventDefault(), nudge(e.key === "ArrowUp" ? 1 : -1));
      }} />
  );
}

interface Choice {
  value: OptionValue;
  label: string;
  group?: string;
}

/** A select's options, then this mod's elements of its elementTypes. */
function choicesOf(field: FieldDef, ctx: FormContext): Choice[] {
  const options: Choice[] = (field.options ?? []).map((o) => ({ value: o.value, label: o.label }));
  const elements = elementsOf(ctx.snapshot, field.elementTypes ?? []).map(({ typeId, element }) => ({
    value: element.id,
    label: `${elementName(typeId, element)} (${element.id})`,
    group: t("field.thisMod"),
  }));
  return [...options, ...elements];
}

/** Selects keep option values exactly (numbers stay numbers) by selecting on the option index. */
function SelectInput({ field, value, set, ctx }: { field: FieldDef; value: unknown; set: (v: unknown) => void; ctx: FormContext }) {
  const choices = choicesOf(field, ctx);
  // An unset value shows the field's default (a widget's optional select, such as an overlay widget's anchor).
  const index = choices.findIndex((c) => c.value === (value === undefined ? field.default : value));
  return (
    <select value={index} onChange={(e) => set(choices[Number(e.target.value)]?.value ?? value)}>
      {index < 0 && <option value={-1}>{t("field.unknownValue", { value: String(value) })}</option>}
      {choices.map((c, i) => <option key={i} value={i}>{c.group ? `${c.label}` : c.label}</option>)}
    </select>
  );
}

function ChoiceList({ choices, value, set }: { choices: Choice[]; value: unknown[]; set: (v: unknown) => void }) {
  const toggle = (choice: OptionValue, on: boolean) => set(on ? [...value, choice] : value.filter((v) => v !== choice));
  if (!choices.length) return <p className="hint">{t("field.noChoices")}</p>;
  return (
    <div className="check-list">
      {choices.map((c, i) => (
        <label key={i} className="check">
          <input type="checkbox" checked={value.includes(c.value)} onChange={(e) => toggle(c.value, e.target.checked)} />
          {c.label}{c.group && <span className="dim"> · {c.group}</span>}
        </label>
      ))}
    </div>
  );
}

/** A model name with its 3D preview and, for a project JSON model, Edit in Blockbench (KUYRUK 171). */
function ModelInput({ value, set, ctx }: { value: string; set: (v: unknown) => void; ctx: FormContext }) {
  const json = ctx.snapshot.models.includes(`models/${value}.json`);
  const blockbench = useBlockbench(ctx.snapshot.dir);
  useEffect(() => blockbench.reset(), [value]);
  return (
    <>
      <div className="fpair">
        <input list="ref-model" value={value} spellCheck={false} onChange={(e) => set(e.target.value)} />
        <button type="button" className="abtn bbedit" disabled={!json} title={json ? undefined : t("blockbench.jsonOnly")}
          onClick={() => void blockbench.open(value, ctx.modelTextures)}>
          <Icon name="cube" /><span>{t("blockbench.edit")}</span>
        </button>
      </div>
      {blockbench.note}
      {json && (
        <ModelPreview dir={ctx.snapshot.dir} modId={ctx.snapshot.project.mod.id} model={value} textures={ctx.snapshot.textures} itemDisplay={ctx.itemDisplay}
          textureOverrides={ctx.modelTextures} />
      )}
    </>
  );
}

function TextureInput({ value, required, set, ctx }: { value: string; required: boolean; set: (v: unknown) => void; ctx: FormContext }) {
  const { textures, dir } = ctx.snapshot;
  return <TexturePicker dir={dir} textures={textures} value={value} allowNone={!required || !value} onChange={set} />;
}

function ProcedureInput({ field, value, set, ctx }: { field: FieldDef; value: string; set: (v: unknown) => void; ctx: FormContext }) {
  const procedures = ctx.snapshot.project.elements.procedure ?? [];
  const exists = procedures.some((p) => p.id === value);
  // "onRightClickedInAir" of ruby_gem: ruby_gem_right_clicked_in_air.
  const base = `${ctx.elementId ?? ctx.typeId}_${field.key.replace(/^on(?=[A-Z])/, "").replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "")}`;
  const create = async () => {
    const id = await ctx.createProcedure!(base);
    set(id);
    ctx.openElement?.("procedure", id);
  };
  return (
    <>
      <div className="fpair">
        <ProcedurePicker value={value} onChange={set}
          choices={[...(value && !exists ? [{ id: value, name: value }] : []), ...procedures.map((p) => ({ id: p.id, name: elementName("procedure", p) }))]} />
        {ctx.openElement && (
          <button type="button" className="mbtn procopen" title={t("procedure.open")} disabled={!exists}
            onClick={() => ctx.openElement?.("procedure", value)}><Icon name="edit" size={12} /><span>{t("procedure.openShort")}</span></button>
        )}
        {ctx.createProcedure && ctx.openElement && (
          <button type="button" className="mbtn procnew" title={t("procedure.newTitle", { id: base })} onClick={() => void create()}>
            <Icon name="plus" size={12} /><span>{t("procedure.new")}</span>
          </button>
        )}
      </div>
      {field.dependencies?.length ? <p className="fhelp">{t("procedure.receives", { values: field.dependencies.join(", ") })}</p> : null}
    </>
  );
}

function ElementInput({ field, value, set, ctx }: { field: FieldDef; value: unknown; set: (v: unknown) => void; ctx: FormContext }) {
  const choices = choicesOf(field, ctx);
  if (field.multiple) return <ChoiceList choices={choices} value={Array.isArray(value) ? value : []} set={set} />;
  const str = typeof value === "string" ? value : "";
  if (field.allowCustom) {
    const listId = `el-${field.key}`;
    return (
      <>
        <input list={listId} value={str} placeholder={t("field.refHint")} spellCheck={false} onChange={(e) => set(e.target.value.trim())} />
        <datalist id={listId}>{choices.map((c, i) => <option key={i} value={String(c.value)}>{c.label}</option>)}</datalist>
      </>
    );
  }
  const index = choices.findIndex((c) => c.value === str);
  return (
    <select value={index} onChange={(e) => set(Number(e.target.value) < 0 ? "" : choices[Number(e.target.value)].value)}>
      <option value={-1}>{str && index < 0 ? t("field.unknownValue", { value: str }) : t("field.none")}</option>
      {choices.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
    </select>
  );
}

function RangeInput({ field, value, set }: { field: FieldDef; value: unknown; set: (v: unknown) => void }) {
  const range = (value ?? {}) as { min?: number; max?: number };
  return (
    <div className="fpair">
      <span className="dim">{t("range.min")}</span>
      <NumberInput value={range.min} integer={false} step={field.step} onChange={(min) => set({ ...range, min })} />
      <span className="dim">{t("range.max")}</span>
      <NumberInput value={range.max} integer={false} step={field.step} onChange={(max) => set({ ...range, max })} />
    </div>
  );
}

function VectorInput({ value, set }: { value: unknown; set: (v: unknown) => void }) {
  const vector = (value ?? {}) as Record<string, number>;
  return (
    <div className="fpair">
      {(["x", "y", "z"] as const).map((axis) => (
        <span key={axis} className="axis">
          <span className="dim">{axis.toUpperCase()}</span>
          <NumberInput value={vector[axis]} integer={false} onChange={(n) => set({ ...vector, [axis]: n })} />
        </span>
      ))}
    </div>
  );
}

/** Crafting grid of inventory slots; each slot opens the item picker (tags allowed, None empties it). */
function RecipeGrid({ size, value, set, ctx }: { size: number; value: string[]; set: (v: unknown) => void; ctx: FormContext }) {
  const slots = Array.from({ length: size * size }, (_, i) => value[i] ?? "");
  return (
    <div className="recipe-grid" style={{ gridTemplateColumns: `repeat(${size}, 44px)` }}>
      {slots.map((slot, i) => (
        <RegistryPicker key={i} kind="item" variant="slot" label={t("recipe.slot", { n: i + 1 })} value={slot} allowTags snapshot={ctx.snapshot}
          minecraft={ctx.engine?.minecraft} onChange={(next) => set(slots.map((s, j) => (j === i ? next : s)))} />
      ))}
    </div>
  );
}

/** Compact toolbar of a list or map control: selection-based actions, left aligned. */
export function MiniBar({ actions, meta }: { actions: { icon: IconName; label: string; onClick?: () => void; tone?: string }[]; meta: string }) {
  return (
    <div className="minibar" role="toolbar">
      {actions.map((a) => (
        <button key={a.label} type="button" className={`mbtn ${a.tone ?? ""}`} disabled={!a.onClick} onClick={a.onClick} title={a.label}>
          <Icon name={a.icon} size={12} /><span>{a.label}</span>
        </button>
      ))}
      <span className="fmeta">{meta}</span>
    </div>
  );
}

/** List of sub-forms: rows on top, the selected row's form below; add, remove and reorder act on the selection. */
function ListInput({ field, value, set, ctx, path, coveragePath, scope, visible }: ControlProps) {
  const rows = (Array.isArray(value) ? value : []) as Values[];
  const [selected, setSelected] = useState(rows.length ? 0 : -1);
  const current = selected >= 0 && selected < rows.length ? selected : -1;
  const sub = field.fields ?? [];
  const max = field.maxItems ?? Infinity;
  const move = (from: number, to: number) => {
    const next = [...rows];
    next.splice(to, 0, ...next.splice(from, 1));
    set(next);
    setSelected(to);
  };
  const summary = (row: Values, i: number) => {
    // Numbers such as speeds say little about a row; the first text value names it best.
    const first = sub.find((f) => typeof row[f.key] === "string" && row[f.key] !== "");
    return first ? String(row[first.key]) : t("list.entry", { n: i + 1 });
  };
  return (
    <div className="listctl">
      <MiniBar meta={t("list.count", { count: rows.length })} actions={[
        { icon: "plus", label: t("list.add"), onClick: rows.length < max ? () => (set([...rows, defaultValues(sub)]), setSelected(rows.length)) : undefined },
        { icon: "trash", label: t("list.remove"), tone: "danger", onClick: current >= 0 ? () => (set(rows.filter((_, i) => i !== current)), setSelected(Math.min(current, rows.length - 2))) : undefined },
        { icon: "up", label: t("list.up"), onClick: current > 0 ? () => move(current, current - 1) : undefined },
        { icon: "down", label: t("list.down"), onClick: current >= 0 && current < rows.length - 1 ? () => move(current, current + 1) : undefined },
      ]} />
      {rows.length === 0 ? (
        <p className="listempty">{t("list.empty")}</p>
      ) : (
        <div className="listrows" role="listbox" aria-label={field.label}>
          {rows.map((row, i) => (
            <button key={i} type="button" role="option" aria-selected={i === current} className={`lrow ${i === current ? "sel" : ""}`}
              onClick={() => setSelected(i)}>
              <span className="lnum">{i + 1}</span><span className="ltxt">{summary(row, i)}</span>
              {[...ctx.issues.keys()].some((k) => k.startsWith(`${path}[${i}]`)) && <Icon name="warn" size={12} />}
            </button>
          ))}
        </div>
      )}
      {current >= 0 && (
        <div className="listform">
          <FieldList fields={sub} ctx={ctx} prefix={`${path}[${current}].`} coveragePrefix={`${coveragePath}.`}
            scope={{ fields: sub, values: rows[current], parent: scope }} parentVisible={visible}
            onChange={(key, v) => set(rows.map((row, i) => (i === current ? { ...row, [key]: v } : row)))} />
        </div>
      )}
    </div>
  );
}

/** Key/value entries: one row per key with its value control; a new key is typed next to Add. */
function MapInput({ field, value, set, ctx, path }: ControlProps) {
  const entries = Object.entries((value && typeof value === "object" ? value : {}) as Values);
  const [selected, setSelected] = useState<string>();
  const [newKey, setNewKey] = useState("");
  const valueField: FieldDef = field.valueField ?? { key: "value", type: "text", label: t("map.value") };
  const object = Object.fromEntries(entries);
  const canAdd = newKey.trim() !== "" && !(newKey.trim() in object);
  const add = () => {
    set({ ...object, [newKey.trim()]: defaultValues([valueField])[valueField.key] });
    setSelected(newKey.trim());
    setNewKey("");
  };
  return (
    <div className="listctl">
      <div className="minibar">
        <input className="mapkey" value={newKey} placeholder={field.keyField?.label ?? t("map.key")} spellCheck={false}
          onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canAdd && (e.preventDefault(), add())} />
        <button type="button" className="mbtn" disabled={!canAdd} onClick={add}><Icon name="plus" size={12} /><span>{t("list.add")}</span></button>
        <button type="button" className="mbtn danger" disabled={selected === undefined || !(selected in object)}
          onClick={() => selected !== undefined && (set(Object.fromEntries(entries.filter(([k]) => k !== selected))), setSelected(undefined))}>
          <Icon name="trash" size={12} /><span>{t("list.remove")}</span>
        </button>
        <span className="fmeta">{t("list.count", { count: entries.length })}</span>
      </div>
      {entries.length === 0 ? (
        <p className="listempty">{t("list.empty")}</p>
      ) : (
        <div className="maprows">
          {entries.map(([key, entry]) => (
            <div key={key} className={`maprow ${key === selected ? "sel" : ""}`} onClick={() => setSelected(key)}>
              <code className="mapk" title={key}>{key}</code>
              <div className="mapv">
                <FieldControl field={valueField} value={entry} set={(v) => set({ ...object, [key]: v })} ctx={ctx} path={`${path}.${key}`} coveragePath="" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DedicatedEditor({ kind, value }: { kind: "gui_layout" | "blockly"; value: unknown }) {
  const size = typeof value === "string" ? value.length : JSON.stringify(value ?? "").length;
  return (
    <div className="dedicated">
      <b>{t(kind === "blockly" ? "field.blocklyName" : "field.guiName")}</b>
      <span>{t("field.dedicatedEditor")}</span>
      <span className="dim">{t("field.storedSize", { count: size })}</span>
    </div>
  );
}

/** Autocomplete lists for registry fields: bundled vanilla ids plus this mod's elements; rendered once per editor. */
export const RefDatalists = memo(function RefDatalists({ snapshot }: { snapshot: ProjectSnapshot }) {
  const lists = useMemo(() => {
    const fileBase = (path: string) => path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));
    const vanilla = vanillaIds as unknown as Record<string, string[]>;
    const kinds: readonly string[] = [...REGISTRY_FIELD_TYPES, "sound", "tag", "gui", "advancement", "fluid", "bubble_element", "radial_menu_element"];
    // Block programs also complete GUI and advancement ids, which only this mod's elements provide.
    const own: Record<string, string[]> = { gui: ["gui"], advancement: ["advancement"], fluid: ["fluid"], bubble_element: ["bubble"], radial_menu_element: ["radial_menu"] };
    const lists = kinds.map((kind) => {
      const providers = kind in REGISTRY_PROVIDERS ? REGISTRY_PROVIDERS[kind as RegistryKind] : own[kind] ?? [];
      const mod = elementsOf(snapshot, providers).map(({ typeId, element }) => ({ value: element.id, label: elementName(typeId, element) }));
      // This mod's sound events (KUYRUK 132): one per sound file, or as sound_events.json lists them.
      const sounds = kind === "sound" ? snapshot.soundEvents.map((e) => ({ value: `${snapshot.project.mod.id}:${e.name}`, label: e.files.join(", ") })) : [];
      return { kind, options: [...sounds, ...mod, ...(vanilla[kind] ?? []).map((id) => ({ value: id, label: "" }))] };
    });
    // Bubble icons are the ids of textures/bubbles/<id>.png.
    lists.push({ kind: "bubble", options: snapshot.textures.filter((path) => path.startsWith("textures/bubbles/")).map((path) => ({ value: fileBase(path), label: "" })) });
    // Imported models are picked by name (models/<name>.json|java|obj).
    lists.push({ kind: "model", options: snapshot.models.map((path) => ({ value: fileBase(path), label: path })) });
    return lists;
  }, [snapshot]);
  return (
    <>
      {lists.map(({ kind, options }) => (
        <datalist key={kind} id={`ref-${kind}`}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </datalist>
      ))}
    </>
  );
});
