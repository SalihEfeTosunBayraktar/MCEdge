/**
 * Show / hide timing (Q228): one general model for anything that appears and disappears (status bubbles, radial menu
 * opening; other overlays can take it later). An element has an appear transition and a disappear transition, each with
 * a set of effects (fade, scale, slide up, slide down; any combination, none = instant), a length in ticks and an easing,
 * plus an active (visible) time: ticks from showing until the disappear transition starts, 0 = until cleared.
 *
 * Pure values shared by the generators (they write `timingJson` into the mod's data files, where one Java helper,
 * `<Mod>Transitions`, evaluates it) and the editor previews (which evaluate it here), so the game and the editor move the
 * same way. `transitionState` is the one rule; the Java helper in src/generator/transitions.ts repeats it.
 */

export const TRANSITION_EFFECTS = ["fade", "scale", "slide_up", "slide_down"] as const;
export type TransitionEffect = (typeof TRANSITION_EFFECTS)[number];
export const EASINGS = ["linear", "ease_out", "ease_in_out", "back"] as const;
export type Easing = (typeof EASINGS)[number];

/** How far a slide moves, as a fraction of the element's height (a bubble) or size (a radial menu). */
export const SLIDE_DISTANCE = 0.5;

export interface Transition {
  effects: TransitionEffect[];
  /** Length in ticks (1 tick = 50 ms); an empty set of effects takes no time. */
  ticks: number;
  easing: Easing;
}

export interface Timing {
  appear: Transition;
  disappear: Transition;
  /** Ticks from showing until the disappear transition starts (it includes the appear transition); 0: until cleared. */
  active: number;
}

/** What to draw: alpha 0..1, scale (>= 0, can pass 1 with `back`), vertical offset as a fraction of the height, up positive. */
export interface TransitionState {
  alpha: number;
  scale: number;
  offset: number;
}

export const DEFAULT_TRANSITION: Readonly<Transition> = { effects: ["scale"], ticks: 5, easing: "back" };

/** Ticks a transition really takes. */
export const transitionLength = (t: Transition): number => (t.effects.length ? t.ticks : 0);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Easing curve: x 0..1 to 0..1 (`back` overshoots 1 on the way, settling at 1). */
export function ease(easing: Easing, x: number): number {
  const t = clamp(x, 0, 1);
  switch (easing) {
    case "ease_out": return 1 - (1 - t) ** 3;
    case "ease_in_out": return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    case "back": return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    default: return t;
  }
}

/**
 * The state `age` ticks into a transition. Appearing runs from hidden to shown; disappearing is the same curve backwards
 * (shown at age 0, gone at its length), so a `back` easing grows a little before it shrinks. Slide up moves up into
 * place when appearing and up and away when disappearing (slide down the opposite).
 */
export function transitionState(t: Transition, age: number, leaving: boolean): TransitionState {
  const length = transitionLength(t);
  const p = length === 0 ? 1 : clamp(age / length, 0, 1);
  const s = ease(t.easing, leaving ? 1 - p : p);
  const has = (e: TransitionEffect) => t.effects.includes(e);
  const away = (1 - s) * SLIDE_DISTANCE;
  const slide = (has("slide_up") ? -away : 0) + (has("slide_down") ? away : 0);
  return { alpha: has("fade") ? clamp(s, 0, 1) : 1, scale: has("scale") ? Math.max(0, s) : 1, offset: leaving ? -slide : slide };
}

/** Where a shown element is `age` ticks after showing, for a preview: the phase and its state (`active` 0 never leaves). */
export function timelineAt(timing: Timing, age: number): { phase: "appear" | "hold" | "disappear" | "gone"; state: TransitionState } {
  const appear = transitionLength(timing.appear), out = transitionLength(timing.disappear);
  const leaveAt = timing.active > 0 ? Math.max(timing.active, appear) : Infinity;
  if (age >= leaveAt) {
    const into = age - leaveAt;
    return into >= out ? { phase: "gone", state: { alpha: 0, scale: 0, offset: 0 } } : { phase: "disappear", state: transitionState(timing.disappear, into, true) };
  }
  return { phase: age < appear ? "appear" : "hold", state: transitionState(timing.appear, age, false) };
}

/** Lengths of the three parts of the timeline, in ticks; `until cleared` (active 0) holds for `fallbackHold`. */
export function timelineLengths(timing: Timing, fallbackHold = 40): { appear: number; hold: number; disappear: number; total: number } {
  const appear = transitionLength(timing.appear), disappear = transitionLength(timing.disappear);
  const hold = timing.active > 0 ? Math.max(0, timing.active - appear) : fallbackHold;
  return { appear, hold, disappear, total: appear + hold + disappear };
}

// ---- Reading a timing from element values ----

type Values = object;
const raw = (o: Values, key: string): unknown => (o as Record<string, unknown>)[key];

function effectsOf(value: unknown, fallback: TransitionEffect[]): TransitionEffect[] {
  if (!Array.isArray(value)) return fallback;
  return TRANSITION_EFFECTS.filter((e) => value.includes(e));
}

function transitionOf(o: Values, prefix: "appear" | "disappear", fallback: Transition): Transition {
  const ticks = Math.round(Number(raw(o, `${prefix}Ticks`)));
  const easing = String(raw(o, `${prefix}Easing`));
  return {
    effects: effectsOf(raw(o, prefix), [...fallback.effects]),
    ticks: Number.isFinite(ticks) ? clamp(ticks, 1, 200) : fallback.ticks,
    easing: (EASINGS as readonly string[]).includes(easing) ? (easing as Easing) : fallback.easing,
  };
}

/** The old single animation of bubbles and radial menus (pop, fade, none over animationTicks), as a transition. */
function legacyTransition(animation: unknown, ticks: unknown): Transition {
  const length = Math.round(Number(ticks));
  const t = Number.isFinite(length) ? clamp(length, 1, 200) : DEFAULT_TRANSITION.ticks;
  if (animation === "fade") return { effects: ["fade"], ticks: t, easing: "linear" };
  if (animation === "none") return { effects: [], ticks: t, easing: "linear" };
  return { effects: ["scale"], ticks: t, easing: "back" };
}

/**
 * The timing of an element's values (fields `appear`, `appearTicks`, `appearEasing`, `disappear`, ..., and `activeKey`
 * for the active time, 0 when the element has none). Values from before Q228 (`animation`, `animationTicks`: one
 * animation for showing and hiding) map to the same look.
 */
export function timingOf(values: Values, activeKey = "duration", fallback: { appear: Transition; disappear: Transition } = { appear: DEFAULT_TRANSITION, disappear: DEFAULT_TRANSITION }): Timing {
  const active = Math.round(Number(activeKey ? raw(values, activeKey) : 0));
  const hasNew = raw(values, "appear") !== undefined || raw(values, "disappear") !== undefined;
  const legacy = !hasNew && raw(values, "animation") !== undefined;
  const old = legacy ? legacyTransition(raw(values, "animation"), raw(values, "animationTicks")) : undefined;
  return {
    appear: old ?? transitionOf(values, "appear", fallback.appear),
    disappear: old ?? transitionOf(values, "disappear", fallback.disappear),
    active: Number.isFinite(active) ? clamp(active, 0, 1_000_000) : 0,
  };
}

/**
 * `values` with the old `animation` / `animationTicks` replaced by the Q228 fields (same look for showing and hiding);
 * values that already have them are returned as they are. Applied when an element is loaded so the editor shows them.
 */
export function upgradeTimingFields<T extends Values>(values: T): T {
  const o = values as Record<string, unknown>;
  if (o.animation === undefined || o.appear !== undefined || o.disappear !== undefined) return values;
  const { animation, animationTicks, ...rest } = o;
  const old = legacyTransition(animation, animationTicks);
  return {
    ...rest,
    appear: [...old.effects], appearTicks: old.ticks, appearEasing: old.easing,
    disappear: [...old.effects], disappearTicks: old.ticks, disappearEasing: old.easing,
  } as unknown as T;
}

/** A transition as the mod's data files write it (`<Mod>Transitions.Timing` reads it). */
export const transitionJson = (t: Transition) => ({ effects: [...t.effects], ticks: t.ticks, easing: t.easing });
export const timingJson = (t: Timing) => ({ appear: transitionJson(t.appear), disappear: transitionJson(t.disappear), active: t.active });
