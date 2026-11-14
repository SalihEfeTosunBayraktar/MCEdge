/** Writes test elements into a project copy with the same defaults the app's New element uses. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultValues, typeFields } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";

export function addElement(project: string, typeId: string, id: string, values: Record<string, unknown> = {}): void {
  const type = typeRegistry().byId.get(typeId);
  if (!type) throw new Error(`unknown type ${typeId}`);
  const dir = join(project, "elements", type.folder);
  mkdirSync(dir, { recursive: true });
  const element = { id, ...defaultValues(typeFields(type)), ...values };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(element, null, 2) + "\n");
}
