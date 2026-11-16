/**
 * Which side a Java source of a mod runs on, and where it uses API of the other side: client-only classes
 * (net.minecraft.client, blaze3d, loader client packages) in common or server code, and clearly server-only classes
 * (the dedicated server) in client code. The side is a hint, never a blocker: callers show these as warnings.
 * Pure text analysis (no classpath): imports, fully qualified names, @OnlyIn / @Environment / client event
 * subscribers, DistExecutor arguments and `client` packages.
 */

export type Side = "client" | "server" | "common";

export interface SideMarker {
  /** 1-based line and columns (end exclusive), as Monaco markers use them. */
  line: number;
  column: number;
  endColumn: number;
  /** The name as written (simple or qualified). */
  name: string;
  /** Side the used API belongs to. */
  api: "client" | "server";
  /** Side of the code that uses it. */
  usedIn: Side;
}

export interface SideReport {
  /** Side of the file's top-level type. */
  side: Side;
  markers: SideMarker[];
}

const CLIENT_API = [
  "net.minecraft.client.", "com.mojang.blaze3d.", "com.mojang.realmsclient.", "net.minecraftforge.client.", "net.neoforged.neoforge.client.",
  "net.fabricmc.fabric.api.client.", "net.fabricmc.api.ClientModInitializer", "net.minecraftforge.fml.client.", "org.lwjgl.",
];
const SERVER_API = [
  "net.minecraft.server.dedicated.", "net.fabricmc.api.DedicatedServerModInitializer",
  "net.minecraftforge.fml.event.lifecycle.FMLDedicatedServerSetupEvent", "net.neoforged.fml.event.lifecycle.FMLDedicatedServerSetupEvent",
];

const apiSide = (name: string): "client" | "server" | undefined =>
  CLIENT_API.some((p) => name.startsWith(p) || `${name}.` === p) ? "client" : SERVER_API.some((p) => name.startsWith(p) || `${name}.` === p) ? "server" : undefined;

interface Region { from: number; to: number; side: Side }

export function checkSides(source: string): SideReport {
  const code = maskLiterals(source);
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1] ?? "";
  const regions = sideRegions(code);
  const topLevel = /^(?:public\s+|final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record|@interface)\s+\w+/m.exec(code);
  const topRegion = topLevel ? regions.find((r) => r.from <= topLevel.index && r.to > topLevel.index) : undefined;
  let side: Side = topRegion?.side ?? "common";
  if (side === "common" && /(^|\.)client(\.|$)/.test(pkg)) side = "client";
  if (side === "common" && /\bimplements\s+[\w.,\s<>]*\bClientModInitializer\b/.test(code)) side = "client";
  if (side === "common" && /\bimplements\s+[\w.,\s<>]*\bDedicatedServerModInitializer\b/.test(code)) side = "server";

  // Simple names brought in by single-type and static imports.
  const imported = new Map<string, "client" | "server">();
  const skip: [number, number][] = [];
  for (const m of code.matchAll(/^[ \t]*(package|import)\b[^;]*;/gm)) {
    skip.push([m.index, m.index + m[0].length]);
    const target = /^[ \t]*import\s+(?:static\s+)?([\w.]+?)(\.\*)?\s*;/.exec(m[0]);
    if (!target || target[2]) continue;
    const api = apiSide(target[1]);
    if (api) imported.set(target[1].slice(target[1].lastIndexOf(".") + 1), api);
  }

  const sideAt = (offset: number): Side => {
    let best: Region | undefined;
    for (const r of regions) if (r.from <= offset && offset < r.to && (!best || r.from >= best.from)) best = r;
    return best?.side ?? side;
  };
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const position = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };

  const markers: SideMarker[] = [];
  const add = (offset: number, name: string, api: "client" | "server") => {
    const usedIn = sideAt(offset);
    if ((api === "client" && usedIn === "client") || (api === "server" && usedIn !== "client")) return;
    const at = position(offset);
    markers.push({ line: at.line, column: at.column, endColumn: at.column + name.length, name, api, usedIn });
  };
  const skipped = (offset: number) => skip.some(([a, b]) => offset >= a && offset < b);
  // Fully qualified names, then imported simple names (not after a dot: `other.Minecraft` is someone else's member).
  for (const m of code.matchAll(/\b[a-z_][\w]*(?:\s*\.\s*[\w$]+)+/g)) {
    if (skipped(m.index) || (m.index > 0 && code[m.index - 1] === ".")) continue;
    const name = m[0].replace(/\s+/g, "");
    const api = apiSide(name);
    if (api) add(m.index, m[0], api);
  }
  if (imported.size) {
    for (const m of code.matchAll(/[\w$]+/g)) {
      const api = imported.get(m[0]);
      if (!api || skipped(m.index) || /[\w$.]/.test(code[m.index - 1] ?? "") || /@\s*$/.test(code.slice(Math.max(0, m.index - 2), m.index))) continue;
      add(m.index, m[0], api);
    }
  }
  markers.sort((a, b) => a.line - b.line || a.column - b.column);
  return { side, markers };
}

/** Spans whose side is stated in the code: annotated declarations and DistExecutor arguments. */
function sideRegions(code: string): Region[] {
  const regions: Region[] = [];
  const annotation = /@(?:[\w.]*\.)?(OnlyIn|Environment|EventBusSubscriber)\s*\(([^)]*)\)/g;
  for (const m of code.matchAll(annotation)) {
    const args = m[2];
    const side: Side | undefined = /\b(Dist|EnvType)\s*\.\s*CLIENT\b/.test(args) && !/\bDEDICATED_SERVER\b|\bEnvType\s*\.\s*SERVER\b/.test(args) ? "client"
      : /\bDist\s*\.\s*DEDICATED_SERVER\b|\bEnvType\s*\.\s*SERVER\b/.test(args) && !/\bCLIENT\b/.test(args) ? "server" : undefined;
    if (!side) continue;
    const end = declarationEnd(code, m.index + m[0].length);
    regions.push({ from: m.index, to: end, side });
  }
  // DistExecutor.(unsafe|safe)(Run|Call)WhenOn(Dist.CLIENT, ...) and runForDist(client, server).
  for (const m of code.matchAll(/\bDistExecutor\s*\.\s*(\w+)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matching(code, open, "(", ")");
    const args = splitArgs(code, open + 1, close);
    if (/ForDist$/.test(m[1]) && args.length >= 2) {
      regions.push({ from: args[0][0], to: args[0][1], side: "client" }, { from: args[1][0], to: args[1][1], side: "server" });
    } else if (/WhenOn$/.test(m[1]) && args.length >= 2) {
      const dist = code.slice(args[0][0], args[0][1]);
      const side: Side | undefined = /\bCLIENT\b/.test(dist) ? "client" : /\bDEDICATED_SERVER\b/.test(dist) ? "server" : undefined;
      if (side) regions.push({ from: args[1][0], to: close, side });
    }
  }
  return regions;
}

/** End of the declaration after an annotation: its body's closing brace, or the `;` of a field. */
function declarationEnd(code: string, from: number): number {
  let i = from;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "(") i = matching(code, i, "(", ")") + 1;
    else if (ch === "{") return matching(code, i, "{", "}") + 1;
    else if (ch === ";") return i + 1;
    else i++;
  }
  return code.length;
}

function matching(code: string, open: number, a: string, b: string): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === a) depth++;
    else if (code[i] === b && --depth === 0) return i;
  }
  return code.length;
}

/** Top-level argument spans between `from` and `to` (exclusive). */
function splitArgs(code: string, from: number, to: number): [number, number][] {
  const spans: [number, number][] = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) (spans.push([start, i]), (start = i + 1));
  }
  spans.push([start, to]);
  return spans;
}

/** Comments, strings, text blocks and char literals blanked with spaces (newlines kept), so offsets still line up. */
export function maskLiterals(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === "\"" && source.startsWith("\"\"\"", i)) {
      const end = source.indexOf("\"\"\"", i + 3);
      const stop = end < 0 ? source.length : end + 3;
      blank(i + 1, stop - 1);
      i = stop;
    } else if (ch === "\"" || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}
