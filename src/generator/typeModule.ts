import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Element } from "../elements/model.ts";
import type { Engine } from "../engines/registry.ts";
import type { ModProject } from "../ir/types.ts";
import type { Remap } from "./png.ts";
import type { Context } from "./render.ts";

/**
 * A type context module turns the stored elements of one element type into template context. It lives in
 * src/generator/types/<typeId>.ts and default-exports a TypeModule; the generator finds it by file name.
 * Engine differences (class names, enum constants, JSON formats) are computed here so templates stay flat.
 */
export interface TypeModule {
  /**
   * Generate this type's elements as elements of another type (plants as blocks): each element is converted and
   * goes through that type's module and templates. The other members are then unused.
   */
  renderAs?: { type: string; element(element: Element, env: GenEnv): Element };
  /** Context of one element, merged over the element's stored values. */
  element(element: Element, env: GenEnv): ElementContext;
  /** Context derived from all generated elements of the type, merged into the root context. */
  global?(elements: ElementContext[], env: GenEnv): Context;
  /** Resource files built from all generated elements of the type (one data map listing them all, ...). */
  files?(elements: ElementContext[], env: GenEnv): ResourceFile[];
  /** Java sources and initialisation built from all generated elements of the type (procedure runtime). */
  runtime?(elements: ElementContext[], env: GenEnv): { sources?: JavaSourceFile[]; init?: string[]; clientInit?: string[] };
}

/** A generated Java source: `path` is relative to src/main/java. */
export interface JavaSourceFile {
  path: string;
  code: string;
}

/** A generated resource file: `path` is relative to src/main/resources ("data/ns/worldgen/feature/x.json"). */
export interface ResourceFile {
  path: string;
  json: string;
}

/** Element context plus contributions the generator collects across all types. */
export interface ElementContext extends Context {
  /** Extra lang entries (key -> text) for the base language. */
  lang?: Record<string, string>;
  /**
   * Project textures to copy: `from` is project-relative, `to` relative to assets/<modid>/textures (no .png).
   * With `remap` the copy is rearranged into another layout instead.
   */
  /** `half` keeps the top or bottom half of the image (button states stored one above the other). */
  /** `below` puts a second project PNG under the first, scaled to its size (two button states made into one texture). */
  textures?: { from: string; to: string; remap?: Remap; half?: "top" | "bottom"; below?: string }[];
  /** Tag memberships; tags with the same registry and id are merged into one file. */
  tags?: TagEntry[];
  /**
   * Client-only Java statements, run on the physical client only. `colors`: block color registrations (Forge and
   * NeoForge give them the color event as `event`); `itemColors`: 1.16.5 item colors (`event`); `setup`: client
   * setup work (render layers, item model properties).
   */
  client?: { colors?: string[]; itemColors?: string[]; setup?: string[] };
  /** Java statements run when the mod is constructed (Forge/NeoForge, with `modBus` in scope) or initialized (Fabric). */
  init?: string[];
  /** Resource files of this element. */
  files?: ResourceFile[];
  /** Project files copied as they are: `from` project-relative, `to` relative to src/main/resources (structure templates). */
  copies?: { from: string; to: string }[];
  /**
   * Fabric mixin classes (`id` = class name in the mod's mixin package); the same id is generated once. `client`
   * mixins target client-only classes and are listed for the physical client only.
   */
  mixins?: { id: string; code: string; client?: boolean }[];
}

export interface TagEntry {
  /** "item", "block", ... as in data/<ns>/tags/<registry>/. */
  registry: string;
  /** Tag id, "minecraft:pickaxes". */
  tag: string;
  /** Entry id ("mymod:ruby") or "#ns:tag". */
  value: string;
}

/** What a type module may know about the generation target. */
/**
 * Test probe (Q218, Q219): generated into dev builds only (run_scenario, tick_profile, `build --probe`), never into
 * export_jar output or a normal build. `profile` also times every procedure call.
 */
export interface ProbeOptions {
  profile?: boolean;
}

export interface GenEnv {
  engine: Engine;
  project: ModProject;
  /** Folder of the project; element files (textures) are relative to it. */
  projectDir: string;
  modId: string;
  /** Minecraft generation: "1.16.5" (Forge, official mappings), "1.21.5" or "26.3". */
  mc: "1.16.5" | "1.21.5" | "26.3";
  loader: "forge" | "neoforge" | "fabric";
  /** Generated elements by type id (after coverage filtering). */
  generated: Record<string, Element[]>;
  /** forge: and c: tags the project defines itself ("forge:key"). */
  ownTags?: Set<string>;
  /** Set when the build carries the test probe. */
  probe?: ProbeOptions;
}

declare global {
  interface ImportMeta {
    /** Defined by Vite only. */
    env?: unknown;
    glob: (pattern: string, options: { eager: true }) => Record<string, { default: TypeModule }>;
  }
}

/**
 * Type modules by type id. Under Vite (the app bundle) import.meta.glob inlines them; under plain Node they are
 * imported from disk. Vite defines import.meta.env, so the glob call is only evaluated there.
 */
export const TYPE_MODULES: ReadonlyMap<string, TypeModule> = import.meta.env
  ? fromEntries(import.meta.glob("./types/*.ts", { eager: true }))
  : await fromDisk();

function fromEntries(modules: Record<string, { default: TypeModule }>): Map<string, TypeModule> {
  return new Map(Object.entries(modules).map(([path, module]) => [path.replace(/^.*\/(\w+)\.ts$/, "$1"), module.default]));
}

async function fromDisk(): Promise<Map<string, TypeModule>> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "types");
  const files = readdirSync(dir).filter((name) => /^\w+\.ts$/.test(name));
  const modules = await Promise.all(files.map(async (name) => [name.slice(0, -3), await import(pathToFileURL(join(dir, name)).href)] as const));
  return new Map(modules.map(([id, module]) => [id, (module as { default: TypeModule }).default]));
}
