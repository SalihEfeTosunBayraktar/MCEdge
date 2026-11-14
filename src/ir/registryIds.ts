import type { Element, ProjectIssue } from "../elements/model.ts";
import type { ModProject } from "./types.ts";

/**
 * Game registry ids the generators give an element besides its own: a block's item, a fluid's flowing fluid and
 * bucket, a sign's wall block, armor pieces, spawn eggs and mob projectiles. Two claims of the same id in the same
 * registry would register twice and crash the game, so validation reports them before a build.
 */

const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface RegistryClaim {
  registry: "item" | "block" | "fluid" | "entity_type";
  id: string;
}

const ARMOR_PIECES: [string, string][] = [["Helmet", "helmet"], ["Body", "chestplate"], ["Leggings", "leggings"], ["Boots", "boots"]];

/** Registry ids an element of a type takes in the item, block, fluid and entity type registries. */
export function registryClaims(typeId: string, e: Element): RegistryClaim[] {
  const id = e.id;
  const claims: RegistryClaim[] = [];
  const add = (registry: RegistryClaim["registry"], name: string) => claims.push({ registry, id: name });
  switch (typeId) {
    case "item":
    case "tool":
      add("item", id);
      break;
    case "block":
    case "plant":
      add("block", id);
      if (e.hasBlockItem !== false) add("item", id);
      if (e.blockBase === "Sign" || e.blockBase === "HangingSign") add("block", `${id}_wall`);
      break;
    case "fluid":
      add("fluid", id);
      add("fluid", `flowing_${id}`);
      add("block", id);
      if (e.generateBucket === true) add("item", `${id}_bucket`);
      break;
    case "armor":
      for (const [field, suffix] of ARMOR_PIECES) if (e[`enable${field}`] === true) add("item", `${id}_${suffix}`);
      break;
    case "living_entity":
      add("entity_type", id);
      if (e.hasSpawnEgg === true) add("item", `${id}_spawn_egg`);
      if (e.ranged === true && str(e.rangedItemType || "Default item") === "Default item" && str(e.rangedAttackItem)) add("entity_type", `${id}_projectile`);
      break;
    case "projectile":
      add("entity_type", id);
      break;
    case "special_entity":
      add("entity_type", id);
      add("item", id);
      break;
  }
  return claims;
}

/** Issues for registry ids claimed by more than one element: path of the later claimant and the message. */
export function registryIdIssues(project: ModProject): ProjectIssue[] {
  const owners = new Map<string, string>();
  const issues: ProjectIssue[] = [];
  for (const [typeId, elements] of Object.entries(project.elements)) {
    for (const element of elements) {
      const path = `${typeId}/${element.id}`;
      for (const claim of registryClaims(typeId, element)) {
        const key = `${claim.registry}:${claim.id}`;
        const owner = owners.get(key);
        if (owner && owner !== path) issues.push({ path: `${path}.id`, message: `${claim.registry} id "${claim.id}" is also used by ${owner}`, code: "registryIdClash", values: { registry: claim.registry, value: claim.id, owner } });
        else owners.set(key, path);
      }
    }
  }
  return issues;
}
