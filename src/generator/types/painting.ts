import type { Element } from "../../elements/model.ts";
import { qualify, str } from "../java.ts";
import { registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Paintings: a painting variant file (sizes in blocks, translated title and author) placeable from the painting
 * item on 1.21.5+; a PaintingType registered with Forge on 1.16.5, which has no title or author. The texture
 * goes to textures/painting/<id>.png on every version.
 */
function element(painting: Element, env: GenEnv): ElementContext {
  if (env.mc === "1.16.5") return {};
  const key = `painting.${env.modId}.${painting.id}`;
  const title = str(painting.title), author = str(painting.author);
  const json = {
    asset_id: qualify(env, painting.id),
    width: Math.max(1, Math.round(Number(painting.width) / 16)),
    height: Math.max(1, Math.round(Number(painting.height) / 16)),
    ...(title ? { title: { translate: `${key}.title`, color: "yellow" } } : {}),
    ...(author ? { author: { translate: `${key}.author`, color: "gray" } } : {}),
  };
  return {
    files: [{ path: `data/${env.modId}/painting_variant/${painting.id}.json`, json: JSON.stringify(json, null, 2) }],
    tags: [{ registry: "painting_variant", tag: "minecraft:placeable", value: qualify(env, painting.id) }],
    lang: { ...(title ? { [`${key}.title`]: title } : {}), ...(author ? { [`${key}.author`]: author } : {}) },
  };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (env.mc !== "1.16.5" || !contexts.length) return {};
    const reg = registryClass(env, {
      name: "Paintings",
      valueType: "net.minecraft.entity.item.PaintingType",
      forge: "net.minecraftforge.registries.ForgeRegistries.PAINTING_TYPES",
      entries: contexts.map((ctx) => ({ constant: String(ctx.constant), id: String(ctx.id), factory: `new net.minecraft.entity.item.PaintingType(${Number(ctx.width)}, ${Number(ctx.height)})` })),
    });
    return { sources: [reg.source], init: [reg.init] };
  },
} satisfies TypeModule;
