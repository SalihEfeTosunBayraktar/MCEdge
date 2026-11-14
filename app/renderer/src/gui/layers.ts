import type { Widget } from "./widgets.ts";

/**
 * Layers of a GUI or overlay layout (editor only, the element's `layers`): named groups drawn in order, the first at
 * the bottom. A widget names its layer in `layer`; a widget without one, or naming a removed layer, is on the first.
 * The widget list is kept sorted by layer, so the generated screen draws them in the same order. A hidden layer is
 * not drawn in the editor (so it cannot be clicked); a locked layer, like a widget with `editLocked`, can be clicked and
 * selected on the canvas but not moved, resized or deleted there.
 */
export interface Layer {
  name: string;
  hidden?: boolean;
  locked?: boolean;
}

/** The layers of a layout; one default layer when it has none. */
export function layersOf(value: unknown, defaultName: string): Layer[] {
  const list = Array.isArray(value) ? value.filter((l): l is Layer => !!l && typeof (l as Layer).name === "string" && !!(l as Layer).name) : [];
  return list.length ? list : [{ name: defaultName }];
}

export const layerIndex = (layers: Layer[], widget: Widget) => Math.max(0, layers.findIndex((l) => l.name === widget.layer));

export const layerOf = (layers: Layer[], widget: Widget) => layers[layerIndex(layers, widget)];

/** Widgets in drawing order: by layer, keeping their order inside one. */
export function sortByLayer(widgets: Widget[], layers: Layer[]): Widget[] {
  return widgets.map((w, i) => ({ w, i, l: layerIndex(layers, w) })).sort((a, b) => a.l - b.l || a.i - b.i).map((x) => x.w);
}

/** True when the canvas must not move, resize or delete the widget (it can still be selected). */
export const pinned = (layers: Layer[], widget: Widget) => widget.editLocked === true || layerOf(layers, widget).locked === true;

export const hiddenIn = (layers: Layer[], widget: Widget) => layerOf(layers, widget).hidden === true;

/** A layer name not used yet: "<base> 2", "<base> 3", ... */
export function freeLayerName(layers: Layer[], base: string): string {
  for (let n = layers.length + 1; ; n++) if (!layers.some((l) => l.name === `${base} ${n}`)) return `${base} ${n}`;
}
