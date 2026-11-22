import { useEffect, useRef } from "react";
import { eachTextPixel, FONT_HEIGHT, shadowOf, textWidth } from "../../../../src/elements/pixelFont.ts";

/**
 * Text on the GUI editor canvas in the preview pixel font (Q276), so it has the game's widths and sits where the game
 * draws it: the glyphs' top row at the widget's y, `scale` GUI pixels per font pixel, and Minecraft's shadow one font
 * pixel down and right when `shadow`. The canvas is the text's width and 9 font pixels high (8 rows and the shadow).
 */
export function PixelText({ text, color, zoom, scale = 1, shadow = false, className = "" }: {
  text: string;
  color: string;
  zoom: number;
  scale?: number;
  shadow?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const px = zoom * scale;
  const width = Math.max(1, textWidth(text)), height = FONT_HEIGHT + 1;
  useEffect(() => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g) return;
    Object.assign(c, { width: Math.ceil(width * px), height: Math.ceil(height * px) });
    const rgb = (/^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : [255, 255, 255]) as [number, number, number];
    const paint = (fill: [number, number, number], dx: number) => {
      g.fillStyle = `rgb(${fill.join(",")})`;
      eachTextPixel(text, (x, y) => g.fillRect(Math.round((x + dx) * px), Math.round((y + dx) * px), Math.ceil(px), Math.ceil(px)));
    };
    if (shadow) paint(shadowOf(rgb), 1);
    paint(rgb, 0);
  }, [text, color, px, shadow, width, height]);
  return <canvas ref={canvas} className={`gpixeltext ${className}`} style={{ width: width * px, height: height * px }} aria-label={text} />;
}
