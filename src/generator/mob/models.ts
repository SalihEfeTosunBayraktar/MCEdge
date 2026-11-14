import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { idExpr, jstr, pascal } from "../java.ts";
import { javaModelNames } from "../javaModels.ts";
import { modClassName } from "../registries.ts";
import type { GenEnv, JavaSourceFile } from "../typeModule.ts";

/**
 * Project entity models. A model field that names no built-in model refers to a file in the project's models/
 * folder: <name>.java (a Blockbench "Modded Entity" Java export, Mojang or MCP names, any version) or
 * <name>.bbmodel (a Blockbench project). Either is read into one geometry description and MCEdge writes the Java
 * model for each engine itself, so one file works on every version: ModelRenderer parts on 1.16.5, a
 * LayerDefinition baked into ModelParts on 1.21.5 and 26.3.
 *
 * Animations come from Blockbench animation exports (Java AnimationDefinition fields, in the model's file or any
 * other .java file of models/) or from a .bbmodel's own animations. MCEdge's keyframe sampler (<Mod>Animator)
 * plays them with the game's keyframe semantics on every version, also where the game has no animation API.
 *
 * Everything below is in entity model space (Y down, rotations in radians). A .bbmodel is turned 180 degrees
 * around Z on reading: (x, y, z) -> (-x, 24 - y, z) for root bones, rotations (-rx, -ry, rz), as Blockbench's
 * own Java export does.
 */

type V3 = [number, number, number];

export interface Box { uv: [number, number]; mirror: boolean; at: V3; size: V3; inflate: number }
export interface Part { name: string; pivot: V3; rot: V3; boxes: Box[]; children: Part[] }
/** kind 0 rotation (radians), 1 position offset, 2 scale offset; interp 0 linear, 1 Catmull-Rom, 2 step. */
export interface Channel { bone: string; kind: 0 | 1 | 2; keys: { time: number; value: V3; interp: 0 | 1 | 2 }[] }
export interface Animation { name: string; length: number; mode: "loop" | "once" | "hold"; channels: Channel[] }
export interface EntityModel { name: string; className: string; texW: number; texH: number; parts: Part[]; animations: Animation[]; warnings: string[] }

/** Models built into the game, by the name a model field stores. */
export const BUILTIN_MODELS = ["Biped", "Chicken", "Cod", "Cow", "Creeper", "Ghast", "Ocelot", "Pig", "Piglin", "Salmon", "Silverfish", "Slime", "Spider", "Villager", "Witch"];

const dir = (env: GenEnv) => join(env.projectDir, "models");
function sourceFile(env: GenEnv, name: string): string | undefined {
  for (const ext of [".java", ".bbmodel"]) {
    const file = join(dir(env), name + ext);
    if (existsSync(file)) return file;
  }
  return undefined;
}
export const modelExists = (env: GenEnv, name: string) => !!name && !BUILTIN_MODELS.includes(name) && /^[A-Za-z0-9_]+$/.test(name) && !!sourceFile(env, name);
export const modelClass = (env: GenEnv, name: string) => `${env.project.mod.package}.client.model.${pascal(name)}Model`;
export const animatorClass = (env: GenEnv) => `${env.project.mod.package}.client.model.${modClassName(env)}Animator`;

const rad = (deg: number) => (deg * Math.PI) / 180;
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const v3 = (v: unknown): V3 => (Array.isArray(v) && v.length >= 3 ? [num(v[0]), num(v[1]), num(v[2])] : [0, 0, 0]);
const f = (n: number) => `${Math.round(n * 1e5) / 1e5}F`;

// ---- Reading Java

/** Value of a Java number expression: literals with F/D suffixes, casts, Math.PI and + - * / ( ). */
function evalNum(text: string): number {
  const cleaned = text.replace(/\((?:float|double|int)\)/g, "").replace(/Math\.PI/g, String(Math.PI)).replace(/Mth\.PI/g, String(Math.PI))
    .replace(/(\d(?:[\d.]*)(?:[eE][-+]?\d+)?)[fFdD]\b/g, "$1").trim();
  if (!/^[\d.eE+\-*/()\s]+$/.test(cleaned)) return NaN;
  try { return Number(new Function(`return (${cleaned});`)()); } catch { return NaN; }
}

/** Arguments of the call whose "(" is at `open`; returns them and the index after ")". */
function args(text: string, open: number): { list: string[]; end: number } {
  const list: string[] = [];
  let depth = 0; let start = open + 1; let quote = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") quote = !quote;
    if (quote) continue;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { list.push(text.slice(start, i).trim()); return { list: list.filter((a, k) => a || k > 0), end: i + 1 }; }
    } else if (c === "," && depth === 1) { list.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return { list, end: text.length };
}

/** Calls of a builder chain (".texOffs(0, 0).addBox(...)") in order. */
function chain(text: string): { name: string; args: string[] }[] {
  const out: { name: string; args: string[] }[] = [];
  const re = /\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = args(text, m.index + m[0].length - 1);
    out.push({ name: m[1], args: a.list });
    re.lastIndex = a.end;
  }
  return out;
}

function boxesOf(calls: { name: string; args: string[] }[], warn: (t: string) => void, part: string): Box[] {
  const boxes: Box[] = [];
  let uv: [number, number] = [0, 0];
  let mirror = false;
  for (const c of calls) {
    if (c.name === "texOffs" || c.name === "setTextureOffset") uv = [evalNum(c.args[0]), evalNum(c.args[1])];
    else if (c.name === "mirror") mirror = c.args.length === 0 || c.args[0] === "true";
    else if (c.name === "addBox") {
      const a = c.args[0]?.startsWith('"') ? c.args.slice(1) : c.args;
      const n = a.slice(0, 6).map(evalNum);
      if (n.length < 6 || n.some((x) => !Number.isFinite(x))) { warn(`part "${part}": addBox(${c.args.join(", ")}) is not understood`); continue; }
      let inflate = 0;
      let boxMirror = mirror;
      for (const extra of a.slice(6)) {
        const def = /CubeDeformation\s*\(([^)]*)\)/.exec(extra);
        if (def) inflate = evalNum(def[1].split(",")[0]);
        else if (extra === "true" || extra === "false") boxMirror = extra === "true";
        else if (Number.isFinite(evalNum(extra))) inflate = evalNum(extra);
      }
      boxes.push({ uv: [...uv], mirror: boxMirror, at: [n[0], n[1], n[2]], size: [n[3], n[4], n[5]], inflate });
    }
  }
  return boxes;
}

/** Blockbench Java export, Mojang names (1.17+: PartDefinition) or MCP names (1.16 and older: ModelRenderer). */
function readJavaModel(text: string, name: string, warnings: string[]): Omit<EntityModel, "animations" | "className"> {
  const warn = (t: string) => warnings.push(`${name}: ${t}`);
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const parts = new Map<string, Part>();
  const roots: Part[] = [];
  let texW = 64; let texH = 64;
  if (/\bPartDefinition\b|addOrReplaceChild/.test(code)) {
    const root = /(\w+)\s*=\s*\w+\.getRoot\(\)/.exec(code)?.[1] ?? "partdefinition";
    const size = /LayerDefinition\.create\(\s*\w+\s*,\s*([^,]+),\s*([^)]+)\)/.exec(code);
    if (size) { texW = evalNum(size[1]); texH = evalNum(size[2]); }
    const re = /(?:PartDefinition\s+(\w+)\s*=\s*)?(\w+)\.addOrReplaceChild\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const a = args(code, m.index + m[0].length - 1);
      re.lastIndex = a.end;
      const partName = JSON.parse(a.list[0] ?? '"part"') as string;
      const pose = a.list[2] ?? "";
      const call = /PartPose\.(\w+)\s*\(/.exec(pose);
      const p = call ? args(pose, call.index + call[0].length - 1).list.map(evalNum) : [];
      const part: Part = {
        name: partName,
        pivot: call && call[1] !== "rotation" ? [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] : [0, 0, 0],
        rot: call?.[1] === "offsetAndRotation" ? [p[3] ?? 0, p[4] ?? 0, p[5] ?? 0] : call?.[1] === "rotation" ? [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] : [0, 0, 0],
        boxes: boxesOf(chain(a.list[1] ?? ""), warn, partName),
        children: [],
      };
      const parent = m[2] === root ? undefined : parts.get(m[2]);
      if (m[2] !== root && !parent) warn(`part "${partName}" hangs on unknown "${m[2]}", added at the root`);
      (parent ? parent.children : roots).push(part);
      if (m[1]) parts.set(m[1], part);
    }
  } else if (/ModelRenderer/.test(code)) {
    const tw = /(?:texWidth|textureWidth)\s*=\s*(\d+)/.exec(code); const th = /(?:texHeight|textureHeight)\s*=\s*(\d+)/.exec(code);
    if (tw) texW = Number(tw[1]); if (th) texH = Number(th[1]);
    for (const m of code.matchAll(/(\w+)\s*=\s*new\s+ModelRenderer\s*\(/g)) {
      parts.set(m[1].replace(/^this\./, ""), { name: m[1].replace(/^this\./, ""), pivot: [0, 0, 0], rot: [0, 0, 0], boxes: [], children: [] });
    }
    const child = new Set<string>();
    for (const stmt of code.split(";")) {
      const s = stmt.trim().replace(/^this\./, "");
      const target = /^(\w+)\s*\./.exec(s)?.[1];
      let m: RegExpExecArray | null;
      if ((m = /^(\w+)\.(setRotationPoint|setPos)\s*\(([^)]*)\)/.exec(s)) && parts.has(m[1])) parts.get(m[1])!.pivot = v3(m[3].split(",").map(evalNum));
      else if ((m = /^setRotationAngle\s*\(\s*(\w+)\s*,([^)]*)\)/.exec(s)) && parts.has(m[1])) parts.get(m[1])!.rot = v3(m[2].split(",").map(evalNum));
      else if ((m = /^(\w+)\.(xRot|yRot|zRot|rotateAngleX|rotateAngleY|rotateAngleZ)\s*=\s*(.+)$/.exec(s)) && parts.has(m[1])) parts.get(m[1])!.rot[/X|xRot/.test(m[2]) ? 0 : /Y|yRot/.test(m[2]) ? 1 : 2] = evalNum(m[3]);
      else if ((m = /^(\w+)\.addChild\s*\(\s*(?:this\.)?(\w+)\s*\)/.exec(s)) && parts.has(m[1]) && parts.has(m[2])) { parts.get(m[1])!.children.push(parts.get(m[2])!); child.add(m[2]); }
      else if (target && parts.has(target) && /addBox/.test(s)) parts.get(target)!.boxes.push(...boxesOf(chain(s.slice(target.length)), warn, target));
    }
    roots.push(...[...parts].filter(([k]) => !child.has(k)).map(([, p]) => p));
  } else warn("no model parts found (expected a Blockbench Java export)");
  return { name, texW, texH, parts: roots, warnings };
}

/** AnimationDefinition fields of Blockbench animation exports, with the game's vector conventions. */
function readJavaAnimations(text: string, warnings: string[], file: string): Animation[] {
  const out: Animation[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const cls = /class\s+(\w+)/.exec(code)?.[1] ?? file;
  const re = /AnimationDefinition\s+(\w+)\s*=\s*AnimationDefinition\.Builder\.withLength\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const len = args(code, m.index + m[0].length - 1);
    const end = code.indexOf(".build()", len.end);
    const body = code.slice(len.end, end < 0 ? code.length : end);
    const channels: Channel[] = [];
    for (const call of chain(body).filter((c) => c.name === "addAnimation")) {
      const bone = JSON.parse(call.args[0] ?? '""') as string;
      const ch = /new\s+AnimationChannel\s*\(/.exec(call.args[1] ?? "");
      if (!ch) continue;
      const a = args(call.args[1], ch.index + ch[0].length - 1).list;
      const kind = /ROTATION/.test(a[0]) ? 0 : /POSITION/.test(a[0]) ? 1 : /SCALE/.test(a[0]) ? 2 : -1;
      if (kind < 0) { warnings.push(`${cls}.${m[1]}: channel ${a[0]} is not supported`); continue; }
      const keys = a.slice(1).map((k) => {
        const kf = /new\s+Keyframe\s*\(/.exec(k);
        const ka = kf ? args(k, kf.index + kf[0].length - 1).list : [];
        const vec = /KeyframeAnimations\.(\w+)\s*\(/.exec(ka[1] ?? "");
        const raw = vec ? args(ka[1], vec.index + vec[0].length - 1).list.map(evalNum) : [0, 0, 0];
        // degreeVec: degrees -> radians; posVec: y flipped; scaleVec: offset from 1.
        const value: V3 = vec?.[1] === "degreeVec" ? [rad(raw[0]), rad(raw[1]), rad(raw[2])] : vec?.[1] === "posVec" ? [raw[0], -raw[1], raw[2]]
          : vec?.[1] === "scaleVec" ? [raw[0] - 1, raw[1] - 1, raw[2] - 1] : [raw[0], raw[1], raw[2]];
        return { time: evalNum(ka[0] ?? "0"), value, interp: (/CATMULLROM/.test(ka[2] ?? "") ? 1 : 0) as 0 | 1 };
      });
      channels.push({ bone, kind: kind as 0 | 1 | 2, keys });
    }
    out.push({ name: `${cls}.${m[1]}`, length: evalNum(len.list[0] ?? "0"), mode: /\.looping\(\)/.test(body) ? "loop" : "hold", channels });
    re.lastIndex = len.end;
  }
  return out;
}

// ---- Reading .bbmodel

function readBbmodel(json: Record<string, unknown>, name: string, warnings: string[]): Omit<EntityModel, "className"> {
  const res = (json.resolution ?? {}) as Record<string, unknown>;
  interface Cube { from: V3; to: V3; origin: V3; rotation: V3; uv: [number, number]; inflate: number; mirror: boolean }
  const cubes = new Map<string, Cube>();
  for (const el of (json.elements ?? []) as Record<string, unknown>[]) {
    if (el.type && el.type !== "cube") continue;
    if (el.box_uv === false) warnings.push(`${name}: cube "${String(el.name)}" uses per-face UV; entity models take box UV, its uv_offset is used`);
    const uv = Array.isArray(el.uv_offset) ? el.uv_offset : [0, 0];
    cubes.set(String(el.uuid), { from: v3(el.from), to: v3(el.to), origin: v3(el.origin), rotation: v3(el.rotation), uv: [num(uv[0]), num(uv[1])], inflate: num(el.inflate), mirror: el.mirror_uv === true });
  }
  const turn = (r: V3): V3 => [rad(-r[0]), rad(-r[1]), rad(r[2])];
  const boxOf = (c: Cube, o: V3): Box => ({ uv: c.uv, mirror: c.mirror, inflate: c.inflate, at: [o[0] - c.to[0], o[1] - c.to[1], c.from[2] - o[2]], size: [c.to[0] - c.from[0], c.to[1] - c.from[1], c.to[2] - c.from[2]] });
  const ids = new Map<string, string>();
  let extra = 0;
  const group = (g: Record<string, unknown>, parentOrigin?: V3): Part => {
    const o = v3(g.origin);
    const part: Part = {
      name: String(g.name ?? "bone"),
      pivot: parentOrigin ? [-(o[0] - parentOrigin[0]), -(o[1] - parentOrigin[1]), o[2] - parentOrigin[2]] : [-o[0], 24 - o[1], o[2]],
      rot: turn(v3(g.rotation)), boxes: [], children: [],
    };
    ids.set(String(g.uuid), part.name);
    for (const child of (g.children ?? []) as unknown[]) {
      if (typeof child === "string") {
        const c = cubes.get(child);
        if (!c) continue;
        if (c.rotation.every((r) => r === 0)) part.boxes.push(boxOf(c, o));
        // A rotated cube becomes a child part turned around the cube's own origin.
        else part.children.push({ name: `mcedge_cube_${extra++}`, pivot: [-(c.origin[0] - o[0]), -(c.origin[1] - o[1]), c.origin[2] - o[2]], rot: turn(c.rotation), boxes: [boxOf(c, c.origin)], children: [] });
      } else if (child && typeof child === "object") part.children.push(group(child as Record<string, unknown>, o));
    }
    return part;
  };
  const parts: Part[] = [];
  const loose: Box[] = [];
  for (const node of (json.outliner ?? []) as unknown[]) {
    if (typeof node === "string") { const c = cubes.get(node); if (c) loose.push(boxOf(c, [0, 24, 0])); }
    else if (node && typeof node === "object") parts.push(group(node as Record<string, unknown>));
  }
  if (loose.length) parts.push({ name: "mcedge_loose", pivot: [0, 0, 0], rot: [0, 0, 0], boxes: loose, children: [] });
  const animations: Animation[] = [];
  for (const a of (json.animations ?? []) as Record<string, unknown>[]) {
    const channels: Channel[] = [];
    for (const [uuid, animator] of Object.entries((a.animators ?? {}) as Record<string, Record<string, unknown>>)) {
      const bone = ids.get(uuid) ?? String(animator.name);
      const byKind = new Map<number, Channel["keys"]>();
      for (const k of (animator.keyframes ?? []) as Record<string, unknown>[]) {
        const kind = ({ rotation: 0, position: 1, scale: 2 } as Record<string, number>)[String(k.channel)];
        if (kind === undefined) continue;
        const p = ((k.data_points ?? []) as Record<string, unknown>[])[0] ?? {};
        const raw = ["x", "y", "z"].map((axis) => {
          const n = Number(String(p[axis] ?? "0").trim() || "0");
          if (!Number.isFinite(n)) warnings.push(`${name}/${String(a.name)}: Molang "${String(p[axis])}" is not supported, 0 is used`);
          return Number.isFinite(n) ? n : 0;
        });
        const value: V3 = kind === 0 ? [rad(-raw[0]), rad(-raw[1]), rad(raw[2])] : kind === 1 ? [-raw[0], -raw[1], raw[2]] : [raw[0] - 1, raw[1] - 1, raw[2] - 1];
        const keys = byKind.get(kind) ?? byKind.set(kind, []).get(kind)!;
        keys.push({ time: num(k.time), value, interp: k.interpolation === "step" ? 2 : k.interpolation === "catmullrom" ? 1 : 0 });
      }
      for (const [kind, keys] of byKind) channels.push({ bone, kind: kind as 0 | 1 | 2, keys: keys.sort((x, y) => x.time - y.time) });
    }
    const loop = String(a.loop ?? "once");
    animations.push({ name: String(a.name ?? "animation"), length: num(a.length), mode: loop === "loop" ? "loop" : loop === "hold" ? "hold" : "once", channels });
  }
  return { name, texW: num(res.width, 64), texH: num(res.height, 64), parts, animations, warnings };
}

// ---- Loading

const cache = new Map<string, { stamp: string; model: EntityModel }>();

/** Animation exports among the project's models/*.java files (other than the model's own file). */
function externalAnimations(env: GenEnv, except: string, warnings: string[]): Animation[] {
  if (!existsSync(dir(env))) return [];
  return readdirSync(dir(env)).filter((n) => n.endsWith(".java") && n !== except).flatMap((n) => {
    const text = readFileSync(join(dir(env), n), "utf8");
    return /AnimationDefinition/.test(text) ? readJavaAnimations(text, warnings, n.slice(0, -5)) : [];
  });
}

/** One model file's animations, as the Resources Animations tab and MCP list them (KUYRUK 132). */
export interface AnimationSource { path: string; animations: { name: string; length: number; mode: Animation["mode"] }[]; warnings: string[] }

/** Animations in the project's models/ folder: Blockbench Java animation exports (any .java file) and .bbmodel animations. */
export function projectAnimations(projectDir: string): AnimationSource[] {
  const folder = join(projectDir, "models");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).sort().flatMap((n) => {
    const warnings: string[] = [];
    let animations: Animation[] = [];
    try {
      const text = readFileSync(join(folder, n), "utf8");
      if (n.endsWith(".java") && /AnimationDefinition/.test(text)) animations = readJavaAnimations(text, warnings, n.slice(0, -5));
      else if (n.endsWith(".bbmodel")) animations = readBbmodel(JSON.parse(text) as Record<string, unknown>, n.slice(0, -8), warnings).animations;
    } catch (e) {
      warnings.push((e as Error).message);
    }
    return animations.length ? [{ path: `models/${n}`, animations: animations.map((a) => ({ name: a.name, length: a.length, mode: a.mode })), warnings }] : [];
  });
}

export function loadModel(env: GenEnv, name: string): EntityModel {
  const file = sourceFile(env, name)!;
  const text = readFileSync(file, "utf8");
  const others = existsSync(dir(env)) ? readdirSync(dir(env)).filter((n) => n.endsWith(".java")).map((n) => `${n}:${readFileSync(join(dir(env), n), "utf8").length}`).join("|") : "";
  const stamp = `${text}\u0000${others}`;
  const known = cache.get(file);
  if (known?.stamp === stamp) return known.model;
  const warnings: string[] = [];
  let model: EntityModel;
  if (file.endsWith(".bbmodel")) {
    model = { ...readBbmodel(JSON.parse(text) as Record<string, unknown>, name, warnings), className: `${pascal(name)}Model` };
  } else {
    const geometry = readJavaModel(text, name, warnings);
    model = { ...geometry, className: `${pascal(name)}Model`, animations: [...readJavaAnimations(text, warnings, name), ...externalAnimations(env, `${name}.java`, warnings)] };
  }
  // Animations only keep channels of bones this model has, like the game's safe baking.
  const bones = new Set(flatten(model.parts).map((p) => p.part.name));
  model.animations = model.animations.map((a) => ({ ...a, channels: a.channels.filter((c) => bones.has(c.bone)) }));
  cache.set(file, { stamp, model });
  return model;
}

/** Index of an animation: its full name ("Beast.WALK", "animation.beast.walk") or its last segment, any case. */
export function findAnimation(model: EntityModel, name: string): number {
  const short = (n: string) => n.split(".").pop()!.toLowerCase();
  const exact = model.animations.findIndex((a) => a.name === name);
  return exact >= 0 ? exact : model.animations.findIndex((a) => short(a.name) === short(name));
}

/** Bone names of a project model in BONE_NAMES order (parents before their children). */
export const boneNames = (env: GenEnv, name: string) => flatten(loadModel(env, name).parts).map((b) => b.part.name);

function flatten(parts: Part[], parent?: Part, out: { part: Part; parent?: Part }[] = []) {
  for (const p of parts) { out.push({ part: p, parent }); flatten(p.children, p, out); }
  return out;
}

// ---- Writing Java

/** The Java model class of a project model for this engine. */
export function modelSource(env: GenEnv, name: string): JavaSourceFile {
  const m = loadModel(env, name);
  const pkg = `${env.project.mod.package}.client.model`;
  const all = flatten(m.parts);
  // Generated names must be unique per parent for getChild; Blockbench names already are.
  const A = animatorClass(env);
  const anims = m.animations.map((a, i) => {
    const channels = a.channels.map((c) => {
      const bone = all.findIndex((b) => b.part.name === c.bone);
      return `new ${A}.Channel(${bone}, ${c.kind}, new float[] {${c.keys.map((k) => f(k.time)).join(", ")}}, new float[] {${c.keys.flatMap((k) => k.value.map(f)).join(", ")}}, new int[] {${c.keys.map((k) => k.interp).join(", ")}})`;
    });
    return `    /** ${a.name.replace(/\*\//g, "")} */\n    public static final ${A}.Animation ANIMATION_${i} = new ${A}.Animation(${f(a.length)}, ${a.mode === "loop"}, ${a.mode === "hold"}, new ${A}.Channel[] {${channels.length ? `\n            ${channels.join(",\n            ")}\n    ` : ""}});`;
  });
  const table = `    /** Animations of this model, in source order. */\n    public static final ${A}.Animation[] ANIMATIONS = {${m.animations.map((_, i) => `ANIMATION_${i}`).join(", ")}};`;
  const boxArgs = (b: Box) => [...b.at, ...b.size].map(f).join(", ");
  let code: string;
  if (env.mc === "1.16.5") {
    const R = "net.minecraft.client.renderer.model.ModelRenderer";
    const lines: string[] = [`this.texWidth = ${m.texW};`, `this.texHeight = ${m.texH};`];
    all.forEach(({ part, parent }, i) => {
      lines.push(`this.bones[${i}] = new ${R}(this);`, `this.bones[${i}].setPos(${part.pivot.map(f).join(", ")});`);
      if (part.rot.some((x) => x !== 0)) lines.push(`this.bones[${i}].xRot = ${f(part.rot[0])};`, `this.bones[${i}].yRot = ${f(part.rot[1])};`, `this.bones[${i}].zRot = ${f(part.rot[2])};`);
      if (parent) lines.push(`this.bones[${all.findIndex((b) => b.part === parent)}].addChild(this.bones[${i}]);`);
      for (const b of part.boxes) lines.push(`this.bones[${i}].texOffs(${b.uv[0]}, ${b.uv[1]}).addBox(${boxArgs(b)}, ${f(b.inflate)}, ${b.mirror});`);
    });
    const roots = all.map((b, i) => (b.parent ? -1 : i)).filter((i) => i >= 0);
    code = `package ${pkg};

/** Generated by MCEdge from models/${name}. */
public class ${m.className}<T extends net.minecraft.entity.Entity> extends net.minecraft.client.renderer.entity.model.EntityModel<T> {
    public static final String[] BONE_NAMES = {${all.map((b) => jstr(b.part.name)).join(", ")}};
    public final ${R}[] bones = new ${R}[${all.length}];
    private final float[][] rest;

${anims.join("\n\n")}

${table}

    public ${m.className}() {
${lines.map((l) => `        ${l}`).join("\n")}
        this.rest = ${A}.capture(this.bones);
    }

    /** Puts every bone back in its modelled pose before animations add to it. */
    public void resetBones() {
        ${A}.restore(this.bones, this.rest);
    }

    @Override
    public void setupAnim(T entity, float limbSwing, float limbSwingAmount, float ageInTicks, float netHeadYaw, float headPitch) {
        this.resetBones();
    }

    @Override
    public void renderToBuffer(com.mojang.blaze3d.matrix.MatrixStack pose, com.mojang.blaze3d.vertex.IVertexBuilder buffer, int light, int overlay, float red, float green, float blue, float alpha) {
${roots.map((i) => `        this.bones[${i}].render(pose, buffer, light, overlay, red, green, blue, alpha);`).join("\n")}
    }
}
`;
  } else {
    const P = "net.minecraft.client.model.geom.ModelPart";
    const B = "net.minecraft.client.model.geom.builders";
    const S = "net.minecraft.client.renderer.entity.state.LivingEntityRenderState";
    const defs: string[] = [`${B}.MeshDefinition mesh = new ${B}.MeshDefinition();`, `${B}.PartDefinition root = mesh.getRoot();`];
    all.forEach(({ part, parent }, i) => {
      const cubes = part.boxes.map((b) => `.texOffs(${b.uv[0]}, ${b.uv[1]})${b.mirror ? ".mirror()" : ""}.addBox(${boxArgs(b)}, new ${B}.CubeDeformation(${f(b.inflate)}))${b.mirror ? ".mirror(false)" : ""}`).join("");
      defs.push(`${B}.PartDefinition p${i} = ${parent ? `p${all.findIndex((b) => b.part === parent)}` : "root"}.addOrReplaceChild(${jstr(part.name)}, ${B}.CubeListBuilder.create()${cubes}, net.minecraft.client.model.geom.PartPose.offsetAndRotation(${[...part.pivot, ...part.rot].map(f).join(", ")}));`);
    });
    const paths = all.map(({ part, parent }) => {
      const chainNames = [part.name];
      let up = parent;
      while (up) { chainNames.unshift(up.name); const u = up; up = all.find((b) => b.part === u)?.parent; }
      return `root${chainNames.map((n) => `.getChild(${jstr(n)})`).join("")}`;
    });
    code = `package ${pkg};

/** Generated by MCEdge from models/${name}. */
public class ${m.className} extends net.minecraft.client.model.EntityModel<${S}> {
    public static final net.minecraft.client.model.geom.ModelLayerLocation LAYER_LOCATION = new net.minecraft.client.model.geom.ModelLayerLocation(${idExpr(env, `${env.modId}:${name.toLowerCase()}`)}, "main");
    public static final String[] BONE_NAMES = {${all.map((b) => jstr(b.part.name)).join(", ")}};
    public final ${P}[] bones;
    private final float[][] rest;

${anims.join("\n\n")}

${table}

    public ${m.className}(${P} root) {
        super(root);
        this.bones = new ${P}[] {${paths.join(", ")}};
        this.rest = ${A}.capture(this.bones);
    }

    public static ${B}.LayerDefinition createBodyLayer() {
${defs.map((l) => `        ${l}`).join("\n")}
        return ${B}.LayerDefinition.create(mesh, ${m.texW}, ${m.texH});
    }

    /** Puts every bone back in its modelled pose before animations add to it. */
    public void resetBones() {
        ${A}.restore(this.bones, this.rest);
    }

    @Override
    public void setupAnim(${S} state) {
        super.setupAnim(state);
        this.resetBones();
    }
}
`;
  }
  return { path: `${pkg.replaceAll(".", "/")}/${m.className}.java`, code };
}

/**
 * Project models every generated element uses (living entity models and layers, projectile models, worn armor). Their Java
 * classes, the animator and the layer registration are written once, by the first of these types that has elements.
 */
export function usedModels(env: GenEnv): string[] {
  const names: string[] = [];
  for (const e of env.generated.living_entity ?? []) {
    names.push(String(e.mobModelName ?? ""));
    for (const row of Array.isArray(e.modelLayers) ? (e.modelLayers as Record<string, unknown>[]) : []) names.push(String(row.model ?? ""));
  }
  for (const p of env.generated.projectile ?? []) names.push(String(p.entityModel ?? ""));
  // Custom worn armor models of enabled pieces.
  for (const a of env.generated.armor ?? []) {
    for (const piece of ["helmet", "body", "leggings", "boots"]) if (a[`enable${piece[0].toUpperCase()}${piece.slice(1)}`] === true) names.push(String(a[`${piece}ModelName`] ?? ""));
  }
  // Block entity and item renderers of Java models.
  names.push(...javaModelNames(env));
  return [...new Set(names.filter((n) => modelExists(env, n)))];
}
/** Type module that writes the model classes; "models" (javaModels.ts) when no entity or armor type is generated. */
export const modelsOwner = (env: GenEnv) => ["living_entity", "projectile", "armor"].find((t) => (env.generated[t] ?? []).length) ?? "models";

/** Sources and client registration of every used project model, for the owning type module. */
export function modelOutputs(env: GenEnv, typeId: string): { sources: JavaSourceFile[]; clientInit: string[] } {
  const models = modelsOwner(env) === typeId ? usedModels(env) : [];
  if (!models.length) return { sources: [], clientInit: [] };
  return { sources: [animatorSource(env), ...models.map((m) => modelSource(env, m))], clientInit: [layerRegistration(env, models)].filter(Boolean) };
}

/** Client statement registering the layer definitions of project models (modern engines). */
export function layerRegistration(env: GenEnv, names: string[]): string {
  if (env.mc === "1.16.5" || !names.length) return "";
  if (env.loader === "neoforge") {
    return `modBus.addListener(net.neoforged.neoforge.client.event.EntityRenderersEvent.RegisterLayerDefinitions.class, event -> {
${names.map((n) => `            event.registerLayerDefinition(${modelClass(env, n)}.LAYER_LOCATION, ${modelClass(env, n)}::createBodyLayer);`).join("\n")}
        });`;
  }
  const api = env.mc === "26.3" ? "net.fabricmc.fabric.api.client.rendering.v1.ModelLayerRegistry" : "net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry";
  return names.map((n) => `${api}.registerModelLayer(${modelClass(env, n)}.LAYER_LOCATION, ${modelClass(env, n)}::createBodyLayer);`).join("\n        ");
}

/**
 * <Mod>Animator: samples keyframes (linear, Catmull-Rom, step) and adds them to model parts, with the game's
 * keyframe animation rules. Scale channels need part scales, which 1.16.5 parts do not have.
 */
export function animatorSource(env: GenEnv): JavaSourceFile {
  const cls = animatorClass(env);
  const pkg = cls.slice(0, cls.lastIndexOf("."));
  const name = cls.slice(cls.lastIndexOf(".") + 1);
  const legacy = env.mc === "1.16.5";
  const P = legacy ? "net.minecraft.client.renderer.model.ModelRenderer" : "net.minecraft.client.model.geom.ModelPart";
  const code = `package ${pkg};

/** Generated by MCEdge: plays keyframe animations on model parts. */
public final class ${name} {
    private ${name}() {}

    /** Keyframes of one bone: kind 0 rotation (radians), 1 position, 2 scale offset; x, y, z per key. */
    public static final class Channel {
        final int bone;
        final int kind;
        final float[] times;
        final float[] values;
        final int[] interpolations;

        public Channel(int bone, int kind, float[] times, float[] values, int[] interpolations) {
            this.bone = bone;
            this.kind = kind;
            this.times = times;
            this.values = values;
            this.interpolations = interpolations;
        }
    }

    public static final class Animation {
        public final float length;
        public final boolean loop;
        public final boolean hold;
        final Channel[] channels;

        public Animation(float length, boolean loop, boolean hold, Channel[] channels) {
            this.length = length;
            this.loop = loop;
            this.hold = hold;
            this.channels = channels;
        }
    }

    public static float[][] capture(${P}[] parts) {
        float[][] rest = new float[parts.length][];
        for (int i = 0; i < parts.length; i++) {
            ${P} p = parts[i];
            rest[i] = new float[] {p.x, p.y, p.z, p.xRot, p.yRot, p.zRot};
        }
        return rest;
    }

    public static void restore(${P}[] parts, float[][] rest) {
        for (int i = 0; i < parts.length; i++) {
            ${P} p = parts[i];
            float[] r = rest[i];
            p.x = r[0];
            p.y = r[1];
            p.z = r[2];
            p.xRot = r[3];
            p.yRot = r[4];
            p.zRot = r[5];${legacy ? "" : "\n            p.xScale = 1.0F;\n            p.yScale = 1.0F;\n            p.zScale = 1.0F;"}
        }
    }

    /** Adds the animation's pose at \`seconds\`, scaled by \`weight\`, to the parts. */
    public static void apply(${P}[] parts, Animation animation, float seconds, float weight) {
        if (seconds < 0.0F) return;
        float t = seconds;
        if (animation.loop) t = animation.length > 0.0F ? seconds % animation.length : 0.0F;
        else if (t > animation.length) {
            if (!animation.hold) return;
            t = animation.length;
        }
        float[] v = new float[3];
        for (Channel c : animation.channels) {
            if (c.bone < 0 || c.bone >= parts.length || c.times.length == 0) continue;
            sample(c, t, v);
            ${P} p = parts[c.bone];
            if (c.kind == 0) {
                p.xRot += v[0] * weight;
                p.yRot += v[1] * weight;
                p.zRot += v[2] * weight;
            } else if (c.kind == 1) {
                p.x += v[0] * weight;
                p.y += v[1] * weight;
                p.z += v[2] * weight;
            }${legacy ? "" : ` else {
                p.xScale += v[0] * weight;
                p.yScale += v[1] * weight;
                p.zScale += v[2] * weight;
            }`}
        }
    }

    private static void sample(Channel c, float t, float[] out) {
        int n = c.times.length;
        int i = 0;
        while (i + 1 < n && c.times[i + 1] <= t) i++;
        int j = Math.min(n - 1, i + 1);
        float alpha = j != i && c.times[j] > c.times[i] ? Math.max(0.0F, Math.min(1.0F, (t - c.times[i]) / (c.times[j] - c.times[i]))) : 0.0F;
        int mode = c.interpolations[j];
        for (int axis = 0; axis < 3; axis++) {
            float a = c.values[i * 3 + axis];
            float b = c.values[j * 3 + axis];
            if (mode == 2) out[axis] = alpha >= 1.0F ? b : a;
            else if (mode == 1) {
                float p0 = c.values[Math.max(0, i - 1) * 3 + axis];
                float p3 = c.values[Math.min(n - 1, j + 1) * 3 + axis];
                float t2 = alpha * alpha;
                float t3 = t2 * alpha;
                out[axis] = 0.5F * (2.0F * a + (b - p0) * alpha + (2.0F * p0 - 5.0F * a + 4.0F * b - p3) * t2 + (3.0F * a - p0 - 3.0F * b + p3) * t3);
            } else out[axis] = a + (b - a) * alpha;
        }
    }
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/${name}.java`, code };
}
