import { blank, clone, type Pixels } from "./pixels.ts";
import { animationSchedule, playbackModeOf, withPlaybackMode, type AnimationSchedule, type PlaybackMode } from "../../../../src/resources/textureAnimation.ts";

/**
 * Animated textures: a vertical strip of frames in one PNG plus "<png>.mcmeta" with an "animation" section
 * (frametime in ticks, interpolate, optional frame order). Other keys of the .mcmeta are kept as they were.
 */
export interface Animation {
  frametime: number;
  interpolate: boolean;
  /** How it plays (Q229): loop, once and hold the last or first frame, ping-pong; kept in the .mcmeta's "mcedge" section. */
  mode: PlaybackMode;
  /** The .mcmeta as read, so keys the editor does not show survive a save. */
  raw?: Record<string, unknown>;
}

export const NEW_ANIMATION: Animation = { frametime: 4, interpolate: false, mode: "loop" };

/** The "animation" section of a .mcmeta text, or undefined when it has none. */
export function parseMcmeta(text: string): Animation | undefined {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const a = raw.animation as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") return undefined;
  return { frametime: Math.max(1, Number(a.frametime) || 1), interpolate: a.interpolate === true, mode: playbackModeOf(raw), raw };
}

/** .mcmeta text for the frames; a custom frame order is dropped when the frame count changed. */
export function mcmetaText(animation: Animation, frameCount: number, previousCount: number): string {
  const raw = withPlaybackMode(structuredClone(animation.raw ?? {}), animation.mode);
  const section = { ...((raw.animation as Record<string, unknown>) ?? {}) };
  section.frametime = animation.frametime;
  if (animation.interpolate) section.interpolate = true;
  else delete section.interpolate;
  if (frameCount !== previousCount) delete section.frames;
  raw.animation = section;
  return JSON.stringify(raw, null, 2) + "\n";
}

/** How `frames` frames of `width` x `height` play with this animation, as the game plays them (shared model, Q229). */
export function scheduleOf(animation: Animation, frames: number, width: number, height: number): AnimationSchedule | undefined {
  return animationSchedule(mcmetaText(animation, frames, frames), width, height * frames);
}

/** Square frames (or `frameHeight` high) of a strip, top first. */
export function splitFrames(strip: Pixels, frameHeight = strip.width): Pixels[] {
  const h = Math.max(1, Math.min(frameHeight, strip.height));
  const count = Math.max(1, Math.floor(strip.height / h));
  const row = strip.width * 4;
  return Array.from({ length: count }, (_, i) => ({ width: strip.width, height: h, data: strip.data.slice(i * h * row, (i + 1) * h * row) }));
}

/** Frames one above the other in one image. */
export function joinFrames(frames: Pixels[]): Pixels {
  const { width, height } = frames[0];
  const out = blank(width, height * frames.length);
  frames.forEach((f, i) => out.data.set(f.data, i * width * height * 4));
  return out;
}

/** A strip of `count` frames, each a copy of `first` (or empty). */
export function stripOf(first: Pixels, count: number): Pixels {
  return joinFrames(Array.from({ length: count }, () => clone(first)));
}

/** Colour between two frames, as the game blends them with interpolate on. */
export function blend(a: Pixels, b: Pixels, t: number): Pixels {
  const out = clone(a);
  for (let i = 0; i < a.data.length; i++) out.data[i] = Math.round(a.data[i] + (b.data[i] - a.data[i]) * t);
  return out;
}
