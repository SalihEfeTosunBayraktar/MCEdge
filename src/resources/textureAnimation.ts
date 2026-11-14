/**
 * Animated textures as the game plays them (KUYRUK 166, 160): a PNG holding frames one above the other plus
 * "<png>.mcmeta" with an "animation" section. Frames are square (the image width) unless the section gives width and
 * height; `frames` orders them (an index, or { index, time }), each shown `frametime` ticks (1 tick = 50 ms) unless it
 * has its own time; with `interpolate` the colour blends towards the next frame. Pure: callers read the files.
 */

export interface AnimationSchedule {
  frameWidth: number;
  frameHeight: number;
  /** Frames in the image, top first, row by row when frames are narrower than the image. */
  frameCount: number;
  /** Playing order: frame index and how many ticks it shows. */
  frames: { index: number; time: number }[];
  interpolate: boolean;
  /** Ticks of one loop. */
  total: number;
}

export const TICK_MS = 50;

/**
 * The schedule of an image of `width` x `height` with this .mcmeta text; undefined when the text has no animation
 * section or the image holds a single frame (then it is drawn as it is). Invalid JSON is not an animation either.
 */
export function animationSchedule(mcmeta: string, width: number, height: number): AnimationSchedule | undefined {
  let section: Record<string, unknown>;
  try {
    const raw = JSON.parse(mcmeta) as Record<string, unknown>;
    if (!raw.animation || typeof raw.animation !== "object") return undefined;
    section = raw.animation as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const positive = (v: unknown) => (typeof v === "number" && v > 0 ? Math.floor(v) : undefined);
  // A size given on one side only makes square frames.
  const square = Math.min(width, height);
  const frameWidth = Math.min(width, positive(section.width) ?? positive(section.height) ?? square);
  const frameHeight = Math.min(height, positive(section.height) ?? positive(section.width) ?? square);
  const frameCount = Math.floor(width / frameWidth) * Math.floor(height / frameHeight);
  if (frameCount < 2) return undefined;
  const frametime = positive(section.frametime) ?? 1;
  const listed = Array.isArray(section.frames) ? section.frames : undefined;
  const frames = (listed ?? Array.from({ length: frameCount }, (_, i) => i))
    .map((f) => (typeof f === "number" ? { index: f, time: frametime } : f && typeof f === "object" ? { index: Number((f as { index?: unknown }).index), time: positive((f as { time?: unknown }).time) ?? frametime } : undefined))
    .filter((f): f is { index: number; time: number } => !!f && Number.isInteger(f.index) && f.index >= 0 && f.index < frameCount);
  if (!frames.length) return undefined;
  return { frameWidth, frameHeight, frameCount, frames, interpolate: section.interpolate === true, total: frames.reduce((n, f) => n + f.time, 0) };
}

/** What shows `ms` after the animation started: the frame, the next one, and how far towards it (0 without interpolate). */
export function frameAt(schedule: AnimationSchedule, ms: number): { index: number; next: number; blend: number } {
  const ticks = ms / TICK_MS;
  let t = ((ticks % schedule.total) + schedule.total) % schedule.total;
  for (let i = 0; i < schedule.frames.length; i++) {
    const frame = schedule.frames[i];
    if (t < frame.time) {
      const next = schedule.frames[(i + 1) % schedule.frames.length].index;
      // The game blends per tick, so the step is whole ticks into the frame.
      return { index: frame.index, next, blend: schedule.interpolate && next !== frame.index ? Math.floor(t) / frame.time : 0 };
    }
    t -= frame.time;
  }
  const last = schedule.frames[schedule.frames.length - 1];
  return { index: last.index, next: last.index, blend: 0 };
}

/** Top-left pixel of frame `index` in the image. */
export function framePosition(schedule: AnimationSchedule, width: number, index: number): { x: number; y: number } {
  const perRow = Math.max(1, Math.floor(width / schedule.frameWidth));
  return { x: (index % perRow) * schedule.frameWidth, y: Math.floor(index / perRow) * schedule.frameHeight };
}
