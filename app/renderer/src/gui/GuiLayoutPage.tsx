import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { visibility, type FieldDef, type GroupDef } from "../../../../src/elements/model.ts";
import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { FieldList, type FormContext } from "../components/ElementFields.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { Texture } from "../components/Texture.tsx";
import { ActionButton, ContextMenu, Dialog, FormGroup, FormRow, MenuList, type MenuItem, Separator, ShortcutsButton } from "../components/ui.tsx";
import { EditorShell, RailButton, RailSeparator, setDockSection, StatusItems, ZoomGroup, type DockSection } from "../dock/Dock.tsx";
import { useTexture } from "../hooks/useTexture.ts";
import { useCtrlWheel } from "../hooks/useCtrlWheel.ts";
import { api } from "../api.ts";
import { VanillaHud } from "./VanillaHud.tsx";
import { WidgetTexture } from "./WidgetTexture.tsx";
import { loadPreviewTexture } from "../textures/animatedTexture.ts";
import { playbackModeOf, type PlaybackMode } from "../../../../src/resources/textureAnimation.ts";
import { imageFilterOf } from "../../../../src/resources/imageFilter.ts";
import { PixelText } from "./PixelText.tsx";
import { freeLayerName, hiddenIn, layerOf, layersOf, pinned, sortByLayer, type Layer } from "./layers.ts";
import { t, type StringKey } from "../strings.ts";
import { anchorOffset, guiScaleFor, overlayScreen, RESOLUTIONS, widgetAnchor } from "../../../../src/elements/overlayLayout.ts";
import {
  asWidgets, imageStates, previewStateOf, CLIPBOARD_TAG, sharedFields, sharedValue, labelBackgroundCss, cloneWidgets, drawOrder, fieldChange, hoverFile, toggleTextures, freeGroupName, gridCells, withGroups, gridOf, inventoryFrames, newWidget, num, OVERLAY_KINDS, OVERLAY_SIZE, SIZED, snapX, snapY, textScaleOf, widgetBox, widgetFields,
  WIDGET_KINDS, type Grid, type Widget, type WidgetKind,
} from "./widgets.ts";

interface Props {
  snapshot: ProjectSnapshot;
  typeId: string;
  draft: Element;
  ctx: FormContext;
  /** The element's gui_layout field. */
  layout: FieldDef;
  /** Every group of the type, for the Screen tab (the layout field is left out there). */
  groups: GroupDef[];
  all: FieldDef[];
  onChange: (key: string, value: unknown) => void;
  /** Back, duplicate and delete of the element. */
  elementActions: React.ReactNode;
  /** Icon, name, type and badges of the element, shown in the top bar. */
  identity: React.ReactNode;
}

type Box = { x: number; y: number; w: number; h: number };
type Edge = "left" | "center" | "right" | "top" | "middle" | "bottom";
const EDGES: [Edge, IconName][] = [["left", "alignleft"], ["center", "aligncenter"], ["right", "alignright"], ["top", "aligntop"], ["middle", "alignmiddle"], ["bottom", "alignbottom"]];
const ZOOMS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];
/** The next zoom step up (`d` > 0) or down from `z`, which may lie between steps after a fit. */
const stepZoom = (z: number, d: number) => (d > 0 ? ZOOMS.find((v) => v > z + 1e-6) : [...ZOOMS].reverse().find((v) => v < z - 1e-6)) ?? z;
/** Zoom that fits a stage of `w` x `h` canvas pixels in an area box, in quarter steps (crisp enough, never scrolling). */
const fitZoom = (box: { w: number; h: number }, w: number, h: number) =>
  Math.min(ZOOMS.at(-1)!, Math.max(ZOOMS[0], Math.floor(Math.min((box.w - 44) / w, (box.h - 44) / h) * 4) / 4));
const MAX_UNDO = 100;
const HUD_KEY = "overlayHud";

/** Widgets copied with Ctrl+C, kept while the app runs so they paste into another GUI too (the system clipboard has them as JSON). */
let clipboard: Widget[] = [];

async function readClipboard(): Promise<Widget[]> {
  try {
    const parsed = JSON.parse(await navigator.clipboard.readText()) as { [CLIPBOARD_TAG]?: unknown };
    const list = asWidgets(parsed?.[CLIPBOARD_TAG]);
    if (list.length && list.every((w) => typeof w.kind === "string")) return list;
  } catch {
    // Not our JSON, or the clipboard is not readable: the in-app copy is used.
  }
  return clipboard;
}

/**
 * GUI and overlay layout editor: the screen drawn the way the generated screen draws it (panel, slot frames,
 * player inventory), widgets placed, moved and resized on it with optional grid snapping, and a side panel with
 * the selected widget's properties and the rest of the element's settings.
 */
export function GuiLayoutPage({ snapshot, typeId, draft, ctx, layout, groups, all, onChange, elementActions, identity }: Props) {
  const overlay = typeId === "overlay";
  const widgets = asWidgets(draft[layout.key]);
  const layers = layersOf(draft.layers, t("gui.layer.default"));
  /** Layer new widgets go on. */
  const [activeLayer, setActiveLayer] = useState(0);
  const active = Math.min(activeLayer, layers.length - 1);
  const [selected, setSelectedState] = useState<number>();
  /** Widgets added to the selection with Shift or Ctrl+click; `selected` stays the first (the one align follows). */
  const [extra, setExtra] = useState<number[]>([]);
  const setSelected = (index: number | undefined) => (setSelectedState(index), setExtra([]));
  /** Preview: the screen without selection frames, handles, slot numbers and grid; nothing is edited. */
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Widget whose name is being edited in the list (double click or F2). */
  const [renaming, setRenaming] = useState<number>();
  /** Right-click menu: where, and which page (the main list, the layers, the align edges). */
  const [menu, setMenu] = useState<{ x: number; y: number; page: "main" | "layer" | "align" }>();
  /** Widget the Make grid dialog copies. */
  const [gridding, setGridding] = useState<number>();
  const [zoom, setZoom] = useState(3);
  /** The zoom follows the canvas area (a collapsed inspector, a bigger window) until the user zooms by hand; Fit goes back. */
  const [fitted, setFitted] = useState(true);
  const shownRef = useRef(false);
  /** Overlays: the window the canvas is previewed on (an index of RESOLUTIONS, -1 the 427x240 canvas) and the GUI scale setting (0 auto). */
  const [screenIndex, setScreenIndex] = useState(-1);
  const [guiSetting, setGuiSetting] = useState(0);
  /** Overlays draw the game's HUD under their widgets (KUYRUK 169); an editor view setting, remembered by the app. */
  const [hud, setHudState] = useState(true);
  useEffect(() => void api.uiState(HUD_KEY).then((saved) => saved === false && setHudState(false)), []);
  const setHud = (on: boolean) => (setHudState(on), void api.setUiState(HUD_KEY, on));
  const grid = gridOf(draft, all.map((f) => f.key));
  const width = overlay ? OVERLAY_SIZE.width : Math.max(1, num(draft.width, 176));
  const height = overlay ? OVERLAY_SIZE.height : Math.max(1, num(draft.height, 166));
  const kinds = overlay ? OVERLAY_KINDS : [...WIDGET_KINDS];
  const current = selected !== undefined && selected < widgets.length ? selected : undefined;
  const selection = current === undefined ? [] : [current, ...extra.filter((i) => i !== current && i < widgets.length)];
  /** Selects these widgets; the first is the primary one (align follows it, it has the resize handle). */
  const selectAll = (indices: number[]) => (setSelectedState(indices[0]), setExtra(indices.slice(1)));
  /** Adds a widget (with its group unless `single`) to the selection or takes it out (Shift or Ctrl+click). */
  const toggleSelected = (index: number, single?: boolean) => {
    const unit = single ? [index] : withGroups(widgets, [index]);
    if (current === undefined) return selectAll(unit);
    if (selection.includes(index)) {
      const left = selection.filter((i) => !unit.includes(i));
      return left.length ? selectAll(left) : setSelected(undefined);
    }
    selectAll([...selection, ...unit]);
  };
  /** Clicking a widget selects its group too, unless `single` (Alt+click). */
  const pick = (index: number, single?: boolean) => selectAll(single ? [index] : withGroups(widgets, [index]));
  /** Group names in list order. */
  const groupNames = [...new Set(widgets.map((w) => w.group).filter((g): g is string => !!g))];
  const [expanded, setExpanded] = useState<string[]>([]);
  const inventory = !overlay && num(draft.type) === 1
    ? inventoryFrames(width, height, num(draft.inventoryOffsetX), num(draft.inventoryOffsetY)) : [];
  const inventoryBox: Box[] = inventory.length ? [{ x: inventory[0].x, y: inventory[0].y, w: 9 * 18, h: 76 }] : [];

  // ---- history: widgets plus the element fields the editor changes (layers, grid) ----
  const tracked = ["layers", "gridSx", "gridSy", "gridOx", "gridOy", ...(grid.snapKey ? [grid.snapKey] : []), ...(overlay ? [] : ["width", "height"])];
  type Snap = { widgets: Widget[]; fields: Record<string, unknown> };
  const undo = useRef<Snap[]>([]);
  const redo = useRef<Snap[]>([]);
  const lastEdit = useRef<{ key: string; at: number }>(undefined);
  const latest = useRef(widgets);
  latest.current = widgets;
  const snapshotNow = (): Snap => ({ widgets: latest.current, fields: Object.fromEntries(tracked.map((k) => [k, draft[k]])) });
  /**
   * Saves the widgets and, with `fields`, other element fields in one undo step; `coalesce` merges quick edits of
   * one field into one undo step.
   */
  const commit = (next: Widget[], coalesce?: string, fields?: Record<string, unknown>) => {
    const now = Date.now();
    const merge = coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < 1000;
    if (!merge) {
      undo.current = [...undo.current.slice(-(MAX_UNDO - 1)), snapshotNow()];
      redo.current = [];
    }
    lastEdit.current = coalesce ? { key: coalesce, at: now } : undefined;
    for (const [k, v] of Object.entries(fields ?? {})) onChange(k, v);
    if (next !== latest.current) {
      latest.current = next;
      onChange(layout.key, next);
    }
  };
  const setFields = (fields: Record<string, unknown>, coalesce?: string) => commit(latest.current, coalesce, fields);
  const step = (from: React.RefObject<Snap[]>, to: React.RefObject<Snap[]>) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(snapshotNow());
    lastEdit.current = undefined;
    for (const [k, v] of Object.entries(prev.fields)) if (draft[k] !== v) onChange(k, v);
    latest.current = prev.widgets;
    onChange(layout.key, prev.widgets);
    if (current !== undefined && current >= prev.widgets.length) setSelected(undefined);
  };

  // ---- layers: the list stays sorted by layer, so the screen draws them in that order ----
  /** Saves widgets in layer order and selects `keep` (a widget object) at its new index. */
  const commitSorted = (next: Widget[], nextLayers: Layer[] = layers, keep?: Widget) => {
    const sorted = sortByLayer(next, nextLayers);
    commit(sorted, undefined, nextLayers !== layers ? { layers: nextLayers } : undefined);
    if (keep) setSelected(sorted.indexOf(keep));
  };
  /** Saves widgets in layer order and selects the given widget objects. */
  const commitSelecting = (next: Widget[], picked: Widget[]) => {
    const sorted = sortByLayer(next, layers);
    commit(sorted);
    const at = picked.map((w) => sorted.indexOf(w)).filter((i) => i >= 0);
    setSelectedState(at[0]);
    setExtra(at.slice(1));
  };
  const setLayers = (next: Layer[], coalesce?: string) => setFields({ layers: next }, coalesce);
  const addLayer = () => {
    const next = [...layers, { name: freeLayerName(layers, t("gui.layer.name")) }];
    setLayers(next);
    setActiveLayer(next.length - 1);
  };
  const renameLayer = (index: number, name: string) => {
    const old = layers[index].name;
    if (!name.trim() || layers.some((l, i) => i !== index && l.name === name)) return;
    // Widgets without a layer are on the first one, so they follow it too.
    commit(widgets.map((w) => (layerOf(layers, w).name === old ? { ...w, layer: name } : w)), `layer.${index}`,
      { layers: layers.map((l, i) => (i === index ? { ...l, name } : l)) });
  };
  const toggleLayer = (index: number, key: "hidden" | "locked") => setLayers(layers.map((l, i) => (i === index ? { ...l, [key]: !l[key] } : l)));
  const moveLayer = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= layers.length) return;
    const next = [...layers];
    [next[index], next[to]] = [next[to], next[index]];
    // Name every widget's layer first: one without a name would otherwise follow whichever layer is now first.
    const named = widgets.map((w) => ({ ...w, layer: layerOf(layers, w).name }));
    commitSorted(named, next);
    setActiveLayer(to);
    setSelected(undefined);
  };
  const removeLayer = (index: number) => {
    if (layers.length < 2) return;
    const next = layers.filter((_, i) => i !== index);
    const target = next[Math.max(0, index - 1)].name;
    const moved = widgets.map((w) => ({ ...w, layer: layerOf(layers, w).name === layers[index].name ? target : layerOf(layers, w).name }));
    commitSorted(moved, next);
    setActiveLayer(Math.max(0, index - 1));
    setSelected(undefined);
  };
  const moveToLayer = (index: number, name: string) => {
    const moved = { ...widgets[index], layer: name };
    commitSorted(widgets.map((w, i) => (i === index ? moved : w)), layers, moved);
  };

  // ---- actions on the selection ----
  const add = (kind: WidgetKind, invisible?: boolean) => {
    const made = newWidget(kind, { x: 0, y: 0 }, widgets, snapshot.textures);
    const base = invisible ? { ...made, invisible: true, text: "" } : made;
    const { x, y } = freeSpot(widgetBox(base), [...widgets.map((w) => widgetBox(w)), ...inventoryBox], width, height, grid);
    const added = { ...base, x, y, layer: layers[active].name };
    commitSorted([...widgets, added], layers, added);
    setDockSection("gui.props", true);
  };
  const remove = () => {
    if (current === undefined) return;
    const gone = selection.filter((i) => !pinned(layers, widgets[i]));
    if (!gone.length) return;
    commit(widgets.filter((_, i) => !gone.includes(i)));
    const left = widgets.length - gone.length;
    setSelected(left > 0 ? Math.min(current, left - 1) : undefined);
  };
  const update = (index: number, change: Partial<Widget>, coalesce?: string) =>
    commit(widgets.map((w, i) => (i === index ? { ...w, ...change } : w)), coalesce);
  /** One change to every selected widget, one undo step (KUYRUK 180). */
  const updateSelected = (change: (w: Widget) => Partial<Widget>, coalesce?: string) =>
    commit(widgets.map((w, i) => (selection.includes(i) ? { ...w, ...change(w) } : w)), coalesce);
  const moveSelectedToLayer = (name: string) =>
    commitSelecting(widgets.map((w, i) => (selection.includes(i) ? { ...w, layer: name } : w)), selection.map((i) => widgets[i]));
  // Text size of the selected labels and buttons, from the toolbar (quarter steps, 0.25 to 8).
  const texted = selection.filter((i) => ["label", "button"].includes(widgets[i]?.kind));
  const textScale = texted.length ? textScaleOf(widgets[texted[0]]) : 1;
  const scaleText = (by: number) => {
    const next = Math.min(8, Math.max(0.25, Math.round((textScale + by) * 4) / 4));
    commit(widgets.map((w, i) => (texted.includes(i) ? { ...w, textScale: next === 1 ? undefined : next } : w)), "textScale");
  };
  const nudge = (dx: number, dy: number) => selection.length > 0 && commit(widgets.map((w, i) => (selection.includes(i) && !pinned(layers, w)
    ? { ...w, x: num(w.x) + dx, y: num(w.y) + dy } : w)), "nudge");
  /** Lines the selection up: one widget on the screen, several on the first selected one. */
  /** A group lines up as one block (its bounding box); every other widget on its own. */
  const align = (edge: Edge) => {
    if (!selection.length) return;
    const units: number[][] = [];
    for (const i of selection) {
      if (units.some((u) => u.includes(i))) continue;
      const g = widgets[i].group;
      units.push(g ? selection.filter((j) => widgets[j].group === g) : [i]);
    }
    const bound = (unit: number[]): Box => {
      const bs = unit.map((i) => widgetBox(widgets[i]));
      const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
      return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
    };
    const anchor = units.length > 1 ? bound(units[0]) : { x: 0, y: 0, w: width, h: height };
    const shift = new Map<number, { dx: number; dy: number }>();
    units.forEach((unit, k) => {
      if (units.length > 1 && k === 0) return;
      const b = bound(unit);
      const x = edge === "left" ? anchor.x : edge === "right" ? anchor.x + anchor.w - b.w : edge === "center" ? Math.round(anchor.x + (anchor.w - b.w) / 2) : b.x;
      const y = edge === "top" ? anchor.y : edge === "bottom" ? anchor.y + anchor.h - b.h : edge === "middle" ? Math.round(anchor.y + (anchor.h - b.h) / 2) : b.y;
      for (const i of unit) shift.set(i, { dx: x - b.x, dy: y - b.y });
    });
    commit(widgets.map((w, i) => {
      const d = shift.get(i);
      return !d || pinned(layers, w) ? w : { ...w, x: num(w.x) + d.dx, y: num(w.y) + d.dy };
    }));
  };
  // ---- groups ----
  /** Puts the selection in one new group (members of other groups move over). */
  const group = () => {
    if (selection.length < 2) return;
    const name = freeGroupName(widgets, t("gui.group.name"));
    commit(widgets.map((w, i) => (selection.includes(i) ? { ...w, group: name } : w)));
    setExpanded([...expanded, name]);
  };
  const ungroup = () => {
    if (!selection.some((i) => widgets[i].group)) return;
    commit(widgets.map((w, i) => (selection.includes(i) && w.group ? without(w, "group") : w)));
  };
  const renameGroup = (old: string, name: string) => {
    const next = name.trim();
    if (!next || next === old || groupNames.includes(next)) return;
    commit(widgets.map((w) => (w.group === old ? { ...w, group: next } : w)));
    setExpanded(expanded.map((g) => (g === old ? next : g)));
  };
  /** Locks or hides every member of a group (on when any member is off). */
  const toggleGroup = (name: string, key: "editLocked" | "editHidden") => {
    const on = widgets.some((w) => w.group === name && w[key] !== true);
    commit(widgets.map((w) => (w.group !== name ? w : on ? { ...w, [key]: true } : without(w, key))));
    if (key === "editHidden" && on) setSelected(undefined);
  };
  /** Copies of the selection one grid step down and right, selected. */
  const duplicate = () => {
    if (!selection.length) return;
    const copies = cloneWidgets(selection.map((i) => widgets[i]), widgets, grid.sx, grid.sy);
    commitSelecting([...widgets, ...copies], copies);
  };
  const copy = () => {
    if (!selection.length) return;
    clipboard = structuredClone(selection.map((i) => widgets[i]));
    navigator.clipboard?.writeText(JSON.stringify({ [CLIPBOARD_TAG]: clipboard }, null, 2)).catch(() => {});
  };
  /** Pastes at the copied place; one grid step further while that place already holds the same widgets (a paste in the same GUI). */
  const paste = async () => {
    const source = await readClipboard();
    if (!source.length) return;
    const list = latest.current;
    const same = (dx: number, dy: number) => source.every((w) => list.some((o) => o.kind === w.kind && num(o.x) === num(w.x) + dx && num(o.y) === num(w.y) + dy));
    let k = 0;
    while (k < 50 && same(k * grid.sx, k * grid.sy)) k++;
    const names = new Set(layers.map((l) => l.name));
    const placed = source.map((w) => ({ ...w, layer: w.layer && names.has(w.layer) ? w.layer : layers[active].name }));
    const copies = cloneWidgets(placed, list, k * grid.sx, k * grid.sy);
    commitSelecting([...list, ...copies], copies);
    setDockSection("gui.props", true);
  };
  /** Replaces widget `index` by an N x M grid of it, all in one new group, selected. */
  const makeGrid = (index: number, rows: number, cols: number, stepX: number, stepY: number) => {
    setGridding(undefined);
    const base = widgets[index];
    if (!base) return;
    const cells = gridCells(base, widgets, rows, cols, stepX, stepY, freeGroupName(widgets, t("gui.group.grid")));
    const next = widgets.flatMap((w) => (w === base ? [cells[0]] : [w]));
    commitSelecting([...next, ...cells.slice(1)], cells);
  };
  /** Locks the selection (or unlocks it when all of it is locked). */
  const toggleLock = () => {
    const on = selection.some((i) => widgets[i].editLocked !== true);
    commit(widgets.map((w, i) => (!selection.includes(i) ? w : on ? { ...w, editLocked: true } : without(w, "editLocked"))));
  };
  const moveSelectionToLayer = (name: string) => {
    const moved = selection.map((i) => ({ ...widgets[i], layer: name }));
    commitSelecting(widgets.map((w, i) => (selection.includes(i) ? moved[selection.indexOf(i)] : w)), moved);
  };
  /** Draws the selection one step later (forward) or earlier (back) inside its layer. */
  const reorder = (by: 1 | -1) => {
    const list = [...widgets];
    const picked = selection.map((i) => widgets[i]);
    const order = list.map((_, i) => i);
    if (by === 1) order.reverse();
    for (const i of order) {
      const j = i + by;
      if (!picked.includes(list[i]) || j < 0 || j >= list.length || picked.includes(list[j])) continue;
      if (layerOf(layers, list[j]).name !== layerOf(layers, list[i]).name) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
    if (list.some((w, i) => w !== widgets[i])) commitSelecting(list, picked);
  };
  const canForward = selection.some((i) => i + 1 < widgets.length && !selection.includes(i + 1) && layerOf(layers, widgets[i + 1]).name === layerOf(layers, widgets[i]).name);
  const canBack = selection.some((i) => i > 0 && !selection.includes(i - 1) && layerOf(layers, widgets[i - 1]).name === layerOf(layers, widgets[i]).name);
  /** Right click on a widget: it (and its group, unless Alt) joins or becomes the selection, then the menu opens. */
  const openMenu = (index: number | undefined) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (preview) return;
    if (index !== undefined && !selection.includes(index)) pick(index, e.altKey);
    if (index === undefined) setSelected(undefined);
    setMenu({ x: e.clientX, y: e.clientY, page: "main" });
  };
  const menuItems = (page: "main" | "layer" | "align", has: boolean): MenuItem[] => {
    const back: MenuItem = { label: t("gui.menu.back"), onClick: () => setMenu((m) => m && { ...m, page: "main" }), keepOpen: true };
    if (page === "layer") return [back, { label: "", separator: true },
      ...[...layers].reverse().map((l) => ({ label: l.name, checked: selection.every((i) => layerOf(layers, widgets[i]).name === l.name), onClick: () => moveSelectionToLayer(l.name) }))];
    if (page === "align") return [back, { label: "", separator: true },
      ...EDGES.map(([edge]) => ({ label: t(selection.length > 1 ? `gui.align.${edge}` : `gui.align.screen.${edge}`), onClick: () => align(edge) }))];
    const on = (fn: () => void) => (has ? fn : undefined);
    const grouped = selection.some((i) => widgets[i].group);
    const locked = has && selection.every((i) => widgets[i].editLocked === true);
    return [
      { label: t("gui.menu.duplicate"), shortcut: "Ctrl+D", onClick: on(duplicate) },
      { label: t("gui.menu.copy"), shortcut: "Ctrl+C", onClick: on(copy) },
      { label: t("gui.menu.paste"), shortcut: "Ctrl+V", onClick: () => void paste() },
      { label: t("gui.menu.rename"), shortcut: "F2", onClick: current !== undefined ? () => (setDockSection("gui.props", true), setRenaming(current)) : undefined },
      { label: "", separator: true },
      { label: t("gui.group"), shortcut: "Ctrl+G", onClick: selection.length > 1 ? group : undefined },
      { label: t("gui.ungroup"), shortcut: "Ctrl+Shift+G", onClick: grouped ? ungroup : undefined },
      { label: t(locked ? "gui.menu.unlock" : "gui.menu.lock"), onClick: on(toggleLock) },
      { label: t("gui.menu.toLayer"), onClick: has && layers.length > 1 ? () => setMenu((m) => m && { ...m, page: "layer" }) : undefined, keepOpen: true },
      { label: t("gui.menu.forward"), onClick: canForward ? () => reorder(1) : undefined },
      { label: t("gui.menu.back2"), onClick: canBack ? () => reorder(-1) : undefined },
      { label: t("gui.menu.align"), onClick: on(() => setMenu((m) => m && { ...m, page: "align" })), keepOpen: true },
      { label: t("gui.makeGrid"), onClick: current !== undefined ? () => setGridding(current) : undefined },
      { label: "", separator: true },
      { label: t("gui.menu.delete"), shortcut: "Delete", danger: true, onClick: has && selection.some((i) => !pinned(layers, widgets[i])) ? remove : undefined },
    ];
  };
  /** Sets a widget's name (its language key part); an empty name removes it. */
  const rename = (index: number, name: string) => {
    setRenaming(undefined);
    // A name is part of a language key: lower case letters, digits and _ (like the MCP tool accepts).
    const next = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") || undefined;
    if (index < widgets.length && next !== widgets[index].name) update(index, { name: next });
  };
  const zoomBy = (d: number) => (setFitted(false), setZoom((z) => stepZoom(z, d)));

  // ---- dragging: move the pressed widget (and the rest of the selection with it) or resize it ----
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: "move" | "resize"; sx: number; sy: number; box: Box; started: boolean; group: { index: number; x: number; y: number }[] }>(undefined);
  const press = (index: number, mode: "move" | "resize", box: Box) => (e: React.PointerEvent) => {
    // A right press keeps the selection for the menu (the canvas behind would clear it).
    if (e.button === 2) return e.stopPropagation();
    if (e.button !== 0 || preview) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey) return toggleSelected(index, e.altKey);
    // Pressing a widget that is part of a selection keeps the selection: the drag moves all of it.
    const together = mode === "move" && selection.length > 1 && selection.includes(index) && !e.altKey;
    if (!together) pick(index, e.altKey);
    const moving = together ? selection : e.altKey ? [index] : withGroups(widgets, [index]);
    setDockSection("gui.props", true);
    // A locked widget is picked like any other but never dragged.
    if (pinned(layers, widgets[index])) return;
    stage.current?.setPointerCapture(e.pointerId);
    const group = moving.length > 1 && mode === "move" ? moving.filter((i) => i !== index && !pinned(layers, widgets[i])).map((i) => ({ index: i, x: num(widgets[i].x), y: num(widgets[i].y) })) : [];
    drag.current = { index, mode, sx: e.clientX, sy: e.clientY, box, started: false, group };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / view, dy = (e.clientY - d.sy) / view;
    if (!d.started && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const list = latest.current;
    let next: Partial<Widget>;
    if (d.mode === "move") next = { x: snapX(grid, d.box.x + dx), y: snapY(grid, d.box.y + dy) };
    else next = { width: Math.max(1, snapX(grid, d.box.x + d.box.w + dx) - d.box.x), height: Math.max(1, snapY(grid, d.box.y + d.box.h + dy) - d.box.y) };
    const w = list[d.index];
    if (Object.entries(next).every(([k, v]) => w[k as keyof Widget] === v)) return;
    // The pressed widget snaps; the others move by the same step.
    const step = d.group.length ? { x: (next.x as number) - d.box.x, y: (next.y as number) - d.box.y } : undefined;
    const updated = list.map((item, i) => {
      if (i === d.index) return { ...item, ...next };
      const mate = step && d.group.find((g) => g.index === i);
      return mate ? { ...item, x: mate.x + step.x, y: mate.y + step.y } : item;
    });
    if (d.started) (latest.current = updated, onChange(layout.key, updated));
    else commit(updated);
    d.started = true;
  };
  const endDrag = () => void (drag.current = undefined);
  // Stable handlers for the memoised WidgetView (Q280): they call the current closures, so a move of one widget
  // does not re-render the other hundred.
  const widgetHandlers = useRef({ press, openMenu });
  widgetHandlers.current = { press, openMenu };
  const pressWidget = useCallback((index: number, mode: "move" | "resize", box: Box) => (e: React.PointerEvent) => widgetHandlers.current.press(index, mode, box)(e), []);
  const menuWidget = useCallback((index: number) => (e: React.MouseEvent) => widgetHandlers.current.openMenu(index)(e), []);

  // ---- keyboard: delete, nudge, undo ----
  const keys = useRef<(e: KeyboardEvent) => void>(undefined);
  keys.current = (e) => {
    const target = e.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
    const by = e.shiftKey ? (grid.snap ? grid.sx : 10) : 1;
    const byY = e.shiftKey ? (grid.snap ? grid.sy : 10) : 1;
    const k = e.key;
    const lower = k.toLowerCase();
    const action = e.ctrlKey
      ? (lower === "z" && !e.shiftKey ? () => step(undo, redo) : lower === "y" || (lower === "z" && e.shiftKey) ? () => step(redo, undo)
        : lower === "g" ? (e.shiftKey ? ungroup : group) : lower === "d" ? duplicate : lower === "c" && selection.length ? copy : lower === "v" ? () => void paste() : undefined)
      : k === "Delete" || k === "Backspace" ? (current !== undefined && pinned(layers, widgets[current]) ? undefined : remove)
      : k === "F2" ? (current !== undefined ? () => (setDockSection("gui.props", true), setRenaming(current)) : undefined)
      : k === "Escape" ? () => (preview ? setPreview(false) : setSelected(undefined))
      // Page Up / Page Down select the previous / next widget, so a widget can be chosen without the mouse (Q248).
      : (k === "PageDown" || k === "PageUp") && widgets.length ? () => pick(((current ?? (k === "PageDown" ? -1 : widgets.length)) + (k === "PageDown" ? 1 : -1) + widgets.length) % widgets.length, true)
      : k.toLowerCase() === "p" && !e.altKey ? () => setPreview(!preview)
      : k === "ArrowLeft" ? () => nudge(-by, 0) : k === "ArrowRight" ? () => nudge(by, 0)
      : k === "ArrowUp" ? () => nudge(0, -byY) : k === "ArrowDown" ? () => nudge(0, byY)
      : undefined;
    if (!action) return;
    e.preventDefault();
    action();
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keys.current?.(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const area = useRef<HTMLDivElement>(null);
  // Ctrl + wheel steps the zoom like the toolbar buttons; a previewed screen is fitted, so it does not zoom (KUYRUK 179).
  useCtrlWheel(area, (step) => !shownRef.current && zoomBy(step));

  // Overlay screen preview (KUYRUK 170): the stage is the whole screen in canvas pixels, fitted to the area, and every
  // widget sits where its anchor puts it there; moving one still changes its x, y on the canvas.
  const [areaSize, setAreaSize] = useState<{ w: number; h: number }>();
  // Measured before the first paint, so the fitted zoom is right from the first frame.
  useLayoutEffect(() => {
    const el = area.current;
    if (el) setAreaSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAreaSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (fitted && areaSize && !shownRef.current) setZoom(fitZoom(areaSize, width, height));
    // The canvas size is left out on purpose: dragging its corner must not rescale the stage under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted, areaSize]);
  const previewed = overlay && screenIndex >= 0 ? RESOLUTIONS[screenIndex] : undefined;
  const shown = previewed ? overlayScreen(draft, previewed.width, previewed.height, guiSetting) : undefined;
  shownRef.current = !!shown;
  const stageW = shown ? shown.screenWidth : width, stageH = shown ? shown.screenHeight : height;
  /** Screen pixels per canvas pixel on the stage: the zoom, or while previewing a screen what fits the area. */
  const view = shown && areaSize ? Math.max(0.05, Math.min((areaSize.w - 48) / stageW, (areaSize.h - 48) / stageH)) : zoom;
  const shiftOf = (w: Widget) => (shown ? anchorOffset(widgetAnchor(w, draft), stageW, stageH) : undefined);
  const designAt = shown ? anchorOffset("center", stageW, stageH) : undefined;

  const toggleSnap = () => grid.snapKey && setFields({ [grid.snapKey]: !grid.snap });
  /** Grid lines show while snapping, and while a grid value is being edited. */
  const [gridEditing, setGridEditing] = useState(false);
  /** A drag of a grid letter is one undo step of its own. */
  const scrubbing = (on: boolean) => ((lastEdit.current = undefined), setGridEditing(on));
  /** GUI size (overlays keep their 427x240 canvas); a drag of the canvas corner or a field letter is one undo step. */
  const MAX_SIZE = 1024;
  const setSize = (key: "width" | "height", value: number) => setFields({ [key]: Math.max(1, Math.min(MAX_SIZE, value)) }, `size.${key}`);
  const sizeStart = () => void (lastEdit.current = undefined);
  const pressCorner = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    sizeStart();
    const sx = e.clientX, sy = e.clientY, w0 = width, h0 = height;
    let last = `${w0}x${h0}`;
    const move = (m: PointerEvent) => {
      const w = Math.max(1, Math.min(MAX_SIZE, Math.round(w0 + (m.clientX - sx) / zoom)));
      const h = Math.max(1, Math.min(MAX_SIZE, Math.round(h0 + (m.clientY - sy) / zoom)));
      if (`${w}x${h}` === last) return;
      last = `${w}x${h}`;
      setFields({ width: w, height: h }, "size.corner");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      lastEdit.current = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const setGrid = (key: "gridSx" | "gridSy" | "gridOx" | "gridOy", value: number) => setFields({ [key]: value }, `grid.${key}`);
  const panelBg = !overlay && draft.renderBgLayer !== false;

  const sections: DockSection[] = [
    // Layers and Widgets come before the properties: selecting a widget grows the properties, and the list the user is
    // clicking in (a double click renames) must not move under the pointer.
    {
      id: "gui.layers", icon: "tiles", title: t("gui.layers"), badge: String(layers.length), defaultOpen: true,
      body: (
        <>
          <LayerList layers={layers} active={active} onActive={setActiveLayer} onAdd={addLayer} onRename={renameLayer}
                    onToggle={toggleLayer} onMove={moveLayer} onRemove={removeLayer} />
        </>
      ),
    },
    {
      id: "gui.widgets", icon: "box", title: t("gui.widgets"), badge: String(widgets.length), defaultOpen: true,
      body: (
        <>
          <WidgetList widgets={widgets} layers={layers} selection={selection}
                    onSelect={(i, add) => (add ? toggleSelected(i, true) : setSelected(i))}
                    onSelectGroup={(name, add) => {
                      const members = widgets.flatMap((w, i) => (w.group === name ? [i] : []));
                      if (!add) return selectAll(members);
                      selectAll(members.every((i) => selection.includes(i)) ? selection.filter((i) => !members.includes(i)) : [...selection, ...members.filter((i) => !selection.includes(i))]);
                    }}
                    expanded={expanded} onExpand={(name) => setExpanded(expanded.includes(name) ? expanded.filter((g) => g !== name) : [...expanded, name])}
                    onGroupToggle={toggleGroup} onGroupRename={renameGroup}
                    renaming={renaming} onRenameStart={setRenaming} onRename={rename} />
                  {selection.length > 1 && <p className="hint nomargin">{t("gui.multiHint", { count: selection.length })}</p>}
        </>
      ),
    },
    {
      id: "gui.props", icon: "edit", title: t("dock.properties"), defaultOpen: true,
      badge: selection.length > 1 ? t("gui.multi.title", { count: selection.length }) : current !== undefined ? t(`gui.kind.${widgets[current].kind}` as StringKey) : undefined,
      body: (
        <>
          <div className="dk-aligns">
            {EDGES.map(([edge, icon]) => (
          <span key={edge} data-align={edge} className="alignbtn">
            <ActionButton icon={icon} compact label={t(selection.length > 1 ? `gui.align.${edge}` : `gui.align.screen.${edge}`)} disabled={!selection.length}
              onClick={() => align(edge)} />
          </span>
        ))}
          </div>
          {selection.length > 1 ? (
            <div className="form">
              <MultiWidgetForm list={selection.map((i) => widgets[i])} layers={layers} overlay={overlay} ctx={ctx} layoutKey={layout.key}
                      onLayer={moveSelectedToLayer}
                      onLock={(on) => updateSelected(() => ({ editLocked: on || undefined }))}
                      onChange={(key, value) => updateSelected((w) => fieldChange(w, key, value, snapshot.textures), `multi.${key}`)} />
            </div>
          ) : current !== undefined ? (
            <>
              <div className="form">
                      <label className="frow">
                        <span className="flabel">{t("gui.layer.of")}</span>
                        <select value={layerOf(layers, widgets[current]).name} onChange={(e) => moveToLayer(current, e.target.value)}>
                          {layers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                        </select>
                      </label>
                      <label className="frow">
                        <span className="flabel">{t("gui.layer.lockWidget")}</span>
                        <span className="check"><input type="checkbox" checked={widgets[current].editLocked === true}
                          onChange={(e) => update(current, { editLocked: e.target.checked || undefined })} /></span>
                      </label>
                    </div>
                    <WidgetForm key={current} index={current} layoutKey={layout.key} widget={widgets[current]} overlay={overlay} ctx={ctx}
                      onChange={(key, value) => update(current, fieldChange(widgets[current], key, value, snapshot.textures), `${current}.${key}`)} />
            </>
          ) : <p className="hint nomargin">{t("gui.selectHint")}</p>}
        </>
      ),
    },
    {
      id: "gui.canvas", icon: "grid", title: t("gui.canvasGroup"), badge: `${width}×${height}`, defaultOpen: true,
      body: (
        <>
          <div className="guictls">
                    <p className="hint nomargin guimeta">{t("gui.meta", { width, height, zoom })}</p>
              {overlay && (
                <label className="check hudctl" title={t("gui.hud.hint")}>
                  <input type="checkbox" checked={hud} onChange={(e) => setHud(e.target.checked)} />
                  <span>{t("gui.hud")}</span>
                </label>
              )}
              {!overlay && (
                <span className="sizectl" title={t("gui.canvas.hint")}>
                  <span className="ctlcap">{t("gui.canvas")}</span>
                  <ScrubNumber label={t("gui.grid.w")} title={t("gui.canvas.width")} value={width} min={1} onChange={(v) => setSize("width", v)} onScrub={sizeStart} />
                  <ScrubNumber label={t("gui.grid.h")} title={t("gui.canvas.height")} value={height} min={1} onChange={(v) => setSize("height", v)} onScrub={sizeStart} />
                </span>
              )}
              {grid.snapKey && (
                <span className="gridctl" onFocus={() => setGridEditing(true)} onBlur={() => setGridEditing(false)}>
                  <span className="ctlcap">{t("gui.grid")}</span>
                  <ScrubNumber label={t("gui.grid.w")} title={t("gui.grid.sizeX")} value={grid.sx} min={1} onChange={(v) => setGrid("gridSx", v)} onScrub={scrubbing} />
                  <ScrubNumber label={t("gui.grid.h")} title={t("gui.grid.sizeY")} value={grid.sy} min={1} onChange={(v) => setGrid("gridSy", v)} onScrub={scrubbing} />
                  <ScrubNumber label={t("gui.grid.x")} title={t("gui.grid.offsetX")} value={grid.ox} onChange={(v) => setGrid("gridOx", v)} onScrub={scrubbing} />
                  <ScrubNumber label={t("gui.grid.y")} title={t("gui.grid.offsetY")} value={grid.oy} onChange={(v) => setGrid("gridOy", v)} onScrub={scrubbing} />
                </span>
              )}
              {/* Always shown (disabled without a text widget), so selecting a widget does not move the panel under the pointer. */}
              <span className={`textctl ${texted.length ? "" : "off"}`} title={t("gui.textSize.hint")}>
                <span className="ctlcap">{t("gui.field.textScale")}</span>
                <button type="button" className="btn small" title={t("gui.textSize.smaller")} disabled={!texted.length || textScale <= 0.25} onClick={() => scaleText(-0.25)}>A-</button>
                <span className="textctlval">{texted.length ? `${textScale}x` : "-"}</span>
                <button type="button" className="btn small" title={t("gui.textSize.bigger")} disabled={!texted.length || textScale >= 8} onClick={() => scaleText(0.25)}>A+</button>
              </span>
                  </div>
          {overlay && (
            <FormGroup title={t("gui.screen")}>
              <ScreenPreview index={screenIndex} onIndex={setScreenIndex} guiSetting={guiSetting} onGuiSetting={setGuiSetting} shown={shown} />
            </FormGroup>
          )}
        </>
      ),
    },
    {
      id: "gui.screen", icon: "gear", title: t(overlay ? "gui.tab.overlay" : "gui.tab.screen"), defaultOpen: false,
      body: <ScreenSettings groups={groups} layoutKey={layout.key} all={all} draft={draft} ctx={ctx} onChange={onChange} />,
    },
  ];
  const status = (
    <StatusItems items={[
      t("gui.meta", { width, height, zoom: Math.round(view * 100) / 100 }),
      selection.length ? t("dock.selected", { count: selection.length }) : null,
      grid.snapKey ? `${t("gui.grid")} ${grid.sx}×${grid.sy}${grid.snap ? ` · ${t("gui.snap")}` : ""}` : null,
      preview ? t("gui.preview") : null,
    ]} />
  );

  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.page, selection.length > 0)} onClose={() => setMenu(undefined)} />}
      {gridding !== undefined && widgets[gridding] && (
        <MakeGridDialog widget={widgets[gridding]} onCancel={() => setGridding(undefined)}
          onOk={(rows, cols, sx, sy) => makeGrid(gridding, rows, cols, sx, sy)} />
      )}
      <EditorShell label={t("dock.editor")} bar={
        <>
        {elementActions}
        <span className="dk-id edhead">{identity}</span>
        <Separator />
        <div className="menuwrap">
          <ActionButton icon="plus" popup pressed={adding} label={t("gui.add")} tone="primary" onClick={() => setAdding(!adding)} />
          {adding && (
            <MenuList onClose={() => setAdding(false)} items={[
              ...kinds.map((kind) => ({ label: t(`gui.kind.${kind}` as StringKey), onClick: () => add(kind) })),
              ...(kinds.includes("button") ? [{ label: t("gui.kind.invisible_button"), onClick: () => add("button", true) }] : []),
            ]} />
          )}
        </div>
        <ActionButton hideLabel icon="undo" label={t("gui.undo")} title="Ctrl+Z" disabled={!undo.current.length} onClick={() => step(undo, redo)} />
        <ActionButton hideLabel icon="redo" label={t("gui.redo")} title="Ctrl+Y" disabled={!redo.current.length} onClick={() => step(redo, undo)} />
        <span className="dk-grow" />
        {grid.snapKey && <ActionButton icon="grid" label={t("gui.snap")} pressed={grid.snap} onClick={toggleSnap} />}
        <ActionButton icon="eye" label={t("gui.preview")} title="P" pressed={preview} onClick={() => setPreview(!preview)} />
        <Separator />
        <ZoomGroup zoom={view} canOut={!shown && view > ZOOMS[0]} canIn={!shown && view < ZOOMS.at(-1)!} onOut={() => zoomBy(-1)} onIn={() => zoomBy(1)}
          onFit={() => setFitted(true)} fitted={fitted && !shown} disabled={!!shown} />
        <ShortcutsButton shortcuts={[
          [t("keys.k.shiftClick"), t("keys.gui.add")], ["PageUp / PageDown", t("keys.gui.cycle")], [t("keys.k.arrows"), t("keys.gui.nudge")], [t("keys.k.shiftArrows"), t("keys.gui.nudgeFar")],
          ["Delete / Backspace", t("keys.gui.remove")], [t("keys.k.f2"), t("keys.gui.rename")], ["Esc", t("keys.gui.deselect")], ["P", t("keys.gui.preview")], [t("keys.k.ctrlWheel"), t("keys.gui.zoom")],
          [t("keys.k.rightClick"), t("keys.gui.menu")], [t("keys.k.altClick"), t("keys.gui.pickOne")], ["Ctrl+G", t("keys.gui.group")], ["Ctrl+Shift+G", t("keys.gui.ungroup")],
          ["Ctrl+D", t("keys.gui.duplicate")], ["Ctrl+C", t("keys.gui.copy")], ["Ctrl+V", t("keys.gui.paste")],
          ["Ctrl+Z", t("keys.undo")], ["Ctrl+Y / Ctrl+Shift+Z", t("keys.redo")], ["?", t("keys.list")],
        ]} />
        </>
      } railLabel={t("dock.tools")} rail={
        <>
        <RailButton icon="dup" label={t("gui.duplicate")} shortcut="Ctrl+D" disabled={!selection.length} onClick={duplicate} />
        <RailButton icon="group" label={t("gui.group")} shortcut="Ctrl+G" disabled={selection.length < 2} onClick={group} />
        <RailButton icon="ungroup" label={t("gui.ungroup")} shortcut="Ctrl+Shift+G" disabled={!selection.some((i) => widgets[i].group)} onClick={ungroup} />
        <RailButton icon="tiles" label={t("gui.makeGrid")} disabled={current === undefined} onClick={() => setGridding(current)} />
        <RailSeparator />
        <RailButton icon="trash" label={t("gui.remove")} tone="danger" disabled={current === undefined} onClick={remove} />
        </>
      } sections={sections} inspectorLabel={t("dock.inspector")} inspectorClass="procpanel" bodyClass="form procform guiform" status={status}>
        <div ref={area} className="guiarea" onPointerDown={() => setSelected(undefined)} onContextMenu={openMenu(undefined)}>
          <div ref={stage} className={`guistage ${overlay ? "overlay" : ""} ${panelBg ? "panelbg" : ""} ${preview ? "preview" : ""} ${shown ? "onscreen" : ""}`}
            style={{
              width: stageW * view, height: stageH * view, ["--z" as string]: view,
            }}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
            {overlay && typeof draft.baseTexture === "string" && draft.baseTexture && <BaseTexture dir={snapshot.dir} path={draft.baseTexture} />}
            {designAt && <span className="gdesign" title={t("gui.screen.design")} style={pos(designAt.dx, designAt.dy, width, height, view)} />}
            {overlay && hud && <VanillaHud width={shown ? shown.guiWidth : width} height={shown ? shown.guiHeight : height} />}
            {inventory.map((f, i) => <span key={i} className="gslot inv" style={pos(f.x, f.y, 18, 18, zoom)} />)}
            {!overlay && !preview && <span className="gcanvashandle" title={t("gui.canvas.drag")} onPointerDown={pressCorner} />}
            {drawOrder(widgets).map((i) => [widgets[i], i] as const).map(([w, i]) => hiddenIn(layers, w) || w.editHidden ? null : (
              <WidgetView key={i} index={i} widget={w} zoom={view} shift={shiftOf(w)} dir={snapshot.dir} overlay={overlay} selected={!preview && selection.includes(i)}
                primary={!preview && i === current} pinned={pinned(layers, w)}
                procedureName={w.procedure ? snapshot.project.elements.procedure?.find((p) => p.id === w.procedure)?.id : undefined}
                onPress={pressWidget} onMenu={menuWidget} />
            ))}
            {/* Over the widgets, so its lines show on opaque images too; it takes no pointer events (KUYRUK 181). */}
            {(grid.snap || gridEditing) && !preview && !shown && (
              <span className="ggrid" style={{
                backgroundSize: `${grid.sx * zoom}px ${grid.sy * zoom}px`,
                backgroundPosition: `${(grid.ox % grid.sx) * zoom}px ${(grid.oy % grid.sy) * zoom}px`,
              }} />
            )}
          </div>
          {widgets.length === 0 && (
            <div className="guiempty" onPointerDown={(e) => e.stopPropagation()}>
              <p className="hint">{t("gui.empty")}</p>
              <div className="emptyadd">
                {kinds.filter((k) => ["label", "button", "image_button", "image", "slot"].includes(k)).map((kind) => (
                  <button key={kind} type="button" className="mbtn" onClick={() => add(kind)}><Icon name="plus" size={12} /><span>{t(`gui.kind.${kind}` as StringKey)}</span></button>
                ))}
              </div>
            </div>
          )}
        </div>
      </EditorShell>
    </>
  );
}

/**
 * Small number field with a label that changes the value when dragged sideways (1 per 4 px), like MCreator's
 * spinners; typed values apply as they are typed.
 */
function ScrubNumber({ label, title, value, min, onChange, onScrub }: {
  label: string;
  title: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
  onScrub: (on: boolean) => void;
}) {
  const clamp = (v: number) => (min === undefined ? v : Math.max(min, v));
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, start = value;
    let last = value;
    onScrub(true);
    const move = (m: PointerEvent) => {
      const next = clamp(start + Math.round((m.clientX - startX) / 4));
      if (next !== last) onChange((last = next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onScrub(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    // Not a <label>: a drag on the letter must not move the focus into the field (Ctrl+Z stays the editor's undo).
    <span className="scrub" title={title}>
      <span className="scrublabel" onPointerDown={down}>{label}</span>
      <input type="number" value={value} min={min} step={1} aria-label={title}
        onChange={(e) => e.target.value !== "" && Number.isFinite(Number(e.target.value)) && onChange(clamp(Math.round(Number(e.target.value))))} />
    </span>
  );
}

/** Rows, columns and step of a grid made from one widget; the step starts at the widget's size. */
function MakeGridDialog({ widget, onOk, onCancel }: { widget: Widget; onOk: (rows: number, cols: number, stepX: number, stepY: number) => void; onCancel: () => void }) {
  const box = widgetBox(widget);
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");
  const [sx, setSx] = useState(String(box.w));
  const [sy, setSy] = useState(String(box.h));
  const r = num(rows), c = num(cols), x = num(sx), y = num(sy);
  const valid = r >= 1 && c >= 1 && r * c >= 2 && r * c <= 400 && x >= 0 && y >= 0;
  const field = (label: string, value: string, set: (v: string) => void, min: number, autoFocus?: boolean) => (
    <FormRow label={label}><input type="number" min={min} step={1} value={value} autoFocus={autoFocus} onChange={(e) => set(e.target.value)} /></FormRow>
  );
  return (
    <Dialog title={t("gui.makeGrid.title", { kind: t(`gui.kind.${widget.kind}` as StringKey) })} okLabel={t("gui.makeGrid.ok")} canOk={valid}
      onOk={() => onOk(r, c, x, y)} onCancel={onCancel}>
      <FormGroup title={t("gui.makeGrid")}>
        {field(t("gui.makeGrid.rows"), rows, setRows, 1, true)}
        {field(t("gui.makeGrid.cols"), cols, setCols, 1)}
        {field(t("gui.makeGrid.stepX"), sx, setSx, 0)}
        {field(t("gui.makeGrid.stepY"), sy, setSy, 0)}
        <p className="hint nomargin">{valid
          ? t("gui.makeGrid.summary", { count: r * c, width: (c - 1) * x + box.w, height: (r - 1) * y + box.h })
          : t("gui.makeGrid.invalid")}</p>
      </FormGroup>
    </Dialog>
  );
}

/** The widget without one key (an editor flag or its group). */
function without(w: Widget, key: keyof Widget): Widget {
  const copy = { ...w };
  delete copy[key];
  return copy;
}

/** First place, row by row from the top left, where a new widget overlaps nothing; the centre when none is free. */
function freeSpot(box: Box, taken: Box[], width: number, height: number, grid: Grid): { x: number; y: number } {
  const stepX = grid.snap ? grid.sx : 4, stepY = grid.snap ? grid.sy : 4;
  const overlaps = (x: number, y: number) => taken.some((b) => x < b.x + b.w + 2 && b.x < x + box.w + 2 && y < b.y + b.h + 2 && b.y < y + box.h + 2);
  for (let y = grid.snap ? grid.oy % grid.sy : 6; y + box.h <= height - 4; y += stepY) {
    for (let x = grid.snap ? grid.ox % grid.sx : 8; x + box.w <= width - 4; x += stepX) if (!overlaps(x, y)) return { x, y };
  }
  return { x: snapX(grid, (width - box.w) / 2), y: snapY(grid, (height - box.h) / 2) };
}

const pos = (x: number, y: number, w: number, h: number, z: number): React.CSSProperties => ({ left: x * z, top: y * z, width: w * z, height: h * z });

/**
 * Overlay screen preview controls (KUYRUK 170): a window size and the player's GUI scale setting; below them what the
 * game makes of it (the GUI scale used, the screen in canvas pixels, window pixels per canvas pixel).
 */
function ScreenPreview({ index, onIndex, guiSetting, onGuiSetting, shown }: {
  index: number;
  onIndex: (index: number) => void;
  guiSetting: number;
  onGuiSetting: (setting: number) => void;
  shown?: ReturnType<typeof overlayScreen>;
}) {
  const auto = shown ? guiScaleFor(shown.width, shown.height) : undefined;
  return (
    <div className="guiscreen">
      <FormRow label={t("gui.screen.window")}>
        <select aria-label={t("gui.screen.window")} value={index} onChange={(e) => onIndex(Number(e.target.value))}>
          <option value={-1}>{t("gui.screen.design")}</option>
          {RESOLUTIONS.map((r, i) => <option key={i} value={i}>{`${r.width} x ${r.height}`}</option>)}
        </select>
      </FormRow>
      <FormRow label={t("gui.screen.guiScale")}>
        <select aria-label={t("gui.screen.guiScale")} value={guiSetting} disabled={!shown} onChange={(e) => onGuiSetting(Number(e.target.value))}>
          <option value={0}>{auto ? t("gui.screen.autoIs", { scale: auto }) : t("gui.screen.auto")}</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </FormRow>
      <p className="hint nomargin guiscreenmeta">
        {shown ? t("gui.screen.meta", { scale: shown.guiScale, width: shown.screenWidth, height: shown.screenHeight, pixels: Math.round(shown.pixels * 100) / 100 })
          : t("gui.screen.hint")}
      </p>
    </div>
  );
}

function BaseTexture({ dir, path }: { dir: string; path: string }) {
  const url = useTexture(dir, path);
  return url ? <img className="gbase pixel" src={url} alt="" /> : null;
}

/** One widget drawn like the generated screen draws it, with a selection frame and a resize handle. */
const WidgetView = memo(function WidgetView({ index, widget: w, zoom, shift, dir, overlay, selected, primary, pinned: locked, procedureName, onPress, onMenu }: {
  /** Place in the layout's widget list (the canvas draws in z order). */
  index: number;
  widget: Widget;
  zoom: number;
  /** Overlay screen preview: how far the widget's anchor moves it from its canvas place. */
  shift?: { dx: number; dy: number };
  dir: string;
  overlay: boolean;
  selected: boolean;
  /** The first selected widget: the one with the resize handle. */
  primary: boolean;
  /** Locked: selectable on the canvas, but not moved or resized. */
  pinned: boolean;
  procedureName?: string;
  onPress: (index: number, mode: "move" | "resize", box: Box) => (e: React.PointerEvent) => void;
  onMenu: (index: number) => (e: React.MouseEvent) => void;
}) {
  const shownState = w.kind === "state_image" ? imageStates(w)[previewStateOf(w)] : undefined;
  const url = useTexture(dir, w.kind === "image" || w.kind === "image_button" || w.kind === "toggle_button" ? w.image ?? "" : shownState?.image ?? "");
  const hoverUrl = useTexture(dir, w.kind === "image_button" ? hoverFile(w) : w.kind === "toggle_button" ? toggleTextures(w)[1] : "");
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const box = widgetBox(w, natural);
  const text = w.text ?? "";
  const color = /^#[0-9a-f]{6}$/i.test(w.color ?? "") ? w.color : overlay ? "#ffffff" : "#404040";
  let body: React.ReactNode;
  switch (w.kind) {
    case "label": {
      // A background box as the game draws it: the text's width and 8 pixels high, the padding around (KUYRUK 182).
      const bg = labelBackgroundCss(w), ts = textScaleOf(w);
      body = (
        <>
          {bg && <span className="glabelbg" style={{ background: bg.color, left: -bg.padding * ts * zoom, right: -bg.padding * ts * zoom,
            top: -bg.padding * ts * zoom, bottom: (1 - bg.padding) * ts * zoom }} />}
          <span className={`gtext ${!text && w.textProcedure ? "gfromproc" : ""}`}>
            <PixelText text={text || (w.textProcedure ? t("gui.procText") : t("gui.kind.label"))} color={color ?? "#404040"} zoom={zoom} scale={ts} /></span>
        </>
      );
      break;
    }
    case "button":
      body = w.invisible ? <span className="ginvisible" /> : <span className="gbutton"><span className="gtext"><PixelText text={text} color="#ffffff" zoom={zoom} scale={textScaleOf(w)} shadow /></span></span>;
      break;
    case "image_button":
      // Two files: the normal state, the hover state under the mouse; each a GUI sprite, which a .mcmeta animates.
      // One file (old layout, also when the hover texture is the same file): normal above hover, the lower half under the mouse.
      body = !url ? <span className="gmissing">{t("gui.noImage")}</span>
        : hoverFile(w) ? (
          <span className="gimg gimgbtn">
            <WidgetTexture dir={dir} path={w.image ?? ""} rule="sprite" look={w} className="gnormal" />
            {hoverUrl && <WidgetTexture dir={dir} path={hoverFile(w)} rule="sprite" look={w} className="ghover" />}
          </span>
        ) : <span className="gimg gsheet">{imageFilterOf(w) ? <WidgetTexture dir={dir} path={w.image ?? ""} rule="toggle" look={w} />
          : <img className="pixel" src={url} alt="" draggable={false} />}</span>;
      break;
    case "toggle_button":
      // The canvas shows the off state, and off with the mouse over it; the side panel shows all four.
      body = !url ? <span className="gmissing">{t("gui.noImage")}</span> : (
        <span className="gimg gimgbtn gtoggle">
          <span className="gframe gnormal"><WidgetTexture dir={dir} path={w.image ?? ""} rule="toggle" look={w} /></span>
          {hoverUrl && <span className="gframe ghover"><WidgetTexture dir={dir} path={toggleTextures(w)[1]} rule="toggle" look={w} /></span>}
        </span>
      );
      break;
    case "text_field":
      // Q276: the hint as the game draws it, dark grey with a shadow.
      body = <span className="gfield"><span className="gtext"><PixelText text={text} color="#555555" zoom={zoom} shadow /></span></span>;
      break;
    case "checkbox":
      body = (
        <span className="gcheck">
          <span className="gbox">{w.checked === true && <Icon name="check" size={11 * zoom} />}</span>
          <span className="gtext"><PixelText text={text} color="#e0e0e0" zoom={zoom} shadow /></span>
        </span>
      );
      break;
    case "image":
      // An animated strip is one frame high and plays, as the generated screen draws it.
      body = url ? <WidgetTexture dir={dir} path={w.image ?? ""} rule="image" widget={w} look={w} className="gimg" onSize={setNatural} />
        : <span className="gmissing">{t("gui.noImage")}</span>;
      break;
    case "state_image":
      // KUYRUK 186: the state chosen in the side panel, as the game draws it (scaled to the widget, a strip's frame or its animation).
      body = url ? <span className="gimg gstate" data-state={previewStateOf(w)} data-texture={shownState?.image ?? ""}><WidgetTexture dir={dir} path={shownState?.image ?? ""} rule="state" widget={{ frame: shownState?.frame }} look={w} /></span>
        : <span className="gmissing">{t("gui.noImage")}</span>;
      break;
    case "slot":
      body = <span className="gslot own"><span className="gslotid">{num(w.id)}</span>{w.output === true && <span className="gout" />}</span>;
      break;
  }
  return (
    <div className={`gwidget k-${w.kind} ${selected ? "sel" : ""} ${locked ? "glocked" : ""}`} data-index={index}
      style={{ ...pos(box.x + (shift?.dx ?? 0), box.y + (shift?.dy ?? 0), box.w, box.h, zoom), ["--ts" as string]: textScaleOf(w) }}
      onPointerDown={onPress(index, "move", { ...box, x: num(w.x), y: num(w.y) })} onContextMenu={onMenu(index)} title={w.kind === "button" && procedureName ? t("gui.runs", { procedure: procedureName })
        : w.kind === "label" && !text && w.textProcedure ? t("gui.fromProcedure", { procedure: w.textProcedure }) : undefined}>
      {body}
      {primary && !locked && SIZED.includes(w.kind) && <span className="ghandle" onPointerDown={onPress(index, "resize", box)} />}
    </div>
  );
}, (a, b) => a.index === b.index && a.widget === b.widget && a.zoom === b.zoom && a.dir === b.dir && a.overlay === b.overlay && a.selected === b.selected
  && a.primary === b.primary && a.pinned === b.pinned && a.procedureName === b.procedureName && a.onPress === b.onPress && a.onMenu === b.onMenu
  && a.shift?.dx === b.shift?.dx && a.shift?.dy === b.shift?.dy);

function WidgetList({ widgets, layers, selection, onSelect, onSelectGroup, expanded, onExpand, onGroupToggle, onGroupRename, renaming, onRenameStart, onRename }: {
  widgets: Widget[];
  layers: Layer[];
  selection: number[];
  onSelect: (i: number, add: boolean) => void;
  onSelectGroup: (name: string, add: boolean) => void;
  expanded: string[];
  onExpand: (name: string) => void;
  onGroupToggle: (name: string, key: "editLocked" | "editHidden") => void;
  onGroupRename: (old: string, name: string) => void;
  renaming?: number;
  onRenameStart: (i: number | undefined) => void;
  onRename: (i: number, name: string) => void;
}) {
  const [renamingGroup, setRenamingGroup] = useState<string>();
  if (!widgets.length) return <p className="listempty">{t("gui.noWidgets")}</p>;
  const row = (w: Widget, i: number, inGroup: boolean) => {
    const detail = w.kind === "slot" ? `#${num(w.id)}` : w.kind === "image" || w.kind === "image_button" || w.kind === "toggle_button" ? w.image
      : w.kind === "state_image" ? t("gui.field.states") + ` ${imageStates(w).length}` : w.text;
    const rest = <>
      {pinned(layers, w) && <Icon name="lock" size={12} />}
      {layers.length > 1 && <span className="dim">{layerOf(layers, w).name}</span>}
      <span className="dim gxy">{num(w.x)}, {num(w.y)}</span>
    </>;
    const cls = `lrow ${inGroup ? "ingroup" : ""} ${w.editHidden ? "ghidden" : ""}`;
    if (renaming === i) return (
      <div key={i} className={`${cls} sel renaming`}>
        <span className="lnum">{i + 1}</span>
        <RenameInput value={w.name ?? ""} placeholder={t("gui.renamePlaceholder")} onDone={(name) => (name === undefined ? onRenameStart(undefined) : onRename(i, name))} />
        {rest}
      </div>
    );
    return (
      <button key={i} type="button" role="option" aria-selected={selection.includes(i)} className={`${cls} ${selection.includes(i) ? "sel" : ""}`}
        title={t("gui.renameHint")} onClick={(e) => onSelect(i, e.shiftKey || e.ctrlKey)} onDoubleClick={() => onRenameStart(i)}>
        <span className="lnum">{i + 1}</span>
        <span className="ltxt">{w.name ? <><b className="gname">{w.name}</b> <span className="dim">{t(`gui.kind.${w.kind}` as StringKey)}</span></>
          : <><b>{t(`gui.kind.${w.kind}` as StringKey)}</b> {detail}</>}</span>
        {rest}
      </button>
    );
  };
  const out: React.ReactNode[] = [];
  const shown = new Set<string>();
  widgets.forEach((w, i) => {
    if (!w.group) return void out.push(row(w, i, false));
    if (shown.has(w.group)) return;
    const name = w.group;
    shown.add(name);
    const members = widgets.flatMap((m, j) => (m.group === name ? [j] : []));
    const open = expanded.includes(name);
    const all = members.every((j) => selection.includes(j));
    const locked = members.every((j) => widgets[j].editLocked === true);
    const hidden = members.every((j) => widgets[j].editHidden === true);
    out.push(
      <div key={`g:${name}`} role="option" aria-selected={all} tabIndex={0} className={`lrow ggroup ${all ? "sel" : ""}`} data-group={name}
        title={t("gui.group.hint")} onClick={(e) => onSelectGroup(name, e.shiftKey || e.ctrlKey)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onSelectGroup(name, e.shiftKey || e.ctrlKey))}
        onDoubleClick={(e) => (e.target as HTMLElement).closest("button") === null && setRenamingGroup(name)}>
        <button type="button" className={`iconbtn gcaret ${open ? "open" : ""}`} aria-expanded={open} title={t(open ? "gui.group.collapse" : "gui.group.expand")}
          onClick={(e) => (e.stopPropagation(), onExpand(name))}><Icon name="chev" size={12} /></button>
        <Icon name="group" size={12} />
        {renamingGroup === name
          ? <RenameInput value={name} placeholder={t("gui.group.name")} onDone={(next) => (setRenamingGroup(undefined), next !== undefined && onGroupRename(name, next))} />
          : <span className="ltxt"><b>{name}</b> <span className="dim">{t("gui.group.count", { count: members.length })}</span></span>}
        <button type="button" className={`iconbtn ${hidden ? "" : "on"}`} title={t(hidden ? "gui.group.show" : "gui.group.hide")}
          onClick={(e) => (e.stopPropagation(), onGroupToggle(name, "editHidden"))}><Icon name="eye" size={12} /></button>
        <button type="button" className={`iconbtn ${locked ? "on" : ""}`} title={t(locked ? "gui.group.unlock" : "gui.group.lock")}
          onClick={(e) => (e.stopPropagation(), onGroupToggle(name, "editLocked"))}><Icon name="lock" size={12} /></button>
      </div>,
    );
    if (open) for (const j of members) out.push(row(widgets[j], j, true));
  });
  return <div className="listrows guilist" role="listbox" aria-label={t("gui.widgets")} data-own-arrows>{out}</div>;
}

/** Inline name editor: Enter or leaving the field saves, Escape cancels (`onDone(undefined)`). */
function RenameInput({ value, placeholder, onDone }: { value: string; placeholder: string; onDone: (name: string | undefined) => void }) {
  const done = useRef(false);
  const finish = (name: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input className="lrename" autoFocus defaultValue={value} placeholder={placeholder} spellCheck={false} aria-label={t("gui.field.name")}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.preventDefault(), finish(e.currentTarget.value));
        else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), finish(undefined));
      }}
      onBlur={(e) => finish(e.currentTarget.value)} />
  );
}

/** Layers, top of the list drawn last (on top); the active one takes new widgets. */
function LayerList({ layers, active, onActive, onAdd, onRename, onToggle, onMove, onRemove }: {
  layers: Layer[];
  active: number;
  onActive: (index: number) => void;
  onAdd: () => void;
  onRename: (index: number, name: string) => void;
  onToggle: (index: number, key: "hidden" | "locked") => void;
  onMove: (index: number, by: number) => void;
  onRemove: (index: number) => void;
}) {
  const order = layers.map((l, i) => ({ l, i })).reverse();
  return (
    <div className="layerlist" role="group" aria-label={t("gui.layers")}>
      {order.map(({ l, i }) => (
        // The row's name field takes the focus, and that makes its layer the active one (keyboard and click alike); a click on the blank part of the row does too.
        <div key={i} role="group" aria-label={l.name} aria-current={i === active ? "true" : undefined} className={`layerrow ${i === active ? "sel" : ""}`}
          onMouseDown={(e) => e.target === e.currentTarget && onActive(i)}>
          <button type="button" className={`iconbtn ${l.hidden ? "" : "on"}`} title={t(l.hidden ? "gui.layer.show" : "gui.layer.hide")}
            onClick={(e) => (e.stopPropagation(), onToggle(i, "hidden"))}><Icon name="eye" size={12} /></button>
          <button type="button" className={`iconbtn ${l.locked ? "on" : ""}`} title={t(l.locked ? "gui.layer.unlock" : "gui.layer.lock")}
            onClick={(e) => (e.stopPropagation(), onToggle(i, "locked"))}><Icon name="lock" size={12} /></button>
          <input value={l.name} aria-label={t("gui.layer.name")} spellCheck={false} onFocus={() => onActive(i)} onChange={(e) => onRename(i, e.target.value)} />
          <button type="button" className="iconbtn" title={t("gui.layer.up")} disabled={i === layers.length - 1}
            onClick={(e) => (e.stopPropagation(), onMove(i, 1))}><Icon name="up" size={12} /></button>
          <button type="button" className="iconbtn" title={t("gui.layer.down")} disabled={i === 0}
            onClick={(e) => (e.stopPropagation(), onMove(i, -1))}><Icon name="down" size={12} /></button>
          <button type="button" className="iconbtn" title={t("gui.layer.remove")} disabled={layers.length < 2}
            onClick={(e) => (e.stopPropagation(), onRemove(i))}><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button type="button" className="mbtn" onClick={onAdd}><Icon name="plus" size={12} /><span>{t("gui.layer.add")}</span></button>
    </div>
  );
}

function WidgetForm({ index, layoutKey, widget, overlay, ctx, onChange }: {
  index: number;
  layoutKey: string;
  widget: Widget;
  overlay: boolean;
  ctx: FormContext;
  onChange: (key: string, value: unknown) => void;
}) {
  const fields = widgetFields(widget.kind, overlay);
  const list = <FieldList fields={fields} scope={{ fields, values: widget as never }} ctx={ctx} prefix={`${layoutKey}[${index}].`} coveragePrefix={`${layoutKey}.`} onChange={onChange} />;
  if (widget.kind === "state_image") return <><StateStrip widget={widget} dir={ctx.snapshot.dir} onChange={onChange} />{list}</>;
  if (widget.kind === "image" && typeof widget.image === "string" && widget.image) return <><PlaybackNote dir={ctx.snapshot.dir} image={widget.image} />{list}</>;
  if (widget.kind !== "toggle_button") return list;
  // A toggle button's four states side by side, as the game draws them (a missing texture shows the one it falls back to).
  const states = toggleTextures(widget);
  return (
    <>
      <div className="togglestates" aria-label={t("gui.toggle.states")}>
        {(["off", "offHover", "on", "onHover"] as const).map((state, i) => (
          <figure key={state} className="togglestate" data-state={state} data-texture={states[i]}>
            <span className="togglepic">{states[i] ? <Texture dir={ctx.snapshot.dir} path={states[i]} size={32} /> : <span className="gmissing">{t("gui.noImage")}</span>}</span>
            <figcaption>{t(`gui.toggle.${state}`)}</figcaption>
          </figure>
        ))}
      </div>
      {list}
    </>
  );
}

/**
 * A state image's states side by side (KUYRUK 186), each as the game draws it; clicking one shows it on the canvas. Split
 * into frames turns the shown state's strip into one still state per frame.
 */
function StateStrip({ widget, dir, onChange }: { widget: Widget; dir: string; onChange: (key: string, value: unknown) => void }) {
  const states = imageStates(widget);
  const shown = previewStateOf(widget);
  const [frames, setFrames] = useState(0);
  const current = states[shown];
  const image = current?.image ?? "";
  useEffect(() => {
    setFrames(0);
    if (!image) return;
    let alive = true;
    loadPreviewTexture(dir, image).then((tex) => alive && setFrames(Math.floor(tex.image.naturalHeight / Math.max(1, tex.image.naturalWidth))), () => {});
    return () => void (alive = false);
  }, [dir, image]);
  const split = () => {
    const parts = Array.from({ length: frames }, (_, frame) => ({ image, frame }));
    onChange("states", [...states.slice(0, shown), ...parts, ...states.slice(shown + 1)]);
  };
  return (
    <div className="statestrip">
      <div className="minibar">
        <span className="dim statehint">{t("gui.state.states")}</span>
        <button type="button" className="mbtn" title={t("gui.state.splitHint")} disabled={frames < 2 || current?.frame !== undefined} onClick={split}>
          <Icon name="grid" size={12} /><span>{t("gui.state.split")}</span>
        </button>
      </div>
      <div className="togglestates statelist" role="radiogroup" aria-label={t("gui.field.states")}>
        {states.map((s, k) => (
          <button key={k} type="button" role="radio" aria-checked={k === shown} className={`togglestate stateitem ${k === shown ? "sel" : ""}`}
            data-state={k} data-texture={s.image ?? ""} onClick={() => onChange("previewState", k)}>
            <span className="togglepic">{s.image ? <WidgetTexture dir={dir} path={s.image} rule="state" widget={{ frame: s.frame }} className="statepic" />
              : <span className="gmissing">{t("gui.noImage")}</span>}</span>
            <span className="statecap">{t("gui.state.n", { n: k })}</span>
            <span className="statesub dim">{s.condition || (s.frame !== undefined ? t("gui.state.frame", { n: s.frame }) : "")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Several widgets selected (KUYRUK 180): their layer, editor lock and every field they all have, edited together. A
 * field whose values differ shows empty with a note; a change sets it on all of them.
 */
function MultiWidgetForm({ list, layers, overlay, ctx, layoutKey, onLayer, onLock, onChange }: {
  list: Widget[];
  layers: Layer[];
  overlay: boolean;
  ctx: FormContext;
  layoutKey: string;
  onLayer: (name: string) => void;
  onLock: (on: boolean) => void;
  onChange: (key: string, value: unknown) => void;
}) {
  const layer = sharedValue(list.map((w) => ({ ...w, layer: layerOf(layers, w).name })), "layer");
  const locked = list.every((w) => w.editLocked === true), someLocked = list.some((w) => w.editLocked === true);
  const fields = sharedFields(list, overlay).map((f) => (sharedValue(list, f.key).mixed ? { ...f, help: t("gui.multi.mixed", { count: list.length }) } : f));
  const values = Object.fromEntries(fields.map((f) => [f.key, sharedValue(list, f.key).value]));
  return (
    <div className="multiform">
      <div className="form">
        <label className="frow">
          <span className="flabel">{t("gui.layer.of")}</span>
          <select value={layer.mixed ? "" : String(layer.value)} onChange={(e) => e.target.value && onLayer(e.target.value)}>
            {layer.mixed && <option value="">{t("gui.multi.mixedValue")}</option>}
            {layers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>
        <label className="frow">
          <span className="flabel">{t("gui.layer.lockWidget")}</span>
          <span className="check"><input type="checkbox" checked={locked} ref={(e) => void (e && (e.indeterminate = someLocked && !locked))}
            onChange={() => onLock(!locked)} /></span>
        </label>
      </div>
      {fields.length ? <FieldList fields={fields} scope={{ fields, values }} ctx={ctx} prefix={`${layoutKey}[*].`} coveragePrefix={`${layoutKey}.`} onChange={onChange} />
        : <p className="hint nomargin">{t("gui.multi.none")}</p>}
    </div>
  );
}

/** The element's other fields (size, inventory offset, background, grid, triggers) in their groups. */
function ScreenSettings({ groups, layoutKey, all, draft, ctx, onChange }: {
  groups: GroupDef[];
  layoutKey: string;
  all: FieldDef[];
  draft: Element;
  ctx: FormContext;
  onChange: (key: string, value: unknown) => void;
}) {
  const scope = { fields: all, values: draft };
  const visible = visibility(scope);
  return (
    <>
      {groups.map((g) => {
        const fields = g.fields.filter((f) => f.key !== layoutKey);
        if (!fields.some((f) => visible(f.key))) return null;
        return (
          <FormGroup key={g.title} title={g.title} titleLang="en">
            <FieldList fields={fields} scope={scope} ctx={ctx} prefix="" coveragePrefix="" onChange={onChange} />
          </FormGroup>
        );
      })}
    </>
  );
}


/** Q229: the playback mode of an image's texture (set in the texture editor), shown above its fields; nothing for a still texture. */
function PlaybackNote({ dir, image }: { dir: string; image: string }) {
  const [mode, setMode] = useState<PlaybackMode>();
  useEffect(() => {
    let alive = true;
    setMode(undefined);
    api.codeRead(dir, `${image}.mcmeta`).then((file) => {
      try {
        const raw = JSON.parse(file.text) as Record<string, unknown>;
        if (alive && raw.animation) setMode(playbackModeOf(raw));
      } catch {
        // Not valid JSON: the game plays it still, so there is no mode to show.
      }
    }, () => {});
    return () => void (alive = false);
  }, [dir, image]);
  if (!mode) return null;
  return <p className="hint playbacknote" data-mode={mode}>{t("gui.field.playbackMode", { mode: t(`paint.playback.${mode}`) })}</p>;
}
