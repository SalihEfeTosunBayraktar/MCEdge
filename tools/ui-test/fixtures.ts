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

/** A 1x1 PNG, for textures a test makes up. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * Gives a project copy its own texture folders, each holding two textures made here, so a test does not depend on
 * which textures the source project has put in its folders (Q213). Textures go to textures/items/ and are placed by
 * texture-folders.json, which replaces the copy's own file.
 */
export function seedTextureFolders(project: string, folders: string[]): void {
  const placement: Record<string, string> = {};
  mkdirSync(join(project, "textures", "items"), { recursive: true });
  for (const folder of folders) {
    for (const n of [1, 2]) {
      const path = `textures/items/fixture_${folder.toLowerCase()}_${n}.png`;
      writeFileSync(join(project, path), PIXEL);
      placement[path] = folder;
    }
  }
  writeFileSync(join(project, "texture-folders.json"), JSON.stringify({ folders, placement }, null, 2) + "\n");
}
