// Minimal NBT writer (gzip) for the structure probe's small template (make.ts).
import { gzipSync } from "node:zlib";

type Nbt = { t: number; v: unknown };
export const tInt = (v: number): Nbt => ({ t: 3, v });
export const tStr = (v: string): Nbt => ({ t: 8, v });
export const tList = (type: number, v: Nbt[]): Nbt => ({ t: 9, v: { type, items: v } });
export const tCompound = (v: Record<string, Nbt>): Nbt => ({ t: 10, v });

function payload(tag: Nbt, out: Buffer[]): void {
  const buf = (n: number, write: (b: Buffer) => void) => { const b = Buffer.alloc(n); write(b); out.push(b); };
  if (tag.t === 3) buf(4, (b) => b.writeInt32BE(tag.v as number));
  else if (tag.t === 8) { const s = Buffer.from(tag.v as string, "utf8"); buf(2, (b) => b.writeUInt16BE(s.length)); out.push(s); }
  else if (tag.t === 9) {
    const { type, items } = tag.v as { type: number; items: Nbt[] };
    buf(5, (b) => { b.writeInt8(type); b.writeInt32BE(items.length, 1); });
    for (const item of items) payload(item, out);
  } else if (tag.t === 10) {
    for (const [name, child] of Object.entries(tag.v as Record<string, Nbt>)) {
      buf(1, (b) => b.writeInt8(child.t));
      const n = Buffer.from(name, "utf8");
      buf(2, (b) => b.writeUInt16BE(n.length));
      out.push(n);
      payload(child, out);
    }
    out.push(Buffer.from([0]));
  }
}

/** A gzip-compressed named root compound. */
export function writeNbt(root: Record<string, Nbt>): Buffer {
  const out: Buffer[] = [Buffer.from([10, 0, 0])];
  payload(tCompound(root), out);
  return gzipSync(Buffer.concat(out));
}
