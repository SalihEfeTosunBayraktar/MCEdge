import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { typeRegistry } from "../elements/registry.ts";
import { loadTags } from "../tags/tags.ts";
import type { DatapackFile, ProjectScanInput } from "./references.ts";
import { loadProject } from "./storage.ts";

/** Datapack texts are scanned up to this size; larger files are binary or generated, not hand-written lists. */
const MAX_DATAPACK_TEXT = 2_000_000;
const DATAPACK_EXTENSIONS = [".json", ".mcfunction", ".txt"];

/** Text files of <project>/datapack (raw data files), project-relative with forward slashes. */
export function loadDatapack(dir: string): DatapackFile[] {
  const files: DatapackFile[] = [];
  const walk = (folder: string, prefix: string) => {
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path, `${prefix}/${name}`);
      else if (DATAPACK_EXTENSIONS.some((e) => name.endsWith(e)) && stat.size <= MAX_DATAPACK_TEXT) files.push({ path: `${prefix}/${name}`, text: readFileSync(path, "utf8") });
    }
  };
  walk(join(dir, "datapack"), "datapack");
  return files;
}

/** Everything the reference scanner and rename need, read from the project folder. */
export function loadReferenceInput(dir: string): ProjectScanInput {
  const project = loadProject(dir);
  return {
    modId: project.mod.id,
    elements: project.elements,
    types: typeRegistry().byId,
    tags: loadTags(dir),
    datapack: loadDatapack(dir),
    project,
    fileExists: (path) => existsSync(resolve(dir, path)),
  };
}
