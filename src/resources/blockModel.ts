/**
 * Minecraft JSON block models as the model preview (app) and inspect_model (MCP) read them: the parent chain inside
 * the project, texture variables, and which project PNG a texture reference names. Pure, no file system: callers
 * pass a reader. The texture lookup follows the generator (src/generator/models.ts projectTexture).
 */

export type Vec3 = [number, number, number];
export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export const FACES: FaceName[] = ["north", "south", "east", "west", "up", "down"];

export interface ModelFace {
  /** [u1, v1, u2, v2] in 0-16 texture units; derived from the element box when missing. */
  uv?: [number, number, number, number];
  /** "#var" or a texture reference. */
  texture: string;
  /** 0, 90, 180 or 270. */
  rotation?: number;
  cullface?: string;
  tintindex?: number;
}

export interface ModelElement {
  name?: string;
  from: Vec3;
  to: Vec3;
  rotation?: { angle: number; axis: "x" | "y" | "z"; origin: Vec3; rescale?: boolean };
  faces: Partial<Record<FaceName, ModelFace>>;
}

export interface DisplayTransform {
  rotation?: Vec3;
  translation?: Vec3;
  scale?: Vec3;
}

export interface BlockModelJson {
  parent?: string;
  textures?: Record<string, string>;
  elements?: ModelElement[];
  display?: Record<string, DisplayTransform>;
}

export interface ResolvedModel {
  textures: Record<string, string>;
  elements: ModelElement[];
  display: Record<string, DisplayTransform>;
  /** Project models of the parent chain, the model itself first. */
  chain: string[];
  /** A parent outside the project (vanilla "minecraft:block/cube_all"); its elements are not known here. */
  externalParent?: string;
}

/** Display contexts of a block model, in the order the preview offers them. */
export const DISPLAY_CONTEXTS = ["gui", "ground", "fixed", "head", "thirdperson_righthand", "thirdperson_lefthand", "firstperson_righthand", "firstperson_lefthand"] as const;

/** Project model name of a parent reference ("modid:custom/lamp", "custom/lamp", "lamp"), or undefined for another namespace. */
export function projectParentName(parent: string, modId: string): string | undefined {
  if (parent.includes(":") && !parent.startsWith(`${modId}:`)) return undefined;
  return parent.replace(/^[^:]*:/, "").replace(/^custom\//, "").replace(/^block\//, "");
}

/** Reads a model and its project parents; child textures, elements and display entries win over the parent's. */
export async function resolveModel(
  name: string,
  modId: string,
  read: (name: string) => Promise<BlockModelJson | undefined> | BlockModelJson | undefined,
  /** Vanilla models by id without namespace ("block/cube_all"); a parent outside the project is looked up here. */
  vanilla?: Record<string, BlockModelJson>,
): Promise<ResolvedModel> {
  const chain: BlockModelJson[] = [];
  const names: string[] = [];
  let externalParent: string | undefined;
  let next: string | undefined = name;
  let raw = name;
  while (next && !names.includes(next) && names.length < 16) {
    const model = await read(next);
    if (!model) {
      if (names.length) externalParent = raw;
      else throw new Error(`no JSON model models/${next}.json`);
      break;
    }
    chain.push(model);
    names.push(next);
    const parent: string | undefined = typeof model.parent === "string" ? model.parent : undefined;
    if (!parent) break;
    const own = projectParentName(parent, modId);
    next = own;
    raw = parent;
    if (!own) externalParent = parent;
  }
  // A parent outside the project may be a vanilla model the app ships; follow it as far as it is known.
  while (vanilla && externalParent && names.length < 16) {
    const key = externalParent.replace(/^minecraft:/, "");
    const model = vanilla[key] ?? vanilla[`block/${key}`];
    if (!model) break;
    chain.push(model);
    names.push(`minecraft:${vanilla[key] ? key : `block/${key}`}`);
    externalParent = typeof model.parent === "string" ? model.parent : undefined;
  }
  const textures: Record<string, string> = {};
  const display: Record<string, DisplayTransform> = {};
  let elements: ModelElement[] = [];
  for (const model of [...chain].reverse()) {
    Object.assign(textures, model.textures ?? {});
    Object.assign(display, model.display ?? {});
    if (Array.isArray(model.elements)) elements = model.elements;
  }
  return { textures, elements, display, chain: names, externalParent };
}

/** Follows "#var" through the texture map; the final reference, or undefined when a variable is unset. */
export function textureOf(textures: Record<string, string>, ref: string): string | undefined {
  let value: string | undefined = ref;
  for (let i = 0; value?.startsWith("#") && i < 16; i++) value = textures[value.slice(1)];
  return value?.startsWith("#") ? undefined : value;
}

/**
 * Project PNG a texture reference names, out of `files` (project-relative paths of every PNG under textures/ and
 * models/): "<modid>:block/x" or "block/x" -> textures/block/x.png, a bare name found anywhere by file name.
 * Undefined for another namespace (vanilla textures) or when nothing matches.
 */
export function projectTexturePath(ref: string, modId: string, files: string[]): string | undefined {
  const [ns, path] = ref.includes(":") ? (ref.split(":", 2) as [string, string]) : ["", ref];
  if (ns && ns !== modId) return undefined;
  const clean = path.replace(/\.png$/i, "");
  for (const candidate of [`models/${clean}.png`, `textures/${clean}.png`]) if (files.includes(candidate)) return candidate;
  const base = `${clean.replace(/^.*\//, "").toLowerCase()}.png`;
  return [...files].sort().find((f) => f.slice(f.lastIndexOf("/") + 1).toLowerCase() === base);
}

/** Face UV when the model leaves it out: the element box projected onto the face, as Minecraft does. */
export function defaultUv(element: ModelElement, face: FaceName): [number, number, number, number] {
  const [x1, y1, z1] = element.from, [x2, y2, z2] = element.to;
  switch (face) {
    case "north": return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case "south": return [x1, 16 - y2, x2, 16 - y1];
    case "west": return [z1, 16 - y2, z2, 16 - y1];
    case "east": return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    case "up": return [x1, z1, x2, z2];
    case "down": return [x1, 16 - z2, x2, 16 - z1];
  }
}

/** What the preview draws, for agents: elements, bounds, every texture variable and the project file it shows. */
export function describeModel(model: ResolvedModel, modId: string, files: string[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const used = new Set<string>();
  for (const e of model.elements) {
    for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], e.from[i], e.to[i]), (max[i] = Math.max(max[i], e.from[i], e.to[i])));
    for (const face of Object.values(e.faces ?? {})) if (face?.texture) used.add(face.texture);
  }
  const texture = (ref: string) => {
    const final = textureOf(model.textures, ref);
    const file = final ? projectTexturePath(final, modId, files) : undefined;
    return { ref, resolves: final ?? null, projectFile: file ?? null, note: !final ? "variable not set" : file ? undefined : "not a project texture (drawn as a checker)" };
  };
  return {
    chain: model.chain,
    externalParent: model.externalParent ?? null,
    elements: model.elements.length,
    rotatedElements: model.elements.filter((e) => e.rotation && e.rotation.angle).length,
    bounds: model.elements.length ? { from: min, to: max } : null,
    textures: Object.keys(model.textures).map((k) => ({ variable: k, ...texture(`#${k}`) })),
    faceTextures: [...used].map(texture),
    display: Object.keys(model.display),
  };
}
