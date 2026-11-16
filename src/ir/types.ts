import type { ProjectFolders } from "./folders.ts";
import type { Element } from "../elements/model.ts";

/** MCEdge intermediate representation: the single source of truth for a mod project. */
export interface ModProject {
  /** 2 since element types are data-driven; schema 1 projects are migrated when loaded (src/ir/migrate.ts). */
  schemaVersion: 2;
  mod: ModInfo;
  /** Elements by element type id ("item", "living_entity"); each type stores to elements/<its folder>/<id>.json. */
  elements: Record<string, Element[]>;
  variables: Variable[];
  /** Translations per language code ("en_us", "tr_tr"); keys are lang keys such as "item.mymod.ruby". */
  localization: Record<string, Record<string, string>>;
  /** How the element list is organised (folders.json); nothing in the mod depends on it. */
  folders?: ProjectFolders;
  /** How the Resources > Textures list is organised (texture-folders.json, placement by texture path); nothing in the mod depends on it. */
  textureFolders?: ProjectFolders;
}

export type { Element };

export interface ModInfo {
  id: string;
  name: string;
  version: string;
  /** Java package for generated code, e.g. "dev.example.hello". */
  package: string;
  authors: string[];
  description: string;
  license: string;
  /** Optional; empty string when unset. */
  website: string;
  credits: string;
  /** PNG path relative to the project, or empty for no logo. */
  logo: string;
  dependencies: Dependency[];
  /** Optional mod integrations the mod uses (config/integrations/<id>.json); none when left out. */
  integrations?: ProjectIntegration[];
  /** Engines the project targets (KUYRUK 126): the engine menu and Build all offer these; all engines when left out. */
  engines?: string[];
  /** Where File > Export publishes the jars (Q238): Modrinth project slug or id, CurseForge project id. */
  publish?: { modrinth?: string; curseforge?: string };
}

export interface ProjectIntegration {
  /** config/integrations/<id>.json */
  id: string;
  /** Required: the other mod must be installed; otherwise it is optional and the integration runs when it is. */
  required: boolean;
}

export interface Dependency {
  modId: string;
  /** "*", an exact version "1.2.0" or a minimum ">=1.2.0"; engines translate it to their own syntax. */
  version: string;
  required: boolean;
  side: "both" | "client" | "server";
  /**
   * Where dev runs get the mod's jar (KUYRUK 152): Modrinth by default (the project with the mod id as slug, or
   * `modrinth`; a mod Modrinth lacks is looked up on CurseForge by its mod id when this computer has a CurseForge key),
   * CurseForge (`curseforge`: project slug or numeric id; KUYRUK 173), or a Maven artifact ("group:artifact:version",
   * {loader} and {mc} filled per engine) from `repository`. The CurseForge key is an app preference, never here.
   */
  source?: { modrinth?: string; curseforge?: string; maven?: string; repository?: string };
}

export const VARIABLE_TYPES = ["number", "logic", "string", "itemstack", "blockstate", "direction"] as const;
export const VARIABLE_SCOPES = ["global_session", "global_world", "global_map", "player_lifetime", "player_persistent"] as const;

export interface Variable {
  name: string;
  type: (typeof VARIABLE_TYPES)[number];
  scope: (typeof VARIABLE_SCOPES)[number];
  /** Initial value as text; interpreted according to the type. */
  initial: string;
}
