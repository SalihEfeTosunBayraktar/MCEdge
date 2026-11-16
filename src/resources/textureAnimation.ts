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
  /** Ticks of one loop (one pass of a once mode). */
  total: number;
  /** Once modes (Q229): after one pass this frame stays; undefined loops. */
  hold?: number;
}

export const TICK_MS = 50;

/**
 * Playback modes of an animated texture (Q229), one model for blocks, items and GUI images: `loop` (vanilla), `hold_last`
 * (play once, stay on the last frame), `hold_first` (play once, then show the first frame), `ping_pong` (forwards, then
 * backwards). Stored in the .mcmeta's own "mcedge" section ({ "mcedge": { "playback": "ping_pong" } }), which the game
 * ignores; the generated mod gets a plain vanilla .mcmeta whose frame list plays the mode (vanillaMcmeta).
 */
export type PlaybackMode = "loop" | "hold_last" | "hold_first" | "ping_pong";
export const PLAYBACK_MODES: readonly PlaybackMode[] = ["loop", "hold_last", "hold_first", "ping_pong"];
/** Ticks a held frame shows in a vanilla .mcmeta: about 19 months of play, so the frame stays. */
export const HOLD_TICKS = 1_000_000_000;

/** The playback mode of a parsed .mcmeta (loop when it has none or an unknown one). */
export function playbackModeOf(raw: unknown): PlaybackMode {
  const mode = (raw as { mcedge?: { playback?: unknown } } | undefined)?.mcedge?.playback;
  return PLAYBACK_MODES.includes(mode as PlaybackMode) ? (mode as PlaybackMode) : "loop";
}

/** `raw` (a parsed .mcmeta) with `mode` set; loop removes the setting, and the "mcedge" section when it is left empty. */
export function withPlaybackMode<T extends Record<string, unknown>>(raw: T, mode: PlaybackMode): T {
  const own = { ...((raw.mcedge as Record<string, unknown> | undefined) ?? {}) };
  if (mode === "loop") delete own.playback;
  else own.playback = mode;
  const out: Record<string, unknown> = { ...raw };
  if (Object.keys(own).length) out.mcedge = own;
  else delete out.mcedge;
  return out as T;
}

/** `schedule` played in `mode`: ping-pong adds the frames back (without repeating the ends), once modes hold a frame. */
export function applyPlayback(schedule: AnimationSchedule, mode: PlaybackMode): AnimationSchedule {
  const { frames } = schedule;
  if (mode === "ping_pong") {
    const all = [...frames, ...frames.slice(1, -1).reverse()];
    return { ...schedule, frames: all, total: all.reduce((n, f) => n + f.time, 0), hold: undefined };
  }
  if (mode === "hold_last") return { ...schedule, hold: frames[frames.length - 1].index };
  if (mode === "hold_first") return { ...schedule, hold: frames[0].index };
  return { ...schedule, hold: undefined };
}

/**
 * The .mcmeta the generated mod gets: the same text for a loop (or no animation), else the vanilla frame list that plays
 * the mode (a once mode ends on its held frame shown HOLD_TICKS) without the "mcedge" section. For blocks and items the
 * game starts every animation when it loads the textures, so a once mode plays once from then (Q229).
 */
export function vanillaMcmeta(text: string, width: number, height: number): string {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
  if (!raw || typeof raw !== "object" || !raw.mcedge) return text;
  const schedule = animationSchedule(text, width, height);
  const { mcedge: _own, ...vanilla } = raw;
  if (!schedule || !vanilla.animation) return JSON.stringify(vanilla, null, 2) + "\n";
  const section = { ...(vanilla.animation as Record<string, unknown>) };
  const frametime = typeof section.frametime === "number" && section.frametime > 0 ? Math.floor(section.frametime) : 1;
  const frames = schedule.frames.map((f) => ({ ...f }));
  if (schedule.hold !== undefined) {
    const last = frames[frames.length - 1];
    if (last.index === schedule.hold) last.time = HOLD_TICKS;
    else frames.push({ index: schedule.hold, time: HOLD_TICKS });
  }
  section.frames = frames.map((f) => (f.time === frametime ? f.index : f));
  return JSON.stringify({ ...vanilla, animation: section }, null, 2) + "\n";
}

/**
 * The schedule of an image of `width` x `height` with this .mcmeta text; undefined when the text has no animation
 * section or the image holds a single frame (then it is drawn as it is). Invalid JSON is not an animation either.
 */
export function animationSchedule(mcmeta: string, width: number, height: number): AnimationSchedule | undefined {
  let section: Record<string, unknown>, raw: Record<string, unknown>;
  try {
    raw = JSON.parse(mcmeta) as Record<string, unknown>;
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
  const schedule = { frameWidth, frameHeight, frameCount, frames, interpolate: section.interpolate === true, total: frames.reduce((n, f) => n + f.time, 0) };
  return applyPlayback(schedule, playbackModeOf(raw));
}

/**
 * What shows `ms` after the animation started: the frame, the next one, and how far towards it (0 without interpolate).
 * A once mode shows its held frame from the end of the first pass on (and the first frame before the start).
 */
export function frameAt(schedule: AnimationSchedule, ms: number): { index: number; next: number; blend: number } {
  if (schedule.hold !== undefined) {
    if (ms < 0) ms = 0;
    if (ms / TICK_MS >= schedule.total) return { index: schedule.hold, next: schedule.hold, blend: 0 };
  }
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
