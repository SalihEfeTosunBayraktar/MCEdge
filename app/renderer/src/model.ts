import { displayName, REGISTRY_PROVIDERS, typeFields, visibility } from "../../../src/elements/model.ts";
import type { Element, ProjectSnapshot } from "../../shared/api.ts";
import { elementTypes, typeOf } from "./types.ts";

export interface ElementRef {
  typeId: string;
  id: string;
}

export type BuildStatus = "waiting" | "running" | "ok" | "failed";

export interface EngineBuild {
  status: BuildStatus;
  lines: string[];
  jar?: string;
  /** A run (client, server, debug client) the user stopped. */
  stopped?: boolean;
}

export function findElement(snapshot: ProjectSnapshot, ref: ElementRef): Element | undefined {
  return snapshot.project.elements[ref.typeId]?.find((element) => element.id === ref.id);
}

/** Issue path of an element: "item/ruby" (see validateProject). */
export const issuePrefix = (ref: ElementRef) => `${ref.typeId}/${ref.id}`;

export function issuesFor(snapshot: ProjectSnapshot, ref: ElementRef) {
  const prefix = issuePrefix(ref);
  return snapshot.issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`));
}

/** Turns a display name into a registry id: "Block of Ruby" -> "block_of_ruby". */
export function toRegistryId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "_$1");
}

export const elementName = (typeId: string, element: Element) => displayName(typeOf(typeId), element);

/** Elements of the given types, for pickers. */
export function elementsOf(snapshot: ProjectSnapshot, typeIds: string[]): { typeId: string; element: Element }[] {
  return typeIds.flatMap((typeId) => (snapshot.project.elements[typeId] ?? []).map((element) => ({ typeId, element })));
}

/** Elements with an item form, which recipes and creative tabs refer to. */
export const itemElements = (snapshot: ProjectSnapshot) => elementsOf(snapshot, REGISTRY_PROVIDERS.item);

/**
 * Texture shown for an element: its own "texture", otherwise the texture of the mod item a shown item field
 * points at (a recipe's result, a tab's icon), preferring result and icon fields.
 */
export function elementTexture(snapshot: ProjectSnapshot, typeId: string, element: Element): string {
  if (typeof element.texture === "string" && element.texture) return element.texture;
  const type = typeOf(typeId);
  if (!type) return "";
  const fields = typeFields(type);
  const visible = visibility({ fields, values: element });
  const refs = fields
    .filter((f) => f.type === "item" && visible(f.key) && typeof element[f.key] === "string" && element[f.key])
    .sort((a, b) => Number(/return|result|icon/i.test(b.key)) - Number(/return|result|icon/i.test(a.key)));
  for (const field of refs) {
    const found = itemElements(snapshot).find((e) => e.element.id === element[field.key]);
    if (found && typeof found.element.texture === "string" && found.element.texture) return found.element.texture;
  }
  return "";
}

/**
 * The JSON model a tile shows instead of the texture (KUYRUK 176): the first shown model field naming a project
 * model (models/<name>.json), with a block's own slot textures. OBJ and Java models are not drawn, so they keep the texture.
 */
export function elementModel(snapshot: ProjectSnapshot, typeId: string, element: Element): { model: string; overrides: Record<string, string> } | undefined {
  const type = typeOf(typeId);
  if (!type) return undefined;
  const fields = typeFields(type);
  const visible = visibility({ fields, values: element });
  const field = fields.find((f) => f.type === "model" && visible(f.key) && typeof element[f.key] === "string"
    && snapshot.models.includes(`models/${element[f.key] as string}.json`));
  if (!field) return undefined;
  const overrides = typeId === "block" && element.customModelTextures && typeof element.customModelTextures === "object" ? element.customModelTextures as Record<string, string> : {};
  return { model: element[field.key] as string, overrides };
}

/** Recipes have their own registry; every other type shares one id namespace (see validateProject). */
export function idTaken(snapshot: ProjectSnapshot, typeId: string, id: string): boolean {
  return allElements(snapshot).some((e) => e.element.id === id && (e.typeId === "recipe") === (typeId === "recipe"));
}

/** First free registry id of the form "<base>", "<base>_2", "<base>_3"... */
export function freeId(snapshot: ProjectSnapshot, typeId: string, base: string): string {
  let id = base;
  for (let n = 2; idTaken(snapshot, typeId, id); n++) id = `${base}_${n}`;
  return id;
}

/** Elements of every type, in type order. */
export function allElements(snapshot: ProjectSnapshot): { typeId: string; element: Element }[] {
  const known = elementTypes().map((type) => type.id);
  const ids = [...known.filter((id) => snapshot.project.elements[id]), ...Object.keys(snapshot.project.elements).filter((id) => !known.includes(id))];
  return elementsOf(snapshot, ids);
}
