import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { GenEnv } from "./typeModule.ts";

/**
 * Data files a project keeps as they are, under datapack/<namespace>/. They are written in the layout of the version
 * they came from (an imported mod: 1.16.5), and 1.21 renamed the folders and changed the icon of advancements.
 */

/** Folders under data/<namespace>/ whose name changed in 1.21, longest first. */
const MODERN_FOLDERS: [string, string][] = [
  ["tags/items", "tags/item"], ["tags/blocks", "tags/block"], ["tags/entity_types", "tags/entity_type"], ["tags/fluids", "tags/fluid"],
  ["tags/game_events", "tags/game_event"], ["tags/functions", "tags/function"], ["advancements", "advancement"], ["recipes", "recipe"],
  ["loot_tables", "loot_table"], ["structures", "structure"], ["functions", "function"], ["predicates", "predicate"], ["item_modifiers", "item_modifier"],
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** <namespace>/<folder>/... of a modern engine. */
function modernPath(path: string): string {
  const slash = path.indexOf("/");
  const rest = path.slice(slash + 1);
  const renamed = MODERN_FOLDERS.find(([old]) => rest.startsWith(`${old}/`));
  return renamed ? `${path.slice(0, slash + 1)}${renamed[1]}${rest.slice(renamed[0].length)}` : path;
}

/** Copies datapack/ into the mod's data folder for the engine's version. */
export function copyDatapack(env: GenEnv, dataDir: string): void {
  const source = join(env.projectDir, "datapack");
  if (!existsSync(source)) return;
  for (const file of filesUnder(source)) {
    const path = relative(source, file).replaceAll("\\", "/");
    const target = join(dataDir, env.mc === "1.16.5" ? path : modernPath(path));
    mkdirSync(dirname(target), { recursive: true });
    if (env.mc !== "1.16.5" && file.endsWith(".json") && modernPath(path).split("/")[1] === "advancement") {
      const advancement = JSON.parse(readFileSync(file, "utf8"));
      const icon = advancement.display?.icon;
      if (icon?.item) {
        icon.id = icon.item;
        delete icon.item;
      }
      writeFileSync(target, JSON.stringify(advancement, null, 2));
    } else {
      copyFileSync(file, target);
    }
  }
}

/** forge: and c: item and block tags the project defines itself ("forge:key"). */
export function ownTags(projectDir: string): Set<string> {
  const ids = ["forge", "c"].flatMap((namespace) => ["items", "blocks"].flatMap((folder) => {
    const dir = join(projectDir, "datapack", namespace, "tags", folder);
    return existsSync(dir) ? filesUnder(dir).map((file) => `${namespace}:${relative(dir, file).replaceAll("\\", "/").replace(/\.json$/, "")}`) : [];
  }));
  return new Set(ids);
}
