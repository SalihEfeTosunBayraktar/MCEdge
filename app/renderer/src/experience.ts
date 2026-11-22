import EXPERIENCE from "../../../config/experience.json" with { type: "json" };
import type { ExperienceLevel, UiMode } from "../../shared/api.ts";

type HideKind = keyof typeof EXPERIENCE.simple;

export const LEVELS = EXPERIENCE.levels.map((l) => ({ id: l.id as ExperienceLevel, mode: l.mode as UiMode }));

let mode: UiMode = "advanced";

/** Set from the preferences (applyPreferences), like the UI language. */
export function setMode(next: UiMode): void {
  mode = next;
  document.documentElement.dataset.mode = next;
}

export const simpleMode = () => mode === "simple";

/** Whether Simple mode hides this section, panel, menu item, element page or element type (config/experience.json). */
export function hidden(kind: HideKind, id: string): boolean {
  return mode === "simple" && (EXPERIENCE.simple[kind] as string[]).includes(id);
}

/** The mode the first-run setup turns on for an answer. */
export const modeFor = (level: ExperienceLevel): UiMode => LEVELS.find((l) => l.id === level)?.mode ?? "advanced";
