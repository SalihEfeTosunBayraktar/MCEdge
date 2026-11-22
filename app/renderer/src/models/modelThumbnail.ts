import { useEffect, useState } from "react";
import * as THREE from "three";
import { resolveModel, type BlockModelJson, type ResolvedModel } from "../../../../src/resources/blockModel.ts";
import vanillaModels from "../../../../config/vanilla-block-models.json" with { type: "json" };
import { api } from "../api.ts";
import { usePerformance } from "../preferences.ts";
import { buildModel, loadImages } from "./ModelPreview.tsx";

/**
 * Element tile pictures of JSON models (KUYRUK 176): the model as the inventory shows it (its "gui" display, else a
 * block's), rendered once by one shared offscreen renderer into a small PNG and kept in memory, so a long element
 * list holds plain images, not a WebGL canvas per tile. A change under models/ or textures/ of the project drops its
 * pictures, and the tiles render them again.
 */

const SIZE = 96;
/** A block in the inventory: the vanilla block/block "gui" display. */
const BLOCK_GUI = { rotation: [30, 225, 0] as [number, number, number], translation: [0, 0, 0] as [number, number, number], scale: [0.625, 0.625, 0.625] as [number, number, number] };

const cache = new Map<string, string>();
const listeners = new Set<() => void>();
/** Renders run one at a time on the shared renderer. */
let queue: Promise<unknown> = Promise.resolve();
let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera } | undefined;
/** Projects whose file changes the tiles already listen to. */
const watched = new Set<string>();

function stage() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The inventory view: orthographic, from the front, a 16 x 16 slot with a small margin.
  const camera = new THREE.OrthographicCamera(-8.5, 8.5, 8.5, -8.5, 0.5, 400);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  shared = { renderer, scene: new THREE.Scene(), camera };
  return shared;
}

/** Drops a project's cached pictures, so its tiles render them again. */
export function invalidateThumbnails(dir: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${dir}|`)) cache.delete(key);
  listeners.forEach((l) => l());
}

/** Pictures rendered so far, for tests: window.mcedgeThumbnails.renders. */
const counter = { renders: 0 };
(globalThis as unknown as { mcedgeThumbnails: typeof counter }).mcedgeThumbnails = counter;

async function render(dir: string, modId: string, model: string, textures: string[], overrides: Record<string, string>): Promise<string> {
  const read = async (name: string): Promise<BlockModelJson | undefined> => {
    try {
      const file = await api.codeRead(dir, `models/${name}.json`);
      return file.binary ? undefined : (JSON.parse(file.text) as BlockModelJson);
    } catch {
      return undefined;
    }
  };
  const resolved: ResolvedModel = await resolveModel(model, modId, read, vanillaModels as unknown as Record<string, BlockModelJson>);
  const full = { ...resolved, textures: { ...resolved.textures, ...overrides } };
  if (!full.elements.length) return "";
  const images = await loadImages(dir, modId, full, textures);
  const { renderer, scene, camera } = stage();
  const built = buildModel(full, images);
  const display = new THREE.Group();
  const t = full.display?.gui ?? BLOCK_GUI;
  const [rx, ry, rz] = t.rotation ?? [0, 0, 0];
  display.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz), "XYZ");
  display.position.set(...(t.translation ?? [0, 0, 0]));
  display.scale.set(...(t.scale ?? [1, 1, 1]));
  display.add(built.group);
  scene.add(display);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(display);
  built.disposables.forEach((d) => d.dispose());
  counter.renders++;
  return url;
}

/**
 * The picture of a JSON model for a tile, or undefined while it renders (or when the model has no elements or
 * cannot be read): the tile shows its texture meanwhile.
 */
export function useModelThumbnail(dir: string, modId: string, model: string | undefined, textures: string[], overrides: Record<string, string> = {}): string | undefined {
  // Light mode with 3D off: no renderer, the tile keeps its texture (Q250).
  const key = model && usePerformance().render3d ? `${dir}|${model}|${JSON.stringify(overrides)}` : "";
  const [url, setUrl] = useState(key ? cache.get(key) : undefined);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const listener = () => setRev((n) => n + 1);
    listeners.add(listener);
    if (!watched.has(dir)) {
      watched.add(dir);
      api.onFsChange((change) => {
        if (change.dir === dir && change.paths.some((p) => p.startsWith("models/") || p.startsWith("textures/"))) invalidateThumbnails(dir);
      });
    }
    return () => void listeners.delete(listener);
  }, [dir]);
  useEffect(() => {
    if (!key || !model) return setUrl(undefined);
    const known = cache.get(key);
    if (known !== undefined) return setUrl(known || undefined);
    let live = true;
    const job = queue.then(() => (cache.has(key) ? cache.get(key)! : render(dir, modId, model, textures, overrides)))
      .catch(() => "");
    queue = job;
    void job.then((made) => {
      cache.set(key, made);
      if (live) setUrl(made || undefined);
    });
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rev]);
  return url;
}
