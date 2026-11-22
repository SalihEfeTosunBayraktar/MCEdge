import { useEffect, useRef, useState } from "react";
import { useTexture } from "../hooks/useTexture.ts";
import { animationClock, drawFrame, loadPreviewTexture, onAnimationTick, type PreviewTexture } from "../textures/animatedTexture.ts";
import { widgetSchedule, type WidgetAnimationFields, type WidgetTextureRule } from "../../../../src/resources/widgetAnimation.ts";
import { applyImageFilter, imageFilterOf, type ImageFilter, type ImageFilterFields } from "../../../../src/resources/imageFilter.ts";

/** Q273: the image with the widget's opacity and tint on its visible pixels, as the generator bakes it. */
async function filtered(image: HTMLImageElement, filter: ImageFilter): Promise<HTMLImageElement> {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: image.naturalWidth, height: image.naturalHeight });
  const g = canvas.getContext("2d")!;
  g.drawImage(image, 0, 0);
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
  applyImageFilter(pixels.data, filter);
  g.putImageData(pixels, 0, 0);
  const out = new Image();
  out.src = canvas.toDataURL();
  await out.decode();
  return out;
}

/**
 * A widget texture on the GUI editor canvas, drawn like the generated screen draws it (KUYRUK 160): a still texture as
 * the image it is, an animated one as one frame at a time on the shared animation clock. `onSize` gets the size one
 * frame is drawn at by default (the whole image when still). `look` gives the widget's opacity and tint (Q273).
 */
export function WidgetTexture({ dir, path, rule, widget, look, className = "", onSize }: {
  dir: string;
  path: string;
  rule: WidgetTextureRule;
  widget?: WidgetAnimationFields;
  look?: ImageFilterFields;
  className?: string;
  onSize?: (size: { w: number; h: number }) => void;
}) {
  const url = useTexture(dir, path);
  const [texture, setTexture] = useState<PreviewTexture>();
  const animated = widget?.animated, frameTime = widget?.frameTime, frameCount = widget?.frameCount, frame = widget?.frame;
  const filter = look ? imageFilterOf(look) : undefined;
  const filterKey = filter ? JSON.stringify(filter) : "";
  useEffect(() => {
    setTexture(undefined);
    if (!url) return;
    let alive = true;
    loadPreviewTexture(dir, path).then(async (loaded) => {
      const image = filter ? await filtered(loaded.image, filter) : loaded.image;
      if (!alive) return;
      const { naturalWidth: w, naturalHeight: h } = image;
      const schedule = widgetSchedule(rule, w, h, loaded.mcmeta, { animated, frameTime, frameCount, frame });
      setTexture({ image, schedule });
      onSize?.(schedule ? { w: schedule.frameWidth, h: schedule.frameHeight } : { w, h });
    }, () => {});
    return () => void (alive = false);
    // onSize is a callback of the caller's render; the size only changes with the texture. filterKey stands for
    // filter, a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, path, url, rule, animated, frameTime, frameCount, frame, filterKey]);
  if (!url) return null;
  if (!texture?.schedule) return <img className={`pixel ${className}`} src={filter ? texture?.image.src : url} alt="" draggable={false} />;
  return <FrameCanvas texture={texture} className={className} />;
}

function FrameCanvas({ texture, className }: { texture: PreviewTexture; className: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g || !texture.schedule) return;
    Object.assign(g.canvas, { width: texture.schedule.frameWidth, height: texture.schedule.frameHeight });
    drawFrame(g, texture, animationClock());
    return onAnimationTick((ms) => void drawFrame(g, texture, ms));
  }, [texture]);
  return <canvas ref={canvas} className={`pixel ${className}`} data-animated="true" />;
}
