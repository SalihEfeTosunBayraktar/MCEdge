import { animationSchedule, type AnimationSchedule } from "../../../../src/resources/textureAnimation.ts";

/**
 * How the generated screen plays a widget texture (src/generator/types/gui.ts), so the GUI editor draws the same frame
 * (KUYRUK 160). Pure: the image size and the .mcmeta text come from the caller.
 *
 * - image: a vertical strip animates when it has a .mcmeta or the widget says `animated`; frames are as high as the
 *   .mcmeta height, else square; `frametime` (else the widget's frameTime, else 1 tick) each; the widget's frameCount
 *   limits the frames played. No interpolation.
 * - toggle: a texture with a .mcmeta animation and at least two square frames plays them all, `frametime` each.
 * - sprite: an image button's texture is a GUI sprite, which the game animates like any .mcmeta texture.
 * - state: a state image's state (KUYRUK 186) plays like a toggle texture; with `frame` set and a strip of at least two
 *   square frames it is that frame, still.
 */
export type WidgetTextureRule = "image" | "toggle" | "sprite" | "state";

export interface WidgetAnimationFields {
  animated?: unknown;
  frameTime?: unknown;
  frameCount?: unknown;
  frame?: unknown;
}

export function widgetSchedule(rule: WidgetTextureRule, width: number, height: number, mcmeta: string | undefined, widget: WidgetAnimationFields = {}): AnimationSchedule | undefined {
  if (rule === "sprite") return mcmeta ? animationSchedule(mcmeta, width, height) : undefined;
  const section = mcmetaAnimation(mcmeta);
  const whole = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);
  if (rule === "state" && widget.frame !== undefined && widget.frame !== null && widget.frame !== "" && Number.isFinite(Number(widget.frame))) {
    const count = Math.floor(height / Math.max(1, width));
    if (count >= 2) {
      const index = ((Math.round(Number(widget.frame)) % count) + count) % count;
      return { frameWidth: width, frameHeight: width, frameCount: count, frames: [{ index, time: 1 }], interpolate: false, total: 1 };
    }
  }
  if (rule === "toggle" || rule === "state") {
    const count = Math.floor(height / Math.max(1, width));
    if (!section || count < 2) return undefined;
    return strip(width, width, count, count, Math.max(1, whole(section.frametime, 1)));
  }
  if (!section && widget.animated !== true) return undefined;
  const frameHeight = Math.max(1, Math.min(height, whole(section?.height, width)));
  const count = Math.floor(height / frameHeight);
  if (count < 2) return undefined;
  const frametime = whole(section?.frametime ?? widget.frameTime, 1);
  const played = Math.min(count, Math.max(1, whole(widget.frameCount, count)));
  return strip(width, frameHeight, count, played, frametime > 0 ? frametime : 1);
}

/** The "animation" object of a .mcmeta text, or undefined. */
function mcmetaAnimation(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return raw.animation && typeof raw.animation === "object" ? (raw.animation as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function strip(frameWidth: number, frameHeight: number, frameCount: number, played: number, time: number): AnimationSchedule {
  const frames = Array.from({ length: played }, (_, index) => ({ index, time }));
  return { frameWidth, frameHeight, frameCount, frames, interpolate: false, total: played * time };
}
