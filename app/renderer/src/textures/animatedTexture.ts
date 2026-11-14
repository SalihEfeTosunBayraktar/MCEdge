import { animationSchedule, frameAt, framePosition, type AnimationSchedule } from "../../../../src/resources/textureAnimation.ts";
import { api } from "../api.ts";

/**
 * Project textures as previews draw them (KUYRUK 166, 160): the decoded image and, when a .mcmeta beside it animates
 * it, the schedule; drawFrame paints the frame showing now. Every animated preview follows one shared clock, so the
 * same texture shows the same frame everywhere, as in the game.
 */
export interface PreviewTexture {
  image: HTMLImageElement;
  schedule?: AnimationSchedule;
  /** The .mcmeta text beside the PNG, for callers that play it by their own rule (the GUI editor draws like the generated screen). */
  mcmeta?: string;
}

/** Loads a project texture and its animation. Only an image that is not square can hold frames, so only then is the .mcmeta read. */
export async function loadPreviewTexture(dir: string, path: string): Promise<PreviewTexture> {
  const image = new Image();
  image.src = await api.readTexture(dir, path);
  await image.decode();
  if (image.naturalWidth === image.naturalHeight) return { image };
  let mcmeta: string | undefined;
  try {
    mcmeta = (await api.codeRead(dir, `${path}.mcmeta`)).text;
  } catch {
    // No .mcmeta: a still texture, of which a tall strip shows its first square.
  }
  return { image, mcmeta, schedule: mcmeta ? animationSchedule(mcmeta, image.naturalWidth, image.naturalHeight) : undefined };
}

/** Size of what a preview shows: one frame, or the top square of a strip that does not animate (as the game shows it). */
export function frameSize(texture: PreviewTexture): { width: number; height: number } {
  const { naturalWidth: w, naturalHeight: h } = texture.image;
  if (texture.schedule) return { width: texture.schedule.frameWidth, height: texture.schedule.frameHeight };
  return { width: w, height: h > w ? w : h };
}

/**
 * Paints the frame showing at `ms` (the shared clock) at x, y in `width` x `height`; returns a key of what it painted,
 * so a caller can skip repainting the same frame.
 */
export function drawFrame(g: CanvasRenderingContext2D, texture: PreviewTexture, ms: number, x = 0, y = 0, width?: number, height?: number): string {
  const size = frameSize(texture);
  const w = width ?? size.width, h = height ?? size.height;
  const draw = (index: number, alpha: number) => {
    const at = texture.schedule ? framePosition(texture.schedule, texture.image.naturalWidth, index) : { x: 0, y: 0 };
    g.globalAlpha = alpha;
    g.drawImage(texture.image, at.x, at.y, size.width, size.height, x, y, w, h);
  };
  g.imageSmoothingEnabled = false;
  g.clearRect(x, y, w, h);
  if (!texture.schedule) {
    draw(0, 1);
    return "still";
  }
  const frame = frameAt(texture.schedule, ms);
  draw(frame.index, 1);
  // Interpolation: the next frame over this one, as opaque as the blend is far.
  if (frame.blend > 0) draw(frame.next, frame.blend);
  g.globalAlpha = 1;
  return `${frame.index}:${frame.next}:${frame.blend}`;
}

/** Milliseconds of the shared animation clock. */
export const animationClock = () => performance.now();

const listeners = new Set<(ms: number) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Calls `listener` every game tick (50 ms) with the shared clock while it is subscribed; returns the unsubscribe.
 * A timer, not requestAnimationFrame, so previews also play in a window in the background.
 */
export function onAnimationTick(listener: (ms: number) => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    const ms = animationClock();
    listeners.forEach((l) => l(ms));
  }, 50);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) (clearInterval(timer), (timer = undefined));
  };
}
