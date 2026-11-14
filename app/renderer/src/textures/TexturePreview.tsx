import { useLayoutEffect, useRef } from "react";
import { FormRow } from "../components/ui.tsx";
import { t } from "../strings.ts";
import type { Pixels } from "./pixels.ts";

/** The picture drawn `tiles` x `tiles` times on a canvas shown `scale` times as large (or at `box` px when given). */
function PixelView({ pixels, scale, tiles = 1, box, label }: { pixels: Pixels; scale: number; tiles?: number; box?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Runs on every render of the editor, so the preview follows each stroke.
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = pixels.width * tiles;
    c.height = pixels.height * tiles;
    const g = c.getContext("2d")!;
    const one = document.createElement("canvas");
    one.width = pixels.width;
    one.height = pixels.height;
    one.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    for (let x = 0; x < tiles; x++) for (let y = 0; y < tiles; y++) g.drawImage(one, x * pixels.width, y * pixels.height);
  });
  const width = box ?? pixels.width * tiles * scale, height = box ?? pixels.height * tiles * scale;
  return <canvas ref={ref} className="pixel pvview" style={{ width, height }} role="img" aria-label={label} />;
}

/**
 * The texture being drawn as the game shows it: at real size (1x and 2x), as an item in an inventory slot, and tiled
 * 3 x 3 so the seams of a block texture show. Follows every stroke.
 */
export function TexturePreview({ pixels }: { pixels: Pixels }) {
  // Tiles about 144 px wide in all.
  const tileScale = Math.max(1, Math.floor(144 / (3 * Math.max(pixels.width, pixels.height))));
  return (
    <>
      <FormRow label={t("paint.pvReal")}>
        <div className="pvrow">
          <PixelView pixels={pixels} scale={1} label="1x" />
          <PixelView pixels={pixels} scale={2} label="2x" />
        </div>
      </FormRow>
      <FormRow label={t("paint.pvSlot")}>
        <div className="pvslot"><PixelView pixels={pixels} scale={2} box={32} label={t("paint.pvSlot")} /></div>
      </FormRow>
      <FormRow label={t("paint.pvTiled")}>
        <div className="pvtiled"><PixelView pixels={pixels} scale={tileScale} tiles={3} label={t("paint.pvTiled")} /></div>
      </FormRow>
    </>
  );
}
