import type { Element } from "../../elements/model.ts";
import { list, qualify, str } from "../java.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Advancements: one advancement file per element. The trigger blockly field needs the advancement trigger block
 * set, which does not exist yet, so every advancement gets the default "custom trigger": an impossible criterion
 * that only commands and procedures grant.
 */

const ROOT = "No parent: root";
type Row = Record<string, unknown>;

/** Resource id of a namespaced element of this mod (function, loot table, recipe): "<ns>:<name>". */
export function elementResource(env: GenEnv, typeId: string, id: string): string {
  const element = env.project.elements[typeId]?.find((e) => e.id === id);
  if (!element) return qualify(env, id);
  const ns = element.namespace === "minecraft" ? "minecraft" : env.modId;
  return `${ns}:${str(element.name) || element.id}`;
}

function element(adv: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const parentRef = str(adv.parent);
  const ownIds = new Set((env.project.elements.advancement ?? []).map((e) => e.id));
  const parent = !parentRef || parentRef === ROOT ? "" : ownIds.has(parentRef) ? `${env.modId}:${parentRef}` : parentRef.includes(":") ? parentRef : `minecraft:${parentRef}`;
  const key = `advancements.${env.modId}.${adv.id}`;
  const textures: ElementContext["textures"] = [];

  let display: Record<string, unknown> | undefined;
  if (adv.disableDisplay !== true) {
    const icon = qualify(env, str(adv.achievementIcon));
    display = {
      icon: legacy ? { item: icon } : { id: icon },
      title: { translate: key },
      description: { translate: `${key}.descr` },
      frame: str(adv.achievementType),
      show_toast: adv.showPopup === true,
      announce_to_chat: adv.announceToChat === true,
      hidden: adv.hideIfNotCompleted === true,
    };
    // A shown root advancement opens a tab and needs a background; others must not have one.
    if (!parent) {
      const background = str(adv.background);
      if (background && background !== "Default") {
        textures.push({ from: background, to: `screen/${adv.id}_background` });
        display.background = legacy ? `${env.modId}:textures/screen/${adv.id}_background.png` : `${env.modId}:screen/${adv.id}_background`;
      } else display.background = legacy ? "minecraft:textures/gui/advancements/backgrounds/stone.png" : "minecraft:gui/advancements/backgrounds/stone";
    }
  }

  const rows = (field: string, sub: string, typeId: string) => list<Row>(adv[field]).map((row) => str(row[sub])).filter(Boolean).map((id) => elementResource(env, typeId, id));
  const xp = Number(adv.rewardXP);
  const fn = str(adv.rewardFunction);
  const loot = rows("rewardLoot", "lootTable", "loot_table");
  const recipes = rows("rewardRecipes", "recipe", "recipe");
  const rewards = {
    ...(xp > 0 ? { experience: xp } : {}),
    ...(fn ? { function: elementResource(env, "function", fn) } : {}),
    ...(loot.length ? { loot } : {}),
    ...(recipes.length ? { recipes } : {}),
  };
  const json = {
    ...(parent ? { parent } : {}),
    ...(display ? { display } : {}),
    criteria: { custom: { trigger: "minecraft:impossible" } },
    ...(Object.keys(rewards).length ? { rewards } : {}),
  };
  return {
    lang: { [`${key}.descr`]: str(adv.achievementDescription) },
    textures,
    files: [{ path: `data/${env.modId}/${legacy ? "advancements" : "advancement"}/${adv.id}.json`, json: JSON.stringify(json, null, 2) }],
  };
}

export default { element } satisfies TypeModule;
