/**
 * Texture slots of a block's custom model (KUYRUK 161): the textures a project JSON or OBJ model names, which a block
 * can map to its own project textures (the block field customModelTextures). Pure, no file system: callers pass a
 * reader, so the app, MCP and the generator list the same slots.
 *
 * A JSON model's slots are its texture variables (with its project parents'), except "particle" (the block has its own
 * particle texture field) and variables that only point at another one ("#0"). An OBJ model's slots are its materials,
 * in the order the model first uses them: the generator names them m0, m1, ... in that order (src/generator/models.ts).
 */

import { projectTexturePath, resolveModel, type BlockModelJson } from "./blockModel.ts";

export type SlotModelKind = "json" | "obj";

export interface ModelTextureSlot {
  /** JSON texture variable ("0", "side") or OBJ material name. */
  slot: string;
  /** What the model itself names for the slot ("modid:block/x", "../textures/x.png"), or "" when nothing. */
  texture: string;
  /** Project PNG the model's texture resolves to, when it is one. */
  file?: string;
}

type Read = (path: string) => Promise<string | undefined> | string | undefined;

/** Slots of models/<name>.json (or .obj): see the file comment. Throws when the model file is missing or broken. */
export async function modelTextureSlots(kind: SlotModelKind, name: string, modId: string, read: Read, files: string[],
  vanilla?: Record<string, BlockModelJson>): Promise<ModelTextureSlot[]> {
  if (kind === "obj") {
    const obj = await read(`models/${name}.obj`);
    if (obj === undefined) throw new Error(`no OBJ model models/${name}.obj`);
    const maps = new Map<string, string>();
    for (const lib of objLibraries(obj, name)) {
      const text = await read(`models/${lib}`);
      if (text !== undefined) for (const [material, map] of mtlMaps(text)) if (!maps.has(material)) maps.set(material, map);
    }
    return objMaterials(obj).map((slot) => {
      const texture = maps.get(slot) ?? "";
      const local = texture ? normalize(`models/${texture}`) : "";
      return { slot, texture, file: files.includes(local) ? local : texture ? projectTexturePath(texture.replace(/^.*[\\/]/, ""), modId, files) : undefined };
    });
  }
  const model = await resolveModel(name, modId, async (n) => {
    const text = await read(`models/${n}.json`);
    return text === undefined ? undefined : (JSON.parse(text) as BlockModelJson);
  }, vanilla);
  return Object.entries(model.textures)
    .filter(([slot, value]) => slot !== "particle" && typeof value === "string" && !value.startsWith("#"))
    .map(([slot, texture]) => ({ slot, texture, file: projectTexturePath(texture, modId, files) }));
}

/** Materials of an OBJ model in the order faces first use them; faces before any `usemtl` use the material "". */
export function objMaterials(obj: string): string[] {
  const order: string[] = [];
  let current: string | undefined;
  for (const raw of obj.split(/\r?\n/)) {
    const [op, ...rest] = raw.trim().split(/\s+/);
    if (op === "usemtl") current = rest.join(" ");
    else if (op === "f" && current === undefined) current = "";
    else continue;
    if (!order.includes(current)) order.push(current);
  }
  return order;
}

/** The material libraries an OBJ model names (mtllib), or <name>.mtl when it names none. */
export function objLibraries(obj: string, name: string): string[] {
  const line = obj.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find(([op]) => op === "mtllib");
  return line && line.length > 1 ? line.slice(1) : [`${name}.mtl`];
}

/** Material name -> diffuse map (map_Kd) of an .mtl file. */
export function mtlMaps(mtl: string): Map<string, string> {
  const maps = new Map<string, string>();
  let material = "";
  for (const raw of mtl.split(/\r?\n/)) {
    const [op, ...rest] = raw.trim().split(/\s+/);
    if (op === "newmtl") material = rest.join(" ");
    else if (op === "map_Kd" && rest.length) maps.set(material, rest[rest.length - 1]);
  }
  return maps;
}

/** A block's slot -> project texture entries that are set (the customModelTextures field). */
export function mappedSlots(value: unknown): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => e[0] !== "" && typeof e[1] === "string" && e[1] !== "");
}

/** "models/../textures/x.png" -> "textures/x.png". */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}
