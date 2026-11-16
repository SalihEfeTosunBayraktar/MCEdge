/**
 * Project folders: a way to organise the element list. They live in folders.json beside the elements and change
 * nothing in the generated mod. A folder is a path ("Economy/Shops"); `placement` maps "typeId/id" to its folder, and
 * an element without a placement sits at the top. Pure, so the editor and the MCP server share it.
 */
export interface ProjectFolders {
  folders: string[];
  placement: Record<string, string>;
  /** Folder path -> "#rrggbb"; a folder without an entry has the default colour. Only the editor shows it. */
  colors?: Record<string, string>;
  /** Folder path -> one of FOLDER_ICONS (KUYRUK 178); a folder without an entry shows the folder icon. Only the editor shows it. */
  icons?: Record<string, string>;
  /**
   * The same state for the other Resources lists (Q211): texture-folders.json keeps the Textures list at the top level, as it
   * always did, and the Sounds (keyed by event name), Models and Structures (keyed by project path) lists here.
   */
  resources?: Partial<Record<Exclude<FolderKind, "textures">, ProjectFolders>>;
}

/** The Resources lists that have folders. */
export type FolderKind = "textures" | "sounds" | "models" | "structures";

/** Icons a folder can show instead of the folder icon, drawn in the folder's colour (KUYRUK 178). */
export const FOLDER_ICONS = ["chest", "book", "sword", "hammer", "gem", "gear", "box", "tag", "star", "potion", "leaf", "heart"] as const;

export const NO_FOLDERS: ProjectFolders = { folders: [], placement: {} };

/** The folders of one Resources list, out of the whole texture-folders.json state. */
export const kindFolders = (file: ProjectFolders | undefined, kind: FolderKind): ProjectFolders =>
  (kind === "textures" ? file : file?.resources?.[kind]) ?? NO_FOLDERS;

/** The whole state with one list's folders replaced; the other lists stay as they are. */
export function withKindFolders(file: ProjectFolders | undefined, kind: FolderKind, state: ProjectFolders): ProjectFolders {
  const base = file ?? NO_FOLDERS;
  if (kind === "textures") return { ...state, ...(base.resources ? { resources: base.resources } : {}) };
  return { ...base, resources: { ...base.resources, [kind]: state } };
}

export const elementKey = (typeId: string, id: string) => `${typeId}/${id}`;
export const parentFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const folderName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** The state with these colours and icons, leaving a key out when it has none (folders.json stays as it was). */
function withDecor(state: ProjectFolders, colors: Record<string, string>, icons: Record<string, string> = state.icons ?? {}): ProjectFolders {
  const { colors: _old, icons: _oldIcons, ...rest } = state;
  return { ...rest, ...(Object.keys(colors).length ? { colors } : {}), ...(Object.keys(icons).length ? { icons } : {}) };
}

/** A path -> value map with each key passed through `move` (dropped when it gives undefined). */
const remap = (map: Record<string, string> | undefined, move: (path: string) => string | undefined) =>
  Object.fromEntries(Object.entries(map ?? {}).flatMap(([f, v]) => {
    const to = move(f);
    return to === undefined ? [] : [[to, v]];
  }));

/** Throws on a folder name that cannot be a path segment. */
function checkName(name: string): string {
  const clean = name.trim();
  if (!clean || /[/\\]/.test(clean)) throw new Error(`bad folder name: "${name}"`);
  return clean;
}

/** Direct subfolders of `parent` ("" is the top), sorted by name. */
export function subfolders(state: ProjectFolders, parent: string): string[] {
  return state.folders.filter((path) => parentFolder(path) === parent).sort((a, b) => a.localeCompare(b));
}

export function addFolder(state: ProjectFolders, parent: string, name: string): ProjectFolders {
  const path = parent ? `${parent}/${checkName(name)}` : checkName(name);
  if (parent && !state.folders.includes(parent)) throw new Error(`no folder "${parent}"`);
  if (state.folders.includes(path)) throw new Error(`folder "${path}" exists`);
  return { ...state, folders: [...state.folders, path] };
}

const repath = (path: string, from: string, to: string) => (inside(path, from) ? `${to}${path.slice(from.length)}` : path);

export function renameFolder(state: ProjectFolders, path: string, name: string): ProjectFolders {
  const parent = parentFolder(path);
  return relocate(state, path, parent ? `${parent}/${checkName(name)}` : checkName(name));
}

/** Moves a folder, with everything in it, into `parent` ("" is the top); it keeps its name. */
export function moveFolder(state: ProjectFolders, path: string, parent: string): ProjectFolders {
  if (!state.folders.includes(path)) throw new Error(`no folder "${path}"`);
  if (parent && !state.folders.includes(parent)) throw new Error(`no folder "${parent}"`);
  if (parent && inside(parent, path)) throw new Error(`cannot move "${path}" into itself`);
  return relocate(state, path, parent ? `${parent}/${folderName(path)}` : folderName(path));
}

/** Gives a folder a new path; its subfolders, the elements in it, the colours and the icons follow. */
function relocate(state: ProjectFolders, path: string, target: string): ProjectFolders {
  if (target === path) return state;
  if (state.folders.includes(target)) throw new Error(`folder "${target}" exists`);
  const move = (f: string) => repath(f, path, target);
  return withDecor({
    ...state,
    folders: state.folders.map(move),
    placement: Object.fromEntries(Object.entries(state.placement).map(([key, f]) => [key, move(f)])),
  }, remap(state.colors, move), remap(state.icons, move));
}

/** Sets the colour of a folder ("#rrggbb"), or clears it with an empty colour. */
export function setFolderColor(state: ProjectFolders, path: string, color: string): ProjectFolders {
  if (!state.folders.includes(path)) throw new Error(`no folder "${path}"`);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`bad colour "${color}": use #rrggbb, or "" to clear`);
  const { [path]: _old, ...colors } = state.colors ?? {};
  return withDecor(state, color ? { ...colors, [path]: color.toLowerCase() } : colors);
}

/** Sets the icon of a folder (one of FOLDER_ICONS), or clears it (the folder icon) with an empty name. */
export function setFolderIcon(state: ProjectFolders, path: string, icon: string): ProjectFolders {
  if (!state.folders.includes(path)) throw new Error(`no folder "${path}"`);
  if (icon && !(FOLDER_ICONS as readonly string[]).includes(icon)) throw new Error(`bad icon "${icon}": one of ${FOLDER_ICONS.join(", ")}, or "" to clear`);
  const { [path]: _old, ...icons } = state.icons ?? {};
  return withDecor(state, state.colors ?? {}, icon ? { ...icons, [path]: icon } : icons);
}

/** Removes a folder; what it held, subfolders included, moves up to its parent. Elements are never deleted. */
export function removeFolder(state: ProjectFolders, path: string): ProjectFolders {
  const parent = parentFolder(path);
  const up = (f: string) => {
    if (!inside(f, path)) return f;
    const rest = f.slice(path.length + 1);
    return parent && rest ? `${parent}/${rest}` : parent || rest;
  };
  const keep = (f: string) => (f === path ? undefined : up(f));
  return withDecor({
    ...state,
    folders: [...new Set(state.folders.filter((f) => f !== path).map(up))],
    placement: Object.fromEntries(Object.entries(state.placement).map(([key, f]) => [key, up(f)]).filter(([, f]) => f)),
  }, remap(state.colors, keep), remap(state.icons, keep));
}

/** Placement keys of everything in a folder and the folders below it. */
export function folderMembers(state: ProjectFolders, path: string): string[] {
  return Object.entries(state.placement).filter(([, f]) => inside(f, path)).map(([key]) => key);
}

/**
 * Removes a folder with its subfolders. What sat in them moves up to the folder's parent when `keep` lists it (or all of
 * it, with no list); the rest loses its placement, for a caller that deletes those elements.
 */
export function removeFolderTree(state: ProjectFolders, path: string, keep?: ReadonlySet<string>): ProjectFolders {
  const parent = parentFolder(path);
  const gone = (f: string) => inside(f, path);
  return withDecor({
    ...state,
    folders: state.folders.filter((f) => !gone(f)),
    placement: Object.fromEntries(Object.entries(state.placement).flatMap(([key, f]) =>
      !gone(f) ? [[key, f]] : !keep || keep.has(key) ? (parent ? [[key, parent]] : []) : [])),
  }, remap(state.colors, (f) => (gone(f) ? undefined : f)), remap(state.icons, (f) => (gone(f) ? undefined : f)));
}

/** Orders folder paths as a tree: a folder, then what is in it, then its next sibling. */
export const byFolderPath = (a: string, b: string): number => {
  const [x, y] = [a.split("/"), b.split("/")];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].localeCompare(y[i]);
  return x.length - y.length;
};

/** Moves an element into `folder`; "" is the top. */
export function moveElement(state: ProjectFolders, key: string, folder: string): ProjectFolders {
  if (folder && !state.folders.includes(folder)) throw new Error(`no folder "${folder}"`);
  const { [key]: _old, ...placement } = state.placement;
  return { ...state, placement: folder ? { ...placement, [key]: folder } : placement };
}

/** Moves many elements into `folder` ("" is the top) in one pass. */
export function moveElements(state: ProjectFolders, keys: readonly string[], folder: string): ProjectFolders {
  if (folder && !state.folders.includes(folder)) throw new Error(`no folder "${folder}"`);
  const moving = new Set(keys);
  const placement = Object.fromEntries(Object.entries(state.placement).filter(([key]) => !moving.has(key)));
  return { ...state, placement: folder ? { ...placement, ...Object.fromEntries(keys.map((key) => [key, folder])) } : placement };
}

/** Creates a folder and every missing parent ("Economy/Shops/Old" makes Economy and Economy/Shops first); returns the folders it added. */
export function ensureFolder(state: ProjectFolders, path: string): { state: ProjectFolders; created: string[] } {
  if (state.folders.includes(path)) throw new Error(`folder "${path}" exists`);
  const created: string[] = [];
  let next = state;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");
    const here = parts.slice(0, i + 1).join("/");
    if (!next.folders.includes(here)) {
      next = addFolder(next, parent, parts[i]);
      created.push(here);
    }
  }
  return { state: next, created };
}

export interface FolderSummary {
  path: string;
  /** Elements directly in the folder. */
  elements: number;
  /** Elements in the folder and everything below it. */
  total: number;
  /** Direct subfolders. */
  subfolders: number;
  /** "#rrggbb", when the folder has a colour. */
  color?: string;
  /** One of FOLDER_ICONS, when the folder has an icon. */
  icon?: string;
}

/** Counts per folder (sorted by path) and the elements in no folder; placements of elements that no longer exist are ignored. */
export function summarizeFolders(state: ProjectFolders, existing: ReadonlySet<string>): { folders: FolderSummary[]; unfiled: number } {
  const direct = new Map<string, number>();
  let placed = 0;
  for (const [key, folder] of Object.entries(state.placement)) {
    if (!existing.has(key)) continue;
    direct.set(folder, (direct.get(folder) ?? 0) + 1);
    placed++;
  }
  const folders = [...state.folders].sort((a, b) => a.localeCompare(b)).map((path) => ({
    path,
    elements: direct.get(path) ?? 0,
    total: [...direct].reduce((n, [folder, count]) => (inside(folder, path) ? n + count : n), 0),
    subfolders: state.folders.filter((f) => parentFolder(f) === path).length,
    ...(state.colors?.[path] ? { color: state.colors[path] } : {}),
    ...(state.icons?.[path] ? { icon: state.icons[path] } : {}),
  }));
  return { folders, unfiled: existing.size - placed };
}
