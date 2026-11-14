import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  DISPLAY_CONTEXTS,
  FACES,
  defaultUv,
  projectTexturePath,
  resolveModel,
  textureOf,
  type BlockModelJson,
  type FaceName,
  type ModelElement,
  type ResolvedModel,
} from "../../../../src/resources/blockModel.ts";
import vanillaModels from "../../../../config/vanilla-block-models.json" with { type: "json" };
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { animationClock, drawFrame, frameSize, loadPreviewTexture, onAnimationTick, type PreviewTexture } from "../textures/animatedTexture.ts";
import { t, type StringKey } from "../strings.ts";

type View = "block" | (typeof DISPLAY_CONTEXTS)[number];

/** Minecraft's directional face shading: top full, bottom half, sides in between. */
const SHADE: Record<FaceName, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

interface Props {
  dir: string;
  modId: string;
  /** Model name: models/<name>.json. */
  model: string;
  /** Project textures (snapshot.textures); also re-read when this list changes. */
  textures: string[];
  height?: number;
  /** The block's item display field (JSON text): its contexts replace those of the model, as the item model does. */
  itemDisplay?: string;
  /** A block's own textures for model slots (slot -> project texture path), drawn instead of the model's. */
  textureOverrides?: Record<string, string>;
}

/**
 * 3D preview of a project JSON block model: element cubes with their face textures, UV, face and element
 * rotation, and the display transforms of each context (GUI, ground, hand ...). Drag to orbit, wheel to zoom.
 * Textures come from the project; anything outside it (vanilla textures, vanilla parents) is shown as missing.
 * Animated textures (.png.mcmeta) play as in the game (KUYRUK 166). The inventory and item frame contexts show the
 * model in an inventory slot or an item frame, seen from the front as the game draws them (KUYRUK 162).
 */
export function ModelPreview({ dir, modId, model, textures, height = 260, itemDisplay, textureOverrides }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>(undefined);
  const [view, setView] = useState<View>("block");
  const [scenery, setScenery] = useState(true);
  const [resolved, setResolved] = useState<ResolvedModel>();
  const [error, setError] = useState<string>();
  const [rev, setRev] = useState(0);
  // Keyed by content, so a new object with the same mapping does not reload the model.
  const overridesKey = JSON.stringify(textureOverrides ?? {});
  const overrides = useMemo(() => JSON.parse(overridesKey) as Record<string, string>, [overridesKey]);

  // Reload when the model or a texture changes on disk (an agent, another editor, the texture editor).
  useEffect(() => api.onFsChange((change) => {
    if (change.dir === dir && change.paths.some((p) => p.startsWith("models/") || p.startsWith("textures/"))) setRev((n) => n + 1);
  }), [dir]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    stage.current = createStage(node);
    return () => (stage.current?.dispose(), (stage.current = undefined));
  }, []);

  useEffect(() => {
    let alive = true;
    setError(undefined);
    const read = async (name: string): Promise<BlockModelJson | undefined> => {
      try {
        const file = await api.codeRead(dir, `models/${name}.json`);
        return file.binary ? undefined : (JSON.parse(file.text) as BlockModelJson);
      } catch (e) {
        if (e instanceof SyntaxError) throw new Error(`models/${name}.json: ${e.message}`);
        return undefined;
      }
    };
    void (async () => {
      try {
        const resolvedModel = await resolveModel(model, modId, read, vanillaModels as unknown as Record<string, BlockModelJson>);
        const next = { ...resolvedModel, textures: { ...resolvedModel.textures, ...overrides } };
        const images = await loadImages(dir, modId, next, textures);
        if (!alive) return;
        setResolved(next);
        stage.current?.show(next, images);
      } catch (e) {
        if (alive) (setResolved(undefined), setError((e as Error).message), stage.current?.show(undefined, new Map()));
      }
    })();
    return () => void (alive = false);
  }, [dir, modId, model, textures, rev, overrides]);

  const display = useMemo(() => ({ ...resolved?.display, ...parseDisplay(itemDisplay) }), [resolved, itemDisplay]);
  useEffect(() => stage.current?.setDisplay(view === "block" ? undefined : display[view]), [view, display]);
  const context = scenery && (view === "gui" || view === "fixed") ? view : undefined;
  useEffect(() => stage.current?.setContext(context), [context]);

  const contexts = DISPLAY_CONTEXTS.filter((c) => display[c]);
  return (
    <div className="modelpreview">
      <div className="mpbar">
        <select value={view} aria-label={t("model.view")} onChange={(e) => setView(e.target.value as View)}>
          <option value="block">{t("model.view.block")}</option>
          {DISPLAY_CONTEXTS.map((c) => (
            <option key={c} value={c} disabled={!contexts.includes(c)}>{t(`model.view.${c}` as StringKey)}</option>
          ))}
        </select>
        <button type="button" className="abtn" title={t("model.resetView")} onClick={() => stage.current?.resetCamera()}>
          <Icon name="fit" size={14} />{t("model.resetView")}
        </button>
        {(view === "gui" || view === "fixed") && (
          <label className="check mpscenery" title={t("model.sceneryTip")}>
            <input type="checkbox" checked={scenery} onChange={(e) => setScenery(e.target.checked)} />{t(view === "gui" ? "model.scenery.gui" : "model.scenery.fixed")}
          </label>
        )}
        <span className="dim mpmeta">{resolved && t("model.meta", { elements: resolved.elements.length })}</span>
      </div>
      <div ref={host} className="mpcanvas" data-context={context} style={{ height }} aria-label={t("model.preview")} />
      {error && <p className="ferr">{error}</p>}
      {resolved?.externalParent && <p className="fhelp">{t("model.externalParent", { parent: resolved.externalParent })}</p>}
      {resolved && !resolved.elements.length && !error && <p className="fhelp">{t("model.noElements")}</p>}
    </div>
  );
}

/** The display object of an item display field; nothing when the text is empty or not a JSON object. */
function parseDisplay(text: string | undefined): ResolvedModel["display"] {
  try {
    const value: unknown = text?.trim() ? JSON.parse(text) : undefined;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as ResolvedModel["display"]) : {};
  } catch {
    return {};
  }
}

/** Texture reference -> decoded texture with its animation, for every face texture of the model. */
export async function loadImages(dir: string, modId: string, model: ResolvedModel, textures: string[]): Promise<Map<string, PreviewTexture>> {
  const images = new Map<string, PreviewTexture>();
  const refs = new Set(model.elements.flatMap((e) => Object.values(e.faces ?? {}).map((f) => f && textureOf(model.textures, f.texture))));
  for (const ref of refs) {
    if (!ref || images.has(ref)) continue;
    const [ns, path] = ref.includes(":") ? ref.split(":", 2) : ["", ref];
    // models/<name>.png sits beside imported models and is not in the texture list; try it first, as the generator does.
    // A block's slot mapping names a project texture by its path.
    const candidates = textures.includes(ref) ? [ref]
      : [!ns || ns === modId ? `models/${path.replace(/\.png$/i, "")}.png` : "", projectTexturePath(ref, modId, textures) ?? ""].filter(Boolean);
    for (const file of candidates) {
      try {
        images.set(ref, await loadPreviewTexture(dir, file));
        break;
      } catch {
        // Not there; the next candidate or the missing-texture checker.
      }
    }
  }
  return images;
}

interface Stage {
  show(model: ResolvedModel | undefined, images: Map<string, PreviewTexture>): void;
  setDisplay(transform: ResolvedModel["display"][string] | undefined): void;
  /** Shows the model in an inventory slot ("gui") or an item frame ("fixed"), from the front; undefined: free view. */
  setContext(context: "gui" | "fixed" | undefined): void;
  resetCamera(): void;
  dispose(): void;
}

/** The three.js scene of one preview; renders on demand (orbit, resize, new model). */
function createStage(node: HTMLDivElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  node.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 8;
  controls.maxDistance = 160;
  // Inventory and item frame: the game draws items from the front without perspective.
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 400);
  const flatControls = new OrbitControls(flat, renderer.domElement);
  flatControls.enableDamping = false;
  flatControls.minZoom = 0.5;
  flatControls.maxZoom = 8;
  flatControls.enabled = false;
  const scenery = new THREE.Group();
  scene.add(scenery);
  let context: "gui" | "fixed" | undefined;
  // The 16x16x16 block space, so the model's size and position (also under a display transform) read at a glance.
  const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 16, 16)),
    new THREE.LineBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 0.35 }));
  scene.add(bounds);
  const display = new THREE.Group();
  scene.add(display);
  let disposables: { dispose(): void }[] = [];
  let stopAnimation: (() => void) | undefined;

  const render = () => renderer.render(scene, context ? flat : camera);
  controls.addEventListener("change", render);
  flatControls.addEventListener("change", render);
  const resetCamera = () => {
    // Minecraft's inventory angle: looking down 30 degrees at the north-west corner.
    camera.position.set(-30, 26, -30);
    controls.target.set(0, 0, 0);
    controls.update();
    flat.position.set(0, 0, 100);
    flat.zoom = 1;
    flat.updateProjectionMatrix();
    flatControls.target.set(0, 0, 0);
    flatControls.update();
    render();
  };
  /** The orthographic view shows `half` units above and below the centre (3 slots, or the frame with a margin). */
  const fitFlat = () => {
    const { clientWidth: w, clientHeight: h } = node;
    const half = context === "gui" ? 30 : 16;
    const aspect = w && h ? w / h : 1;
    Object.assign(flat, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    flat.updateProjectionMatrix();
  };
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = node;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitFlat();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(node);
  resetCamera();

  return {
    show(model, images) {
      display.clear();
      stopAnimation?.();
      stopAnimation = undefined;
      disposables.forEach((d) => d.dispose());
      disposables = [];
      if (model) {
        const built = buildModel(model, images);
        display.add(built.group);
        disposables = built.disposables;
        // Animated textures repaint their canvas on the shared clock; the scene redraws when a frame changed.
        if (built.animated.length) {
          stopAnimation = onAnimationTick((ms) => {
            let changed = false;
            for (const a of built.animated) {
              const key = drawFrame(a.g, a.texture, ms);
              if (key !== a.last) (a.last = key, (a.map.needsUpdate = true), (changed = true));
            }
            if (changed) render();
          });
        }
      }
      render();
    },
    setDisplay(transform) {
      const [rx, ry, rz] = transform?.rotation ?? [0, 0, 0];
      display.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz), "XYZ");
      display.position.set(...(transform?.translation ?? [0, 0, 0]));
      display.scale.set(...(transform?.scale ?? [1, 1, 1]));
      render();
    },
    setContext(next) {
      if (next === context) return;
      context = next;
      scenery.children.forEach((m) => (((m as THREE.Mesh).material as THREE.MeshBasicMaterial).map?.dispose(), ((m as THREE.Mesh).material as THREE.Material).dispose(), (m as THREE.Mesh).geometry.dispose()));
      scenery.clear();
      if (context) scenery.add(sceneryMesh(context));
      // The block space outline belongs to the free view.
      bounds.visible = !context;
      controls.enabled = !context;
      flatControls.enabled = !!context;
      fitFlat();
      resetCamera();
    },
    resetCamera,
    dispose() {
      observer.disconnect();
      stopAnimation?.();
      controls.dispose();
      flatControls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * What the game draws around an item, as a picture behind the model in model units (16 = one block, 1 = a pixel of a
 * 16 px texture): a 3 x 3 patch of inventory slots with the model in the middle one (an item fills the 16 x 16 inside of
 * an 18 x 18 slot), or an item frame. The frame draws its item at half size, so the frame (12 x 12 px of a block) is
 * drawn at twice its size, 24 x 24, around the model at its own display size.
 */
function sceneryMesh(context: "gui" | "fixed"): THREE.Mesh {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d")!;
  const px = (color: string, x: number, y: number, w: number, h: number) => ((g.fillStyle = color), g.fillRect(x, y, w, h));
  let size: number;
  if (context === "gui") {
    // Inventory background with a 4 px margin around three rows of three slots.
    size = 62;
    canvas.width = canvas.height = size;
    px("#c6c6c6", 0, 0, size, size);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const x = 4 + col * 18, y = 4 + row * 18;
      px("#373737", x, y, 17, 1);
      px("#373737", x, y, 1, 17);
      px("#ffffff", x + 1, y + 17, 17, 1);
      px("#ffffff", x + 17, y + 1, 1, 17);
      px("#8b8b8b", x + 1, y + 1, 16, 16);
    }
  } else {
    // Item frame front: a wooden border round a leather back, 12 x 12 px.
    size = 12;
    canvas.width = canvas.height = size;
    px("#9c7a4f", 0, 0, 12, 12);
    px("#c29d62", 0, 0, 12, 1);
    px("#c29d62", 0, 0, 1, 12);
    px("#6e5432", 0, 11, 12, 1);
    px("#6e5432", 11, 0, 1, 12);
    px("#8a5a3b", 1, 1, 10, 10);
    px("#7a4e33", 2, 2, 8, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const units = context === "gui" ? size : size * 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(units, units), new THREE.MeshBasicMaterial({ map: texture }));
  // Behind anything the model's display transform can put in front of the viewer.
  mesh.position.z = -40;
  return mesh;
}

/** Minecraft's missing texture: a magenta and black checker. */
function missingTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#f800f8";
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  return canvas;
}

/** Corners of a face seen from outside, top-left first, clockwise; matches the UV corners (u1,v1) (u2,v1) (u2,v2) (u1,v2). */
function faceCorners(e: ModelElement, face: FaceName): [number, number, number][] {
  const [x1, y1, z1] = e.from, [x2, y2, z2] = e.to;
  switch (face) {
    case "north": return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case "south": return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case "west": return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    case "east": return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    case "up": return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case "down": return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
  }
}

/** A face texture whose canvas follows its animation. */
interface AnimatedMap { map: THREE.CanvasTexture; g: CanvasRenderingContext2D; texture: PreviewTexture; last: string }

export function buildModel(model: ResolvedModel, images: Map<string, PreviewTexture>) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const animated: AnimatedMap[] = [];
  const materials = new Map<string, THREE.Material>();
  const canvasOf = (source: PreviewTexture) => {
    const canvas = document.createElement("canvas");
    Object.assign(canvas, frameSize(source));
    const g = canvas.getContext("2d")!;
    return { canvas, g, last: drawFrame(g, source, animationClock()) };
  };
  const material = (ref: string | undefined) => {
    const key = ref && images.has(ref) ? ref : "";
    let m = materials.get(key);
    if (!m) {
      const source = images.get(key);
      const painted = source && canvasOf(source);
      const texture = new THREE.CanvasTexture(painted?.canvas ?? missingTexture());
      if (source?.schedule && painted) animated.push({ map: texture, g: painted.g, texture: source, last: painted.last });
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
      materials.set(key, m);
      disposables.push(texture, m);
    }
    return m;
  };
  for (const element of model.elements) {
    if (!Array.isArray(element.from) || !Array.isArray(element.to)) continue;
    const rotation = elementRotation(element);
    for (const name of FACES) {
      const face = element.faces?.[name];
      if (!face) continue;
      const [u1, v1, u2, v2] = face.uv ?? defaultUv(element, name);
      const uvCorners = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
      const turn = (((face.rotation ?? 0) / 90) % 4 + 4) % 4;
      const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
      faceCorners(element, name).forEach((corner, i) => {
        const p = new THREE.Vector3(...corner);
        if (rotation) p.sub(rotation.origin).multiply(rotation.rescale).applyQuaternion(rotation.turn).add(rotation.origin);
        positions.push(p.x - 8, p.y - 8, p.z - 8);
        const [u, v] = uvCorners[(i - turn + 4) % 4];
        uvs.push(u / 16, 1 - v / 16);
        const shade = SHADE[name];
        colors.push(shade, shade, shade);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex([0, 3, 2, 0, 2, 1]);
      disposables.push(geometry);
      group.add(new THREE.Mesh(geometry, material(textureOf(model.textures, face.texture))));
    }
  }
  return { group, disposables, animated };
}

/** Element rotation about its origin; with rescale the two other axes stretch so the face keeps the block's width. */
function elementRotation(e: ModelElement) {
  const r = e.rotation;
  if (!r || !r.angle || !["x", "y", "z"].includes(r.axis)) return undefined;
  const axis = new THREE.Vector3(r.axis === "x" ? 1 : 0, r.axis === "y" ? 1 : 0, r.axis === "z" ? 1 : 0);
  const angle = THREE.MathUtils.degToRad(r.angle);
  const stretch = r.rescale ? 1 / Math.cos(angle) : 1;
  const rescale = new THREE.Vector3(r.axis === "x" ? 1 : stretch, r.axis === "y" ? 1 : stretch, r.axis === "z" ? 1 : stretch);
  return { origin: new THREE.Vector3(...(r.origin ?? [8, 8, 8])), turn: new THREE.Quaternion().setFromAxisAngle(axis, angle), rescale };
}
