import { useEffect, useRef, useState } from "react";
import { useTexture } from "../hooks/useTexture.ts";
import { animationClock, drawFrame, frameSize, loadPreviewTexture, onAnimationTick, type PreviewTexture } from "../textures/animatedTexture.ts";

/**
 * A project texture at a square size. An animated strip (taller than wide) shows its first frame only, unless
 * `animate` is set: then a .mcmeta animation plays as in the game (KUYRUK 166).
 */
export function Texture({ dir, path, size, animate }: { dir: string; path: string; size: number; animate?: boolean }) {
  const url = useTexture(dir, path);
  const [ratio, setRatio] = useState(1);
  const animation = useAnimation(animate ? dir : "", path, url);
  if (!url) return <span className="pixel placeholder" style={{ width: size, height: size }} />;
  if (animation) return <AnimatedTexture texture={animation} size={size} />;
  const img = (
    <img className="pixel" src={url} width={size} height={ratio > 1 ? size * ratio : size} alt=""
      onLoad={(e) => setRatio(Math.max(1, Math.floor(e.currentTarget.naturalHeight / Math.max(1, e.currentTarget.naturalWidth))))} />
  );
  return ratio > 1 ? <span className="pixel" style={{ width: size, height: size, overflow: "hidden" }}>{img}</span> : img;
}

/**
 * A texture that is read only once its cell is near the visible area (Q280). A list of hundreds (Resources) opened
 * with one read and one data URL per file, 180 MB through IPC and 4 s of the main process for 680 textures; now only
 * the cells on screen load.
 */
export function LazyTexture({ dir, path, size }: { dir: string; path: string; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const cell = ref.current;
    if (!cell || seen) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "240px" });
    observer.observe(cell);
    return () => observer.disconnect();
  }, [seen]);
  return seen ? <Texture dir={dir} path={path} size={size} /> : <span ref={ref} className="pixel placeholder" style={{ width: size, height: size }} />;
}

/** The texture with its animation when it has one (read again when the file is rewritten, which changes `url`). */
function useAnimation(dir: string, path: string, url: string | undefined): PreviewTexture | undefined {
  const [texture, setTexture] = useState<PreviewTexture>();
  useEffect(() => {
    setTexture(undefined);
    if (!dir || !url) return;
    let alive = true;
    loadPreviewTexture(dir, path).then((t) => alive && t.schedule && setTexture(t), () => {});
    return () => void (alive = false);
  }, [dir, path, url]);
  return texture;
}

/** An animated texture on a canvas, repainted on the shared animation clock. */
function AnimatedTexture({ texture, size }: { texture: PreviewTexture; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    Object.assign(g.canvas, frameSize(texture));
    drawFrame(g, texture, animationClock());
    return onAnimationTick((ms) => void drawFrame(g, texture, ms));
  }, [texture]);
  return <canvas ref={canvas} className="pixel" data-animated="true" style={{ width: size, height: size }} />;
}
