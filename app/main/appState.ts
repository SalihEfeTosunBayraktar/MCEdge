import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { Preferences, RecentProject } from "../shared/api.ts";

/**
 * Small per-user state of the app (not of a project), kept as JSON in the user data folder. A missing or
 * unreadable file means "nothing remembered yet".
 */
export interface AppState {
  /** Last export folder per project folder. */
  exportFolders: Record<string, string>;
  /** Language columns the Localization screen hides, per project folder. */
  hiddenLanguages?: Record<string, string[]>;
  /** Remembered view settings: the element list's view mode, the open editor tabs per project (KUYRUK 129, 130). */
  ui?: Record<string, unknown>;
  /** Unset until the user changes a preference for the first time. */
  preferences?: Preferences;
  /** Most recently opened first. */
  recent: RecentProject[];
}

const DEFAULTS: AppState = { exportFolders: {}, recent: [] };
const MAX_RECENT = 10;

const file = () => join(app.getPath("userData"), "app-state.json");

export function readAppState(): AppState {
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(file(), "utf8")) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function updateAppState(change: (state: AppState) => void): AppState {
  const state = readAppState();
  change(state);
  const path = file();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
  return state;
}

/** Moves a project to the top of the recent list, keeping the last ten. */
export function rememberProject(dir: string, name: string, kind?: "code"): void {
  updateAppState((state) => {
    const entry: RecentProject = { dir, name, openedAt: new Date().toISOString(), ...(kind ? { kind } : {}) };
    state.recent = [entry, ...state.recent.filter((r) => r.dir !== dir)].slice(0, MAX_RECENT);
  });
}

/** Unsaved texture drafts live in their own file: they hold pixel data, which does not belong in app-state.json. */
type DraftStore = Record<string, Record<string, string>>;
const draftFile = () => join(app.getPath("userData"), "texture-drafts.json");

function readDrafts(): DraftStore {
  try {
    return JSON.parse(readFileSync(draftFile(), "utf8"));
  } catch {
    return {};
  }
}

export const listDrafts = (dir: string): Record<string, string> => readDrafts()[dir] ?? {};

export function saveDraft(dir: string, path: string, text: string | undefined): void {
  const store = readDrafts();
  const mine = { ...store[dir] };
  if (text === undefined) delete mine[path];
  else mine[path] = text;
  if (Object.keys(mine).length) store[dir] = mine;
  else delete store[dir];
  const file = draftFile();
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store));
}
