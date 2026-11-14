import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setGradleNoteText, type GradleNote } from "../../src/build/gradle.ts";
import { ROOT } from "../../src/paths.ts";
import { readAppState } from "./appState.ts";

function strings(language: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(ROOT, "config", "ui-strings", `${language}.json`), "utf8"));
  } catch {
    return {};
  }
}

/** Gradle's daemon-loss notes appear in the build output, so they follow the UI language (English when missing). */
export function registerGradleNotes(): void {
  setGradleNoteText((note: GradleNote) => {
    const key = `gradle.${note}`;
    return strings(readAppState().preferences?.language ?? "en")[key] ?? strings("en")[key] ?? key;
  });
}
