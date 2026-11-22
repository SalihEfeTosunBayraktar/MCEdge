/**
 * Opacity and colour filter of a GUI or overlay image widget (Q273), one rule for the generator (applied to the copied
 * texture), the GUI editor canvas and the MCP preview. Only visible pixels change: a fully transparent pixel stays
 * empty. Opacity scales the pixel's alpha; the tint multiplies its colour, mixed in by its strength, so shading stays.
 */
export interface ImageFilter {
  /** 0-100; 100 leaves the alpha as it is. */
  opacity: number;
  /** Multiplied colour, [r, g, b] 0-255; none for no tint. */
  tint?: [number, number, number];
  /** 0-100, how much of the tinted colour replaces the original. */
  strength: number;
}

export interface ImageFilterFields {
  opacity?: unknown;
  tint?: unknown;
  tintStrength?: unknown;
}

const percent = (value: unknown, fallback: number) => {
  const n = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(n) ? fallback : Math.min(100, Math.max(0, Math.round(n)));
};

/** The widget's filter, or undefined when it changes nothing (full opacity, no tint or a zero strength). */
export function imageFilterOf(w: ImageFilterFields): ImageFilter | undefined {
  const opacity = percent(w.opacity, 100);
  const hex = typeof w.tint === "string" && /^#[0-9a-fA-F]{6}$/.test(w.tint) ? w.tint : "";
  const strength = percent(w.tintStrength, 100);
  const tint = hex && strength > 0 ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number] : undefined;
  if (opacity === 100 && !tint) return undefined;
  return { opacity, strength, ...(tint ? { tint } : {}) };
}

/** Applies `filter` in place to RGBA bytes; pixels with alpha 0 are left as they are. */
export function applyImageFilter(data: Uint8Array | Uint8ClampedArray, filter: ImageFilter): void {
  const s = filter.strength / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (filter.tint) {
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - s + (s * filter.tint[c]) / 255));
    }
    if (filter.opacity !== 100) data[i + 3] = Math.round((data[i + 3] * filter.opacity) / 100);
  }
}
