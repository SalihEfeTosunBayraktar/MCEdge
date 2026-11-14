import type { Element } from "../../elements/model.ts";
import { derivedConstant, blockExpr, idExpr, jstr, qualify, str } from "../java.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/**
 * Villager professions: a point of interest type for the job block (states another POI already claims are left
 * out instead of crashing) and the profession using it, in <Mod>VillagerProfessions, with the villager and zombie
 * villager textures and the hat setting. 26.x villagers trade from trade sets: each profession gets one per level,
 * reading the villager_trade tag that villager trade elements fill.
 */

const LEVELS = [1, 2, 3, 4, 5];

function element(prof: Element, env: GenEnv): ElementContext {
  const textures = [
    { from: str(prof.professionTextureFile), to: `entity/villager/profession/${prof.id}` },
    { from: str(prof.zombifiedProfessionTextureFile), to: `entity/zombie_villager/profession/${prof.id}` },
  ];
  const files: ResourceFile[] = [];
  const hat = str(prof.hat);
  if (hat && hat !== "None") {
    files.push({ path: `assets/${env.modId}/textures/entity/villager/profession/${prof.id}.png.mcmeta`, json: JSON.stringify({ villager: { hat: hat.toLowerCase() } }, null, 2) });
  }
  const tags: TagEntry[] = [];
  if (env.mc !== "1.16.5") tags.push({ registry: "point_of_interest_type", tag: "minecraft:acquirable_job_site", value: qualify(env, prof.id) });
  if (env.mc === "26.3") {
    for (const level of LEVELS) {
      const tag = `${env.modId}:${prof.id}/level_${level}`;
      files.push({ path: `data/${env.modId}/trade_set/${prof.id}/level_${level}.json`, json: JSON.stringify({ amount: 2, random_sequence: `${env.modId}:trade_set/${prof.id}/level_${level}`, trades: `#${tag}` }, null, 2) });
      // The tag exists even when no trade fills it.
      tags.push({ registry: "villager_trade", tag, value: "" });
    }
  }
  const name = str(prof.displayName);
  const lang = env.mc === "1.16.5" ? { [`entity.minecraft.villager.${env.modId}.${prof.id}`]: name } : { [`entity.${env.modId}.villager.${prof.id}`]: name };
  return { textures, files, tags, lang };
}

function source(env: GenEnv, profs: ElementContext[]): { code: string; init: string } {
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}VillagerProfessions`;
  const legacy = env.mc === "1.16.5";
  const states = (prof: ElementContext, state: string, forState: string) =>
    `com.google.common.collect.ImmutableSet.copyOf(${blockExpr(env, str(prof.pointOfInterest))}.getStateDefinition().getPossibleStates().stream().filter(state -> !${forState}(state).isPresent()).iterator())`.replace("state ->", `(${state} state) ->`);
  const sound = (prof: ElementContext) => legacy
    ? `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${idExpr(env, qualify(env, str(prof.actionSound)))})`
    : `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${idExpr(env, qualify(env, str(prof.actionSound)))})`;
  let body: string;
  let init: string;
  if (legacy) {
    const POI = "net.minecraft.village.PointOfInterestType", VP = "net.minecraft.entity.merchant.villager.VillagerProfession";
    body = `    public static final net.minecraftforge.registries.DeferredRegister<${POI}> POI_TYPES = net.minecraftforge.registries.DeferredRegister.create(net.minecraftforge.registries.ForgeRegistries.POI_TYPES, ${jstr(env.modId)});
    public static final net.minecraftforge.registries.DeferredRegister<${VP}> PROFESSIONS = net.minecraftforge.registries.DeferredRegister.create(net.minecraftforge.registries.ForgeRegistries.PROFESSIONS, ${jstr(env.modId)});
${profs.map((p) => `    public static final net.minecraftforge.fml.RegistryObject<${POI}> ${derivedConstant(String(p.constant), "Poi")} = POI_TYPES.register(${jstr(String(p.id))}, () -> new ${POI}(${jstr(`${env.modId}:${p.id}`)}, ${states(p, "net.minecraft.block.BlockState", `${POI}.forState`)}, 1, 1));
    public static final net.minecraftforge.fml.RegistryObject<${VP}> ${p.constant} = PROFESSIONS.register(${jstr(String(p.id))}, () -> new ${VP}(${jstr(`${env.modId}:${p.id}`)}, ${derivedConstant(String(p.constant), "Poi")}.get(), com.google.common.collect.ImmutableSet.of(), com.google.common.collect.ImmutableSet.of(), ${sound(p)}));`).join("\n")}

    public static void register(net.minecraftforge.eventbus.api.IEventBus modBus) {
        POI_TYPES.register(modBus);
        PROFESSIONS.register(modBus);
    }`;
    init = `${pkg}.init.${cls}.register(modBus);`;
  } else {
    const POI = "net.minecraft.world.entity.ai.village.poi.PoiType";
    const VP = env.mc === "26.3" ? "net.minecraft.world.entity.npc.villager.VillagerProfession" : "net.minecraft.world.entity.npc.VillagerProfession";
    const BS = "net.minecraft.world.level.block.state.BlockState";
    const forState = "net.minecraft.world.entity.ai.village.poi.PoiTypes.forState";
    const poiKey = (p: ElementContext) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.POINT_OF_INTEREST_TYPE, ${idExpr(env, `${env.modId}:${p.id}`)})`;
    const tradeSets = (p: ElementContext) => env.mc === "26.3"
      ? `, it.unimi.dsi.fastutil.ints.Int2ObjectMap.ofEntries(${LEVELS.map((l) => `it.unimi.dsi.fastutil.ints.Int2ObjectMap.entry(${l}, net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.TRADE_SET, ${idExpr(env, `${env.modId}:${p.id}/level_${l}`)}))`).join(", ")})`
      : "";
    const profession = (p: ElementContext) => `new ${VP}(net.minecraft.network.chat.Component.translatable(${jstr(`entity.${env.modId}.villager.${p.id}`)}), holder -> holder.is(${derivedConstant(String(p.constant), "Poi")}), holder -> holder.is(${derivedConstant(String(p.constant), "Poi")}), com.google.common.collect.ImmutableSet.of(), com.google.common.collect.ImmutableSet.of(), ${sound(p)}${tradeSets(p)})`;
    const keys = profs.map((p) => `    public static final net.minecraft.resources.ResourceKey<${POI}> ${derivedConstant(String(p.constant), "Poi")} = ${poiKey(p)};
    public static final net.minecraft.resources.ResourceKey<${VP}> ${derivedConstant(String(p.constant), "Key")} = net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.VILLAGER_PROFESSION, ${idExpr(env, `${env.modId}:${p.id}`)});`).join("\n");
    if (env.loader === "neoforge") {
      body = `${keys}
    public static final net.neoforged.neoforge.registries.DeferredRegister<${POI}> POI_TYPES = net.neoforged.neoforge.registries.DeferredRegister.create(net.minecraft.core.registries.Registries.POINT_OF_INTEREST_TYPE, ${jstr(env.modId)});
    public static final net.neoforged.neoforge.registries.DeferredRegister<${VP}> PROFESSIONS = net.neoforged.neoforge.registries.DeferredRegister.create(net.minecraft.core.registries.Registries.VILLAGER_PROFESSION, ${jstr(env.modId)});
${profs.map((p) => `    static {
        POI_TYPES.register(${jstr(String(p.id))}, () -> new ${POI}(${states(p, BS, forState)}, 1, 1));
    }
    public static final net.neoforged.neoforge.registries.DeferredHolder<${VP}, ${VP}> ${p.constant} = PROFESSIONS.register(${jstr(String(p.id))}, () -> ${profession(p)});`).join("\n")}

    public static void register(net.neoforged.bus.api.IEventBus modBus) {
        POI_TYPES.register(modBus);
        PROFESSIONS.register(modBus);
    }`;
      init = `${pkg}.init.${cls}.register(modBus);`;
    } else {
      const helper = env.mc === "26.3" ? "net.fabricmc.fabric.api.object.builder.v1.world.poi.PoiHelper" : "net.fabricmc.fabric.api.object.builder.v1.world.poi.PointOfInterestHelper";
      body = `${keys}
${profs.map((p) => `    public static ${VP} ${p.constant};`).join("\n")}

    public static void register() {
${profs.map((p) => `        ${helper}.register(${derivedConstant(String(p.constant), "Poi")}.${env.mc === "26.3" ? "identifier" : "location"}(), 1, 1, ${states(p, BS, forState)});
        ${p.constant} = net.minecraft.core.Registry.register(net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION, ${derivedConstant(String(p.constant), "Key")}, ${profession(p)});`).join("\n")}
    }`;
      init = `${pkg}.init.${cls}.register();`;
    }
  }
  const code = `package ${pkg}.init;

/** Generated by MCEdge. Villager professions and their job site points of interest. */
public final class ${cls} {
    private ${cls}() {}

${body}
}
`;
  return { code, init };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const pkg = env.project.mod.package;
    const { code, init } = source(env, contexts);
    return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${modClassName(env)}VillagerProfessions.java`, code }], init: [init] };
  },
} satisfies TypeModule;
