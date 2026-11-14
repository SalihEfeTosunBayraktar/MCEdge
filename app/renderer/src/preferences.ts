import type { Preferences } from "../../shared/api.ts";
import { setLanguage } from "./strings.ts";

/** Text sizes as window zoom factors. */
export const TEXT_SIZES = [
  { id: "small", scale: 0.9 },
  { id: "normal", scale: 1 },
  { id: "large", scale: 1.15 },
  { id: "larger", scale: 1.3 },
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

/** Applies everything the renderer owns; the window zoom (text size) is applied by the main process on save. */
export function applyPreferences(preferences: Preferences): void {
  setLanguage(preferences.language);
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.style.setProperty("--font", `"${preferences.uiFont}", "Segoe UI", sans-serif`);
  root.style.setProperty("--mono", `"${preferences.codeFont}", Consolas, monospace`);
}
