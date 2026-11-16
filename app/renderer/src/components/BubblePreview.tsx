import { useEffect, useRef, useState } from "react";
import { BUBBLE_PIXEL_BLOCKS, bubbleCaption, bubbleColor, bubbleLayout, CAPTION_PIXELS, NAME_TAG_ATTACH, NAME_TAG_PAD, OVER_HEAD, OVER_NAME, speechBubble, type BubbleLayout } from "../../../../src/elements/bubbleLayout.ts";
import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { timelineAt, timelineLengths, type Timing } from "../../../../src/elements/transitions.ts";
import { animationSchedule, frameAt, type AnimationSchedule } from "../../../../src/resources/textureAnimation.ts";
import { loadPreviewTexture, onAnimationTick } from "../textures/animatedTexture.ts";
import { t } from "../strings.ts";

/**
 * Live preview of a bubble element (Q216), drawn like the game's renderer draws it (src/generator/bubbles.ts, same
 * layout from src/elements/bubbleLayout.ts): the bubble above a player head placeholder, with or without the name tag,
 * its background stretched or 9-sliced, its icon and caption, animated images on the game clock (with their playback
 * modes, Q229) and a timeline (Q228: appear | hold | disappear) with Play, a scrubber and a loop switch that plays the
 * bubble's transitions as the game does (src/elements/transitions.ts). The icon can be dragged on the canvas; that
 * switches it to the free position.
 */

const CANVAS = { width: 296, height: 280 };
/** Bubble pixels of the player's head (0.5 blocks) and of the bubble's lift (the game's OVER_NAME / OVER_HEAD, shared). */
const HEAD = 0.5 / BUBBLE_PIXEL_BLOCKS;
const LIFT = { name: OVER_NAME / BUBBLE_PIXEL_BLOCKS, head: OVER_HEAD / BUBBLE_PIXEL_BLOCKS };
const TICK_MS = 50;

/** An image with its frames: a strip of square frames animates `time` ticks each, as the generated renderer plays it. */
export interface Sheet {
  image: CanvasImageSource;
  width: number;
  frameHeight: number;
  frames: number;
  time: number;
  /** The .mcmeta's own frame order, times and playback mode (Q229), when it describes this strip. */
  schedule?: AnimationSchedule;
}

/** A sheet of a loaded image: a taller-than-wide image of whole square frames is a strip, as the build reads it. */
export function sheetOf(image: HTMLImageElement, mcmeta: string | undefined): Sheet {
  const { naturalWidth: w, naturalHeight: h } = image;
  const frames = h > w && h % w === 0 ? h / w : 1;
  let time = 1;
  try {
    time = Math.max(1, Math.round(Number(JSON.parse(mcmeta ?? "{}")?.animation?.frametime ?? 1)) || 1);
  } catch {
    // A broken .mcmeta plays one frame per tick, like the build.
  }
  const schedule = frames > 1 && mcmeta ? animationSchedule(mcmeta, w, h) : undefined;
  return { image, width: w, frameHeight: h / frames, frames, time, schedule: schedule && schedule.frameWidth === w && schedule.frameCount === frames ? schedule : undefined };
}

/** The tick a sheet's frame is picked at: a once mode counts from when the preview's bubble or wheel appeared (`age`), the rest follow the shared clock. */
export const sheetTick = (s: Sheet | undefined, clock: number, age: number): number => (s?.schedule?.hold !== undefined ? age : clock);

export function useSheet(dir: string, path: string): Sheet | undefined {
  const [sheet, setSheet] = useState<Sheet>();
  useEffect(() => {
    setSheet(undefined);
    if (!path) return;
    let alive = true;
    loadPreviewTexture(dir, path).then(({ image, mcmeta }) => {
      if (alive) setSheet(sheetOf(image, mcmeta));
    }, () => {});
    return () => void (alive = false);
  }, [dir, path]);
  return sheet;
}

/** The built-in speech bubble, made once. */
let builtIn: Sheet | undefined;
function speechSheet(): Sheet {
  if (builtIn) return builtIn;
  const { width, height, data } = speechBubble();
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width, height });
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return (builtIn = { image: canvas, width, frameHeight: height, frames: 1, time: 1 });
}

/** Draws frame `tick` of a sheet's source rectangle sx, sy, sw, sh (in one frame) into dx, dy, dw, dh. */
export function drawPart(g: CanvasRenderingContext2D, s: Sheet, tick: number, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
  const top = (s.schedule ? frameAt(s.schedule, tick * TICK_MS).index : Math.floor(tick / s.time) % s.frames) * s.frameHeight;
  if (sw > 0 && sh > 0 && dw > 0 && dh > 0) g.drawImage(s.image, sx, top + sy, sw, sh, dx, dy, dw, dh);
}

function drawBackground(g: CanvasRenderingContext2D, s: Sheet, tick: number, layout: BubbleLayout, x: number, y: number, k: number) {
  const { width: w, height: h, slice } = layout;
  if (slice <= 0) return drawPart(g, s, tick, 0, 0, s.width, s.frameHeight, x, y, w * k, h * k);
  const b = Math.min(slice, Math.min(w, h) / 2);
  const xs = [0, b, w - b, w], us = [0, slice, s.width - slice, s.width];
  const ys = [0, b, h - b, h], vs = [0, slice, s.frameHeight - slice, s.frameHeight];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) drawPart(g, s, tick, us[i], vs[j], us[i + 1] - us[i], vs[j + 1] - vs[j], x + xs[i] * k, y + ys[j] * k, (xs[i + 1] - xs[i]) * k, (ys[j + 1] - ys[j]) * k);
  }
}

/** A player head placeholder: a skin-coloured face with eyes and hair, `size` pixels square. */
function drawHead(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const p = size / 8;
  const rows = ["HHHHHHHH", "HHHHHHHH", "HSSSSSSH", "SSSSSSSS", "SWESSEWS", "SSSNNSSS", "SSMMMMSS", "SSSSSSSS"];
  const colours: Record<string, string> = { H: "#3b2a1a", S: "#c99d7a", W: "#ffffff", E: "#3d3dad", N: "#a8775a", M: "#6b3d2e" };
  rows.forEach((row, r) => [...row].forEach((c, col) => {
    g.fillStyle = colours[c];
    g.fillRect(x + col * p, y + r * p, Math.ceil(p), Math.ceil(p));
  }));
}

/** Where the timeline's playhead is: resting (the bubble shown as it stays), playing from `base` (clock ms), or scrubbed to `age` ticks. */
type Run = { mode: "idle" } | { mode: "play"; base: number } | { mode: "scrub"; age: number };

export function BubblePreview({ snapshot, draft, onChange }: { snapshot: ProjectSnapshot; draft: Element; onChange: (key: string, value: unknown) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [nameTag, setNameTag] = useState(true);
  const [sample, setSample] = useState("Steve");
  const [run, setRun] = useState<Run>({ mode: "idle" });
  const [loop, setLoop] = useState(false);
  const [openedAt] = useState(() => performance.now());
  const [now, setNow] = useState(() => performance.now());
  const background = useSheet(snapshot.dir, typeof draft.background === "string" ? draft.background : "");
  const icon = useSheet(snapshot.dir, typeof draft.icon === "string" ? draft.icon : "");
  const layout = bubbleLayout(draft);
  const lengths = timelineLengths(layout.timing);
  // The timeline the preview plays: an active time of 0 (until cleared) holds for a nominal while.
  const timing: Timing = { ...layout.timing, active: lengths.appear + lengths.hold };
  const age = run.mode === "play" ? (now - run.base) / TICK_MS : run.mode === "scrub" ? run.age : undefined;
  const timeline = age === undefined ? { phase: "hold" as const, state: { alpha: 1, scale: 1, offset: 0 } } : timelineAt(timing, age);
  /** Canvas pixels per bubble pixel and the bubble's top left on the canvas, for drawing and for dragging the icon. */
  const geometry = useRef({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; iconX: number; iconY: number } | undefined>(undefined);

  useEffect(() => onAnimationTick(setNow), []);
  // At the end of the timeline: start again (loop) or rest.
  useEffect(() => {
    if (run.mode !== "play" || age === undefined || age < lengths.total) return;
    setRun(loop ? { mode: "play", base: run.base + lengths.total * TICK_MS } : { mode: "idle" });
  }, [now]);

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    const css = getComputedStyle(g.canvas);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, CANVAS.width, CANVAS.height);
    g.fillStyle = css.getPropertyValue("--slot") || "#15100c";
    g.fillRect(0, 0, CANVAS.width, CANVAS.height);
    // Fit the scene: the head, the lift and the bubble with its caption, at a whole zoom where possible.
    const lift = (nameTag ? LIFT.name : LIFT.head) + layout.offset / BUBBLE_PIXEL_BLOCKS;
    const captionPx = CAPTION_PIXELS * layout.captionScale;
    const sceneHeight = HEAD * 1.2 + Math.max(0, lift) + (layout.height + captionPx * 10) * layout.scale + 8;
    const sceneWidth = Math.max(HEAD, layout.width * layout.scale) + 16;
    const zoom = Math.min(3, CANVAS.width / sceneWidth, CANVAS.height / sceneHeight);
    const headTop = CANVAS.height - HEAD * 1.2 * zoom;
    const cx = CANVAS.width / 2;
    drawHead(g, cx - (HEAD * zoom) / 2, headTop, HEAD * zoom);
    let tagBox: { top: number; bottom: number } | undefined;
    if (nameTag) {
      // The name tag: drawn from 0.5 blocks over the player's height down, its box 0.225 blocks high.
      const top = headTop - (NAME_TAG_ATTACH / BUBBLE_PIXEL_BLOCKS) * zoom, size = CAPTION_PIXELS * zoom;
      tagBox = { top: top - (NAME_TAG_PAD / BUBBLE_PIXEL_BLOCKS) * zoom, bottom: top + 9 * size - (NAME_TAG_PAD / BUBBLE_PIXEL_BLOCKS) * zoom };
      g.font = `${Math.max(6, Math.round(8 * size))}px monospace`;
      const width = g.measureText("Steve").width;
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(cx - width / 2 - size, top - size, width + 2 * size, 9 * size);
      g.fillStyle = "#ffffff";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText("Steve", cx, top);
    }
    // The transition, as the game plays it (shared rule): alpha, size and a slide as a fraction of the bubble's height.
    const { alpha, scale: size, offset } = timeline.state;
    g.globalAlpha = alpha;
    const k = zoom * layout.scale * size;
    const x = cx - (layout.width / 2) * k, y = headTop - lift * zoom - layout.height * k - offset * layout.height * layout.scale * zoom;
    geometry.current = { k, x, y };
    // For the UI test: the frame and the name tag boxes on the canvas, and the lift in blocks.
    g.canvas.dataset.boxes = JSON.stringify({ frame: { top: y, bottom: y + layout.height * k }, tag: tagBox ?? null, headTop, liftBlocks: (headTop - (y + layout.height * k + offset * layout.height * layout.scale * zoom)) / zoom * BUBBLE_PIXEL_BLOCKS });
    g.canvas.dataset.state = JSON.stringify({ ...timeline.state, phase: timeline.phase });
    // Images play on the shared clock; a once mode counts from when the bubble appeared (the timeline's age, else the preview's).
    const clock = Math.floor(now / TICK_MS), since = age ?? (now - openedAt) / TICK_MS;
    const bg = draft.background ? background : speechSheet();
    if (bg && size > 0) drawBackground(g, bg, sheetTick(bg, clock, since), layout, x, y, k);
    if (icon && layout.iconSize > 0 && size > 0) drawPart(g, icon, sheetTick(icon, clock, since), 0, 0, icon.width, icon.frameHeight, x + layout.iconX * k, y + layout.iconY * k, layout.iconSize * k, layout.iconSize * k);
    const caption = bubbleCaption(typeof draft.caption === "string" ? draft.caption : "", sample);
    if (caption && size > 0) {
      const px = captionPx * k;
      g.font = `${Math.max(6, Math.round(8 * px))}px monospace`;
      g.textAlign = "center";
      g.textBaseline = "top";
      const top = y - 10 * px, width = g.measureText(caption).width;
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(x + (layout.width / 2) * k - width / 2 - px, top - px, width + 2 * px, 9 * px);
      const colour = `#${bubbleColor(draft.captionColor).toString(16).padStart(6, "0")}`;
      if (draft.captionShadow === true) {
        g.fillStyle = "#3f3f3f";
        g.fillText(caption, x + (layout.width / 2) * k + px, top + px);
      }
      g.fillStyle = colour;
      g.fillText(caption, x + (layout.width / 2) * k, top);
    }
    g.globalAlpha = 1;
  });

  const at = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * CANVAS.width) / r.width, y: ((e.clientY - r.top) * CANVAS.height) / r.height };
  };
  const onDown = (e: React.MouseEvent) => {
    const p = at(e), { k, x, y } = geometry.current;
    const ix = x + layout.iconX * k, iy = y + layout.iconY * k, s = layout.iconSize * k;
    if (p.x >= ix && p.x <= ix + s && p.y >= iy && p.y <= iy + s) drag.current = { x: p.x, y: p.y, iconX: layout.iconX, iconY: layout.iconY };
  };
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e), { k } = geometry.current;
    const nx = d.iconX + Math.round((p.x - d.x) / k), ny = d.iconY + Math.round((p.y - d.y) / k);
    if (nx === layout.iconX && ny === layout.iconY && draft.layout === "free") return;
    onChange("layout", "free");
    onChange("iconX", nx);
    onChange("iconY", ny);
  };

  const playing = run.mode === "play";
  const phaseName = { appear: t("bubble.timeline.appear"), hold: t("bubble.timeline.hold"), disappear: t("bubble.timeline.disappear"), gone: t("bubble.timeline.gone") }[timeline.phase];
  const shownAge = age === undefined ? lengths.appear : Math.min(age, lengths.total);
  return (
    <aside className="formpreview bubblepreview" aria-label={t("preview.title")}>
      <div className="pvtitle">{t("preview.title")}</div>
      <canvas ref={canvas} className="pixel bubblecanvas" width={CANVAS.width} height={CANVAS.height} data-testid="bubble-preview"
        data-layout={JSON.stringify(layout)} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={() => (drag.current = undefined)} onMouseLeave={() => (drag.current = undefined)} />
      <p className="fhelp">{t("bubble.dragHint")}</p>
      <label className="check"><input type="checkbox" checked={nameTag} onChange={(e) => setNameTag(e.target.checked)} />{t("bubble.nameTag")}</label>
      <div className="bubbletimeline" data-testid="bubble-timeline" data-phase={age === undefined ? "idle" : timeline.phase} data-age={shownAge.toFixed(2)} data-lengths={JSON.stringify(lengths)}>
        <div className="tlbar" aria-hidden="true">
          {(["appear", "hold", "disappear"] as const).map((part) => (
            <span key={part} className={`tlseg ${part}${timeline.phase === part && age !== undefined ? " on" : ""}`} style={{ flexGrow: Math.max(lengths[part], lengths.total * 0.04) }}>{t(`bubble.timeline.${part}`)}</span>
          ))}
          <i className="tlhead" style={{ left: `${(shownAge / Math.max(1, lengths.total)) * 100}%` }} />
        </div>
        <div className="tlcontrols">
          <button type="button" className="abtn" data-testid="bubble-play" onClick={() => (playing ? setRun({ mode: "scrub", age: Math.min(age ?? 0, lengths.total) }) : setRun({ mode: "play", base: performance.now() }))}>
            {playing ? t("bubble.timeline.pause") : t("bubble.timeline.play")}
          </button>
          <input type="range" data-testid="bubble-scrub" aria-label={t("bubble.timeline.scrub")} min={0} max={lengths.total} step={0.5} value={shownAge}
            onChange={(e) => setRun({ mode: "scrub", age: Number(e.target.value) })} />
          <label className="check"><input type="checkbox" data-testid="bubble-loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} />{t("bubble.timeline.loop")}</label>
        </div>
        <p className="fhelp" data-testid="bubble-timeline-text">{t("bubble.timeline.summary", { phase: phaseName, age: shownAge.toFixed(1), appear: lengths.appear, hold: lengths.hold, disappear: lengths.disappear })}</p>
      </div>
      <label className="pvlabel" htmlFor="bubble-sample">{t("bubble.sample")}</label>
      <input id="bubble-sample" value={sample} onChange={(e) => setSample(e.target.value)} />
    </aside>
  );
}
