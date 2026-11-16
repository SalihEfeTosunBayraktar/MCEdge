import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModResources } from "./resourceIds.ts";

const MAX_FILES = 20_000;

/** Lists a Gradle mod's src/main/resources and reads its sounds.json and lang keys (bad JSON is skipped). */
export function scanModResources(projectDir: string): ModResources {
  const root = join(projectDir, "src", "main", "resources");
  const files: string[] = [];
  const walk = (folder: string, rel: string) => {
    for (const e of readdirSync(folder, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(folder, e.name), path);
      else files.push(path);
    }
  };
  if (existsSync(root)) walk(root, "");
  const sounds: Record<string, string[]> = {};
  const lang: Record<string, string[]> = {};
  for (const file of files) {
    const sound = /^assets\/([^/]+)\/sounds\.json$/.exec(file);
    const langFile = /^assets\/([^/]+)\/lang\/[^/]+\.json$/.exec(file);
    if (!sound && !langFile) continue;
    let keys: string[];
    try {
      keys = Object.keys(JSON.parse(readFileSync(join(root, file), "utf8")));
    } catch {
      continue;
    }
    const target = sound ? sounds : lang;
    const ns = (sound ?? langFile)![1];
    target[ns] = [...new Set([...(target[ns] ?? []), ...keys])];
  }
  return { files, sounds, lang };
}
