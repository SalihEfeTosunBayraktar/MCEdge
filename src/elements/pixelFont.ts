import FONT from "../../config/gui-font.json" with { type: "json" };

/**
 * The GUI preview font (config/gui-font.json, an original pixel font with Minecraft-like glyph widths), shared by the
 * MCP preview (guiDesign.ts) and the GUI editor canvas (Q276), so both measure and draw text as the game lays it out.
 * Rows 0-6 stand above the baseline, row 7 below; a glyph's advance is its width plus 1, like Minecraft's Font.width.
 */
const glyphs = (FONT as { glyphs: Record<string, string[]> }).glyphs;
export const FONT_HEIGHT = 8;

export const glyph = (ch: string): string[] => glyphs[ch] ?? glyphs["?"];

/** Width in GUI pixels at text size 1: every glyph's width plus 1. */
export const textWidth = (text: string): number => [...text].reduce((n, ch) => n + glyph(ch)[0].length + 1, 0);

/** Calls `ink(x, y)` for every inked pixel of `text`, in GUI pixels from its top left at text size 1. */
export function eachTextPixel(text: string, ink: (x: number, y: number) => void): void {
  let x = 0;
  for (const ch of text) {
    const g = glyph(ch);
    g.forEach((row, y) => [...row].forEach((c, gx) => c === "#" && ink(x + gx, y)));
    x += g[0].length + 1;
  }
}

/** Minecraft's text shadow colour: the text colour at a quarter of its brightness. */
export const shadowOf = (rgb: [number, number, number]): [number, number, number] => rgb.map((v) => Math.floor(v / 4)) as [number, number, number];
