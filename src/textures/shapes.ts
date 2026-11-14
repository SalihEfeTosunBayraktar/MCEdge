/**
 * Pixel shapes of the texture editor and the MCP draw tools: lines, rectangles, ellipses and polygons (outline or
 * filled), mirrored drawing and whole-image flips. Shapes are point lists; callers paint them in their colour.
 */
export type Point = [number, number];
export type ShapeKind = "line" | "rect" | "ellipse" | "polygon";

/** Points of a straight pixel line (Bresenham), both ends included. */
export function line(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) (err += dy, (x0 += sx));
    if (e2 <= dx) (err += dx, (y0 += sy));
  }
}

/** Rectangle between two corners (any order), both included. */
export function rect(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0], [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  const points: Point[] = [];
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) if (filled || x === l || x === r || y === t || y === b) points.push([x, y]);
  return points;
}

/** Ellipse inside the box of two corners; the outline is the inside pixels with a 4-neighbour outside. */
export function ellipse(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0], [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2 + 0.5, ry = (b - t) / 2 + 0.5;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const points: Point[] = [];
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= r; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) points.push([x, y]);
    }
  }
  return points;
}

/** Closed polygon through the vertices; filled by even-odd at pixel centres, outline always drawn. */
export function polygon(vertices: Point[], filled: boolean): Point[] {
  if (!vertices.length) return [];
  const points: Point[] = vertices.flatMap((v, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return line(v[0], v[1], next[0], next[1]);
  });
  if (!filled || vertices.length < 3) return points;
  const ys = vertices.map((v) => v[1]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    vertices.forEach(([ax, ay], i) => {
      const [bx, by] = vertices[(i + 1) % vertices.length];
      const a = [ax + 0.5, ay + 0.5], b2 = [bx + 0.5, by + 0.5];
      if ((a[1] <= cy && b2[1] > cy) || (b2[1] <= cy && a[1] > cy)) xs.push(a[0] + ((cy - a[1]) / (b2[1] - a[1])) * (b2[0] - a[0]));
    });
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) points.push([x, y]);
  }
  return points;
}

export function shape(kind: ShapeKind, points: Point[], filled: boolean): Point[] {
  const [a, b = a] = [points[0], points.at(-1)!];
  if (!a) return [];
  if (kind === "line") return points.slice(1).flatMap((p, i) => line(points[i][0], points[i][1], p[0], p[1])).concat(points.length === 1 ? [a] : []);
  if (kind === "rect") return rect(a[0], a[1], b[0], b[1], filled);
  if (kind === "ellipse") return ellipse(a[0], a[1], b[0], b[1], filled);
  return polygon(points, filled);
}

/** Mirrored drawing: every point also on the other side of the vertical (x) and/or horizontal (y) centre line. */
export function mirror(points: Point[], width: number, height: number, mode: { x?: boolean; y?: boolean }): Point[] {
  let out = points;
  if (mode.x) out = out.concat(out.map(([x, y]) => [width - 1 - x, y] as Point));
  if (mode.y) out = out.concat(out.map(([x, y]) => [x, height - 1 - y] as Point));
  return out;
}

/** Whole image flipped left-right ("horizontal") or top-bottom ("vertical"), RGBA rows. */
export function flip<T extends Uint8Array | Uint8ClampedArray>(data: T, width: number, height: number, axis: "horizontal" | "vertical"): T {
  const out = data.slice() as T;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = axis === "horizontal" ? [width - 1 - x, y] : [x, height - 1 - y];
      out.set(data.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}
