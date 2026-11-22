import { memo } from "react";
import { pixelRects } from "./pixel.tsx";

/** Fixed art colors for element-type sprites; theme independent. */
const PALETTE: Record<string, string> = {
  k: "#15101c", s: "#6f6f75", S: "#9a9aa2", d: "#48484f", p: "#7b48c4", P: "#b48cf2", q: "#43246f",
  t: "#27c7aa", T: "#9ff5e2", w: "#8b5a2b", W: "#c08a4a", D: "#34343e", E: "#56566a", r: "#d8463a",
  R: "#ff9a8e", y: "#f1c232", o: "#e07a1f", O: "#f3b562", g: "#4fa83a", G: "#8fd96a", b: "#3a7bd5",
  B: "#8fc3ff", h: "#f2efe8", Y: "#e3dda0",
};

/** 8x8 type sprites used where an element type, not an element, is shown. */
const SPRITES = {
  stone: ["SsSssSsd", "ssSsdsss", "SssSsSsS", "sdsssssd", "ssSssdSs", "SsssSsss", "sdSsssSs", "dssdsSsd"],
  infuser: ["kkkkkkkk", "kdDDDDdk", "kDtTtTDk", "kDTkkTDk", "kDtkktDk", "kDTtTtDk", "kdDDDDdk", "kkkkkkkk"],
  raw: ["........", "..kkk...", ".kPpqk..", "kPppqqk.", "kpPppqk.", ".kpqqk..", "..kkk...", "........"],
  ingot: ["........", "........", "...kkkkk", "..kPPPpk", ".kPpppqk", "kppppqk.", "kkkkkk..", "........"],
  apple: ["...w....", "...wG...", ".rrrrrr.", "rRrrrrrr", "rRrrrrrr", "rrrrrrrr", ".rrrrrr.", "..rr.rr."],
  pick: [".kkkkk..", "kPPPPpk.", ".kk.wkpk", "...w.kpk", "..w...kk", ".w......", "w.......", "........"],
  chest: [".kk..kk.", "kppkkppk", "kpPPPPpk", ".kpPPpk.", ".kpPPpk.", ".kpppqk.", ".kqqqqk.", ".kkkkkk."],
  recipe: ["wwwwwwww", "wpPwSSwW", "wPpwSSwW", "wwwwwwww", "wSSwpPwW", "wSSwPpwW", "wwwwwwww", "WWWWWWWW"],
  feature: ["gggggggg", "gGggGggG", "wgwwgwwg", "wwwwwwww", "sssspsss", "ssPpssss", "sssssPps", "sdsssqsd"],
  biome: ["qqqqqqqq", "qhqqqqqq", "qqqqqqhq", "qqqPqqqq", "qqqqqqqq", "YYYqqqYY", "YYYYYYYY", "YwYYYwYY"],
  stalker: ["kkkkkkkk", "kqqqqqqk", "kqqqqqqk", "kTtqqtTk", "kqqqqqqk", "kqkkkkqk", "kqqqqqqk", "kkkkkkkk"],
  gui: ["kkkkkkkk", "kSSSSSSk", "kSdSdSdk", "kSSSSSSk", "kSdddSSk", "kSSSSSSk", "kSSSSSSk", "kkkkkkkk"],
  potion: ["...kk...", "...hh...", "..khhk..", ".kPPPPk.", "kPpPPppk", "kppppqqk", ".kqqqqk.", "..kkkk.."],
  proc: ["........", ".bbbbbb.", ".bhhhhb.", ".bbbbbb.", "...bb...", ".oooooo.", ".ohhhho.", ".oooooo."],
  loot: ["kkkkkkkk", "kWWWWWWk", "kWwwwwWk", "kkkyykkk", "kWWyyWWk", "kWwwwwWk", "kWwwwwWk", "kkkkkkkk"],
  tab: ["kkkkk...", "kPPPk...", "kPpPkkkk", "kpppppPk", "kpppppPk", "kpppppPk", "kqqqqqqk", "kkkkkkkk"],
  star: ["...yy...", "..yyyy..", "yyyyyyyy", ".yyyyyy.", "..yyyy..", ".yy..yy.", "yy....yy", "........"],
  flag: ["wwwwwwww", ".rrrrrr.", ".rhhhhr.", ".rrhhrr.", ".rrrrrr.", ".rhrrhr.", ".rrrrrr.", ".r.rr.r."],
  cmd: ["oooooooo", "oOOOOOOo", "oOkOOOOo", "oOOkOOOo", "oOkOkkOo", "oOOOOOOo", "oOOOOOOo", "oooooooo"],
  heart: [".rr..rr.", "rRrrrrrr", "rrrrrrrr", "rrrrrrrr", ".rrrrrr.", "..rrrr..", "...rr...", "........"],
  portal: ["kkkkkkkk", "kPpPpPpk", "kpPpPpPk", "kPpPpPpk", "kpPpPpPk", "kPpPpPpk", "kpPpPpPk", "kkkkkkkk"],
  book: [".kkkkkk.", "kPPPPPPk", "kPhhhhPk", "kPPPPPPk", "kPhhhPPk", "kPPPPPPk", "khhhhhhk", ".kkkkkk."],
  drop: ["...bb...", "...bb...", "..bBbb..", ".bBbbbb.", ".bBbbbb.", ".bbbbbb.", "..bbbb..", "........"],
  key: ["........", "........", ".yyy....", "yk.ky...", "y...yyyy", "yk.ky.yy", ".yyy..y.", "........"],
  particle: ["T.....t.", "...T....", ".t...T..", "....t...", "T.......", "..T..t..", "......T.", ".t.T...."],
  plant: ["..g.....", ".ggG.g..", "gGgggGg.", ".gGgGg..", "...w....", "...w....", "..www...", ".wwwww.."],
  arrow: [".....hhh", "......hh", ".....w.h", "....w...", "...w....", "..w.....", "hw......", "hh......"],
  villager: [".wwwwww.", "wWWWWWWw", "wWkWWkWw", "wWWwwWWw", "wWWwwWWw", "wWWwwWWw", ".wWWWWw.", "..gggg.."],
  emerald: ["...gg...", "..gGgg..", ".gGgggg.", ".gGgggg.", ".gggggg.", "..gggg..", "...gg...", "........"],
  bricks: ["SSSdSSSd", "sssdsssd", "dddddddd", "SdSSSdSS", "sdsssdss", "dddddddd", "SSSdSSSd", "sssdsssd"],
  bars: ["........", "......g.", "......g.", "....y.g.", "....y.g.", "..r.y.g.", "..r.y.g.", "kkkkkkkk"],
  list: ["hhhhhh..", "hSSSShh.", "hhhhhhh.", "hSSSSSh.", "hhhhhhh.", "hSSShhh.", "hhhhhhh.", "........"],
} as const;

export type SpriteName = keyof typeof SPRITES;

const spriteRects = new Map<SpriteName, React.ReactNode[]>();

/** Memoised like Icon (Q280): the rects of each sprite are built once. */
export const Sprite = memo(function Sprite({ name, size }: { name: SpriteName; size: number }) {
  let rects = spriteRects.get(name);
  if (!rects) spriteRects.set(name, (rects = pixelRects(SPRITES[name], (c) => PALETTE[c])));
  return (
    <svg className="spr" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
});
