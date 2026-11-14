// Writes a saved data file the way MCreator 1.16.5 does: {data: {goldPrice: 7.5d}}, gzip compressed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
const name = (s: string) => { const b = Buffer.from(s, "utf8"); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); return Buffer.concat([h, b]); };
const double = Buffer.alloc(8); double.writeDoubleBE(7.5);
const nbt = Buffer.concat([
  Buffer.from([10]), name(""),
  Buffer.from([10]), name("data"),
  Buffer.from([6]), name("goldPrice"), double,
  Buffer.from([0, 0]),
]);
const file = process.argv[2];
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, gzipSync(nbt));
