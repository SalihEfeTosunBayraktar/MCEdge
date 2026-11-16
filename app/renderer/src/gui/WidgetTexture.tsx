import { useEffect, useRef, useState } from "react";
import { useTexture } from "../hooks/useTexture.ts";
import { animationClock, drawFrame, loadPreviewTexture, onAnimationTick, type PreviewTexture } from "../textures/animatedTexture.ts";
import { widgetSchedule, type WidgetAnimationFields, type WidgetTextureRule } from "../../../../src/resources/widgetAnimation.ts";

/**
 * A widget texture on the GUI editor canvas, drawn like the generated screen draws it (KUYRUK 160): a still texture as
 * the image it is, an animated one as one frame at a time on the shared animation clock. `onSize` gets the size one
 * frame is drawn at by default (the whole image when still).
 */
export function WidgetTexture({ dir, path, rule, widget, className = "", onSize }: {
  dir: string;
  path: string;
  rule: WidgetTextureRule;
  widget?: WidgetAnimationFields;
  className?: string;
  onSize?: (size: { w: number; h: number }) => void;
}) {
  const url = useTexture(dir, path);
  const [texture, setTexture] = useState<PreviewTexture>();
  const animated = widget?.animated, frameTime = widget?.frameTime, frameCount = widget?.frameCount, frame = widget?.frame;
  useEffect(() => {
    setTexture(undefined);
    if (!url) return;
    let alive = true;
    loadPreviewTexture(dir, path).then((loaded) => {
      if (!alive) return;
      const { naturalWidth: w, naturalHeight: h } = loaded.image;
      const schedule = widgetSchedule(rule, w, h, loaded.mcmeta, { animated, frameTime, frameCount, frame });
      setTexture({ image: loaded.image, schedule });
      onSize?.(schedule ? { w: schedule.frameWidth, h: schedule.frameHeight } : { w, h });
    }, () => {});
    return () => void (alive = false);
    // onSize is a callback of the caller's render; the size only changes with the texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, path, url, rule, animated, frameTime, frameCount, frame]);
  if (!url) return null;
  if (!texture?.schedule) return <img className={`pixel ${className}`} src={url} alt="" draggable={false} />;
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
