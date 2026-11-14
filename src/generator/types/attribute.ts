import type { Element } from "../../elements/model.ts";
import { idExpr, jstr, list, qualify, str } from "../java.ts";
import { registeredHolder, registeredValue, registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Attributes: a RangedAttribute per element in <Mod>Attributes (synced to clients, with its sentiment on 1.21.5+),
 * added to all living entities, players or the listed entity types. Forge and NeoForge use the attribute
 * modification event; Fabric rebuilds the default attribute suppliers (26.x has a modify event for it).
 */

type Row = Record<string, unknown>;
const REG = "Attributes";

function element(attr: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const key = `attribute.${env.modId}.${attr.id}`;
  const factory = legacy
    ? `new net.minecraft.entity.ai.attributes.RangedAttribute(${jstr(key)}, ${Number(attr.defaultValue)}, ${Number(attr.minValue)}, ${Number(attr.maxValue)}).setSyncable(true)`
    : `new net.minecraft.world.entity.ai.attributes.RangedAttribute(${jstr(key)}, ${Number(attr.defaultValue)}, ${Number(attr.minValue)}, ${Number(attr.maxValue)}).setSyncable(true)${attr.sentiment !== "POSITIVE" ? `.setSentiment(net.minecraft.world.entity.ai.attributes.Attribute.Sentiment.${str(attr.sentiment)})` : ""}`;
  const all = attr.addToAllEntities === true;
  const entities = all ? [] : list<Row>(attr.entities).map((row) => str(row.entity)).filter(Boolean).map((ref) => qualify(env, ref));
  if (!all && attr.addToPlayers === true) entities.push("minecraft:player");
  return { factory, targetAll: all, targets: [...new Set(entities)] };
}

/** Statements adding every attribute to its entity types. */
function additions(env: GenEnv, contexts: ElementContext[]): string[] {
  const legacy = env.mc === "1.16.5";
  const out: string[] = [];
  const type = (id: string) => legacy
    ? `net.minecraftforge.registries.ForgeRegistries.ENTITIES.getValue(${idExpr(env, id)})`
    : `net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getValue(${idExpr(env, id)})`;
  const living = legacy ? "net.minecraft.entity.LivingEntity" : "net.minecraft.world.entity.LivingEntity";
  const entityType = legacy ? "net.minecraft.entity.EntityType" : "net.minecraft.world.entity.EntityType";
  const cast = (expr: string) => `(${entityType}<? extends ${living}>) ${expr}`;
  const value = (ctx: ElementContext) => (legacy ? registeredValue(env, REG, String(ctx.constant)) : registeredHolder(env, REG, String(ctx.constant)));

  if (env.loader !== "fabric") {
    const event = legacy ? "net.minecraftforge.event.entity.EntityAttributeModificationEvent" : "net.neoforged.neoforge.event.entity.EntityAttributeModificationEvent";
    const body = contexts.flatMap((ctx) => ctx.targetAll
      ? [`for (${entityType}<? extends ${living}> type : event.getTypes()) event.add(type, ${value(ctx)});`]
      : (ctx.targets as string[]).map((id) => `if (event.getTypes().contains(${type(id)})) event.add(${cast(type(id))}, ${value(ctx)});`));
    if (body.length) {
      out.push(legacy
        ? `modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, ${event}.class, event -> {\n${body.map((l) => `            ${l}`).join("\n")}\n        });`
        : `modBus.addListener(${event}.class, event -> {\n${body.map((l) => `            ${l}`).join("\n")}\n        });`);
    }
    return out;
  }
  const registry = "net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry";
  if (env.mc === "26.3") {
    const body = contexts.flatMap((ctx) => ctx.targetAll
      ? [`context.modifyAll((type, builder) -> builder.add(${value(ctx)}));`]
      : (ctx.targets as string[]).map((id) => `context.modify(${cast(type(id))}, (type, builder) -> builder.add(${value(ctx)}));`));
    if (body.length) out.push(`${registry}.MODIFY.register(context -> {\n${body.map((l) => `            ${l}`).join("\n")}\n        });`);
    return out;
  }
  // Fabric 1.21.5 can only replace a type's supplier: copy the existing one and add the attribute.
  const defaults = "net.minecraft.world.entity.ai.attributes.DefaultAttributes";
  for (const ctx of contexts) {
    const types = ctx.targetAll
      ? `net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.stream().filter(${defaults}::hasSupplier).map(type -> ${cast("type")}).toList()`
      : `java.util.stream.Stream.of(${(ctx.targets as string[]).map(type).join(", ")}).filter(${defaults}::hasSupplier).map(type -> ${cast("type")}).toList()`;
    if (!ctx.targetAll && !(ctx.targets as string[]).length) continue;
    out.push(`for (${entityType}<? extends ${living}> type : ${types}) {
            net.minecraft.world.entity.ai.attributes.AttributeSupplier existing = ${defaults}.getSupplier(type);
            net.minecraft.world.entity.ai.attributes.AttributeSupplier.Builder builder = net.minecraft.world.entity.ai.attributes.AttributeSupplier.builder();
            net.minecraft.core.registries.BuiltInRegistries.ATTRIBUTE.listElements().filter(existing::hasAttribute).forEach(attribute -> builder.add(attribute, existing.getBaseValue(attribute)));
            ${registry}.register(type, builder.add(${value(ctx)}));
        }`);
  }
  return out;
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const legacy = env.mc === "1.16.5";
    const reg = registryClass(env, {
      name: REG,
      valueType: legacy ? "net.minecraft.entity.ai.attributes.Attribute" : "net.minecraft.world.entity.ai.attributes.Attribute",
      forge: "net.minecraftforge.registries.ForgeRegistries.ATTRIBUTES",
      key: "ATTRIBUTE",
      entries: contexts.map((ctx) => ({ constant: String(ctx.constant), id: String(ctx.id), factory: String(ctx.factory) })),
    });
    return { sources: [reg.source], init: [reg.init, ...additions(env, contexts)] };
  },
} satisfies TypeModule;
