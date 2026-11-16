import { displayNameField } from "../../../src/elements/model.ts";
import type { Element, ProjectSnapshot } from "../../shared/api.ts";
import { api } from "./api.ts";
import { elementName, findElement, freeId, type ElementRef } from "./model.ts";
import { t } from "./strings.ts";
import { typeOf } from "./types.ts";

/** Saves a copy of an element under a free id; returns the new snapshot and the copy. */
export async function duplicateElement(snapshot: ProjectSnapshot, ref: ElementRef): Promise<[ProjectSnapshot, ElementRef]> {
  const source = findElement(snapshot, ref);
  if (!source) return [snapshot, ref];
  const id = freeId(snapshot, ref.typeId, `${source.id}_copy`);
  const copyName = t("element.copyName", { name: elementName(ref.typeId, source) });
  const copy: Element = { ...structuredClone(source), id };
  const nameField = displayNameField(typeOf(ref.typeId));
  if (nameField) copy[nameField.key] = copyName;
  else copy.title = copyName;
  return [await api.saveElement(snapshot.dir, ref.typeId, copy), { typeId: ref.typeId, id }];
}
