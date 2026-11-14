import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { pixelRects } from "./pixel.tsx";

/** 5x7 pixel letters for the wordmark. */
const LETTERS: Record<string, string[]> = {
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
};
const WORD = "MCEDGE";

/** "MCEDGE" in pixel letters: MC in amber, EDGE in text color, with a one-pixel drop shadow. */
export function Wordmark({ px = 3 }: { px?: number }) {
  const width = WORD.length * 6;
  const cells: { x: number; y: number; cls: string }[] = [];
  [...WORD].forEach((letter, i) =>
    LETTERS[letter].forEach((row, y) =>
      [...row].forEach((c, x) => c === "#" && cells.push({ x: i * 6 + x, y, cls: i < 2 ? "wm-a" : "wm-b" })),
    ),
  );
  return (
    <svg className="wordmark" width={width * px} height={8 * px} viewBox={`0 0 ${width} 8`} shapeRendering="crispEdges"
      role="img" aria-label={t("appName")}>
      {cells.map((c) => <rect key={`s${c.x}:${c.y}`} className="wm-s" x={c.x + 1} y={c.y + 1} width={1} height={1} />)}
      {cells.map((c) => <rect key={`${c.x}:${c.y}`} className={c.cls} x={c.x} y={c.y} width={1} height={1} />)}
    </svg>
  );
}

/** Logo mark: a block whose top-left edge is cut and lit. */
export function LogoMark({ px = 2 }: { px?: number }) {
  const rows = ["..aaaaaa", ".abbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", "abbbbbbc", "cccccccc"];
  return (
    <svg className="logomark" width={8 * px} height={8 * px} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      {pixelRects(rows, (c) => `var(--logo-${c})`)}
    </svg>
  );
}

const FLAGS: Record<string, { rows: string[]; colors: Record<string, string> }> = {
  en: {
    rows: ["bbbbbrrrrrrr", "bbbbbwwwwwww", "bbbbbrrrrrrr", "bbbbbwwwwwww", "rrrrrrrrrrrr", "wwwwwwwwwwww", "rrrrrrrrrrrr", "wwwwwwwwwwww"],
    colors: { b: "#2d3f8f", r: "#c8323c", w: "#f4f4f4" },
  },
  tr: {
    rows: ["rrrrrrrrrrrr", "rrrwwwrrrrrr", "rrwwrrrrrrrr", "rrwrrrrwrrrr", "rrwrrrwwwrrr", "rrwwrrrwrrrr", "rrrwwwrrrrrr", "rrrrrrrrrrrr"],
    colors: { r: "#d42a2a", w: "#ffffff" },
  },
  de: {
    rows: ["kkkkkkkkkkkk", "kkkkkkkkkkkk", "kkkkkkkkkkkk", "rrrrrrrrrrrr", "rrrrrrrrrrrr", "yyyyyyyyyyyy", "yyyyyyyyyyyy", "yyyyyyyyyyyy"],
    colors: { k: "#1b1b1b", r: "#d22d2d", y: "#f2c230" },
  },
  fr: {
    rows: Array(8).fill("bbbbwwwwrrrr"),
    colors: { b: "#2d4fa8", w: "#f4f4f4", r: "#d33a3a" },
  },
};

/** Striped 12x8 flag: horizontal bands top to bottom, or vertical bands left to right. */
function bands(direction: "h" | "v", ...colors: string[]): { rows: string[]; colors: Record<string, string> } {
  const letters = colors.map((_, i) => String.fromCharCode(97 + i));
  const pick = (at: number, size: number) => letters[Math.min(colors.length - 1, Math.floor((at * colors.length) / size))];
  const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 12 }, (_, x) => (direction === "h" ? pick(y, 8) : pick(x, 12))).join(""));
  return { rows, colors: Object.fromEntries(letters.map((l, i) => [l, colors[i]])) };
}

/** Flags by country (the code's second part), for languages whose country differs from the language prefix. */
const REGION_FLAGS: Record<string, { rows: string[]; colors: Record<string, string> }> = {
  it: bands("v", "#2f8f46", "#f4f4f4", "#d33a3a"),
  be: bands("v", "#1b1b1b", "#f2c230", "#d22d2d"),
  ro: bands("v", "#2d4fa8", "#f2c230", "#d22d2d"),
  ru: bands("h", "#f4f4f4", "#2d4fa8", "#d33a3a"),
  nl: bands("h", "#c8323c", "#f4f4f4", "#2d4fa8"),
  hu: bands("h", "#d33a3a", "#f4f4f4", "#3f7a3a"),
  bg: bands("h", "#f4f4f4", "#2f8f46", "#d33a3a"),
  lt: bands("h", "#f2c230", "#2f8f46", "#c8323c"),
  ee: bands("h", "#3a75c4", "#1b1b1b", "#f4f4f4"),
  at: bands("h", "#d33a3a", "#f4f4f4", "#d33a3a"),
  ua: bands("h", "#2d6fc4", "#f2d230"),
  pl: bands("h", "#f4f4f4", "#d33a3a"),
  id: bands("h", "#d33a3a", "#f4f4f4"),
  es: bands("h", "#c8323c", "#f2c230", "#f2c230", "#c8323c"),
  jp: {
    rows: ["wwwwwwwwwwww", "wwwwwwwwwwww", "wwwwwrrwwwww", "wwwwrrrrwwww", "wwwwrrrrwwww", "wwwwwrrwwwww", "wwwwwwwwwwww", "wwwwwwwwwwww"],
    colors: { w: "#f4f4f4", r: "#c8323c" },
  },
  cn: {
    rows: ["rrrrrrrrrrrr", "ryyrrrrrrrrr", "ryyrryrrrrrr", "rrrrrrrrrrrr", "rrrryrrrrrrr", "rrrrrrrrrrrr", "rrrrrrrrrrrr", "rrrrrrrrrrrr"],
    colors: { r: "#d42a2a", y: "#f2d230" },
  },
};

/** Pixel flag for a language code ("tr_tr" -> Turkey, "de_at" -> Austria); unknown languages get a globe. */
export function Flag({ lang }: { lang: string }) {
  const flag = REGION_FLAGS[lang.split("_")[1] ?? ""] ?? FLAGS[lang.slice(0, 2)];
  if (!flag) return <Icon name="globe" size={12} />;
  return (
    <svg className="flag" width={18} height={12} viewBox="0 0 12 8" shapeRendering="crispEdges" aria-hidden="true">
      {pixelRects(flag.rows, (c) => flag.colors[c])}
    </svg>
  );
}
