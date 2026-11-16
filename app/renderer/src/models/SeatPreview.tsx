import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { blockCells, type Cell } from "../../../../src/elements/multiBlock.ts";
import { autoHeight, footprint, LIE_HALF, LIE_LIFT, resolvedSeats, round, seatBoxes, SIT_DROP, spreadSeats, storedSeats, surfaceAt, type Seat } from "../../../../src/elements/seats.ts";
import { FACES, type ModelElement, type ResolvedModel } from "../../../../src/resources/blockModel.ts";
import { mappedSlots } from "../../../../src/resources/modelTextures.ts";
import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { elementTexture } from "../model.ts";
import { t } from "../strings.ts";
import type { PreviewTexture } from "../textures/animatedTexture.ts";
import { buildModel, loadImages, loadProjectModel } from "./ModelPreview.tsx";

/**
 * Seat page preview of a block (Q225): the block's model (its custom JSON model, else its boxes with its texture), its
 * boxes outlined, and a sitting player figure on every seat, facing as the seat does, at the height the game seats it.
 * Seats are edited on the model as well as in the form: a click on a top surface adds a seat there, dragging a seat
 * moves it over the block's footprint (whole pixels unless Snap is off or Shift is held), dragging its arrow turns it
 * (15 degree steps; R turns by 90), Delete removes the selected seat. A lying seat shows a player lying on its back, head
 * along the arrow. The block is shown facing north, its front; a block spanning several cells (Q226) outlines each cell,
 * and on the Bounding boxes page the preview shows only the model and its cells.
 */

/** Pixels a pointer may move between press and release for a click (add a seat) rather than an orbit. */
const CLICK_SLOP = 4;
const TURN_STEP = 15;

interface Props {
  snapshot: ProjectSnapshot;
  draft: Element;
  onChange: (key: string, value: unknown) => void;
  /** Only the model, its boxes and its cells, without seats (the Bounding boxes page of a multi-block). */
  cellsOnly?: boolean;
}

/** The seats as stored, or the one middle seat a block without stored seats gets. */
const editable = (draft: Element): Seat[] => (storedSeats(draft).length ? storedSeats(draft) : spreadSeats(draft, 1));
const yawOf = (degrees: number) => round(((degrees % 360) + 360) % 360);

export function SeatPreview({ snapshot, draft, onChange, cellsOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<SeatStage>(undefined);
  const [selected, setSelected] = useState(-1);
  const [snap, setSnap] = useState(true);
  const [count, setCount] = useState(2);
  const [error, setError] = useState<string>();
  const [rev, setRev] = useState(0);
  const seats = cellsOnly ? [] : resolvedSeats(draft);

  // Editing goes through the latest draft, so a drag of many moves never writes from an old one.
  const latest = useRef({ draft, onChange, snap });
  latest.current = { draft, onChange, snap };
  const edits = useMemo(() => {
    const write = (list: Seat[]) => latest.current.onChange("seats", list.map((s) => ({ x: round(s.x), y: round(s.y), z: round(s.z), yaw: round(s.yaw), pose: s.pose })));
    const placed = (d: Element, x: number, z: number, y: number, free: boolean): Seat => {
      const { minX, maxX, minZ, maxZ } = footprint(d);
      const step = (v: number) => (latest.current.snap && !free ? Math.round(v) : round(v));
      const sx = Math.min(maxX, Math.max(minX, step(x))), sz = Math.min(maxZ, Math.max(minZ, step(z)));
      return { x: sx, y: autoHeight(d) ? surfaceAt(d, sx, sz) : y, z: sz, yaw: 0, pose: "sit" };
    };
    return {
      add(x: number, y: number, z: number, free: boolean) {
        const d = latest.current.draft;
        const list = editable(d);
        write([...list, placed(d, x, z, latest.current.snap && !free ? Math.round(y) : y, free)]);
        setSelected(list.length);
      },
      move(index: number, x: number, z: number, free: boolean) {
        const d = latest.current.draft;
        const list = editable(d);
        if (!list[index]) return;
        list[index] = { ...placed(d, x, z, list[index].y, free), yaw: list[index].yaw, pose: list[index].pose };
        write(list);
      },
      turn(index: number, yaw: number, free: boolean) {
        const list = editable(latest.current.draft);
        if (!list[index]) return;
        list[index] = { ...list[index], yaw: yawOf(free ? yaw : Math.round(yaw / TURN_STEP) * TURN_STEP) };
        write(list);
      },
      remove(index: number) {
        const list = editable(latest.current.draft);
        if (!list[index] || list.length < 2) return;
        write(list.filter((_, i) => i !== index));
        setSelected(-1);
      },
      spread(n: number) {
        write(spreadSeats(latest.current.draft, n));
        setSelected(-1);
      },
    };
  }, []);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    stage.current = createStage(node, cellsOnly, {
      select: setSelected,
      add: (x, y, z, free) => edits.add(x, y, z, free),
      move: (i, x, z, free) => edits.move(i, x, z, free),
      turn: (i, yaw, free) => edits.turn(i, yaw, free),
    });
    return () => (stage.current?.dispose(), (stage.current = undefined));
  }, [edits, cellsOnly]);

  // Reload when a model or texture changes on disk.
  useEffect(() => api.onFsChange((change) => {
    if (change.dir === snapshot.dir && change.paths.some((p) => p.startsWith("models/") || p.startsWith("textures/"))) setRev((n) => n + 1);
  }), [snapshot.dir]);

  // The block: its custom JSON model with its slot textures, else its boxes with its textures.
  const modelName = Number(draft.renderType) === 2 && typeof draft.customModelName === "string" && snapshot.models.includes(`models/${draft.customModelName}.json`) ? draft.customModelName : "";
  const overridesKey = JSON.stringify(Object.fromEntries(mappedSlots(draft.customModelTextures)));
  const boxesKey = JSON.stringify(seatBoxes(draft));
  const main = elementTexture(snapshot, "block", draft);
  const top = typeof draft.textureTop === "string" && draft.textureTop ? draft.textureTop : main;
  useEffect(() => {
    let alive = true;
    setError(undefined);
    void (async () => {
      try {
        const loaded = modelName
          ? await loadProjectModel(snapshot.dir, snapshot.project.mod.id, modelName, snapshot.textures, JSON.parse(overridesKey) as Record<string, string>)
          : await boxModel(snapshot, JSON.parse(boxesKey) as ReturnType<typeof seatBoxes>, main, top);
        if (alive) stage.current?.showModel(loaded.model, loaded.images);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => void (alive = false);
  }, [snapshot.dir, snapshot.project.mod.id, snapshot.textures, modelName, overridesKey, boxesKey, main, top, rev]);

  const seatsKey = JSON.stringify(seats);
  const cellsKey = JSON.stringify(blockCells(draft));
  useEffect(() => stage.current?.showBoxes(JSON.parse(boxesKey) as ReturnType<typeof seatBoxes>, JSON.parse(cellsKey) as Cell[]), [boxesKey, cellsKey]);
  useEffect(() => stage.current?.showSeats(JSON.parse(seatsKey) as Seat[], selected), [seatsKey, selected]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (selected < 0 || !seats[selected]) return;
    if (e.key === "r" || e.key === "R") edits.turn(selected, seats[selected].yaw + (e.shiftKey ? -90 : 90), true);
    else if (e.key === "Delete" || e.key === "Backspace") edits.remove(selected);
    else if (e.key === "Escape") setSelected(-1);
    else return;
    e.preventDefault();
  };

  return (
    <aside className="formpreview seatpreview" aria-label={t("seat.preview")} style={{ display: "flex", flexBasis: 320 }}>
      <div className="pvtitle">{t("seat.preview")}</div>
      <div className="modelpreview">
        <div className="mpbar">
          <button type="button" className="abtn" title={t("model.resetView")} onClick={() => stage.current?.resetCamera()}>
            <Icon name="fit" size={14} />{t("model.resetView")}
          </button>
          <label className="check" title={t("seat.snapTip")}>
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />{t("seat.snap")}
          </label>
        </div>
        <div ref={host} className="mpcanvas seatcanvas" tabIndex={0} style={{ height: 300 }} aria-label={t("seat.preview")} onKeyDown={onKeyDown}
          data-seats={seatsKey} data-selected={selected} data-cells={cellsKey} />
        {!cellsOnly && <div className="mpbar">
          <input type="number" min={1} max={8} value={count} aria-label={t("seat.count")} title={t("seat.count")} style={{ width: 56 }}
            onChange={(e) => setCount(Math.max(1, Math.min(8, Math.round(Number(e.target.value)) || 1)))} />
          <button type="button" className="abtn seatspread" title={t("seat.spreadTip")} onClick={() => edits.spread(count)}>{t("seat.spread")}</button>
        </div>}
      </div>
      {error && <p className="ferr">{error}</p>}
      {cellsOnly ? <p className="fhelp">{t("seat.cells", { count: JSON.parse(cellsKey).length })}</p> : <>
      <ol className="seatlist" style={{ margin: 0, paddingLeft: 18 }}>
        {seats.map((s, i) => (
          <li key={i} className={i === selected ? "selected" : undefined} style={{ fontWeight: i === selected ? 600 : undefined, cursor: "pointer" }} onClick={() => setSelected(i)}>
            {t(s.pose === "lie" ? "seat.rowLie" : "seat.row", { x: round(s.x), z: round(s.z), height: round(s.y / 16), yaw: round(s.yaw) })}
          </li>
        ))}
      </ol>
      <p className="fhelp">{t("seat.hint")}</p></>}
    </aside>
  );
}

/** A model of the block's boxes with its textures (top faces with the top texture), for blocks without a JSON model. */
async function boxModel(snapshot: ProjectSnapshot, boxes: ReturnType<typeof seatBoxes>, main: string, top: string): Promise<{ model: ResolvedModel; images: Map<string, PreviewTexture> }> {
  const elements: ModelElement[] = boxes.map((b) => ({
    from: [b.mx, b.my, b.mz], to: [b.Mx, b.My, b.Mz],
    faces: Object.fromEntries(FACES.map((face) => [face, { texture: face === "up" ? "#top" : "#all" }])),
  }));
  const model: ResolvedModel = { textures: { all: main, top }, elements, display: {}, chain: [] };
  return { model, images: await loadImages(snapshot.dir, snapshot.project.mod.id, model, snapshot.textures) };
}

interface StageEvents {
  select(index: number): void;
  add(x: number, y: number, z: number, free: boolean): void;
  move(index: number, x: number, z: number, free: boolean): void;
  turn(index: number, yaw: number, free: boolean): void;
}

interface SeatStage {
  showModel(model: ResolvedModel, images: Map<string, PreviewTexture>): void;
  showBoxes(boxes: ReturnType<typeof seatBoxes>, cells: Cell[]): void;
  showSeats(seats: Seat[], selected: number): void;
  resetCamera(): void;
  dispose(): void;
}

/** Minecraft-like face shading of a box (BoxGeometry face order: +x, -x, +y, -y, +z, -z). */
const BOX_SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];

function shadedBox(w: number, h: number, d: number, color: number, opacity = 1): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const colors: number[] = [];
  for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) colors.push(BOX_SHADE[face], BOX_SHADE[face], BOX_SHADE[face]);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: opacity < 1, opacity }));
}

/**
 * A sitting player in model pixels, its origin on the seat surface, facing -z (north): the game puts its feet SIT_DROP
 * below the surface, its hips 12 pixels above the feet with the legs forward, as the riding pose draws them.
 */
function sittingFigure(opacity: number): THREE.Group {
  const SKIN = 0xd8a47f, SHIRT = 0x2fa3a8, PANTS = 0x3b46a8;
  const figure = new THREE.Group();
  const hips = 12 - SIT_DROP * 16;
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
    const mesh = shadedBox(w, h, d, color, opacity);
    mesh.position.set(x, y, z);
    figure.add(mesh);
    return mesh;
  };
  part(8, 12, 4, SHIRT, 0, hips + 6, 0);
  part(8, 8, 8, SKIN, 0, hips + 16, 0);
  for (const side of [-1, 1]) {
    part(4, 4, 12, PANTS, side * 2, hips, -4);
    // Arms hang from the shoulders, swung forward as in the riding pose.
    const arm = new THREE.Group();
    arm.position.set(side * 6, hips + 10, 0);
    arm.rotation.x = 0.63;
    const mesh = shadedBox(4, 12, 4, SKIN, opacity);
    mesh.position.y = -4;
    arm.add(mesh);
    figure.add(arm);
  }
  return figure;
}

/**
 * A player lying on its back in model pixels, head towards -z, the middle of the lying spot at the origin on the surface:
 * the game puts the feet LIE_HALF behind the point and the body's middle LIE_LIFT above the surface.
 */
function lyingFigure(opacity: number): THREE.Group {
  const SKIN = 0xd8a47f, SHIRT = 0x2fa3a8, PANTS = 0x3b46a8;
  const figure = new THREE.Group();
  const lift = LIE_LIFT * 16, feet = LIE_HALF * 16;
  const part = (w: number, h: number, d: number, color: number, x: number, z: number) => {
    const mesh = shadedBox(w, h, d, color, opacity);
    mesh.position.set(x, lift, z);
    figure.add(mesh);
  };
  for (const side of [-1, 1]) part(4, 4, 12, PANTS, side * 2, feet - 6);
  part(8, 4, 12, SHIRT, 0, feet - 18);
  for (const side of [-1, 1]) part(4, 4, 12, SKIN, side * 6, feet - 18);
  part(8, 8, 8, SKIN, 0, feet - 28);
  return figure;
}

function createStage(node: HTMLDivElement, cellsOnly: boolean, events: StageEvents): SeatStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  node.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 12;
  controls.maxDistance = 160;
  // The block's cells: one for a plain block, every cell of a block spanning several.
  const bounds = new THREE.Group();
  scene.add(bounds);
  // The block's front (north) is marked by an arrow on the ground in front of it.
  const front = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 3), new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 0.6 }));
  front.rotation.x = -Math.PI / 2;
  front.position.set(0, -8, -12);
  scene.add(front);
  const model = new THREE.Group();
  const boxes = new THREE.Group();
  const seats = new THREE.Group();
  scene.add(model, boxes, seats);
  let modelParts: { dispose(): void }[] = [];
  let shown: Seat[] = [];

  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);
  /** What the camera frames: the middle of the block's cells and how far they reach (pixels). */
  let frame = { x: 0, y: 8, z: 0, size: 16 };
  const resetCamera = () => {
    // From the front-left and above, far enough to see the sitting figures whole.
    const scale = frame.size / 16;
    camera.position.set(frame.x - 50 * scale, frame.y + 38 * scale, frame.z - 62 * scale);
    controls.target.set(frame.x, frame.y, frame.z);
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

  const disposeTree = (group: THREE.Object3D) => group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach((m) => m.dispose());
  });

  // Pointer: a seat's arrow tip turns it, the seat or its figure moves it, a click on a top surface adds one.
  const raycaster = new THREE.Raycaster();
  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const onPlane = (e: PointerEvent, y: number) => {
    raycaster.setFromCamera(ndc(e), camera);
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()) ?? undefined;
  };
  /** What a pointer at client x/y grabs: a seat's arrow tip, its marker, its figure (in that order), else a top surface. */
  const hitAt = (at: { clientX: number; clientY: number }) => {
    raycaster.setFromCamera(ndc(at), camera);
    const hits = raycaster.intersectObjects(seats.children, true).filter((h) => h.object.userData.part);
    const seatHit = hits.find((h) => h.object.userData.part === "handle") ?? hits.find((h) => h.object.userData.part === "marker") ?? hits[0];
    if (seatHit) {
      let o: THREE.Object3D | null = seatHit.object;
      while (o && o.userData.seat === undefined) o = o.parent;
      return { part: seatHit.object.userData.part as string, index: Number(o?.userData.seat) };
    }
    const hit = raycaster.intersectObjects(model.children, true)[0];
    const flat = hit?.face && Math.abs(hit.face.normal.y) > 0.7 && raycaster.ray.direction.y < 0;
    return { part: flat ? "surface" : hit ? "model" : "none", point: flat ? hit.point.clone() : undefined };
  };
  let drag: { mode: "move" | "turn"; index: number } | undefined;
  let press: { x: number; y: number; point?: THREE.Vector3 } | undefined;
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || cellsOnly) return;
    const hit = hitAt(e);
    if (hit.index !== undefined) {
      drag = { mode: hit.part === "handle" ? "turn" : "move", index: hit.index };
      // OrbitControls listens on the canvas; this capture listener on its parent runs first.
      controls.enabled = false;
      events.select(hit.index);
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    press = { x: e.clientX, y: e.clientY, point: hit.point };
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const seat = shown[drag.index];
    if (!seat) return;
    const at = onPlane(e, seat.y - 8);
    if (!at) return;
    if (drag.mode === "move") events.move(drag.index, at.x + 8, at.z + 8, e.shiftKey);
    else {
      const dx = at.x + 8 - seat.x, dz = at.z + 8 - seat.z;
      if (Math.hypot(dx, dz) > 0.5) events.turn(drag.index, (Math.atan2(dx, -dz) * 180) / Math.PI, e.shiftKey);
    }
  };
  const up = (e: PointerEvent) => {
    if (drag) {
      drag = undefined;
      controls.enabled = true;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_SLOP) {
      if (press.point) events.add(press.point.x + 8, press.point.y + 8, press.point.z + 8, e.shiftKey);
      else events.select(-1);
    }
    press = undefined;
  };
  node.addEventListener("pointerdown", down, true);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);

  // Lets UI tests find a model point on screen: client coordinates of block pixel x, y, z.
  (node as HTMLDivElement & { seatStage?: unknown }).seatStage = {
    /** What a press at client x/y would grab ("handle", "marker", "figure", "surface", "model", "none"). */
    pick: (clientX: number, clientY: number) => hitAt({ clientX, clientY }).part,
    project(x: number, y: number, z: number) {
      const v = new THREE.Vector3(x - 8, y - 8, z - 8).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };

  return {
    showModel(next, images) {
      model.clear();
      modelParts.forEach((d) => d.dispose());
      const built = buildModel(next, images);
      model.add(built.group);
      modelParts = built.disposables;
      render();
    },
    showBoxes(list, cells) {
      disposeTree(bounds);
      bounds.clear();
      for (const [cx, cy, cz] of cells) {
        const cell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 16, 16)),
          new THREE.LineBasicMaterial({ color: cells.length > 1 ? 0x4f9fe8 : 0x8a8f98, transparent: true, opacity: cells.length > 1 ? 0.6 : 0.35 }));
        cell.position.set(cx * 16, cy * 16, cz * 16);
        bounds.add(cell);
      }
      const span = (axis: 0 | 1 | 2) => [Math.min(...cells.map((c) => c[axis])) * 16 - 8, Math.max(...cells.map((c) => c[axis])) * 16 + 8];
      const [x, y, z] = ([0, 1, 2] as const).map(span);
      const next = { x: (x[0] + x[1]) / 2, y: (y[0] + y[1]) / 2 + 8, z: (z[0] + z[1]) / 2, size: Math.max(16, x[1] - x[0], y[1] - y[0], z[1] - z[0]) };
      // A new reach of cells frames the camera again; editing boxes inside the same cells leaves the view alone.
      if (JSON.stringify(next) !== JSON.stringify(frame)) {
        frame = next;
        resetCamera();
      }
      disposeTree(boxes);
      boxes.clear();
      // The boxes the automatic sit height reads, outlined.
      for (const b of list) {
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.Mx - b.mx, b.My - b.my, b.Mz - b.mz)),
          new THREE.LineBasicMaterial({ color: 0x5fbf7f, transparent: true, opacity: 0.7 }));
        box.position.set((b.mx + b.Mx) / 2 - 8, (b.my + b.My) / 2 - 8, (b.mz + b.Mz) / 2 - 8);
        boxes.add(box);
      }
      render();
    },
    showSeats(list, selected) {
      shown = list;
      node.dataset.figures = String(list.length);
      node.dataset.lying = String(list.filter((seat) => seat.pose === "lie").length);
      disposeTree(seats);
      seats.clear();
      list.forEach((s, i) => {
        const chosen = i === selected;
        const seat = new THREE.Group();
        seat.userData.seat = i;
        seat.position.set(s.x - 8, s.y - 8, s.z - 8);
        const turned = new THREE.Group();
        turned.rotation.y = (-s.yaw * Math.PI) / 180;
        seat.add(turned);
        const figure = s.pose === "lie" ? lyingFigure(chosen ? 1 : 0.8) : sittingFigure(chosen ? 1 : 0.8);
        figure.traverse((o) => (o.userData.part = "figure"));
        turned.add(figure);
        // Marker, arrow and its tip drawn over everything, so they stay grabbable under the figure.
        const color = chosen ? 0xf0a020 : 0xffffff;
        const over = (mesh: THREE.Mesh, part: string) => {
          // Transparent objects draw after opaque ones; as one, the marker can draw after the see-through figures.
          Object.assign(mesh.material as THREE.Material, { depthTest: false, transparent: true });
          mesh.renderOrder = 10;
          mesh.userData.part = part;
          turned.add(mesh);
          return mesh;
        };
        const marker = over(new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })), "marker");
        marker.rotation.x = -Math.PI / 2;
        marker.position.y = 0.05;
        const shaft = over(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 6), new THREE.MeshBasicMaterial({ color })), "marker");
        shaft.position.set(0, 0.1, -3);
        const tip = over(new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 12), new THREE.MeshBasicMaterial({ color })), "handle");
        tip.rotation.x = -Math.PI / 2;
        tip.position.set(0, 0.1, -7);
        seats.add(seat);
      });
      render();
    },
    resetCamera,
    dispose() {
      observer.disconnect();
      node.removeEventListener("pointerdown", down, true);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      controls.dispose();
      modelParts.forEach((d) => d.dispose());
      disposeTree(seats);
      disposeTree(boxes);
      disposeTree(bounds);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
