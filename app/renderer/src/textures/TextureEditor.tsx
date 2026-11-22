import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ActionButton, AlertDialog, FormRow, PanelEmpty, Separator, ShortcutsButton } from "../components/ui.tsx";
import { EditorShell, RailButton, RailSeparator, StatusItems, useFitOnResize, ZoomGroup, type DockSection } from "../dock/Dock.tsx";
import { invalidateTexture } from "../hooks/useTexture.ts";
import { beginSave } from "../saveStatus.ts";
import { t, type StringKey } from "../strings.ts";
import { dropDraft, persistDraft, putDraft, takeDraft } from "./drafts.ts";
import { TexturePreview } from "./TexturePreview.tsx";
import { SaveAsDialog } from "./NewTextureDialog.tsx";
import { flip, mirror, shape, type Point, type ShapeKind } from "../../../../src/textures/shapes.ts";
import { blend, joinFrames, mcmetaText, NEW_ANIMATION, parseMcmeta, scheduleOf, splitFrames, type Animation } from "./animation.ts";
import { frameAt, PLAYBACK_MODES, type PlaybackMode } from "../../../../src/resources/textureAnimation.ts";
import { blank, clone, decodePng, encodePng, floodFill, fromHex, getPixel, line, resize, setPixel, toHex, type Pixels, type Rgba } from "./pixels.ts";
import { useCtrlWheel } from "../hooks/useCtrlWheel.ts";
import { ANCHORS, clearRegion, clip, copyRegion, desaturate, pasteRegion, resizeCanvas, shiftHue, trimBox, type Anchor, type Rect } from "../../../../src/textures/edit.ts";

type Tool = "select" | "pencil" | "eraser" | "fill" | "picker" | ShapeKind;
/** Copied pixels, kept while the app runs, so a piece of one texture can be pasted into another. */
let clipboard: Pixels | undefined;
const asPixels = (image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): Pixels => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });
const SHAPES: ShapeKind[] = ["line", "rect", "ellipse", "polygon"];
const isShape = (tool: Tool): tool is ShapeKind => (SHAPES as string[]).includes(tool);

const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const SIZES = [16, 32, 64, 128];
const MAX_UNDO = 100;
const TRANSPARENT: Rgba = [0, 0, 0, 0];
/** Minecraft dye colours, then greys and a few material tones. */
const PALETTE = [
  "#f9fffe", "#f9801d", "#c74ebd", "#3ab3da", "#fed83d", "#80c71f", "#f38baa", "#474f52",
  "#9d9d97", "#169c9c", "#8932b8", "#3c44aa", "#835432", "#5e7c16", "#b02e26", "#1d1d21",
  "#000000", "#2b2b2b", "#555555", "#808080", "#aaaaaa", "#d4d4d4", "#ffffff", "#5a3a1e",
  "#7a5230", "#a77b4f", "#4a7a2a", "#2e5c8a", "#c23b22", "#e8b04a", "#6fd3e6", "#d84fd4",
];

interface Props {
  snapshot: ProjectSnapshot;
  /** Project-relative PNG path under textures/. */
  path: string;
  onSaved: (snapshot: ProjectSnapshot) => void;
  onClose: () => void;
}

/**
 * Pixel editor for one project texture: pencil, eraser, flood fill and colour picker with undo, zoom and a pixel
 * grid; a rectangle selection to move, copy, cut, paste and delete, canvas resize and colour adjustments (KUYRUK 133). Like MCreator's texture maker it writes only on Save (the same file) or Save as (another name or folder);
 * leaving asks, and strokes left behind by switching views stay as a draft for the next time the texture opens.
 */
export function TextureEditor({ snapshot, path, onSaved, onClose }: Props) {
  const pixels = useRef<Pixels>(undefined);
  const [, setTick] = useState(0);
  const redraw = () => setTick((n) => n + 1);
  const [tool, setTool] = useState<Tool>("pencil");
  const lastTool = useRef<Tool>("pencil");
  const [colour, setColour] = useState<Rgba>([178, 46, 38, 255]);
  const [recent, setRecent] = useState<string[]>([]);
  const [zoom, setZoom] = useState(16);
  /** The zoom follows the canvas area (a collapsed inspector, a bigger window) until the user zooms by hand; Fit goes back. */
  const [fitted, setFitted] = useState(true);
  const [grid, setGrid] = useState(true);
  const [hover, setHover] = useState<[number, number]>();
  /** The pixel cursor is driven by the keyboard (arrow keys); the screen reader hears where it is and what is there. */
  const keyboardCursor = useRef(false);
  const heldKey = useRef(false);
  const [said, setSaid] = useState("");
  /** Shapes are drawn filled instead of as an outline. */
  const [filled, setFilled] = useState(false);
  /** Mirrored drawing: every stroke, shape and fill is repeated across the vertical and/or horizontal centre line. */
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  /** A shape being dragged (line, rectangle, ellipse) or a polygon being clicked out, previewed on a copy of `before`. */
  const shapeDraft = useRef<{ kind: ShapeKind; before: Pixels; points: Point[]; colour: Rgba } | undefined>(undefined);
  const [error, setError] = useState<string>();
  // ---- selection: a rectangle of the current frame; dragging inside it moves its pixels ----
  const [selection, setSelectionState] = useState<Rect>();
  const selectionRef = useRef<Rect>(undefined);
  const setSelection = (r: Rect | undefined) => ((selectionRef.current = r && r.w > 0 && r.h > 0 ? r : undefined), setSelectionState(selectionRef.current));
  /** A selection being dragged out from a corner, or one being moved (its pixels lifted off `base`). */
  const selecting = useRef<{ start: Point } | undefined>(undefined);
  const moving = useRef<{ before: Pixels; base: Pixels; piece: Pixels; from: Rect; start: Point; moved: boolean } | undefined>(undefined);
  const [hasClipboard, setHasClipboard] = useState(!!clipboard);
  const [canvasW, setCanvasW] = useState(16);
  const [canvasH, setCanvasH] = useState(16);
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [hue, setHue] = useState(30);
  // ---- frames: a still texture is one frame; an animated one is a strip of frames plus its .mcmeta ----
  /** Every frame; the slot of the current frame may be stale, `pixels` holds the frame being drawn. */
  const framesRef = useRef<Pixels[]>([]);
  const [frame, setFrameState] = useState(0);
  const frameRef = useRef(0);
  const [anim, setAnimState] = useState<Animation>();
  const animRef = useRef<Animation>(undefined);
  const setAnim = (next: Animation | undefined) => ((animRef.current = next), setAnimState(next));
  /** Frames in the PNG on disk and whether its .mcmeta exists (a custom frame order stays only while the count does). */
  const onDisk = useRef({ frames: 1, mcmeta: false });
  /** The animation plays on the main canvas; the texture is read only meanwhile (KUYRUK 194). */
  const [play, setPlay] = useState(false);
  const allFrames = () => framesRef.current.map((f, i) => (i === frameRef.current && pixels.current ? pixels.current : f));
  const setDoc = (frames: Pixels[], index: number) => {
    framesRef.current = frames;
    frameRef.current = Math.min(index, frames.length - 1);
    setFrameState(frameRef.current);
    pixels.current = frames[frameRef.current];
  };
  const undo = useRef<{ frames: Pixels[]; index: number }[]>([]);
  const redo = useRef<{ frames: Pixels[]; index: number }[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ before: Pixels; changed: boolean; last: [number, number]; colour: Rgba } | undefined>(undefined);

  // ---- saving: only on Save or Save as, never on its own ----
  /** The PNG this editor writes; Save as switches it. */
  const [file, setFile] = useState(path);
  const fileRef = useRef(path);
  fileRef.current = file;
  /** Not on disk yet (a new texture): Save creates it and refuses to replace a file that appeared meanwhile. */
  const isNew = useRef(false);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (value: boolean) => ((dirtyRef.current = value), setDirtyState(value));
  const live = useRef({ snapshot, onSaved });
  live.current = { snapshot, onSaved };
  /** The PNG changed on disk while this editor had unsaved strokes; the user keeps theirs or reloads. */
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  conflictRef.current = conflict;
  /** The last outside change was loaded, or unsaved strokes were restored (shown briefly in the header). */
  const [reloadedAt, setReloadedAt] = useState<number>();
  const [restored, setRestored] = useState(false);
  const [dialog, setDialog] = useState<"saveAs" | "close">();
  const [savedAt, setSavedAt] = useState<number>();
  const write = async (target: string) => {
    if (!pixels.current) return;
    const end = beginSave();
    try {
      const dir = live.current.snapshot.dir, frames = allFrames(), animation = animRef.current;
      const image = animation ? joinFrames(frames) : frames[0];
      const next = await api.writeTexture(dir, target, await encodePng(image));
      // The animation lives in "<png>.mcmeta"; a texture made still loses it.
      const sameFile = target === fileRef.current;
      if (animation) await api.codeWrite(dir, `${target}.mcmeta`, mcmetaText(animation, frames.length, sameFile ? onDisk.current.frames : frames.length));
      else if (sameFile && onDisk.current.mcmeta) await api.codeDelete(dir, `${target}.mcmeta`);
      onDisk.current = { frames: frames.length, mcmeta: !!animation };
      invalidateTexture(next.dir, target);
      live.current.onSaved(next);
      dropDraft(dir, path);
      if (target !== path) dropDraft(dir, target);
      isNew.current = false;
      conflictRef.current = false;
      setConflict(false);
      setRestored(false);
      setDirty(false);
      setFile(target);
      fileRef.current = target;
      setSavedAt(Date.now());
    } finally {
      end();
    }
  };
  /** Save: the file being edited; a new texture whose name got taken meanwhile asks for another name. */
  const save = async () => {
    if (isNew.current && live.current.snapshot.textures.includes(fileRef.current)) return setDialog("saveAs");
    await write(fileRef.current);
  };
  const changed = () => {
    setDirty(true);
    redraw();
  };

  // ---- outside changes (an AI agent over MCP, another program) ----
  /** Loads the PNG from disk; the replaced pixels stay one undo step away. */
  const reloadFromDisk = async () => {
    const loaded = await loadFromDisk(live.current.snapshot.dir, fileRef.current);
    if (pixels.current) pushUndo(clone(pixels.current));
    showDoc(loaded);
    setDirty(false);
    conflictRef.current = false;
    setConflict(false);
    setRestored(false);
    setReloadedAt(Date.now());
    redraw();
  };
  const keepMine = () => void write(fileRef.current);
  useEffect(() => api.onFsChange((change) => {
    if (change.dir !== live.current.snapshot.dir || !change.paths.includes(fileRef.current) || isNew.current) return;
    if (dirtyRef.current || stroke.current) setConflict(true);
    else void reloadFromDisk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => {
    if (!reloadedAt && !savedAt) return;
    const t = setTimeout(() => (setReloadedAt(undefined), setSavedAt(undefined)), 4000);
    return () => clearTimeout(t);
  }, [reloadedAt, savedAt]);
  // Leaving with unsaved strokes (another view, another texture) keeps them as a draft instead of writing the PNG.
  useEffect(() => () => {
    if (!dirtyRef.current || !pixels.current) return;
    const frames = allFrames();
    putDraft(live.current.snapshot.dir, fileRef.current, {
      pixels: animRef.current ? joinFrames(frames) : frames[0], isNew: isNew.current, animation: animRef.current, framesOnDisk: onDisk.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // While strokes are unsaved a copy goes to the user data folder now and then, so closing the app does not lose them.
  useEffect(() => {
    if (!dirty) return;
    const timer = setInterval(() => {
      if (!dirtyRef.current || !pixels.current) return;
      const frames = allFrames();
      persistDraft(live.current.snapshot.dir, fileRef.current, {
        pixels: animRef.current ? joinFrames(frames) : frames[0], isNew: isNew.current, animation: animRef.current, framesOnDisk: onDisk.current,
      });
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  const close = () => (dirtyRef.current ? setDialog("close") : onClose());
  const closeAnyway = () => (setDirty(false), dropDraft(live.current.snapshot.dir, fileRef.current), onClose());

  // ---- loading ----
  /** Shows a loaded texture: its frames (one for a still texture) and animation. */
  function showDoc(doc: { image: Pixels; animation?: Animation }) {
    setAnim(doc.animation);
    setDoc(doc.animation ? splitFrames(doc.image) : [doc.image], frameRef.current);
    redraw();
  }
  useEffect(() => {
    let alive = true;
    const show = (doc: { image: Pixels; animation?: Animation }) => {
      showDoc(doc);
      const loaded = pixels.current!;
      const box = area.current?.getBoundingClientRect();
      const fit = box ? Math.min((box.width - 48) / loaded.width, (box.height - 48) / loaded.height) : 16;
      setZoom(ZOOMS.filter((z) => z <= fit).at(-1) ?? 1);
    };
    const draft = takeDraft(snapshot.dir, path);
    if (draft) {
      isNew.current = draft.isNew;
      if (draft.framesOnDisk) onDisk.current = draft.framesOnDisk;
      setDirty(true);
      setRestored(!draft.isNew);
      show({ image: draft.pixels, animation: draft.animation });
    } else {
      loadFromDisk(snapshot.dir, path).then((doc) => {
        if (!alive) return;
        onDisk.current = { frames: doc.animation ? splitFrames(doc.image).length : 1, mcmeta: doc.hasMcmeta };
        show(doc);
      }, (e) => alive && setError(String(e)));
    }
    return () => void (alive = false);
    // The file is read once per editor; later changes come from this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ---- drawing ----
  const p = pixels.current;
  const playing = play && !!anim && !!p;
  // The canvas size fields start at the texture's size.
  useEffect(() => {
    if (p) (setCanvasW(p.width), setCanvasH(p.height));
  }, [p?.width, p?.height]);
  /** Draws an image on the main canvas at the zoom, with the grid; the editing marks only while editing. */
  const drawCanvas = (img: Pixels, editing: boolean) => {
    const c = canvas.current;
    if (!c) return;
    c.width = img.width * zoom;
    c.height = img.height * zoom;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const bitmap = document.createElement("canvas");
    bitmap.width = img.width;
    bitmap.height = img.height;
    bitmap.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    if (grid && zoom >= 4) {
      g.fillStyle = "rgba(0, 0, 0, .28)";
      for (let x = 1; x < img.width; x++) g.fillRect(x * zoom, 0, 1, c.height);
      for (let y = 1; y < img.height; y++) g.fillRect(0, y * zoom, c.width, 1);
      g.fillStyle = "rgba(255, 255, 255, .22)";
      for (let x = 16; x < img.width; x += 16) g.fillRect(x * zoom - 1, 0, 1, c.height);
      for (let y = 16; y < img.height; y += 16) g.fillRect(0, y * zoom - 1, c.width, 1);
    }
    if (!editing) return;
    // Mirror lines of mirrored drawing.
    g.fillStyle = "rgba(95, 184, 240, .85)";
    if (mirrorX) g.fillRect(Math.round((img.width / 2) * zoom) - 1, 0, 2, c.height);
    if (mirrorY) g.fillRect(0, Math.round((img.height / 2) * zoom) - 1, c.width, 2);
    const sel = selectionRef.current;
    if (sel) {
      // Marching ants: a dark and a light dash, so the selection shows on any colour.
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeStyle = "#000";
      g.strokeRect(sel.x * zoom + 1, sel.y * zoom + 1, sel.w * zoom - 2, sel.h * zoom - 2);
      g.lineDashOffset = 5;
      g.strokeStyle = "#fff";
      g.strokeRect(sel.x * zoom + 1, sel.y * zoom + 1, sel.w * zoom - 2, sel.h * zoom - 2);
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    if (hover && (tool !== "select" || keyboardCursor.current)) {
      g.strokeStyle = "#f2a53a";
      g.lineWidth = 2;
      g.strokeRect(hover[0] * zoom + 1, hover[1] * zoom + 1, zoom - 2, zoom - 2);
    }
  };
  useLayoutEffect(() => {
    const img = pixels.current;
    if (!img) return;
    // While playing, the playback loop below draws the canvas.
    if (!playing) drawCanvas(img, true);
    const pv = preview.current;
    if (pv) {
      pv.width = img.width;
      pv.height = img.height;
      pv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    }
  });
  // Playback on the main canvas as the game plays it (the shared model: frame time, a tick is 50 ms, frame order and
  // playback mode, Q229), blending into the next frame with interpolate on; it starts again when the animation settings
  // change, so a once mode shows its end. After Stop the next render draws the frame being edited again. A layout
  // effect, so Stop cancels the loop before that draw.
  useLayoutEffect(() => {
    if (!playing || !anim) return;
    let raf = 0, start: number | undefined;
    const tick = (now: number) => {
      // Timed from the first frame: a frame's timestamp can be earlier than performance.now() when the loop started.
      start ??= now;
      const frames = allFrames();
      const schedule = scheduleOf(anim, frames.length, frames[0].width, frames[0].height);
      if (schedule) {
        const at = frameAt(schedule, now - start);
        drawCanvas(at.blend > 0 ? blend(frames[at.index], frames[at.next], at.blend) : frames[at.index], false);
        canvas.current?.setAttribute("data-frame", String(at.index));
      } else drawCanvas(frames[0], false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // drawCanvas reads the zoom and grid of its render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, anim, zoom, grid]);
  const togglePlay = () => (cancelShape(), setPlay(!playing));

  // ---- editing ----
  /** Every frame as it is now, copied, for undo and redo. */
  const docCopy = () => ({ frames: allFrames().map(clone), index: frameRef.current });
  /** Remembers the document before a change; `before` is the current frame as it was (the other frames are unchanged). */
  const pushUndo = (before: Pixels) => {
    const entry = { frames: allFrames().map((f, i) => (i === frameRef.current ? before : clone(f))), index: frameRef.current };
    undo.current = [...undo.current.slice(-(MAX_UNDO - 1)), entry];
    redo.current = [];
  };
  const doUndo = () => {
    if (shapeDraft.current) return cancelShape();
    const prev = undo.current.pop();
    if (!prev || !pixels.current) return;
    redo.current.push(docCopy());
    setDoc(prev.frames, prev.index);
    changed();
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next || !pixels.current) return;
    undo.current.push(docCopy());
    setDoc(next.frames, next.index);
    changed();
  };
  // ---- animation frames ----
  const showFrame = (index: number) => {
    cancelShape();
    setDoc(allFrames(), index);
    redraw();
  };
  /** Changes the frame list (add, duplicate, delete, move) as one undo step. */
  const editFrames = (edit: (frames: Pixels[], index: number) => { frames: Pixels[]; index: number }) => {
    if (!pixels.current) return;
    cancelShape();
    pushUndo(clone(pixels.current));
    const next = edit(allFrames(), frameRef.current);
    setDoc(next.frames, next.index);
    changed();
  };
  const addFrame = (copy: boolean) => editFrames((frames, i) => ({
    frames: [...frames.slice(0, i + 1), copy ? clone(frames[i]) : blank(frames[i].width, frames[i].height), ...frames.slice(i + 1)], index: i + 1,
  }));
  const deleteFrame = () => editFrames((frames, i) => ({ frames: frames.filter((_, j) => j !== i), index: Math.max(0, i - 1) }));
  const moveFrame = (step: number) => editFrames((frames, i) => {
    const j = i + step;
    if (j < 0 || j >= frames.length) return { frames, index: i };
    const next = [...frames];
    [next[i], next[j]] = [next[j], next[i]];
    return { frames: next, index: j };
  });
  const makeAnimated = () => (setAnim({ ...NEW_ANIMATION }), addFrame(true));
  /** Back to a still texture: the current frame stays, the .mcmeta goes on the next save. */
  const makeStill = () => {
    editFrames((frames, i) => ({ frames: [frames[i]], index: 0 }));
    setAnim(undefined);
    setPlay(false);
  };
  const setAnimation = (patch: Partial<Animation>) => {
    if (!animRef.current) return;
    setAnim({ ...animRef.current, ...patch });
    changed();
  };
  const remember = (c: Rgba) => {
    if (c[3] === 0) return;
    const hex = toHex(c);
    setRecent((list) => [hex, ...list.filter((h) => h !== hex)].slice(0, 8));
  };
  const pickTool = (next: Tool) => {
    cancelShape();
    if (next !== "select") setSelection(undefined);
    if (next !== "picker") lastTool.current = next;
    setTool(next);
  };
  /** Paints points (and their mirror images when mirrored drawing is on); returns whether a pixel changed. */
  const paint = (img: Pixels, points: Point[], c: Rgba) => {
    let any = false;
    for (const [x, y] of mirror(points, img.width, img.height, { x: mirrorX, y: mirrorY })) any = setPixel(img, x, y, c) || any;
    return any;
  };
  /** Redraws the shape draft from its `before` copy, optionally with a rubber-band point (the hovered cell). */
  const previewShape = (extra?: Point) => {
    const s = shapeDraft.current;
    if (!s) return false;
    const img = clone(s.before);
    const points = extra ? [...s.points, extra] : s.points;
    // While a polygon is clicked out its open path is shown; the closing edge and the fill come on commit.
    const drawn = paint(img, shape(s.kind === "polygon" && extra ? "line" : s.kind, points, filled), s.colour);
    pixels.current = img;
    redraw();
    return drawn;
  };
  const commitShape = () => {
    const s = shapeDraft.current;
    if (!s) return;
    const drawn = previewShape();
    shapeDraft.current = undefined;
    if (drawn) (pushUndo(s.before), remember(s.colour), changed());
    else (pixels.current = s.before, redraw());
  };
  function cancelShape() {
    const s = shapeDraft.current;
    if (!s) return;
    shapeDraft.current = undefined;
    pixels.current = s.before;
    redraw();
  }
  // ---- selection commands ----
  /** One undo step that replaces the current frame. */
  const replaceFrame = (next: Pixels) => {
    const img = pixels.current;
    if (!img) return;
    cancelShape();
    pushUndo(clone(img));
    pixels.current = next;
    changed();
  };
  const copySelection = () => {
    const img = pixels.current, sel = selectionRef.current;
    if (!img || !sel) return;
    clipboard = asPixels(copyRegion(img, sel));
    setHasClipboard(true);
  };
  const deleteSelection = () => {
    const img = pixels.current, sel = selectionRef.current;
    if (img && sel) replaceFrame(asPixels(clearRegion(img, sel)));
  };
  const cutSelection = () => (copySelection(), deleteSelection());
  /** Pastes at the selection's corner (else the top left) and selects the pasted pixels, ready to move. */
  const paste = () => {
    const img = pixels.current, piece = clipboard;
    if (!img || !piece) return;
    const at = selectionRef.current ?? { x: 0, y: 0, w: 0, h: 0 };
    pickTool("select");
    replaceFrame(asPixels(pasteRegion(img, piece, at.x, at.y, false)));
    setSelection(clip(img, { x: at.x, y: at.y, w: piece.width, h: piece.height }));
  };
  const selectAll = () => {
    const img = pixels.current;
    if (img) (pickTool("select"), setSelection({ x: 0, y: 0, w: img.width, h: img.height }), redraw());
  };
  /** Hue and colour: the selection of this frame, or every frame without a selection. */
  const adjust = (edit: (image: Pixels, r?: Rect) => Pixels) => {
    const sel = selectionRef.current;
    if (sel) return pixels.current && replaceFrame(edit(pixels.current, sel));
    editFrames((frames, i) => ({ frames: frames.map((f) => edit(f)), index: i }));
  };
  const applyHue = () => adjust((image, r) => asPixels(shiftHue(image, hue, r)));
  const applyDesaturate = () => adjust((image, r) => asPixels(desaturate(image, 1, r)));
  const applyCanvasSize = () => {
    const img = pixels.current;
    if (!img || (img.width === canvasW && img.height === canvasH)) return;
    setSelection(undefined);
    editFrames((frames, i) => ({ frames: frames.map((f) => asPixels(resizeCanvas(f, canvasW, canvasH, anchor))), index: i }));
  };
  /** Q274: cuts the empty margins of every frame away, the drawing's pixels unchanged (an animation's frames stay square). */
  const trimCanvas = () => {
    const frames = allFrames();
    const box = frames.length && trimBox(frames, !!anim);
    if (!box || (box.w === frames[0].width && box.h === frames[0].height)) return;
    setSelection(undefined);
    editFrames((all, i) => ({ frames: all.map((f) => asPixels(copyRegion(f, box))), index: i }));
  };
  const flipImage = (axis: "horizontal" | "vertical") => {
    const img = pixels.current;
    if (!img) return;
    cancelShape();
    pushUndo(clone(img));
    pixels.current = { width: img.width, height: img.height, data: flip(img.data, img.width, img.height, axis) };
    changed();
  };
  /** The cell under the pointer, held to the canvas edge (dragging a selection past it). */
  const clampedCell = (e: React.PointerEvent): [number, number] | undefined => {
    const img = pixels.current, box = canvas.current?.getBoundingClientRect();
    if (!img || !box) return undefined;
    const x = Math.floor((e.clientX - box.left) / zoom), y = Math.floor((e.clientY - box.top) / zoom);
    return [Math.max(0, Math.min(img.width - 1, x)), Math.max(0, Math.min(img.height - 1, y))];
  };
  const cellAt = (e: React.PointerEvent): [number, number] | undefined => {
    const img = pixels.current, box = canvas.current?.getBoundingClientRect();
    if (!img || !box) return undefined;
    const x = Math.floor((e.clientX - box.left) / zoom), y = Math.floor((e.clientY - box.top) / zoom);
    return x >= 0 && y >= 0 && x < img.width && y < img.height ? [x, y] : undefined;
  };
  const down = (e: React.PointerEvent) => {
    const img = pixels.current, cell = cellAt(e);
    if (playing || !img || !cell || (e.button !== 0 && e.button !== 2)) return;
    keyboardCursor.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    press(img, cell, e.button === 2, e.detail);
  };
  /** A press on a cell (the mouse button, or Space on the pixel cursor); `secondary` erases with any tool. */
  const press = (img: Pixels, cell: [number, number], secondary: boolean, detail: number) => {
    if (tool === "select") {
      const sel = selectionRef.current;
      if (sel && !secondary && cell[0] >= sel.x && cell[1] >= sel.y && cell[0] < sel.x + sel.w && cell[1] < sel.y + sel.h) {
        moving.current = { before: clone(img), base: asPixels(clearRegion(img, sel)), piece: asPixels(copyRegion(img, sel)), from: sel, start: cell, moved: false };
      } else {
        selecting.current = { start: cell };
        setSelection({ x: cell[0], y: cell[1], w: 1, h: 1 });
        redraw();
      }
      return;
    }
    if (tool === "picker") {
      setColour(getPixel(img, ...cell));
      pickTool(lastTool.current);
      return;
    }
    const c = tool === "eraser" || secondary ? TRANSPARENT : colour;
    if (tool === "polygon") {
      const s = shapeDraft.current;
      if (!s) {
        shapeDraft.current = { kind: "polygon", before: clone(img), points: [cell], colour: c };
        return void previewShape();
      }
      // A double click, or a click on the first corner, closes the polygon.
      const first = s.points[0];
      if (detail >= 2 || (s.points.length > 2 && first[0] === cell[0] && first[1] === cell[1])) return commitShape();
      s.points.push(cell);
      return void previewShape();
    }
    if (isShape(tool)) {
      shapeDraft.current = { kind: tool, before: clone(img), points: [cell, cell], colour: c };
      return void previewShape();
    }
    const before = clone(img);
    if (tool === "fill") {
      let filledAny = false;
      for (const [x, y] of mirror([cell], img.width, img.height, { x: mirrorX, y: mirrorY })) filledAny = floodFill(img, x, y, c) || filledAny;
      if (filledAny) (pushUndo(before), remember(colour), changed());
      return;
    }
    stroke.current = { before, changed: paint(img, [cell], c), last: cell, colour: c };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (playing) return;
    keyboardCursor.current = false;
    setHover(cellAt(e));
    dragTo(cellAt(e) ?? (e.buttons ? clampedCell(e) : undefined), e.buttons !== 0);
  };
  /** The pointer, or the pixel cursor with Space held, reached `cell`: continues the stroke, selection, move or shape. */
  const dragTo = (cell: [number, number] | undefined, pressed: boolean) => {
    const m = moving.current;
    if (m && cell) {
      const dx = cell[0] - m.start[0], dy = cell[1] - m.start[1];
      m.moved = m.moved || dx !== 0 || dy !== 0;
      pixels.current = asPixels(pasteRegion(m.base, m.piece, m.from.x + dx, m.from.y + dy));
      setSelection({ ...m.from, x: m.from.x + dx, y: m.from.y + dy });
      return redraw();
    }
    const sel = selecting.current;
    if (sel && cell) {
      const [x0, y0] = sel.start;
      setSelection({ x: Math.min(x0, cell[0]), y: Math.min(y0, cell[1]), w: Math.abs(cell[0] - x0) + 1, h: Math.abs(cell[1] - y0) + 1 });
      return redraw();
    }
    const d = shapeDraft.current;
    if (d && cell) {
      if (d.kind === "polygon") previewShape(cell);
      else if (pressed) (d.points[1] = cell, previewShape());
      return;
    }
    const s = stroke.current, img = pixels.current;
    if (!s || !img || !cell) return;
    s.changed = paint(img, line(s.last[0], s.last[1], cell[0], cell[1]), s.colour) || s.changed;
    s.last = cell;
    redraw();
  };
  const up = () => {
    selecting.current = undefined;
    const m = moving.current;
    if (m) {
      moving.current = undefined;
      // The moved selection keeps only the part still on the canvas.
      if (m.moved) (pushUndo(m.before), setSelection(clip(m.before, selectionRef.current ?? m.from)), changed());
      else pixels.current = m.before;
      return;
    }
    if (shapeDraft.current && shapeDraft.current.kind !== "polygon") return commitShape();
    const s = stroke.current;
    stroke.current = undefined;
    if (s?.changed) (pushUndo(s.before), remember(s.colour), changed());
  };
  /** Keyboard painting: arrows move the pixel cursor (Shift: 4 pixels), Space presses the mouse button on it, Shift+Space the right one. */
  const descId = useId();
  const announce = (cell: [number, number]) => {
    const img = pixels.current;
    if (!img) return;
    const px = getPixel(img, cell[0], cell[1]);
    setSaid(t("paint.cursorPixel", { x: cell[0], y: cell[1], colour: px[3] === 0 ? t("paint.transparent") : toHex(px) }));
  };
  const canvasKey = (e: React.KeyboardEvent) => {
    const img = pixels.current;
    if (!img || playing || e.ctrlKey || e.metaKey || e.altKey) return;
    const at = hover ?? [0, 0] as [number, number];
    const by = e.shiftKey ? 4 : 1;
    const step: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by], Home: [-img.width, 0], End: [img.width, 0] };
    if (step[e.key]) {
      e.preventDefault();
      const next: [number, number] = [Math.max(0, Math.min(img.width - 1, at[0] + step[e.key][0])), Math.max(0, Math.min(img.height - 1, at[1] + step[e.key][1]))];
      keyboardCursor.current = true;
      setHover(next);
      dragTo(next, heldKey.current);
      announce(next);
    } else if (e.key === " ") {
      e.preventDefault();
      if (e.repeat || heldKey.current) return;
      heldKey.current = true;
      keyboardCursor.current = true;
      setHover(at);
      press(img, at, e.shiftKey, 1);
      announce(at);
    }
  };
  const releaseKey = () => {
    if (!heldKey.current) return;
    heldKey.current = false;
    up();
    if (hover) announce(hover);
  };
  const zoomBy = (step: number) => (setFitted(false), setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + step))] ?? z));
  useFitOnResize(area, fitted, (box) => {
    const img = pixels.current;
    if (img) setZoom(ZOOMS.filter((z) => z <= Math.min((box.w - 48) / img.width, (box.h - 48) / img.height)).at(-1) ?? 1);
  });
  // Ctrl + wheel, natively so the window does not zoom too (KUYRUK 179).
  useCtrlWheel(area, zoomBy);
  const setSize = (size: number) => {
    const img = pixels.current;
    if (!img || (img.width === size && img.height === size)) return;
    // Every frame of an animated texture takes the new size.
    editFrames((frames, i) => ({ frames: frames.map((f) => resize(f, size, size)), index: i }));
  };

  // Shortcuts work while the focus is not in a text field of the side panel.
  const keys = useRef<(e: KeyboardEvent) => void>(undefined);
  keys.current = (e) => {
    const target = e.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const k = e.key.toLowerCase();
    if (dialog) return;
    // A playing preview is read only: Escape stops it; saving, copying, the grid and zoom still work.
    if (playing && !(e.ctrlKey ? k === "s" || k === "c" : ["escape", "g", "+", "=", "-"].includes(k))) return;
    const action = e.ctrlKey
      ? (k === "z" && !e.shiftKey ? doUndo : k === "y" || (k === "z" && e.shiftKey) ? doRedo
        : k === "s" ? (e.shiftKey ? () => setDialog("saveAs") : () => void save())
        : k === "c" ? copySelection : k === "x" ? cutSelection : k === "v" ? paste : k === "a" ? selectAll
        : k === "d" ? () => (setSelection(undefined), redraw()) : undefined)
      : e.shiftKey && k === "f" ? () => setFilled((v) => !v)
      : k === "delete" || k === "backspace" ? (selectionRef.current ? deleteSelection : undefined)
      : { m: () => pickTool("select"), p: () => pickTool("pencil"), b: () => pickTool("pencil"), e: () => pickTool("eraser"), f: () => pickTool("fill"), i: () => pickTool("picker"),
        l: () => pickTool("line"), r: () => pickTool("rect"), o: () => pickTool("ellipse"), y: () => pickTool("polygon"),
        enter: commitShape, escape: () => (playing ? setPlay(false) : shapeDraft.current ? cancelShape() : (setSelection(undefined), redraw())),
        g: () => setGrid((v) => !v), "+": () => zoomBy(1), "=": () => zoomBy(1), "-": () => zoomBy(-1) }[k];
    if (!action) return;
    e.preventDefault();
    action();
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keys.current?.(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const name = file.slice(file.lastIndexOf("/") + 1);
  const hex = toHex(colour);
  const square = p && p.width === p.height && SIZES.includes(p.width);
  const sections: DockSection[] = p ? [
      {
        id: "paint.colourGroup", icon: "picker", title: t("paint.colourGroup"), defaultOpen: true, badge: hex,
        body: (
          <>
            <FormRow label={t("paint.colour")}>
                  <div className="fpair">
                    <input type="color" className="swatch" value={hex} aria-label={t("paint.colour")}
                      onChange={(e) => setColour(fromHex(e.target.value, colour[3] || 255)!)} />
                    <HexInput value={hex} onChange={(h) => setColour(fromHex(h, colour[3] || 255)!)} />
                  </div>
                </FormRow>
                <FormRow label={t("paint.opacity")}>
                  <div className="fpair">
                    <input type="range" min={0} max={255} value={colour[3]} aria-label={t("paint.opacity")}
                      onChange={(e) => setColour([colour[0], colour[1], colour[2], Number(e.target.value)])} />
                    <span className="mono opacityval">{Math.round((colour[3] / 255) * 100)}%</span>
                  </div>
                </FormRow>
                <FormRow label={t("paint.palette")} top>
                  <Swatches colours={PALETTE} current={colour} onPick={(h) => setColour(fromHex(h)!)} />
                </FormRow>
                <FormRow label={t("paint.recent")} top>
                  {recent.length ? <Swatches colours={recent} current={colour} onPick={(h) => setColour(fromHex(h)!)} />
                    : <p className="hint nomargin">{t("paint.noRecent")}</p>}
                </FormRow>
          </>
        ),
      },
      {
        id: "paint.previewGroup", icon: "image", title: t("paint.previewGroup"), defaultOpen: true,
        body: (
          <>
            <TexturePreview pixels={p} />
          </>
        ),
      },
      {
        id: "paint.canvasGroup", icon: "grid", title: t("paint.canvasGroup"), defaultOpen: true, badge: `${p.width}×${p.height}`,
        body: (
          <>
            <FormRow label={t("paint.size")}>
                  <select value={square ? p.width : ""} disabled={playing} onChange={(e) => setSize(Number(e.target.value))}>
                    {!square && <option value="">{t("paint.customSize", { width: p.width, height: p.height })}</option>}
                    {SIZES.map((s) => <option key={s} value={s}>{t("paint.customSize", { width: s, height: s })}</option>)}
                  </select>
                </FormRow>
                <FormRow label={t("paint.canvasSize")}>
                  <div className="fpair">
                    <input type="number" min={1} max={512} value={canvasW} aria-label={t("paint.canvasWidth")} onChange={(e) => setCanvasW(Math.max(1, Math.min(512, Math.round(Number(e.target.value) || 1))))} />
                    <span className="dim">×</span>
                    <input type="number" min={1} max={512} value={canvasH} aria-label={t("paint.canvasHeight")} onChange={(e) => setCanvasH(Math.max(1, Math.min(512, Math.round(Number(e.target.value) || 1))))} />
                  </div>
                </FormRow>
                <FormRow label={t("paint.anchor")}>
                  <select value={anchor} aria-label={t("paint.anchor")} onChange={(e) => setAnchor(e.target.value as Anchor)}>
                    {ANCHORS.map((a) => <option key={a} value={a}>{t(`paint.anchor.${a}` as StringKey)}</option>)}
                  </select>
                </FormRow>
                <div className="framebtns">
                  <button type="button" className="abtn resizecanvas" disabled={playing || (p.width === canvasW && p.height === canvasH)} onClick={applyCanvasSize}>
                    <Icon name="fit" />{t("paint.resizeCanvas")}
                  </button>
                  <button type="button" className="abtn trimcanvas" disabled={playing} title={t("paint.trimCanvasHelp")} onClick={trimCanvas}>
                    <Icon name="fit" />{t("paint.trimCanvas")}
                  </button>
                </div>
                <p className="hint">{t("paint.canvasHint")}</p>
                <FormRow label={t("paint.file")}><div className="fval"><code>{file}</code></div></FormRow>
          </>
        ),
      },
      {
        id: "paint.adjustGroup", icon: "hue", title: t("paint.adjustGroup"), defaultOpen: true,
        body: (
          <>
            <FormRow label={t("paint.hue")}>
                  <div className="fpair">
                    <input type="range" min={-180} max={180} value={hue} aria-label={t("paint.hue")} onChange={(e) => setHue(Number(e.target.value))} />
                    <span className="mono opacityval">{hue}°</span>
                  </div>
                </FormRow>
                <div className="framebtns">
                  <button type="button" className="abtn applyhue" disabled={playing || !hue} onClick={applyHue}><Icon name="hue" />{t("paint.applyHue")}</button>
                  <button type="button" className="abtn desaturate" disabled={playing} onClick={applyDesaturate}><Icon name="grey" />{t("paint.desaturate")}</button>
                </div>
                <p className="hint">{t(selection ? "paint.adjustSelection" : "paint.adjustAll")}</p>
          </>
        ),
      },
      {
        id: "paint.animGroup", icon: "frames", title: t("paint.animGroup"), defaultOpen: true, badge: anim ? String(allFrames().length) : undefined,
        body: (
          <>
            {!anim ? (
                  <>
                    <p className="hint nomargin">{t("paint.stillHint")}</p>
                    <button type="button" className="abtn" onClick={makeAnimated}><Icon name="frames" />{t("paint.makeAnimated")}</button>
                  </>
                ) : (
                  <>
                    <div className="framestrip" role="listbox" aria-label={t("paint.frames")}>
                      {allFrames().map((f, i) => (
                        <button key={i} type="button" role="option" aria-selected={i === frame} title={t("paint.frameN", { n: i + 1 })}
                          className={`framecell ${i === frame ? "sel" : ""}`} disabled={playing} onClick={() => showFrame(i)}>
                          <FrameThumb pixels={f} /><span>{i + 1}</span>
                        </button>
                      ))}
                    </div>
                    <div className="framebtns">
                      <button type="button" className="abtn" disabled={playing} onClick={() => addFrame(false)}><Icon name="plus" />{t("paint.addFrame")}</button>
                      <button type="button" className="abtn" disabled={playing} onClick={() => addFrame(true)}><Icon name="dup" />{t("paint.dupFrame")}</button>
                      <button type="button" className="abtn" disabled={playing || frame === 0} title={t("paint.frameEarlier")} onClick={() => moveFrame(-1)}><Icon name="back" /></button>
                      <button type="button" className="abtn" disabled={playing || frame === allFrames().length - 1} title={t("paint.frameLater")} onClick={() => moveFrame(1)}><Icon name="next" /></button>
                      <button type="button" className="abtn danger" disabled={playing || allFrames().length < 2} onClick={deleteFrame}><Icon name="trash" />{t("paint.deleteFrame")}</button>
                    </div>
                    <FormRow label={t("paint.frametime")}>
                      <input type="number" min={1} step={1} value={anim.frametime} aria-label={t("paint.frametime")}
                        onChange={(e) => setAnimation({ frametime: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                      <p className="fhelp">{t("paint.frametimeUnit", { seconds: (anim.frametime / 20).toFixed(2) })}</p>
                    </FormRow>
                    <FormRow label={t("paint.interpolate")}>
                      <label className="check"><input type="checkbox" checked={anim.interpolate} onChange={(e) => setAnimation({ interpolate: e.target.checked })} /></label>
                    </FormRow>
                    <FormRow label={t("paint.playback")}>
                      <select className="playbackmode" value={anim.mode} aria-label={t("paint.playback")} onChange={(e) => setAnimation({ mode: e.target.value as PlaybackMode })}>
                        {PLAYBACK_MODES.map((m) => <option key={m} value={m}>{t(`paint.playback.${m}`)}</option>)}
                      </select>
                      <p className="fhelp">{t(`paint.playbackHelp.${anim.mode}`)}</p>
                    </FormRow>
                    <FormRow label={t("paint.animPreview")}>
                      <button type="button" className="abtn" title={t(playing ? "paint.stopHint" : "paint.playHint")} onClick={togglePlay}>
                        <Icon name={playing ? "stop" : "play"} />{t(playing ? "paint.stop" : "paint.play")}
                      </button>
                    </FormRow>
                    <p className="hint">{t("paint.animHint", { count: allFrames().length })}</p>
                    <button type="button" className="abtn" disabled={playing} onClick={makeStill}>{t("paint.makeStill")}</button>
                  </>
                )}
          </>
        ),
      },
  ] : [];
  const status = (
    <StatusItems items={[
      hover ? <span className="pcursor">{t("paint.cursor", { x: hover[0], y: hover[1] })}</span> : null,
      <span className="fmeta">{p ? t("paint.meta", { width: p.width, height: p.height, path: file }) : file}</span>,
      t(`paint.${tool}` as StringKey),
    ]} />
  );
  return (
    <section className="view painter">
      {conflict && <p className="notice codenotice">{t("paint.conflict")}</p>}
      <EditorShell label={t("dock.editor")} bar={
        <>
          <ActionButton icon="back" label={t("paint.back")} onClick={close} />
          <span className="dk-id edhead">
        <span className="slot small"><canvas ref={preview} className="pixel" style={{ width: 24, height: 24 }} /></span>
        <span className="edname">{name}{dirty && <span className="unsaved" title={t("paint.unsaved")}> *</span>}</span>
        <span className="ttype">{t("paint.type")}</span>
        {dirty && !conflict && <span className="livechip conflict">{t(isNew.current ? "paint.notCreated" : restored ? "paint.restored" : "paint.unsaved")}</span>}
        {conflict && <span className="livechip conflict"><i className="liveled" />{t("paint.conflictChip")}</span>}
        {reloadedAt && !conflict && <span className="livechip"><i className="liveled" />{t("paint.reloaded")}</span>}
        {savedAt && !dirty && <span className="livechip">{t("paint.saved")}</span>}
          </span>
          <Separator />
          <ActionButton icon="save" label={t("paint.save")} title="Ctrl+S" tone={dirty ? "primary" : undefined} disabled={!dirty || !p} onClick={() => void save()} />
          <ActionButton hideLabel icon="saveas" label={t("paint.saveAs")} title="Ctrl+Shift+S" disabled={!p} onClick={() => setDialog("saveAs")} />
          <Separator />
          {conflict && (
          <>
            <ActionButton icon="check" label={t("paint.keepMine")} tone="primary" onClick={keepMine} />
            <ActionButton icon="import" label={t("paint.reloadDisk")} onClick={() => void reloadFromDisk()} />
            <Separator />
          </>
        )}
          <ActionButton hideLabel icon="undo" label={t("paint.undo")} title="Ctrl+Z" disabled={playing || !undo.current.length} onClick={doUndo} />
          <ActionButton hideLabel icon="redo" label={t("paint.redo")} title="Ctrl+Y" disabled={playing || !redo.current.length} onClick={doRedo} />
          <Separator />
          <ActionButton compact icon="copy" label={t("paint.copy")} title="Ctrl+C" disabled={!selection} onClick={copySelection} />
          <ActionButton compact icon="cut" label={t("paint.cut")} title="Ctrl+X" disabled={playing || !selection} onClick={cutSelection} />
          <ActionButton compact icon="paste" label={t("paint.paste")} title="Ctrl+V" disabled={playing || !hasClipboard || !p} onClick={paste} />
          <ActionButton hideLabel icon="trash" label={t("paint.deleteSelected")} title="Delete" tone="danger" disabled={playing || !selection} onClick={deleteSelection} />
          <span className="dk-grow" />
          <ActionButton icon="grid" label={t("paint.grid")} title="G" pressed={grid} onClick={() => setGrid(!grid)} />
          {anim && (
          <>
            <ActionButton icon={playing ? "stop" : "play"} label={t(playing ? "paint.stop" : "paint.play")} title={t(playing ? "paint.stopHint" : "paint.playHint")}
              pressed={playing} onClick={togglePlay} />
            <Separator />
          </>
        )}
          <Separator />
          <ZoomGroup zoom={zoom} canOut={zoom !== ZOOMS[0]} canIn={zoom !== ZOOMS.at(-1)} onOut={() => zoomBy(-1)} onIn={() => zoomBy(1)}
            onFit={() => setFitted(true)} fitted={fitted} />
          <ShortcutsButton shortcuts={[
          ["M", t("keys.paint.select")], ["Ctrl+C / Ctrl+X / Ctrl+V", t("keys.paint.clipboard")], ["Delete", t("keys.paint.deleteSelected")],
          ["Ctrl+A / Ctrl+D", t("keys.paint.selectAll")], ["P / B", t("keys.paint.pencil")], ["E", t("keys.paint.eraser")], ["F", t("keys.paint.fill")], ["I", t("keys.paint.picker")],
          ["L", t("keys.paint.line")], ["R", t("keys.paint.rect")], ["O", t("keys.paint.ellipse")], ["Y", t("keys.paint.polygon")],
          ["Shift+F", t("keys.paint.filled")], ["G", t("keys.paint.grid")], [t("keys.k.arrows") + " / Shift+" + t("keys.k.arrows"), t("keys.paint.cursor")],
          ["Space / Shift+Space", t("keys.paint.space")], ["+ / -", t("keys.paint.zoom")], [t("keys.k.ctrlWheel"), t("keys.paint.wheel")],
          [t("keys.k.rightClick"), t("keys.paint.erase")], ["Ctrl+S", t("keys.save")], ["Ctrl+Shift+S", t("keys.saveAs")], ["Ctrl+Z", t("keys.undo")],
          ["Ctrl+Y / Ctrl+Shift+Z", t("keys.redo")], ["Esc", t("keys.paint.stopPlay")], ["?", t("keys.list")],
        ]} />
        </>
      } railLabel={t("paint.tools")} railClass="ptools" rail={
        <>
          <RailButton icon="select" label={t("paint.select")} shortcut="M" pressed={tool === "select"} disabled={playing} onClick={() => pickTool("select")} />
          <RailButton icon="edit" label={t("paint.pencil")} shortcut="P" pressed={tool === "pencil"} disabled={playing} onClick={() => pickTool("pencil")} />
          <RailButton icon="eraser" label={t("paint.eraser")} shortcut="E" pressed={tool === "eraser"} disabled={playing} onClick={() => pickTool("eraser")} />
          <RailButton icon="bucket" label={t("paint.fill")} shortcut="F" pressed={tool === "fill"} disabled={playing} onClick={() => pickTool("fill")} />
          <RailButton icon="picker" label={t("paint.picker")} shortcut="I" pressed={tool === "picker"} disabled={playing} onClick={() => pickTool("picker")} />
          <RailSeparator />
          <RailButton icon="line" label={t("paint.line")} shortcut="L" pressed={tool === "line"} disabled={playing} onClick={() => pickTool("line")} />
          <RailButton icon="rect" label={t("paint.rect")} shortcut="R" pressed={tool === "rect"} disabled={playing} onClick={() => pickTool("rect")} />
          <RailButton icon="ellipse" label={t("paint.ellipse")} shortcut="O" pressed={tool === "ellipse"} disabled={playing} onClick={() => pickTool("ellipse")} />
          <RailButton icon="polygon" label={t("paint.polygon")} shortcut={t("paint.polygonHint")} pressed={tool === "polygon"} disabled={playing} onClick={() => pickTool("polygon")} />
          <RailButton icon="filled" label={t("paint.filled")} shortcut="Shift+F" pressed={filled} disabled={playing} onClick={() => setFilled(!filled)} />
          <RailSeparator />
          <RailButton icon="mirrorx" label={t("paint.mirrorX")} shortcut={t("paint.mirrorXHint")} pressed={mirrorX} disabled={playing} onClick={() => setMirrorX(!mirrorX)} />
          <RailButton icon="mirrory" label={t("paint.mirrorY")} shortcut={t("paint.mirrorYHint")} pressed={mirrorY} disabled={playing} onClick={() => setMirrorY(!mirrorY)} />
          <RailSeparator />
          <RailButton icon="fliph" label={t("paint.flipH")} disabled={playing || !p} onClick={() => flipImage("horizontal")} />
          <RailButton icon="flipv" label={t("paint.flipV")} disabled={playing || !p} onClick={() => flipImage("vertical")} />
        </>
      } sections={sections} inspectorLabel={t("dock.inspector")} bodyClass="form paintform" status={status}
        inspectorEmpty={!p ? <PanelEmpty text={t("paint.loading")} /> : undefined}>
        <div ref={area} className="paintarea">
          {error ? <p className="error-text">{error}</p> : !p ? <p className="empty-note">{t("paint.loading")}</p> : (
            <div className="paintframe" style={{ ["--cell" as string]: `${Math.max(4, zoom / 2)}px` }}>
              {playing && <span className="playbadge" role="status"><Icon name="play" />{t("paint.playing")}</span>}
              <canvas ref={canvas} className={`paintcanvas ${playing ? "playing" : `tool-${tool}`}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}
                onPointerLeave={() => setHover(undefined)} onContextMenu={(e) => e.preventDefault()}
                tabIndex={0} role="application" aria-describedby={descId} onKeyDown={canvasKey} onKeyUp={(e) => e.key === " " && releaseKey()} onBlur={releaseKey}
                onFocus={(e) => {
                  // Reached with the keyboard: the pixel cursor appears (at the top left) and is read out.
                  if (hover || !e.currentTarget.matches(":focus-visible")) return;
                  keyboardCursor.current = true;
                  setHover([0, 0]);
                  announce([0, 0]);
                }}
                style={{ width: p.width * zoom, height: p.height * zoom }} aria-label={t("paint.canvas")} />
              <span id={descId} className="sr-only">{t("paint.keysHelp")}</span>
              <span className="sr-only" role="status" aria-live="polite">{said}</span>
            </div>
          )}
        </div>
      </EditorShell>
      {dialog === "saveAs" && (
        <SaveAsDialog snapshot={snapshot} current={file} onCancel={() => setDialog(undefined)}
          onSave={(target) => (setDialog(undefined), void write(target))} />
      )}
      {dialog === "close" && (
        <AlertDialog title={t("paint.closeTitle")} onEscape={() => setDialog(undefined)}>
          <p className="hint">{t(isNew.current ? "paint.closeNew" : "paint.closeText", { name })}</p>
          <div className="dlg-buttons">
            <button type="button" autoFocus className="abtn primary" onClick={() => void save().then(() => !dirtyRef.current && onClose())}>
              <Icon name="save" /><span>{t("paint.save")}</span>
            </button>
            <button type="button" className="abtn danger" onClick={closeAnyway}><span>{t("paint.discard")}</span></button>
            <button type="button" className="abtn" onClick={() => setDialog(undefined)}><span>{t("dialog.cancel")}</span></button>
          </div>
        </AlertDialog>
      )}
    </section>
  );
}

/** A project texture and, when its .mcmeta has an animation section, that animation. */
async function loadFromDisk(dir: string, path: string): Promise<{ image: Pixels; animation?: Animation; hasMcmeta: boolean }> {
  const image = await decodePng(await api.readTexture(dir, path));
  let text: string | undefined;
  try {
    text = (await api.codeRead(dir, `${path}.mcmeta`)).text;
  } catch {
    return { image, hasMcmeta: false };
  }
  try {
    const animation = parseMcmeta(text);
    // A strip whose height is not a whole number of square frames is not shown as frames.
    return { image, animation: animation && image.height % image.width === 0 ? animation : undefined, hasMcmeta: true };
  } catch {
    return { image, hasMcmeta: true };
  }
}

/** Small picture of one frame. */
function FrameThumb({ pixels }: { pixels: Pixels }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = pixels.width;
    c.height = pixels.height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  });
  return <canvas ref={ref} className="pixel" />;
}

function Swatches({ colours, current, onPick }: { colours: string[]; current: Rgba; onPick: (hex: string) => void }) {
  const hex = toHex(current);
  return (
    <div className="swatches" role="listbox" aria-label={t("paint.palette")}>
      {colours.map((c) => (
        <button key={c} type="button" role="option" aria-selected={c === hex} title={c} className={`sw ${c === hex ? "sel" : ""}`}
          style={{ background: c }} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

/** Hex colour typed by hand; applied once it is a full #rrggbb. */
function HexInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input className="mono" value={text} spellCheck={false} aria-label="hex" maxLength={7}
      onChange={(e) => {
        setText(e.target.value);
        if (fromHex(e.target.value)) onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`);
      }} onBlur={() => setText(value)} />
  );
}
