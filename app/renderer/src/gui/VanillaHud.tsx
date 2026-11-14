import { useEffect, useRef } from "react";

/**
 * The game's own HUD drawn under an overlay's widgets (KUYRUK 169): hotbar with the selected slot, XP bar, health,
 * armor and hunger rows and the crosshair, at the sizes and places vanilla's Gui draws them on a screen of
 * `width` x `height` GUI pixels. MCEdge ships no Minecraft art, so the icons are its own 9x9 drawings; only the
 * sizes and positions are the game's.
 */
export function VanillaHud({ width, height }: { width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (g) drawHud(g, width, height);
  }, [width, height]);
  return <canvas ref={canvas} className="ghud pixel" width={width} height={height} aria-hidden="true" />;
}

/** Where vanilla puts each part (net.minecraft.client.gui.Gui), for a screen of w x h GUI pixels. */
export function hudLayout(w: number, h: number) {
  const left = Math.floor(w / 2) - 91;
  return {
    hotbar: { x: left, y: h - 22, width: 182, height: 22 },
    /** The selected slot's frame (slot 0). */
    selection: { x: left - 1, y: h - 23, width: 24, height: 23 },
    xp: { x: left, y: h - 29, width: 182, height: 5 },
    hearts: Array.from({ length: 10 }, (_, i) => ({ x: left + i * 8, y: h - 39 })),
    armor: Array.from({ length: 10 }, (_, i) => ({ x: left + i * 8, y: h - 49 })),
    food: Array.from({ length: 10 }, (_, i) => ({ x: left + 182 - i * 8 - 9, y: h - 39 })),
    crosshair: { x: Math.floor((w - 15) / 2), y: Math.floor((h - 15) / 2), width: 15, height: 15 },
  };
}

const COLORS: Record<string, string> = {
  K: "#1b1b1b", R: "#d8261d", r: "#a3140f", W: "#ffd6d0",
  B: "#b56a2c", b: "#8a4a1c", O: "#e6d5b8",
  S: "#c9cfd6", s: "#8d959e", H: "#ffffff",
};
const HEART = [
  ".KK...KK.",
  "KRWRKRRRK",
  "KRRRRRRrK",
  "KRRRRRRrK",
  ".KRRRRrK.",
  "..KRRrK..",
  "...KrK...",
  "....K....",
  ".........",
];
const FOOD = [
  ".....KKK.",
  "....KBBBK",
  "...KBBBBK",
  "...KBBBbK",
  "...KBBbK.",
  "..KOKKK..",
  ".KOK.....",
  "KOOK.....",
  ".KK......",
];
const ARMOR = [
  "KKK...KKK",
  "KHSKKKSsK",
  "KSSSSSSsK",
  ".KSSSSsK.",
  ".KSSSSsK.",
  ".KSSSSsK.",
  ".KSSSSsK.",
  ".KKKKKKK.",
  ".........",
];

function icon(g: CanvasRenderingContext2D, rows: string[], x: number, y: number): void {
  rows.forEach((row, dy) => [...row].forEach((c, dx) => {
    if (c === ".") return;
    g.fillStyle = COLORS[c];
    g.fillRect(x + dx, y + dy, 1, 1);
  }));
}

function drawHud(g: CanvasRenderingContext2D, w: number, h: number): void {
  const at = hudLayout(w, h);
  g.clearRect(0, 0, w, h);
  // Hotbar: nine 20 px slots in a dark frame.
  const bar = at.hotbar;
  g.fillStyle = "rgba(0, 0, 0, .55)";
  g.fillRect(bar.x, bar.y, bar.width, bar.height);
  for (let i = 0; i < 9; i++) {
    const x = bar.x + 1 + i * 20, y = bar.y + 1;
    g.fillStyle = "rgba(139, 139, 139, .45)";
    g.fillRect(x + 1, y + 1, 18, 18);
    g.strokeStyle = "#5a5a5a";
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, 19, 19);
  }
  const sel = at.selection;
  g.strokeStyle = "#000";
  g.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.width - 1, sel.height - 1);
  g.strokeStyle = "#fff";
  g.lineWidth = 2;
  g.strokeRect(sel.x + 2, sel.y + 2, sel.width - 4, sel.height - 3);
  g.lineWidth = 1;
  // XP bar, a third full.
  const xp = at.xp;
  g.fillStyle = "#101010";
  g.fillRect(xp.x, xp.y, xp.width, xp.height);
  g.fillStyle = "#2a3a1c";
  g.fillRect(xp.x + 1, xp.y + 1, xp.width - 2, xp.height - 2);
  g.fillStyle = "#80ff20";
  g.fillRect(xp.x + 1, xp.y + 1, Math.round((xp.width - 2) / 3), xp.height - 2);
  at.hearts.forEach((p) => icon(g, HEART, p.x, p.y));
  at.armor.forEach((p) => icon(g, ARMOR, p.x, p.y));
  at.food.forEach((p) => icon(g, FOOD, p.x, p.y));
  // Crosshair: two 1 px lines through the middle of its 15 x 15 box.
  const c = at.crosshair;
  g.fillStyle = "rgba(255, 255, 255, .85)";
  g.fillRect(c.x + 7, c.y + 3, 1, 9);
  g.fillRect(c.x + 3, c.y + 7, 9, 1);
}
