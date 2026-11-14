import { api } from "../api.ts";
import type { Animation } from "./animation.ts";
import type { Pixels } from "./pixels.ts";

/**
 * Unsaved texture editor work that outlives the editor: a texture created in the New texture dialog (nothing is on
 * disk until the first Save) and strokes left unsaved when the user switched to another view. The editor of that
 * path picks the draft up when it opens again, so leaving never saves over the PNG and never loses the strokes.
 */
export interface Draft {
  pixels: Pixels;
  /** The file does not exist yet: Save writes it, refusing to replace a file that appeared meanwhile. */
  isNew: boolean;
  /** Animated: `pixels` is the strip of frames, this its .mcmeta animation. */
  animation?: Animation;
  /** What the file on disk held when the draft was made (frame count, .mcmeta). */
  framesOnDisk?: { frames: number; mcmeta: boolean };
}

const drafts = new Map<string, Draft>();
const key = (dir: string, path: string) => `${dir}
${path}`;

/** Drafts also live in the app's user data (one JSON text per draft), so they survive a restart of the app. */
function encode(draft: Draft): string {
  let binary = "";
  for (let i = 0; i < draft.pixels.data.length; i += 0x8000) binary += String.fromCharCode(...draft.pixels.data.subarray(i, i + 0x8000));
  return JSON.stringify({ ...draft, pixels: { width: draft.pixels.width, height: draft.pixels.height, data: btoa(binary) } });
}
function decode(text: string): Draft {
  const raw = JSON.parse(text) as Omit<Draft, "pixels"> & { pixels: { width: number; height: number; data: string } };
  const data = Uint8ClampedArray.from(atob(raw.pixels.data), (c) => c.charCodeAt(0));
  return { ...raw, pixels: { width: raw.pixels.width, height: raw.pixels.height, data } };
}

export const putDraft = (dir: string, path: string, draft: Draft) => {
  drafts.set(key(dir, path), draft);
  void api.saveDraft(dir, path, encode(draft));
};
/** Keeps a copy of work in progress on disk without touching the in-memory draft (the editor is still open). */
export const persistDraft = (dir: string, path: string, draft: Draft) => void api.saveDraft(dir, path, encode(draft));
/** The draft moves into the editor; its copy on disk stays until the editor saves or discards it. */
export const takeDraft = (dir: string, path: string): Draft | undefined => {
  const draft = drafts.get(key(dir, path));
  drafts.delete(key(dir, path));
  return draft;
};
/** The work was saved or thrown away. */
export const dropDraft = (dir: string, path: string) => {
  drafts.delete(key(dir, path));
  void api.dropDraft(dir, path);
};
export const hasDraft = (dir: string, path: string) => drafts.has(key(dir, path));

/** Loads the drafts a previous run of the app left for a project (does not replace drafts made in this run). */
export async function restoreDrafts(dir: string): Promise<void> {
  const saved = await api.listDrafts(dir);
  for (const [path, text] of Object.entries(saved)) {
    try {
      if (!drafts.has(key(dir, path))) drafts.set(key(dir, path), decode(text));
    } catch {
      void api.dropDraft(dir, path);
    }
  }
}

/** New textures that only exist as a draft, so the Resources view can offer to continue them. */
export const newDraftPaths = (dir: string): string[] =>
  [...drafts].filter(([k, d]) => d.isNew && k.startsWith(`${dir}
`)).map(([k]) => k.slice(dir.length + 1));
