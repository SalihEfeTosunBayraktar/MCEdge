import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

/** Copies a project texture to any file, with its animation (.mcmeta) when it has one. Returns the files written. */
export function exportTexture(projectDir: string, path: string, target: string): string[] {
  const source = join(projectDir, path);
  const rel = relative(projectDir, source);
  if (rel.startsWith("..") || isAbsolute(rel) || !/\.png$/i.test(path) || !existsSync(source)) throw new Error(`no project texture ${path}`);
  if (!isAbsolute(target)) throw new Error(`the target must be an absolute path: ${target}`);
  const file = /\.png$/i.test(target) ? target : `${target}.png`;
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(source, file);
  if (!existsSync(`${source}.mcmeta`)) return [file];
  copyFileSync(`${source}.mcmeta`, `${file}.mcmeta`);
  return [file, `${file}.mcmeta`];
}
