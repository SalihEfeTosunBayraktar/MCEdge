import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { convertBbmodel } from "../resources/blockbench.ts";
import { objMaterials } from "../resources/modelTextures.ts";
import { idClass, jstr } from "./java.ts";
import { procedureBuild } from "./procedures.ts";
import { modClassName } from "./registries.ts";
import type { GenEnv, JavaSourceFile, ResourceFile } from "./typeModule.ts";

/**
 * Project block/item models: a model field that names no built-in model refers to models/<name>.json (a Java
 * block/item model, also made from a Blockbench .bbmodel), or models/<name>.obj with its .mtl. Elements ask for a
 * model with `customModel`; every model asked for is written once to assets/<modid>/models/custom/<name>.json and
 * the element's own models use it as their parent, so rotations (blockstate variants), display transforms and the
 * block's other models keep working.
 *
 * Textures a model names are copied with it. A reference to a project texture (models/<file>.png, textures/...,
 * "<modid>:block/<name>" of an imported .bbmodel, or a bare file name) becomes "<modid>:block/..." or
 * "<modid>:item/...", the folders every version stitches into the block atlas; vanilla references stay as they are.
 *
 * OBJ models use the loader's own OBJ support where it has one: NeoForge ("neoforge:obj") and Forge 1.16.5
 * ("forge:obj"). Fabric has none, so MCEdge writes its own (<Mod>ObjModels): a model loading plugin gives the
 * custom model the OBJ geometry, read from the same .obj file and baked into quads. The .obj is written in a
 * normalized form (absolute indices, materials renamed to texture slots m0, m1, ...), so every loader reads the
 * same file and the .mtl only maps each slot to its texture.
 */

export type ModelKind = "json" | "obj";
const NAME = /^[A-Za-z0-9_]+$/;

interface Usage { kinds: Map<string, ModelKind> }
const usages = new WeakMap<object, Map<string, Usage>>();
function usage(env: GenEnv): Usage {
  const perProject = usages.get(env.generated) ?? new Map<string, Usage>();
  usages.set(env.generated, perProject);
  let known = perProject.get(env.engine.id);
  if (!known) perProject.set(env.engine.id, (known = { kinds: new Map() }));
  return known;
}

const modelsDir = (env: GenEnv) => join(env.projectDir, "models");

/** Kind of the project model `name` among `kinds`, or undefined when there is no such file. */
export function projectModelKind(env: GenEnv, name: string, kinds: ModelKind[] = ["json", "obj"]): ModelKind | undefined {
  if (!NAME.test(name)) return undefined;
  const has = (ext: string) => existsSync(join(modelsDir(env), name + ext));
  for (const kind of kinds) {
    if (kind === "json" && (has(".json") || has(".bbmodel"))) return "json";
    if (kind === "obj" && has(".obj")) return "obj";
  }
  return undefined;
}

/**
 * Model id ("<modid>:custom/<name>") of a project model used by an element, recorded for generation. A name that
 * is neither built in nor a project model is warned about and gives undefined, so the caller keeps its built-in
 * model. `kind` narrows the files looked at (a block's model type picks JSON or OBJ).
 */
export function customModel(env: GenEnv, owner: string, name: string, kind?: ModelKind): string | undefined {
  const found = projectModelKind(env, name, kind ? [kind] : ["json", "obj"]);
  if (!found && NAME.test(name) && existsSync(join(modelsDir(env), `${name}.java`))) {
    procedureBuild(env).warnings.push(`${owner}: "${name}" is a Java model (models/${name}.java), which this field cannot use here (a block needs the Java model type); the built-in model is used`);
    return undefined;
  }
  if (!found) {
    procedureBuild(env).warnings.push(`${owner}: model "${name}" is not a project ${kind ? `${kind.toUpperCase()} ` : ""}model (models/${name}.${kind ?? "json|obj"}); the built-in model is used`);
    return undefined;
  }
  usage(env).kinds.set(name, found);
  return `${env.modId}:custom/${name}`;
}

/**
 * Texture variable of the generated custom model that a block's slot mapping (KUYRUK 161) overrides: a JSON model keeps
 * its variable names; an OBJ material becomes m<i> in the order objModel numbers them. Undefined for an unknown material.
 */
export function customModelSlot(env: GenEnv, name: string, kind: ModelKind, slot: string): string | undefined {
  if (kind === "json") return slot;
  const index = objMaterials(readFileSync(join(modelsDir(env), `${name}.obj`), "utf8")).indexOf(slot);
  return index < 0 ? undefined : `m${index}`;
}

/** Everything the used project models need, written once per build. */
export interface ModelOutputs {
  files: ResourceFile[];
  /** Project file (project-relative) -> path under assets/<modid>/textures, without .png. */
  textures: { from: string; to: string }[];
  /** Texture bytes made during generation (embedded .bbmodel textures) -> path under assets/<modid>/textures. */
  images: { to: string; bytes: Buffer }[];
  sources: JavaSourceFile[];
  clientInit: string[];
}

export function projectModelOutputs(env: GenEnv): ModelOutputs {
  const out: ModelOutputs = { files: [], textures: [], images: [], sources: [], clientInit: [] };
  const used = usage(env).kinds;
  const warn = (text: string) => procedureBuild(env).warnings.push(text);
  const done = new Set<string>();
  const objModels: string[] = [];
  // JSON models can name other project models as parents; those are written too.
  const queue = [...used.entries()];
  while (queue.length) {
    const [name, kind] = queue.shift()!;
    if (done.has(name)) continue;
    done.add(name);
    const path = `assets/${env.modId}/models/custom/${name}`;
    if (kind === "json") {
      const model = jsonModel(env, name, out, warn);
      const parent = typeof model.parent === "string" ? model.parent : "";
      const parentName = parent.replace(new RegExp(`^(${env.modId}:)?(custom/)?`), "");
      if (parent && (!parent.includes(":") || parent.startsWith(`${env.modId}:`)) && projectModelKind(env, parentName, ["json"])) {
        model.parent = `${env.modId}:custom/${parentName}`;
        queue.push([parentName, "json"]);
      }
      out.files.push({ path: `${path}.json`, json: JSON.stringify(model, null, 2) });
    } else {
      const obj = objModel(env, name, out, warn);
      objModels.push(name);
      out.files.push({ path: `${path}.obj`, json: obj.obj }, { path: `${path}.mtl`, json: obj.mtl });
      out.files.push({ path: `${path}.json`, json: JSON.stringify(objModelJson(env, name, obj.textures), null, 2) });
    }
  }
  if (objModels.length && env.loader === "fabric") {
    const source = fabricObjLoader(env, objModels);
    out.sources.push(source);
    out.clientInit.push(`${source.path.replace(/\.java$/, "").replaceAll("/", ".")}.register();`);
  }
  return out;
}

// ---- JSON models

function jsonModel(env: GenEnv, name: string, out: ModelOutputs, warn: (t: string) => void): Record<string, unknown> {
  const file = join(modelsDir(env), `${name}.json`);
  let model: Record<string, unknown>;
  if (existsSync(file)) {
    try {
      model = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (e) {
      warn(`models/${name}.json: ${(e as Error).message}`);
      return {};
    }
  } else {
    // A Blockbench project not imported yet is converted the way importing does.
    const converted = convertBbmodel(readFileSync(join(modelsDir(env), `${name}.bbmodel`), "utf8"), name, env.modId);
    for (const [path, bytes] of converted.textures) out.images.push({ to: path.replace(/^textures\//, "").replace(/\.png$/, ""), bytes });
    for (const w of converted.warnings) warn(`models/${name}.bbmodel: ${w}`);
    if (!converted.textures.size) warn(`models/${name}.bbmodel: no embedded textures, so its faces are not drawn`);
    model = converted.model;
    // Its textures exist only in memory, so they are referenced as they are.
    return model;
  }
  if (env.mc !== "26.3" && Array.isArray(model.elements)) model.elements = model.elements.map((el: Record<string, unknown>) => singleAxisElement(el, (t) => warn(`models/${name}.json: ${t}`)));
  const textures = (model.textures ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(textures)) {
    if (typeof value !== "string" || value.startsWith("#")) continue;
    textures[key] = textureRef(env, value, out, (t) => warn(`models/${name}.json: ${t}`));
  }
  return model;
}

/**
 * Resource location of a texture a model names: a project texture is copied and referenced in this mod's
 * namespace, anything else is left for the game to find.
 */
function textureRef(env: GenEnv, ref: string, out: ModelOutputs, warn: (t: string) => void): string {
  const [ns, path] = ref.includes(":") ? ref.split(":", 2) as [string, string] : ["", ref];
  if (ns && ns !== env.modId) return ref;
  const file = projectTexture(env, path);
  if (!file) {
    if (ns === env.modId) warn(`texture "${ref}" is not a project texture`);
    return ref;
  }
  const clean = path.replace(/\.png$/i, "").replaceAll("\\", "/");
  const to = /^(block|item)\/[a-z0-9_/.-]+$/.test(clean) ? clean : `block/custom/${resourceBase(file)}`;
  out.textures.push({ from: relative(env.projectDir, file).replaceAll("\\", "/"), to });
  return `${env.modId}:${to}`;
}

const resourceBase = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.png$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");

/** Project PNG a model texture reference points at: models/, textures/ (with or without block/), or by file name. */
function projectTexture(env: GenEnv, path: string): string | undefined {
  const clean = path.replace(/\.png$/i, "");
  const candidates = [join(modelsDir(env), `${clean}.png`), join(env.projectDir, "textures", `${clean}.png`)];
  for (const c of candidates) if (existsSync(c)) return c;
  const base = clean.replace(/^.*\//, "").toLowerCase();
  for (const root of [modelsDir(env), join(env.projectDir, "textures")]) {
    const hit = findPng(root, base);
    if (hit) return hit;
  }
  return undefined;
}

function findPng(dir: string, base: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const hit = findPng(path, base);
      if (hit) return hit;
    } else if (name.toLowerCase() === `${base}.png`) return path;
  }
  return undefined;
}

// ---- OBJ models

interface ObjResult { obj: string; mtl: string; textures: Record<string, string> }

/**
 * Reads models/<name>.obj (+ its .mtl): faces keep their vertices, texture coordinates and normals with absolute
 * indices; each material becomes the texture slot m<i> whose texture is the material's diffuse map (map_Kd).
 */
function objModel(env: GenEnv, name: string, out: ModelOutputs, warn: (t: string) => void): ObjResult {
  const text = readFileSync(join(modelsDir(env), `${name}.obj`), "utf8");
  const v: string[] = [];
  const vt: string[] = [];
  const vn: string[] = [];
  const body: string[] = [];
  const slots = new Map<string, string>();
  let libs: string[] = [];
  const slotOf = (material: string) => slots.get(material) ?? slots.set(material, `m${slots.size}`).get(material)!;
  let current = "";
  let faces = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [op, ...rest] = line.split(/\s+/);
    if (op === "v") { v.push(rest.slice(0, 3).join(" ")); body.push(`v ${rest.slice(0, 3).join(" ")}`); }
    else if (op === "vt") { vt.push(rest.slice(0, 2).join(" ")); body.push(`vt ${rest.slice(0, 2).join(" ")}`); }
    else if (op === "vn") { vn.push(rest.slice(0, 3).join(" ")); body.push(`vn ${rest.slice(0, 3).join(" ")}`); }
    else if (op === "mtllib") libs = rest;
    else if (op === "usemtl") { current = slotOf(rest.join(" ")); body.push(`usemtl ${current}`); }
    else if (op === "o" || op === "g") body.push(`${op} ${rest.join("_") || "part"}`);
    else if (op === "f") {
      if (!current) { current = slotOf(""); body.push(`usemtl ${current}`); }
      const abs = (index: string, count: number) => {
        if (!index) return "";
        const n = Number(index);
        return String(n < 0 ? count + n + 1 : n);
      };
      const corners = rest.map((c) => {
        const [a, b = "", c3 = ""] = c.split("/");
        return [abs(a, v.length), abs(b, vt.length), abs(c3, vn.length)].join("/").replace(/\/+$/, "");
      });
      if (corners.length < 3) continue;
      // Polygons with more than four corners become a fan of triangles.
      if (corners.length <= 4) body.push(`f ${corners.join(" ")}`);
      else for (let i = 1; i + 1 < corners.length; i++) body.push(`f ${corners[0]} ${corners[i]} ${corners[i + 1]}`);
      faces++;
    }
  }
  if (!faces) warn(`models/${name}.obj: the model has no faces`);
  // Materials: name -> diffuse map, from the model's material libraries.
  const maps = new Map<string, string>();
  for (const lib of libs.length ? libs : [`${name}.mtl`]) {
    const file = join(modelsDir(env), lib);
    if (!existsSync(file)) { if (libs.length) warn(`models/${name}.obj: material library ${lib} is missing`); continue; }
    let material = "";
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const [op, ...rest] = raw.trim().split(/\s+/);
      if (op === "newmtl") material = rest.join(" ");
      else if (op === "map_Kd" && rest.length) maps.set(material, rest[rest.length - 1]);
    }
  }
  const textures: Record<string, string> = {};
  const mtl: string[] = ["# Generated by MCEdge"];
  for (const [material, slot] of slots) {
    const map = maps.get(material);
    if (map) textures[slot] = textureRef(env, map, out, (t) => warn(`models/${name}.obj: ${t}`));
    else {
      warn(`models/${name}.obj: material "${material || "(none)"}" has no texture (map_Kd); the missing texture shows`);
      textures[slot] = "minecraft:missingno";
    }
    mtl.push(`newmtl ${slot}`, `map_Kd #${slot}`);
  }
  return { obj: [`# Generated by MCEdge from models/${name}.obj`, `mtllib ${name}.mtl`, ...body].join("\n") + "\n", mtl: mtl.join("\n") + "\n", textures };
}

/** The custom model file of an OBJ model: the loader's OBJ model, or (Fabric) a plain model MCEdge fills in. */
function objModelJson(env: GenEnv, name: string, slots: Record<string, string>): Record<string, unknown> {
  const textures = { ...slots, particle: Object.values(slots)[0] ?? "minecraft:missingno" };
  const model = `${env.modId}:models/custom/${name}.obj`;
  // Display transforms of a block; an element's own models can override them.
  const base = { parent: "minecraft:block/block", textures };
  if (env.loader === "neoforge") return { loader: "neoforge:obj", model, flip_v: true, ...base };
  if (env.loader === "forge") return { loader: "forge:obj", model, "flip-v": true, diffuseLighting: true, ...base };
  return base;
}

/**
 * Fabric OBJ support: a model loading plugin swaps the geometry of each custom OBJ model for the quads of its .obj
 * file, baked with the model's texture slots and the block state's rotation.
 */
function fabricObjLoader(env: GenEnv, names: string[]): JavaSourceFile {
  const pkg = `${env.project.mod.package}.client`;
  const cls = `${modClassName(env)}ObjModels`;
  const id = idClass(env);
  const v26 = env.mc === "26.3";
  const M = "net.minecraft.client.resources.model";
  const slots = v26 ? `${M}.sprite.TextureSlots` : "net.minecraft.client.renderer.block.model.TextureSlots";
  const state = v26 ? "net.minecraft.client.renderer.block.dispatch.ModelState" : `${M}.ModelState`;
  const quads = v26 ? `${M}.geometry.QuadCollection` : `${M}.QuadCollection`;
  const geometry = v26 ? `${M}.geometry.UnbakedGeometry` : `${M}.UnbakedGeometry`;
  const transforms = v26 ? `${M}.cuboid.ItemTransforms` : "net.minecraft.client.renderer.block.model.ItemTransforms";
  const quad = v26 ? `${M}.geometry.BakedQuad` : "net.minecraft.client.renderer.block.model.BakedQuad";
  const identity = v26 ? "com.mojang.math.Transformation.IDENTITY" : "com.mojang.math.Transformation.identity()";
  const bake = v26
    ? `${M}.sprite.Material.Baked material = baker.materials().resolveSlot(textures, mesh.slot, debugName);
                net.minecraft.client.renderer.texture.TextureAtlasSprite sprite = material.sprite();
                com.mojang.blaze3d.platform.Transparency transparency = material.forceTranslucent() ? com.mojang.blaze3d.platform.Transparency.TRANSLUCENT : sprite.contents().computeTransparency(0.0F, 0.0F, 1.0F, 1.0F);
                ${quad}.MaterialInfo info = ${quad}.MaterialInfo.of(material, transparency, -1, null, 0);
                for (int q = 0; q < mesh.quads(); q++) {
                    org.joml.Vector3f[] p = new org.joml.Vector3f[4];
                    long[] uv = new long[4];
                    for (int i = 0; i < 4; i++) {
                        p[i] = mesh.position(q, i, matrix);
                        uv[i] = net.minecraft.client.model.geom.builders.UVPair.pack(sprite.getU(mesh.u(q, i)), sprite.getV(mesh.v(q, i)));
                    }
                    builder.addUnculledFace(new ${quad}(p[0], p[1], p[2], p[3], uv[0], uv[1], uv[2], uv[3], facing(p), info));
                }`
    : `net.minecraft.client.renderer.texture.TextureAtlasSprite sprite = baker.sprites().resolveSlot(textures, mesh.slot, debugName);
                for (int q = 0; q < mesh.quads(); q++) {
                    org.joml.Vector3f[] p = new org.joml.Vector3f[4];
                    int[] vertices = new int[32];
                    for (int i = 0; i < 4; i++) {
                        p[i] = mesh.position(q, i, matrix);
                        vertices[i * 8] = Float.floatToRawIntBits(p[i].x());
                        vertices[i * 8 + 1] = Float.floatToRawIntBits(p[i].y());
                        vertices[i * 8 + 2] = Float.floatToRawIntBits(p[i].z());
                        vertices[i * 8 + 3] = -1;
                        vertices[i * 8 + 4] = Float.floatToRawIntBits(sprite.getU(mesh.u(q, i)));
                        vertices[i * 8 + 5] = Float.floatToRawIntBits(sprite.getV(mesh.v(q, i)));
                    }
                    builder.addUnculledFace(new ${quad}(vertices, -1, facing(p), sprite, true, 0));
                }`;
  const code = `package ${pkg};

/** Generated by MCEdge: OBJ models for Fabric, which has no OBJ loader. */
public final class ${cls} {
    private ${cls}() {}

    /** Custom models drawn from an OBJ file of the same name. */
    private static final java.util.Set<${id}> MODELS = java.util.Set.of(${names.map((n) => `${id}.parse(${jstr(`${env.modId}:custom/${n}`)})`).join(", ")});

    public static void register() {
        net.fabricmc.fabric.api.client.model.loading.v1.ModelLoadingPlugin.register(context -> context.modifyModelOnLoad().register((model, ctx) ->
            MODELS.contains(ctx.id()) ? new ObjUnbakedModel(model, ${id}.fromNamespaceAndPath(ctx.id().getNamespace(), "models/" + ctx.id().getPath() + ".obj")) : model));
    }

    /** The loaded model with its geometry replaced by the OBJ quads. */
    private record ObjUnbakedModel(${M}.UnbakedModel model, ${id} file) implements ${M}.UnbakedModel {
        @Override
        public Boolean ambientOcclusion() {
            return this.model.ambientOcclusion();
        }

        @Override
        public ${M}.UnbakedModel.GuiLight guiLight() {
            return this.model.guiLight();
        }

        @Override
        public ${transforms} transforms() {
            return this.model.transforms();
        }

        @Override
        public ${slots}.Data textureSlots() {
            return this.model.textureSlots();
        }

        @Override
        public ${id} parent() {
            return this.model.parent();
        }

        @Override
        public ${geometry} geometry() {
            return (textures, baker, modelState, debugName) -> {
                ${quads}.Builder builder = new ${quads}.Builder();
                org.joml.Matrix4fc matrix = modelState.transformation().equals(${identity}) ? null : modelState.transformation().getMatrix();
                for (Mesh mesh : Mesh.read(this.file)) {
                ${bake}
                }
                return builder.build();
            };
        }
    }

    private static net.minecraft.core.Direction facing(org.joml.Vector3f[] p) {
        org.joml.Vector3f a = new org.joml.Vector3f(p[1]).sub(p[0]);
        org.joml.Vector3f b = new org.joml.Vector3f(p[2]).sub(p[0]);
        org.joml.Vector3f n = a.cross(b);
        if (n.lengthSquared() < 1.0E-12F) n = new org.joml.Vector3f(p[3]).sub(p[0]).cross(new org.joml.Vector3f(p[2]).sub(p[0]));
        return net.minecraft.core.Direction.getApproximateNearest(n.x(), n.y(), n.z());
    }

    /** Faces of one material (texture slot): four corners per face, a triangle repeats its last corner. */
    private static final class Mesh {
        final String slot;
        final java.util.List<float[]> faces = new java.util.ArrayList<>();

        Mesh(String slot) {
            this.slot = slot;
        }

        int quads() {
            return this.faces.size();
        }

        org.joml.Vector3f position(int quad, int corner, org.joml.Matrix4fc matrix) {
            float[] f = this.faces.get(quad);
            org.joml.Vector3f p = new org.joml.Vector3f(f[corner * 5], f[corner * 5 + 1], f[corner * 5 + 2]);
            if (matrix != null) {
                p.sub(0.5F, 0.5F, 0.5F);
                matrix.transformPosition(p);
                p.add(0.5F, 0.5F, 0.5F);
            }
            return p;
        }

        float u(int quad, int corner) {
            return this.faces.get(quad)[corner * 5 + 3];
        }

        float v(int quad, int corner) {
            return this.faces.get(quad)[corner * 5 + 4];
        }

        /** Reads a normalized OBJ file (absolute indices, materials named after texture slots); V is flipped. */
        static java.util.Collection<Mesh> read(${id} file) {
            java.util.Map<String, Mesh> meshes = new java.util.LinkedHashMap<>();
            java.util.List<float[]> positions = new java.util.ArrayList<>();
            java.util.List<float[]> uvs = new java.util.ArrayList<>();
            Mesh current = null;
            java.util.Optional<net.minecraft.server.packs.resources.Resource> resource = net.minecraft.client.Minecraft.getInstance().getResourceManager().getResource(file);
            if (resource.isEmpty()) return meshes.values();
            try (java.io.BufferedReader reader = resource.get().openAsReader()) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String[] t = line.trim().split("\\\\s+");
                    switch (t[0]) {
                        case "v" -> positions.add(new float[] {Float.parseFloat(t[1]), Float.parseFloat(t[2]), Float.parseFloat(t[3])});
                        case "vt" -> uvs.add(new float[] {Float.parseFloat(t[1]), 1.0F - Float.parseFloat(t[2])});
                        case "usemtl" -> current = meshes.computeIfAbsent(t[1], Mesh::new);
                        case "f" -> {
                            if (current == null) current = meshes.computeIfAbsent("m0", Mesh::new);
                            float[] face = new float[20];
                            for (int i = 0; i < 4; i++) {
                                String[] corner = t[Math.min(i + 1, t.length - 1)].split("/");
                                float[] pos = positions.get(Integer.parseInt(corner[0]) - 1);
                                float[] uv = corner.length > 1 && !corner[1].isEmpty() ? uvs.get(Integer.parseInt(corner[1]) - 1) : new float[] {0.0F, 0.0F};
                                System.arraycopy(pos, 0, face, i * 5, 3);
                                face[i * 5 + 3] = uv[0];
                                face[i * 5 + 4] = uv[1];
                            }
                            current.faces.add(face);
                        }
                        default -> {
                        }
                    }
                }
            } catch (java.io.IOException | RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(${cls}.class).error("Could not read OBJ model {}", file, e);
            }
            return meshes.values();
        }
    }
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/${cls}.java`, code };
}

const MODEL_ANGLES = [-45, -22.5, 0, 22.5, 45];
const AXIS_NAMES = ["x", "y", "z"] as const;
/** A face's side after a quarter turn about the y axis (right-handed: north becomes west). */
const QUARTER_Y: Record<string, string> = { north: "west", west: "south", south: "east", east: "north", up: "up", down: "down" };

/**
 * A model element as 1.16.5 and 1.21.5 load it: one axis and an angle of -45, -22.5, 0, 22.5 or 45. Newer models may turn
 * an element on several axes ({"x", "y", "z"}) and by any angle (26.x); whole quarter turns about y are baked into the
 * element's corners and faces, and the remaining turn keeps its largest axis, snapped to the nearest allowed angle.
 */
function singleAxisElement(el: Record<string, unknown>, warn: (t: string) => void): Record<string, unknown> {
  const rotation = el.rotation as Record<string, unknown> | undefined;
  if (!rotation) return el;
  const label = typeof el.name === "string" && el.name ? el.name : "element";
  const angles: Record<string, number> = { x: 0, y: 0, z: 0 };
  if (typeof rotation.axis === "string") angles[rotation.axis] = Number(rotation.angle) || 0;
  else for (const axis of AXIS_NAMES) angles[axis] = Number(rotation[axis]) || 0;
  const origin = (rotation.origin as number[] | undefined) ?? [8, 8, 8];
  let out = { ...el };
  // Whole quarter turns about y: the corners turn about the origin ([x, z] -> [z, -x] from it) and the side faces move on.
  const quarters = angles.y % 90 === 0 ? (((angles.y / 90) % 4) + 4) % 4 : 0;
  if (quarters) {
    angles.y = 0;
    let from = (el.from as number[]).slice(), to = (el.to as number[]).slice();
    let faces = (el.faces ?? {}) as Record<string, Record<string, unknown>>;
    for (let i = 0; i < quarters; i++) {
      const turn = (p: number[]) => [origin[0] + (p[2] - origin[2]), p[1], origin[2] - (p[0] - origin[0])];
      const a = turn(from), b = turn(to);
      from = [Math.min(a[0], b[0]), from[1], Math.min(a[2], b[2])];
      to = [Math.max(a[0], b[0]), to[1], Math.max(a[2], b[2])];
      faces = Object.fromEntries(Object.entries(faces).map(([side, face]) => [QUARTER_Y[side] ?? side,
        side === "up" || side === "down" ? { ...face, rotation: ((Number(face.rotation) || 0) + (side === "up" ? 270 : 90)) % 360 } : face]));
    }
    out = { ...out, from, to, faces };
  }
  const turned = AXIS_NAMES.filter((axis) => angles[axis] !== 0);
  if (!turned.length) {
    delete out.rotation;
    return out;
  }
  const axis = turned.reduce((best, a) => (Math.abs(angles[a]) > Math.abs(angles[best]) ? a : best));
  if (turned.length > 1) warn(`${label}: turned on several axes; only the ${axis} axis is kept for this game version`);
  const angle = angles[axis];
  const snapped = MODEL_ANGLES.reduce((best, a) => (Math.abs(a - angle) < Math.abs(best - angle) ? a : best), 0);
  if (snapped !== angle) warn(`${label}: rotation ${angle} becomes ${snapped} for this game version (22.5 degree steps up to 45)`);
  out.rotation = { angle: snapped, axis, origin, ...(rotation.rescale !== undefined ? { rescale: rotation.rescale } : {}) };
  return out;
}
