import { displayName, type ElementType } from "../elements/model.ts";
import { elementKey, type ProjectFolders } from "./folders.ts";
import type { ModProject } from "./types.ts";

/** One element as the list tools show it. */
export interface ElementRow {
  type: string;
  id: string;
  name: string;
  /** Folder path, "" at the top. */
  folder: string;
}

/** What picks elements for list_elements and move_to_folder; every given key must match. */
export interface ElementFilter {
  type?: string;
  /** Case-insensitive text in the id or display name. */
  query?: string;
  /** A folder and everything below it; "" is the elements that sit in no folder. */
  folder?: string;
  /** Glob on the id: * any characters, ? one character. */
  pattern?: string;
}

/** `*` and `?` glob of a whole id, case-insensitive. */
export function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

/** Every element of the project, in type then file order, with its display name and folder. */
export function elementRows(project: ModProject, types: ReadonlyMap<string, ElementType>): ElementRow[] {
  const placement = (project.folders as ProjectFolders | undefined)?.placement ?? {};
  return Object.entries(project.elements).flatMap(([typeId, list]) =>
    list.map((e) => ({ type: typeId, id: e.id, name: displayName(types.get(typeId), e), folder: placement[elementKey(typeId, e.id)] ?? "" })));
}

export function filterRows(rows: ElementRow[], filter: ElementFilter): ElementRow[] {
  const query = filter.query?.trim().toLowerCase();
  const glob = filter.pattern ? globToRegExp(filter.pattern) : undefined;
  const folder = filter.folder;
  return rows.filter((r) =>
    (!filter.type || r.type === filter.type)
    && (!query || r.id.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    && (!glob || glob.test(r.id))
    && (folder === undefined || (folder === "" ? r.folder === "" : r.folder === folder || r.folder.startsWith(`${folder}/`))));
}
