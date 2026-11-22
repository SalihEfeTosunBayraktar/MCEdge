import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { listEngines } from "../engines/registry.ts";
import { ROOT } from "../paths.ts";
import { changeModIdentity } from "./modIdentity.ts";
import { applyStarter, listStarters } from "./starters.ts";
import { loadProject, saveModInfo, saveProject } from "./storage.ts";
import type { ModProject } from "./types.ts";

/**
 * New project (KUYRUK 126): the welcome screen, File > New project and the MCP create_project tool make a project
 * folder from a mod id, name, package, engines and a template. "empty" has no elements; "example" starts from the
 * bundled example (an item, a block, a tool, recipes and a creative tab) renamed to the new mod id and package.
 */
export const PROJECT_TEMPLATES = ["empty", "example"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

export interface NewProject {
  /** Absolute folder the project folder is created in. */
  parent: string;
  /** Name of the project folder; the mod id when left out. */
  folder?: string;
  name: string;
  modId: string;
  package: string;
  /** Engines the project targets (all when left out). */
  engines?: string[];
  template: ProjectTemplate;
  /** A starter of the gallery (Q252) added to an empty project; `template` is ignored then. */
  starter?: { id: string; params: Record<string, string> };
  author?: string;
}

const MOD_ID = /^[a-z][a-z0-9_]{1,63}$/;
const PACKAGE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const FOLDER = /^[^<>:"/\\|?*\x00-\x1f]+$/;

/** A package suggested for a mod id: "com.<author or example>.<mod id>". */
export function suggestPackage(modId: string, author = ""): string {
  const owner = author.toLowerCase().replace(/[^a-z0-9_]/g, "") || "example";
  return `com.${/^[a-z_]/.test(owner) ? owner : `_${owner}`}.${modId || "mymod"}`;
}

/** A mod id suggested for a display name: "Ruby Tools" -> "ruby_tools". */
export function suggestModId(name: string): string {
  const id = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "mod_$1");
  return id.slice(0, 64);
}

/** Why the options cannot make a project, or undefined. Checks the target folder too. */
export function newProjectProblem(options: NewProject): string | undefined {
  if (!options.name.trim()) return "the name is empty";
  if (!MOD_ID.test(options.modId)) return `"${options.modId}" is not a valid mod id: 2-64 lowercase letters, digits and _, starting with a letter`;
  if (!PACKAGE.test(options.package)) return `"${options.package}" is not a valid Java package: lowercase names separated by dots`;
  if (options.starter && !listStarters().some((s) => s.id === options.starter!.id)) return `no starter "${options.starter.id}" in the gallery; see list_starters`;
  if (!options.starter && !(PROJECT_TEMPLATES as readonly string[]).includes(options.template)) return `template must be one of ${PROJECT_TEMPLATES.join(", ")}`;
  const known = listEngines().map((e) => e.id);
  const unknown = (options.engines ?? []).filter((e) => !known.includes(e));
  if (unknown.length) return `unknown engine ${unknown.join(", ")}; one of ${known.join(", ")}`;
  if (options.engines && !options.engines.length) return "pick at least one engine";
  if (!isAbsolute(options.parent)) return "the location must be an absolute folder";
  const folder = options.folder ?? options.modId;
  if (!FOLDER.test(folder) || folder === "." || folder === "..") return `"${folder}" is not a valid folder name`;
  const dir = resolve(options.parent, folder);
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length)) return `${dir} already exists and is not empty`;
  return undefined;
}

/** Creates the project folder; returns its path. */
export function createProject(options: NewProject): string {
  const problem = newProjectProblem(options);
  if (problem) throw new Error(problem);
  const dir = resolve(options.parent, options.folder ?? options.modId);
  mkdirSync(dir, { recursive: true });
  const engines = options.engines?.length && options.engines.length < listEngines().length ? { engines: options.engines } : {};
  if (options.template === "example" && !options.starter) {
    // The example's own files, then its mod id and package changed everywhere (elements, lang keys, folders).
    const example = join(ROOT, "examples", "hello");
    for (const name of readdirSync(example)) if (name !== "out") cpSync(join(example, name), join(dir, name), { recursive: true });
    const current = loadProject(dir).mod;
    if (current.id !== options.modId || current.package !== options.package) {
      changeModIdentity(dir, { ...(current.id !== options.modId ? { modId: options.modId } : {}), ...(current.package !== options.package ? { package: options.package } : {}) });
    }
    const mod = loadProject(dir).mod;
    // A starter has no other mods to depend on and none of the example's texts.
    saveModInfo(dir, { ...mod, name: options.name, version: "1.0.0", authors: options.author ? [options.author] : [], description: "", website: "", credits: "", dependencies: [], ...engines });
  } else {
    const project: ModProject = {
      schemaVersion: 2,
      mod: {
        id: options.modId, name: options.name, version: "1.0.0", package: options.package, authors: options.author ? [options.author] : [],
        description: "", license: "All Rights Reserved", website: "", credits: "", logo: "", dependencies: [], ...engines,
      },
      elements: {},
      variables: [],
      localization: { en_us: {} },
    };
    saveProject(dir, project);
    writeFileSync(join(dir, ".gitignore"), "out/\n");
    if (options.starter) {
      // A starter that cannot be added leaves no half-made project behind (the folder was new or empty).
      try {
        const result = applyStarter(dir, options.starter.id, options.starter.params);
        if (!result.applied) throw new Error(`the starter could not be added: ${[...result.errors.map((e) => e.message), ...result.newProblems.map((p) => `${p.path}: ${p.message}`)].join("; ")}`);
      } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
      }
    }
  }
  return dir;
}
