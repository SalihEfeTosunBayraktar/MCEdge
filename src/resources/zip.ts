import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Writes a zip of `dir` (files under `prefix/` inside the archive), skipping folders `skip` says to skip.
 * Plain zip with deflate, no zip64: workspaces are small (sources, PNGs, sounds); returns the file count.
 */
export function zipFolder(dir: string, file: string, prefix: string, skip: (relativePath: string, isDir: boolean) => boolean): number {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const isDir = statSync(path).isDirectory();
      const rel = relative(dir, path).replaceAll("\\", "/");
      if (skip(rel, isDir)) continue;
      if (isDir) {
        walk(path);
        continue;
      }
      const data = readFileSync(path);
      const packed = deflateRawSync(data);
      const stored = packed.length >= data.length;
      const body = stored ? data : packed;
      const nameBytes = Buffer.from(`${prefix}/${rel}`, "utf8");
      const crc = crc32(data);
      const { time, date } = dosTime(statSync(path).mtime);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0800, 6); // UTF-8 names
      head.writeUInt16LE(stored ? 0 : 8, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(body.length, 18);
      head.writeUInt32LE(data.length, 22);
      head.writeUInt16LE(nameBytes.length, 26);
      local.push(head, nameBytes, body);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(stored ? 0 : 8, 10);
      entry.writeUInt16LE(time, 12);
      entry.writeUInt16LE(date, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(body.length, 20);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt16LE(nameBytes.length, 28);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, nameBytes);
      offset += head.length + nameBytes.length + body.length;
      count++;
    }
  };
  walk(dir);
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...local, ...central, end]));
  return count;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Extracts a zip (stored or deflated entries, as zipFolder and common zip tools write) into `target`; returns the
 * relative paths written. Entries that would land outside `target` ("../") are refused.
 */
export function unzipToFolder(file: string, target: string): string[] {
  const zip = readFileSync(file);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const written: string[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    at += 46 + nameLength + extra + comment;
    if (name.endsWith("/")) continue;
    const out = resolve(target, name);
    if (relative(target, out).startsWith("..")) throw new Error(`zip entry outside the folder: ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`zip entry ${name}: unsupported compression ${method}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, method === 8 ? inflateRawSync(body) : body);
    written.push(name);
  }
  return written;
}
