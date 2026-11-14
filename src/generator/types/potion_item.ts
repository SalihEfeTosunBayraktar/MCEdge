import type { Element } from "../../elements/model.ts";
import { idExpr, list, qualify, str } from "../java.ts";
import { registeredHolder, registeredValue, registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, ResourceFile, TypeModule } from "../typeModule.ts";

/**
 * Potions: a Potion registered in <Mod>Potions with its effect instances, named for the potion, splash potion,
 * lingering potion and tipped arrow. 26.x brews potions through recipes, so it also gets the gunpowder (splash)
 * and dragon's breath (lingering) recipes vanilla potions have; earlier versions mix every potion that way.
 */

type Row = Record<string, unknown>;

/** Effect reference: this mod's effects come from their registry class, vanilla ones from the registry. */
function effectRef(env: GenEnv, ref: string): string {
  const id = qualify(env, ref);
  const own = (env.generated.potion_effect ?? []).some((e) => `${env.modId}:${e.id}` === id);
  const constant = id.slice(id.indexOf(":") + 1).toUpperCase();
  if (env.mc === "1.16.5") return own ? registeredValue(env, "MobEffects", constant) : `net.minecraftforge.registries.ForgeRegistries.POTIONS.getValue(${idExpr(env, id)})`;
  return own ? registeredHolder(env, "MobEffects", constant) : `net.minecraft.core.registries.BuiltInRegistries.MOB_EFFECT.get(${idExpr(env, id)}).orElseThrow()`;
}

function element(potion: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const instance = legacy ? "net.minecraft.potion.EffectInstance" : "net.minecraft.world.effect.MobEffectInstance";
  const effects = list<Row>(potion.effects).filter((row) => str(row.effect)).map((row) => {
    const duration = row.infinite === true ? (legacy ? "Integer.MAX_VALUE" : "-1") : String(Number(row.duration));
    return `new ${instance}(${effectRef(env, str(row.effect))}, ${duration}, ${Number(row.amplifier)}, ${row.ambient === true}, ${row.showParticles === true})`;
  });
  const factory = legacy
    ? `new net.minecraft.potion.Potion(${effects.join(", ")})`
    : `new net.minecraft.world.item.alchemy.Potion(${JSON.stringify(potion.id)}${effects.map((e) => `, ${e}`).join("")})`;
  const files: ResourceFile[] = [];
  if (env.mc === "26.3") {
    const id = qualify(env, potion.id);
    const mix = (from: string, reagent: string, to: string) => ({
      path: `data/${env.modId}/recipe/brewing/${from.slice(10)}_${potion.id}_${reagent.slice(10)}.json`,
      json: JSON.stringify({
        type: "minecraft:brewing",
        input: { item: from, potion_contents: { potions: id } },
        reagent: { item: reagent },
        output: { id: to, components: { "minecraft:potion_contents": { potion: id } } },
      }, null, 2),
    });
    files.push(mix("minecraft:potion", "minecraft:gunpowder", "minecraft:splash_potion"), mix("minecraft:splash_potion", "minecraft:dragon_breath", "minecraft:lingering_potion"));
  }
  const name = (kind: string, field: string) => [`item.minecraft.${kind}.effect.${potion.id}`, str(potion[field])];
  return {
    factory,
    files,
    lang: Object.fromEntries([name("potion", "potionName"), name("splash_potion", "splashName"), name("lingering_potion", "lingeringName"), name("tipped_arrow", "arrowName")]),
  };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const reg = registryClass(env, {
      name: "Potions",
      valueType: env.mc === "1.16.5" ? "net.minecraft.potion.Potion" : "net.minecraft.world.item.alchemy.Potion",
      forge: "net.minecraftforge.registries.ForgeRegistries.POTION_TYPES",
      key: "POTION",
      entries: contexts.map((ctx) => ({ constant: String(ctx.constant), id: String(ctx.id), factory: String(ctx.factory) })),
    });
    return { sources: [reg.source], init: [reg.init] };
  },
} satisfies TypeModule;
