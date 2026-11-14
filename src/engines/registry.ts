import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT } from "../paths.ts";
import type { ToolchainKind } from "./toolchains.ts";

/**
 * An engine turns the IR into a buildable mod project for one Minecraft version + loader.
 * Engines are plugins: a folder with engine.json and optional template layers. Built-in engines
 * live in <root>/engines; user engines in $MCEDGE_ENGINES_DIR or ~/.mcedge/engines and win on id clash.
 */
export interface Engine {
  id: string;
  apiVersion: 1;
  name: string;
  minecraft: string;
  loader: string;
  java: number;
  gradle: { version: string; jdk: number };
  /** Ordered template layers: "@name" = shared library layer, anything else = folder inside the engine. */
  layers: string[];
  versions: Record<string, string>;
  /** Fully qualified API names that differ between engines of the same loader. */
  api: Record<string, string>;
  /** Vanilla creative tab value of element types (MATERIALS) -> the engine's tab constant (INGREDIENTS). */
  creativeTabs: Record<string, string>;
  /** Folder the engine was loaded from. */
  dir: string;
}

const SUPPORTED_API_VERSION = 1;
const SHARED_LAYERS = join(ROOT, "layers");

export function engineSearchPaths(): string[] {
  return [join(ROOT, "engines"), process.env.MCEDGE_ENGINES_DIR ?? join(homedir(), ".mcedge", "engines")];
}

export function listEngines(): Engine[] {
  const byId = new Map<string, Engine>();
  for (const base of engineSearchPaths()) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const manifest = join(base, name, "engine.json");
      if (existsSync(manifest)) {
        const engine = loadEngine(manifest);
        byId.set(engine.id, engine);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function loadEngine(manifestPath: string): Engine {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (raw.apiVersion !== SUPPORTED_API_VERSION) {
    throw new Error(`${manifestPath}: engine apiVersion ${raw.apiVersion} is not supported (expected ${SUPPORTED_API_VERSION})`);
  }
  const { $schema: _, ...engine } = raw;
  return { api: {}, versions: {}, creativeTabs: {}, ...engine, dir: dirname(manifestPath) };
}

/** Absolute folders of an engine's layers, in application order. */
export function layerDirs(engine: Engine): string[] {
  return engine.layers.map((layer) => {
    const dir = layer.startsWith("@") ? join(SHARED_LAYERS, layer.slice(1)) : join(engine.dir, layer);
    if (!existsSync(dir)) throw new Error(`engine ${engine.id}: layer "${layer}" not found at ${dir}`);
    return dir;
  });
}

/** The JDKs and Gradle distribution an engine's builds need. */
export function toolchainNeeds(engine: Engine): { kind: ToolchainKind; version: string | number }[] {
  return [
    { kind: "gradle", version: engine.gradle.version },
    { kind: "jdk", version: engine.gradle.jdk },
    { kind: "jdk", version: engine.java },
  ];
}
