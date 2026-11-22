import { useEffect, useRef, useState } from "react";
import { deadZone, radialLayout, sectorImage, sliceAngle, sliceAt, sliceCenter } from "../../../../src/elements/radialLayout.ts";
import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { loadPreviewTexture, onAnimationTick } from "../textures/animatedTexture.ts";
import { t } from "../strings.ts";
import { transitionState } from "../../../../src/elements/transitions.ts";
import { drawPart, sheetOf, sheetTick, useSheet, type Sheet } from "./BubblePreview.tsx";
import { TabList } from "./ui.tsx";

/**
 * Live preview of a radial menu (Q227), placed like the game's screen places it (src/generator/radial.ts, same values
 * from src/elements/radialLayout.ts): the background, every slice of the chosen tab as the tinted slice shape, slice
 * images, icons, and the hovered slice's label and description (or the menu's title) in the middle. The mouse over the
 * canvas picks a slice by its direction from the middle, as in the game; Replay plays the opening transition (Q228) and
 * animated slice icons play with their playback modes (Q229).
 */

const CANVAS = 296;
const TICK_MS = 50;
const SCENE = "#3a4a5c";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((r): r is Row => !!r && typeof r === "object") : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const css = (argb: number) => `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${((argb >>> 24) / 255).toFixed(3)})`;

/** One shown slice: a designed one, or a placeholder for a file of a runtime folder tab. */
interface Shown { label: string; description: string; icon: string; item: string; disabled: boolean }

function shownSlices(tab: Row | undefined): Shown[] {
  if (!tab) return [];
  if (tab.source === "folder") {
    const count = Math.min(12, Math.max(2, Math.round(Number(tab.pageSize ?? 8)) || 8));
    return Array.from({ length: count }, (_, i) => ({ label: `${str(tab.folder) || "folder"}/${i + 1}`, description: "", icon: "", item: "", disabled: false }));
  }
  return rows(tab.slices).map((s) => ({
    label: str(s.label) || str(s.id), description: str(s.description),
    icon: s.iconKind === "texture" ? str(s.icon) : "", item: s.iconKind === "item" ? str(s.item) : "",
    // A condition is tested on the server; the preview shows how a slice it disables looks.
    disabled: !!str(s.condition) && s.conditionMode === "disabled",
  }));
}

/** The top slice of n tinted with an ARGB colour (alpha included), as the game tints the white image; made once each. */
const sectors = new Map<string, HTMLCanvasElement>();
function sector(n: number, hole: number, gap: number, argb: number): HTMLCanvasElement {
  const key = `${n}_${hole}_${gap}_${argb}`;
  let canvas = sectors.get(key);
  if (!canvas) {
    const { width, height, data } = sectorImage(n, hole, gap);
    canvas = Object.assign(document.createElement("canvas"), { width, height });
    const g = canvas.getContext("2d")!;
    g.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = css(argb);
    g.fillRect(0, 0, width, height);
    sectors.set(key, canvas);
  }
  return canvas;
}

/** Every slice icon texture with its frames, by path. */
function useIcons(dir: string, paths: string[]): Map<string, Sheet> {
  const [icons, setIcons] = useState(new Map<string, Sheet>());
  const key = paths.join("|");
  useEffect(() => {
    let alive = true;
    Promise.all(paths.map((p) => loadPreviewTexture(dir, p).then(({ image, mcmeta }) => [p, sheetOf(image, mcmeta)] as const, () => undefined)))
      .then((loaded) => alive && setIcons(new Map(loaded.filter((e) => !!e))));
    return () => void (alive = false);
  }, [dir, key]);
  return icons;
}

function drawBackground(g: CanvasRenderingContext2D, s: Sheet, border: number, x: number, y: number, size: number, k: number) {
  if (border <= 0) return drawPart(g, s, 0, 0, 0, s.width, s.frameHeight, x, y, size * k, size * k);
  const b = Math.min(border, size / 2);
  const xs = [0, b, size - b, size], us = [0, border, s.width - border, s.width], vs = [0, border, s.frameHeight - border, s.frameHeight];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) drawPart(g, s, 0, us[i], vs[j], us[i + 1] - us[i], vs[j + 1] - vs[j], x + xs[i] * k, y + xs[j] * k, (xs[i + 1] - xs[i]) * k, (xs[j + 1] - xs[j]) * k);
  }
}

export function RadialPreview({ snapshot, draft }: { snapshot: ProjectSnapshot; draft: Element }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tabs = rows(draft.tabs);
  const [tabIndex, setTabIndex] = useState(0);
  const tab = tabs[Math.min(tabIndex, tabs.length - 1)];
  const [hover, setHover] = useState(-1);
  const [openedAt, setOpenedAt] = useState(() => performance.now());
  const [now, setNow] = useState(() => performance.now());
  const layout = radialLayout(draft);
  const slices = shownSlices(tab);
  const background = useSheet(snapshot.dir, str(draft.background));
  const images = useIcons(snapshot.dir, [...new Set([...slices.map((s) => s.icon), str(draft.sliceImage), str(draft.hoverImage), str(draft.disabledImage)].filter(Boolean))]);
  /** Canvas pixels per GUI pixel: the wheel and its background padding fit the canvas, at most 2x. */
  const k = Math.min(2, (CANVAS - 8) / (layout.size + 2 * (draft.background ? layout.padding : 0)));

  useEffect(() => onAnimationTick(setNow), []);

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, CANVAS, CANVAS);
    // The game draws the wheel over the world, so its text colours are seen on a dark scene in both themes.
    g.fillStyle = SCENE;
    g.fillRect(0, 0, CANVAS, CANVAS);
    // The opening transition (shared rule): size, alpha and a slide as a fraction of the wheel's size.
    const age = (now - openedAt) / TICK_MS;
    const opening = transitionState(layout.timing.appear, age, false);
    const c = CANVAS / 2;
    g.save();
    g.translate(c, c - opening.offset * layout.size * k);
    g.scale(opening.scale, opening.scale);
    g.globalAlpha = opening.alpha;
    const half = layout.size / 2;
    if (background) drawBackground(g, background, draft.backgroundMode === "nine_slice" ? Math.round(Number(draft.sliceBorder ?? 4)) || 4 : 0, -(half + layout.padding) * k, -(half + layout.padding) * k, layout.size + 2 * layout.padding, k);
    const n = slices.length;
    slices.forEach((s, i) => {
      g.save();
      g.rotate(sliceAngle(i, n));
      g.drawImage(sector(n, layout.hole, layout.gap, s.disabled ? layout.disabled : i === hover ? layout.hover : layout.slice), -half * k, -half * k, layout.size * k, layout.size * k);
      g.restore();
      const p = sliceCenter(i, n, layout.size, layout.hole);
      const frame = images.get(s.disabled && draft.disabledImage ? str(draft.disabledImage) : i === hover && draft.hoverImage ? str(draft.hoverImage) : str(draft.sliceImage));
      if (frame) drawPart(g, frame, 0, 0, 0, frame.width, frame.frameHeight, (p.x - layout.sliceImageSize / 2) * k, (p.y - layout.sliceImageSize / 2) * k, layout.sliceImageSize * k, layout.sliceImageSize * k);
      const icon = images.get(s.icon);
      const size = layout.iconSize * k;
      // Icons play on the shared clock; a once mode counts from when the wheel opened, as in the game.
      if (icon) drawPart(g, icon, sheetTick(icon, Math.floor(now / TICK_MS), age), 0, 0, icon.width, icon.frameHeight, p.x * k - size / 2, p.y * k - size / 2, size, size);
      else if (s.item) {
        // Items are drawn by the game; the preview names them.
        g.font = `${Math.round(5 * k)}px monospace`;
        g.fillStyle = css(0xff000000 | layout.text);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(s.item.replace(/^.*:/, "").slice(0, 6), p.x * k, p.y * k);
      }
    });
    const over = slices[hover];
    const title = over ? (draft.showLabel !== false ? over.label : "") : str(draft.title);
    const description = over && draft.showDescription !== false ? over.description : "";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `${Math.round(8 * k)}px monospace`;
    g.fillStyle = css(0xff000000 | layout.text);
    if (title) g.fillText(title, 0, description ? -5 * k : 0);
    g.fillStyle = "#a0a0a0";
    if (description) g.fillText(description, 0, 5 * k);
    g.restore();
  });

  const onMove = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const dx = ((e.clientX - r.left) * CANVAS) / r.width - CANVAS / 2, dy = ((e.clientY - r.top) * CANVAS) / r.height - CANVAS / 2;
    setHover(sliceAt(dx / k, dy / k, slices.length, deadZone(layout.size, layout.hole)));
  };

  return (
    <aside className="formpreview radialpreview" aria-label={t("preview.title")}>
      <div className="pvtitle">{t("preview.title")}</div>
      <canvas ref={canvas} className="pixel radialcanvas" width={CANVAS} height={CANVAS} data-testid="radial-preview" data-hover={hover}
        data-layout={JSON.stringify(layout)} onMouseMove={onMove} onMouseLeave={() => setHover(-1)} />
      <p className="fhelp">{t("radial.hoverHint")}</p>
      {tabs.length > 1 && (
        <TabList className="radialtabs" label={t("radial.tabs")}>
          {tabs.map((row, i) => (
            <button key={i} type="button" role="tab" aria-selected={row === tab} className={row === tab ? "abtn on" : "abtn"} onClick={() => setTabIndex(i)}>
              {str(row.label) || str(row.id) || t("radial.tab", { n: i + 1 })}
            </button>
          ))}
        </TabList>
      )}
      {tab?.source === "folder" && <p className="fhelp">{t("radial.folderHint", { folder: str(tab.folder) })}</p>}
      <button type="button" className="abtn" onClick={() => setOpenedAt(performance.now())}>{t("radial.replay")}</button>
    </aside>
  );
}
