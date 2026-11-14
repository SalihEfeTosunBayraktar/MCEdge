/**
 * Overlays on screens of any size (KUYRUK 170). Widgets are placed on a 427x240 design canvas; in the game each one
 * keeps its distance to the canvas point named by its anchor (its own `anchor`, else the overlay's `anchor`): a widget
 * anchored bottom right stays as far from the screen's bottom right corner as it is from the canvas's. The overlay's
 * `scaleMode` sets how big a canvas pixel is: "gui" one GUI pixel (the player's GUI scale, as before), "fixed" a
 * chosen GUI scale whatever the player's setting, "fit" the canvas scaled to fill the screen (by its narrower side).
 * Pure functions shared by the generator (src/generator/types/overlay.ts writes the same rule in Java), the editor's
 * resolution preview and the MCP tool overlay_layout.
 */

export const OVERLAY_SIZE = { width: 427, height: 240 };

export const ANCHORS = ["top_left", "top", "top_right", "left", "center", "right", "bottom_left", "bottom", "bottom_right"] as const;
export type Anchor = (typeof ANCHORS)[number];

export const SCALE_MODES = ["gui", "fixed", "fit"] as const;
export type ScaleMode = (typeof SCALE_MODES)[number];

/** Screen sizes the editor previews (window pixels). */
export const RESOLUTIONS: { width: number; height: number }[] = [
  { width: 854, height: 480 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1600, height: 900 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3440, height: 1440 }, { width: 3840, height: 2160 },
];

/** Any element or widget value (a weak type would refuse interfaces without these keys). */
type Values = object;
const get = (o: Values, key: string): unknown => (o as Record<string, unknown>)[key];

const isAnchor = (v: unknown): v is Anchor => typeof v === "string" && (ANCHORS as readonly string[]).includes(v);

/** The overlay's anchor; "center" (the old behaviour) when unset. */
export const overlayAnchor = (overlay: Values): Anchor => { const a = get(overlay, "anchor"); return isAnchor(a) ? a : "center"; };

/** A widget's own anchor, else the overlay's. */
export const widgetAnchor = (widget: Values, overlay: Values): Anchor => { const a = get(widget, "anchor"); return isAnchor(a) ? a : overlayAnchor(overlay); };

export const scaleModeOf = (overlay: Values): ScaleMode => { const m = String(get(overlay, "scaleMode")); return (SCALE_MODES as readonly string[]).includes(m) ? m as ScaleMode : "gui"; };

/** The GUI scale "fixed" draws at: 1 to 8, default 2. */
export function fixedScaleOf(overlay: Values): number {
  const n = Math.round(Number(get(overlay, "fixedScale")));
  return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 2;
}

/** Horizontal and vertical part of an anchor: 0 start, 1 middle, 2 end. */
export function anchorParts(anchor: Anchor): { h: 0 | 1 | 2; v: 0 | 1 | 2 } {
  const h = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 2 : 1;
  const v = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 2 : 1;
  return { h, v };
}

/**
 * The GUI scale the game picks for a window (Window.calculateScale): the setting (0 = auto) or less, as long as the
 * scaled screen stays at least 320x240.
 */
export function guiScaleFor(width: number, height: number, setting = 0): number {
  let i = 1;
  while (i !== setting && i < width && i < height && Math.floor(width / (i + 1)) >= 320 && Math.floor(height / (i + 1)) >= 240) i++;
  return i;
}

export interface OverlayScreen {
  /** Window pixels and the GUI scale used. */
  width: number;
  height: number;
  guiScale: number;
  /** The screen in GUI pixels, as getGuiScaledWidth / getGuiScaledHeight return it. */
  guiWidth: number;
  guiHeight: number;
  /** GUI pixels per canvas pixel, and the screen in canvas pixels (what the widgets are placed on). */
  scale: number;
  screenWidth: number;
  screenHeight: number;
  /** Window pixels per canvas pixel. */
  pixels: number;
}

/** The screen an overlay is drawn on, for a window size and GUI scale setting (0 = auto). */
export function overlayScreen(overlay: Values, width: number, height: number, guiSetting = 0): OverlayScreen {
  const guiScale = guiScaleFor(width, height, guiSetting);
  const guiWidth = Math.ceil(width / guiScale), guiHeight = Math.ceil(height / guiScale);
  const mode = scaleModeOf(overlay);
  const scale = mode === "fit" ? Math.min(guiWidth / OVERLAY_SIZE.width, guiHeight / OVERLAY_SIZE.height)
    : mode === "fixed" ? fixedScaleOf(overlay) / guiScale : 1;
  const screenWidth = scale === 1 ? guiWidth : Math.round(guiWidth / scale);
  const screenHeight = scale === 1 ? guiHeight : Math.round(guiHeight / scale);
  return { width, height, guiScale, guiWidth, guiHeight, scale, screenWidth, screenHeight, pixels: guiScale * scale };
}

/** How far a canvas point moves on a screen of this size (canvas pixels) for an anchor; the generator's Java rule. */
export function anchorOffset(anchor: Anchor, screenWidth: number, screenHeight: number): { dx: number; dy: number } {
  const { h, v } = anchorParts(anchor);
  const dx = h === 0 ? 0 : h === 1 ? Math.floor(screenWidth / 2) - 213 : screenWidth - OVERLAY_SIZE.width;
  const dy = v === 0 ? 0 : v === 1 ? Math.floor(screenHeight / 2) - 120 : screenHeight - OVERLAY_SIZE.height;
  return { dx, dy };
}

/** Where every widget's top left lands on a screen (canvas pixels), in list order. */
export function overlayPositions(overlay: Values, screen: Pick<OverlayScreen, "screenWidth" | "screenHeight">): { anchor: Anchor; x: number; y: number }[] {
  const list = get(overlay, "components");
  const widgets = Array.isArray(list) ? list as { anchor?: unknown; x?: unknown; y?: unknown }[] : [];
  return widgets.map((w) => {
    const anchor = widgetAnchor(w ?? {}, overlay);
    const { dx, dy } = anchorOffset(anchor, screen.screenWidth, screen.screenHeight);
    return { anchor, x: Math.round(Number(w?.x) || 0) + dx, y: Math.round(Number(w?.y) || 0) + dy };
  });
}
