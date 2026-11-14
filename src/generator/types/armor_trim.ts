import type { Element } from "../../elements/model.ts";
import { qualify, str } from "../java.ts";
import type { ElementContext, GenEnv, ResourceFile, TypeModule } from "../typeModule.ts";

/**
 * Armor trims (1.21.5+): the trim pattern, the smithing recipe applying it with the template item, and the trim
 * texture for the outer and leggings layers. 1.21.5 adds the textures to the armor trim atlas, which colors them
 * per material; 26.x reads the palette from the texture's .mcmeta instead.
 */

/** Trim materials of the vanilla armor trim atlas (1.21.5). */
const MATERIALS = ["quartz", "iron", "gold", "diamond", "netherite", "redstone", "copper", "emerald", "lapis", "amethyst", "resin",
  "iron_darker", "gold_darker", "diamond_darker", "netherite_darker"];
const LAYERS = ["humanoid", "humanoid_leggings"];

function element(trim: Element, env: GenEnv): ElementContext {
  const id = qualify(env, trim.id);
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const files: ResourceFile[] = [
    { path: `data/${env.modId}/trim_pattern/${trim.id}.json`, json: json({ asset_id: id, description: { translate: `trim_pattern.${env.modId}.${trim.id}` }, decal: false }) },
    { path: `data/${env.modId}/recipe/${trim.id}_smithing_trim.json`, json: json({
      type: "minecraft:smithing_trim",
      template: qualify(env, str(trim.item)),
      base: "#minecraft:trimmable_armor",
      addition: "#minecraft:trim_materials",
      pattern: id,
    }) },
  ];
  if (env.mc === "26.3") {
    files.push(...LAYERS.map((layer) => ({ path: `assets/${env.modId}/textures/trims/entity/${layer}/${trim.id}.png.mcmeta`, json: json({ palette: { base_palette: "trim_base" } }) })));
  }
  return {
    files,
    textures: LAYERS.map((layer) => ({ from: str(trim.armorTextureFile), to: `trims/entity/${layer}/${trim.id}` })),
  };
}

export default {
  element,
  files: (trims: ElementContext[], env: GenEnv): ResourceFile[] => {
    if (env.mc !== "1.21.5" || !trims.length) return [];
    const source = {
      type: "minecraft:paletted_permutations",
      textures: trims.flatMap((trim) => LAYERS.map((layer) => `${env.modId}:trims/entity/${layer}/${trim.id}`)),
      palette_key: "minecraft:trims/color_palettes/trim_palette",
      permutations: Object.fromEntries(MATERIALS.map((m) => [m, `minecraft:trims/color_palettes/${m}`])),
    };
    return [{ path: "assets/minecraft/atlases/armor_trims.json", json: JSON.stringify({ sources: [source] }, null, 2) }];
  },
} satisfies TypeModule;
