import { useSyncExternalStore } from "react";
import type { Preferences } from "../../shared/api.ts";
import { setMode } from "./experience.ts";
import { setLanguage } from "./strings.ts";

/** Text sizes as window zoom factors. */
export const TEXT_SIZES = [
  { id: "small", scale: 0.9 },
  { id: "normal", scale: 1 },
  { id: "large", scale: 1.15 },
  { id: "larger", scale: 1.3 },
  { id: "huge", scale: 1.5 },
  { id: "largest", scale: 1.75 },
] as const;

/** Font stacks offered for the interface and for code; the first of each is the Workbench default. */
export const UI_FONTS = ["Trebuchet MS", "Segoe UI", "Verdana", "Tahoma", "Arial", "Georgia"];
export const CODE_FONTS = ["Cascadia Mono", "Consolas", "Lucida Console", "Courier New"];

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  theme: "dark",
  fontScale: 1,
  uiFont: UI_FONTS[0],
  codeFont: CODE_FONTS[0],
};

/** Reduced motion (Q247): "system" follows the OS and keeps following it while the app runs. */
let motion: NonNullable<Preferences["reducedMotion"]> = "system";
const osMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function applyMotion(): void {
  const reduce = motion === "on" || (motion === "system" && osMotion.matches);
  document.documentElement.dataset.motion = reduce ? "reduce" : "full";
}
osMotion.addEventListener("change", applyMotion);

/** What "light mode" switches together (first-start setup): previews and 3D off, the small memory limits. */
export const LIGHT_PERFORMANCE: NonNullable<Preferences["performance"]> = { previews: false, render3d: false, lowMemory: true };

/** Light mode (Q250): previews and 3D are on unless the preferences switch them off. */
export interface Performance { previews: boolean; render3d: boolean }
let performanceNow: Performance = { previews: true, render3d: true };
const performanceListeners = new Set<() => void>();
function applyPerformance(prefs: Preferences["performance"]): void {
  const next = { previews: prefs?.previews !== false, render3d: prefs?.render3d !== false };
  if (next.previews === performanceNow.previews && next.render3d === performanceNow.render3d) return;
  performanceNow = next;
  performanceListeners.forEach((l) => l());
}
/** The current light mode switches; components re-render when they change. */
export function usePerformance(): Performance {
  return useSyncExternalStore((listener) => (performanceListeners.add(listener), () => void performanceListeners.delete(listener)), () => performanceNow);
}

/** Applies everything the renderer owns; the window zoom (text size) is applied by the main process on save. */
export function applyPreferences(preferences: Preferences): void {
  setLanguage(preferences.language);
  setMode(preferences.mode ?? "advanced");
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.contrast = preferences.highContrast ? "high" : "normal";
  root.dataset.palette = preferences.colorBlind ? "cb" : "default";
  motion = preferences.reducedMotion ?? "system";
  applyMotion();
  applyPerformance(preferences.performance);
  root.style.setProperty("--font", `"${preferences.uiFont}", "Segoe UI", sans-serif`);
  root.style.setProperty("--mono", `"${preferences.codeFont}", Consolas, monospace`);
}
