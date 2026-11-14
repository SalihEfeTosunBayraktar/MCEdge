/**
 * Converts a Blockbench project (.bbmodel) into a Java block/item model of the project: cubes become model
 * elements, UVs are scaled to the 16x16 model space, and embedded textures are written as project PNGs that the
 * model refers to as "<modid>:block/<name>_<n>". Meshes and rotations Minecraft cannot show are reported.
 */
export interface BbConversion {
  model: Record<string, unknown>;
  /** Project-relative PNG path -> file bytes. */
  textures: Map<string, Buffer>;
  warnings: string[];
}

interface BbFace { uv?: number[]; texture?: number | string | null; rotation?: number }
interface BbElement { type?: string; name?: string; from?: number[]; to?: number[]; origin?: number[]; rotation?: number[]; faces?: Record<string, BbFace> }
interface BbTexture { name?: string; source?: string; uuid?: string; id?: string }

const ANGLES = [-45, -22.5, 0, 22.5, 45];
const AXES = ["x", "y", "z"] as const;

export function convertBbmodel(json: string, name: string, modId: string): BbConversion {
  const bb = JSON.parse(json) as { resolution?: { width?: number; height?: number }; elements?: BbElement[]; textures?: BbTexture[] };
  const warnings: string[] = [];
  const textures = new Map<string, Buffer>();
  const refs: Record<string, string> = {};
  (bb.textures ?? []).forEach((tex, i) => {
    const match = /^data:image\/png;base64,(.+)$/.exec(tex.source ?? "");
    if (!match) return warnings.push(`texture ${tex.name ?? i} is not embedded; export it from Blockbench with the model`);
    const file = `${name}_${i}`;
    textures.set(`textures/block/${file}.png`, Buffer.from(match[1], "base64"));
    refs[String(i)] = `${modId}:block/${file}`;
  });
  if (refs["0"]) refs.particle = refs["0"];

  const indexOf = (texture: BbFace["texture"]) => {
    if (typeof texture === "number") return texture;
    const i = (bb.textures ?? []).findIndex((t) => t.uuid === texture || t.id === texture);
    return i;
  };
  const su = 16 / (bb.resolution?.width || 16), sv = 16 / (bb.resolution?.height || 16);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const elements: Record<string, unknown>[] = [];
  for (const el of bb.elements ?? []) {
    if (el.type && el.type !== "cube") {
      warnings.push(`${el.name ?? "element"}: ${el.type} elements cannot be used in a block model; skipped`);
      continue;
    }
    const out: Record<string, unknown> = { from: (el.from ?? [0, 0, 0]).map(round), to: (el.to ?? [16, 16, 16]).map(round) };
    if (el.name) out.name = el.name;
    const rotated = (el.rotation ?? [0, 0, 0]).map((a, i) => [a, i] as const).filter(([a]) => a !== 0);
    if (rotated.length > 1) warnings.push(`${el.name ?? "element"}: rotated on several axes; only the ${AXES[rotated[0][1]]} axis is kept`);
    if (rotated.length) {
      const [angle, axis] = rotated[0];
      const snapped = ANGLES.reduce((best, a) => (Math.abs(a - angle) < Math.abs(best - angle) ? a : best), 0);
      if (snapped !== angle) warnings.push(`${el.name ?? "element"}: rotation ${angle} becomes ${snapped} (block models allow 22.5 degree steps up to 45)`);
      out.rotation = { angle: snapped, axis: AXES[axis], origin: (el.origin ?? [8, 8, 8]).map(round) };
    }
    const faces: Record<string, unknown> = {};
    for (const [side, face] of Object.entries(el.faces ?? {})) {
      if (face.texture === null || face.texture === undefined) continue;
      const index = indexOf(face.texture);
      if (index < 0) continue;
      const uv = face.uv ?? [0, 0, 16, 16];
      faces[side] = { uv: [uv[0] * su, uv[1] * sv, uv[2] * su, uv[3] * sv].map(round), texture: `#${index}`, ...(face.rotation ? { rotation: face.rotation } : {}) };
    }
    out.faces = faces;
    elements.push(out);
  }
  if (!elements.length) warnings.push("the model has no cubes");
  return { model: { credit: "Converted by MCEdge from Blockbench", textures: refs, elements }, textures, warnings };
}
