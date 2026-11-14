import type { Element } from "../../elements/model.ts";
import { qualify, str } from "../java.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Banner patterns (1.21.5+): a banner_pattern registry file, the banner and shield textures (picked up by the
 * vanilla atlases from entity/banner and entity/shield), a name per dye color, and the no_item_required tag when
 * the loom offers the pattern without an item. Items provide patterns through their "providedBannerPatterns".
 */
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const label = (color: string) => color.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function element(pattern: Element, env: GenEnv): ElementContext {
  const key = `block.${env.modId}.banner.${pattern.id}`;
  const name = str(pattern.name);
  return {
    files: [{ path: `data/${env.modId}/banner_pattern/${pattern.id}.json`, json: JSON.stringify({ asset_id: qualify(env, pattern.id), translation_key: key }, null, 2) }],
    textures: [
      { from: str(pattern.texture), to: `entity/banner/${pattern.id}` },
      { from: str(pattern.shieldTexture), to: `entity/shield/${pattern.id}` },
    ],
    tags: pattern.requireItem === true ? [] : [{ registry: "banner_pattern", tag: "minecraft:no_item_required", value: qualify(env, pattern.id) }],
    lang: Object.fromEntries(COLORS.map((color) => [`${key}.${color}`, `${label(color)} ${name}`])),
  };
}

export default { element } satisfies TypeModule;
