import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FACES, type FaceName, type ResolvedModel } from "../../../../src/resources/blockModel.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { drawFrame, onAnimationTick } from "../textures/animatedTexture.ts";
import { t, type StringKey } from "../strings.ts";
import { buildModel, loadImages } from "./ModelPreview.tsx";

/**
 * Whose texture each face of a block draws, as the generator builds the block's model (src/generator/types/block.ts):
 * a normal cube draws each face with its own field (an empty one falls back to the main texture, the bottom); stairs,
 * slabs and the grass block a bottom, a top and the front texture on every side; a pane its top texture on the edges;
 * every other shape (single texture, cross, crop, potted plant, fence, wall ...) the main texture everywhere. A door
 * is shown as its bottom half with its top texture on top.
 */
export function faceSources(base: string, render: number): Record<FaceName, FaceName> {
  const pick = (up: FaceName, side: FaceName): Record<FaceName, FaceName> =>
    ({ down: "down", up, north: side, south: side, east: side, west: side });
  if (base === "Stairs" || base === "Slab" || (base === "" && render === 14)) return pick("up", "north");
  if (base === "Pane") return { ...pick("up", "down"), down: "up" };
  if (base === "Door") return pick("up", "down");
  if (base !== "" || [11, 110, 12, 120, 13, 15, 150].includes(render)) return pick("down", "down");
  return { down: "down", up: "up", north: "north", south: "south", east: "east", west: "west" };
}

/** Face centre and outward normal of the 16 px cube centred on the origin. */
const NORMALS: Record<FaceName, [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

/**
 * A block as a 3D cube whose faces are drawn with their textures and named on top (KUYRUK 187). Drag turns it; a click
 * on a face calls onPick with that face. `textures` maps a face to the project texture drawn on it (empty: missing).
 * `active` faces are outlined (the face under the mouse, or the faces of the focused field in the form).
 */
export function BlockFacesCube({ dir, files, textures, active, names, onPick, onHover }: {
  dir: string;
  /** Project textures (snapshot.textures); also re-read when this list changes. */
  files: string[];
  textures: Record<FaceName, string>;
  active: FaceName[];
  /** Second line under a face's name (the texture it draws). */
  names: Record<FaceName, string>;
  onPick: (face: FaceName) => void;
  onHover: (face: FaceName | undefined) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<FaceName, HTMLSpanElement | null>>>({});
  const stage = useRef<CubeStage>(undefined);
  const [rev, setRev] = useState(0);
  const handlers = useRef({ onPick, onHover });
  handlers.current = { onPick, onHover };
  const key = JSON.stringify(textures);

  useEffect(() => api.onFsChange((change) => {
    if (change.dir === dir && change.paths.some((p) => p.startsWith("textures/"))) setRev((n) => n + 1);
  }), [dir]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    stage.current = createCubeStage(node, labels.current, (face) => handlers.current.onPick(face), (face) => handlers.current.onHover(face));
    return () => (stage.current?.dispose(), (stage.current = undefined));
  }, []);

  useEffect(() => {
    let alive = true;
    const model = cubeModel(JSON.parse(key) as Record<FaceName, string>);
    void loadImages(dir, "", model, files).then((images) => alive && stage.current?.show(model, images));
    return () => void (alive = false);
  }, [dir, key, files, rev]);

  const activeKey = active.join(",");
  useEffect(() => stage.current?.highlight(activeKey ? (activeKey.split(",") as FaceName[]) : []), [activeKey]);

  return (
    <div className="cubeview">
      <div ref={host} className="cubecanvas" aria-hidden="true" />
      {FACES.map((face) => (
        <span key={face} ref={(el) => void (labels.current[face] = el)} className={`cubelabel${active.includes(face) ? " on" : ""}`} data-face={face}>
          <b>{t(`cubeFaces.${face}` as StringKey)}</b>
          <span>{names[face]}</span>
        </span>
      ))}
      <button type="button" className="mbtn cubereset" title={t("model.resetView")} aria-label={t("model.resetView")} onClick={() => stage.current?.resetCamera()}>
        <Icon name="fit" size={12} />
      </button>
    </div>
  );
}

/** One full-block element whose faces name the face's texture directly (a project texture path). */
function cubeModel(textures: Record<FaceName, string>): ResolvedModel {
  const faces = Object.fromEntries(FACES.map((f) => [f, { texture: `#${f}` }])) as ResolvedModel["elements"][number]["faces"];
  const named = Object.fromEntries(FACES.filter((f) => textures[f]).map((f) => [f, textures[f]]));
  return { textures: named, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }], display: {}, chain: [] };
}

interface CubeStage {
  show(model: ResolvedModel, images: Awaited<ReturnType<typeof loadImages>>): void;
  highlight(faces: FaceName[]): void;
  resetCamera(): void;
  dispose(): void;
}

/** The three.js scene of the cube; renders on demand (orbit, resize, new textures, hover). */
function createCubeStage(node: HTMLDivElement, labels: Partial<Record<FaceName, HTMLSpanElement | null>>,
  pick: (face: FaceName) => void, hover: (face: FaceName | undefined) => void): CubeStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  node.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  // The wheel keeps scrolling the form; the cube only turns.
  controls.enableZoom = false;
  controls.enablePan = false;
  const cube = new THREE.Group();
  scene.add(cube);
  // Outlines of the active faces, just outside the cube so they never fight with its faces.
  const outlines = new THREE.Group();
  scene.add(outlines);
  const outline = (face: FaceName) => {
    const [x, y, z] = NORMALS[face];
    const plane = new THREE.PlaneGeometry(16, 16);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(plane), new THREE.LineBasicMaterial({ color: 0xf0b232 }));
    const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0xf0b232, transparent: true, opacity: 0.18, depthWrite: false }));
    const group = new THREE.Group();
    group.add(edges, fill);
    group.lookAt(x, y, z);
    group.position.set(x * 8.05, y * 8.05, z * 8.05);
    return group;
  };
  let disposables: { dispose(): void }[] = [];
  let stopAnimation: (() => void) | undefined;
  let faceOf = new Map<THREE.Object3D, FaceName>();

  const placeLabels = () => {
    const { clientWidth: w, clientHeight: h } = node;
    for (const face of FACES) {
      const label = labels[face];
      if (!label) continue;
      const normal = new THREE.Vector3(...NORMALS[face]);
      const centre = normal.clone().multiplyScalar(8);
      // Only faces turned towards the camera carry their name, fading out as they turn away.
      const facing = normal.dot(camera.position.clone().sub(centre).normalize());
      const p = centre.project(camera);
      label.style.opacity = String(Math.max(0, Math.min(1, (facing - 0.15) * 3)));
      label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  };
  const render = () => (renderer.render(scene, camera), placeLabels());
  controls.addEventListener("change", render);
  const resetCamera = () => {
    // Front (north) on the left, right (west) on the right and the top, as the inventory shows a block.
    camera.position.set(-26, 22, -26);
    controls.target.set(0, 0, 0);
    controls.update();
    render();
  };
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = node;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(node);
  resetCamera();

  // A click (not a drag) picks the face under the pointer; moving over a face names it in the form.
  const ray = new THREE.Raycaster();
  const faceAt = (e: PointerEvent): FaceName | undefined => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(cube.children, true)[0];
    return hit ? faceOf.get(hit.object) : undefined;
  };
  let down: [number, number] | undefined;
  let hovered: FaceName | undefined;
  const onDown = (e: PointerEvent) => void (down = [e.clientX, e.clientY]);
  const onUp = (e: PointerEvent) => {
    const moved = down ? Math.hypot(e.clientX - down[0], e.clientY - down[1]) : Infinity;
    down = undefined;
    const face = moved < 4 ? faceAt(e) : undefined;
    if (face) pick(face);
  };
  const onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const face = faceAt(e);
    if (face !== hovered) (hovered = face, hover(face), (renderer.domElement.style.cursor = face ? "pointer" : "grab"));
  };
  const onLeave = () => hovered && ((hovered = undefined), hover(undefined));
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  return {
    show(model, images) {
      cube.clear();
      stopAnimation?.();
      stopAnimation = undefined;
      disposables.forEach((d) => d.dispose());
      const built = buildModel(model, images);
      // buildModel adds one mesh per face, in FACES order.
      faceOf = new Map(built.group.children.map((mesh, i) => [mesh, FACES[i]]));
      cube.add(built.group);
      disposables = built.disposables;
      if (built.animated.length) {
        stopAnimation = onAnimationTick((ms) => {
          let changed = false;
          for (const a of built.animated) {
            const frame = drawFrame(a.g, a.texture, ms);
            if (frame !== a.last) (a.last = frame, (a.map.needsUpdate = true), (changed = true));
          }
          if (changed) render();
        });
      }
      render();
    },
    highlight(faces) {
      outlines.children.forEach((g) => g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      }));
      outlines.clear();
      faces.forEach((f) => outlines.add(outline(f)));
      render();
    },
    resetCamera,
    dispose() {
      observer.disconnect();
      stopAnimation?.();
      controls.dispose();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
