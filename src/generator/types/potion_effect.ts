import type { Element } from "../../elements/model.ts";
import { idExpr, jstr, list, OPERATIONS_1165, pascal, qualify, str } from "../java.ts";
import { override } from "../itemTraits.ts";
import { procedureCall, procedureMembers } from "../procedures.ts";
import { registeredHolder, registeredValue, registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * Potion effects: a MobEffect (1.16.5: Effect) subclass per element, registered in <Mod>MobEffects, with its icon
 * at textures/mob_effect/<id>.png. Procedure fields become overrides; "expired" listens to the loader's effect
 * events (Forge/NeoForge only). HUD/inventory visibility and honey curing use loader hooks Fabric does not have.
 */

type Row = Record<string, unknown>;
const REG = "MobEffects";

/** Attribute holder for a modifier: this mod's attributes come from their registry class (registered later). */
function attributeRef(env: GenEnv, ref: string): string {
  const id = qualify(env, ref);
  const own = id.startsWith(`${env.modId}:`) && (env.generated.attribute ?? []).some((a) => `${env.modId}:${a.id}` === id);
  const constant = id.slice(id.indexOf(":") + 1).toUpperCase();
  if (env.mc === "1.16.5") return own ? registeredValue(env, "Attributes", constant) : `net.minecraftforge.registries.ForgeRegistries.ATTRIBUTES.getValue(${idExpr(env, id)})`;
  return own ? registeredHolder(env, "Attributes", constant) : `net.minecraft.core.registries.BuiltInRegistries.ATTRIBUTE.get(${idExpr(env, id)}).orElseThrow()`;
}

const color = (value: unknown) => `0x${(str(value).replace("#", "") || "ffffff").padStart(6, "0")}`;

function element(effect: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const pkg = env.project.mod.package;
  const cls = `${pascal(effect.id)}MobEffect`;
  const instant = effect.isInstant === true;
  const sound = str(effect.onAddedSound);
  const soundLegacy = sound && legacy
    ? `entity.level.playSound(null, entity.getX(), entity.getY(), entity.getZ(), net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${idExpr(env, qualify(env, sound))}), entity.getSoundSource(), 1.0F, 1.0F);`
    : "";
  const started = [instant ? "instant" : "", ...(soundLegacy ? [soundLegacy] : [])].join("\n");
  const procedures = procedureMembers(env, "potion_effect", effect, { onStarted: started });
  const members = [...procedures.members];
  const self = registeredValue(env, REG, effect.id.toUpperCase());

  // A tick procedure without a condition runs every tick.
  if (str(effect.onActiveTick) && !procedures.handled.has("activeTickCondition") && procedures.handled.has("onActiveTick")) {
    members.push(override(legacy ? "public boolean isDurationEffectTick(int duration, int amplifier)" : "public boolean shouldApplyEffectTickThisTick(int duration, int amplifier)", "return true;"));
  }
  const init: string[] = [];
  const clientInit: string[] = [];
  const modifiers = list<Row>(effect.modifiers).filter((m) => str(m.attribute));
  let ctor: string[];
  let header: string;

  if (legacy) {
    header = `public class ${cls} extends net.minecraft.potion.Effect`;
    ctor = [
      `super(net.minecraft.potion.EffectType.${str(effect.mobEffectCategory)}, ${color(effect.color)});`,
      ...modifiers.map((m, i) => `this.addAttributeModifier(${attributeRef(env, str(m.attribute))}, java.util.UUID.nameUUIDFromBytes(${jstr(`${env.modId}:${effect.id}_${i}`)}.getBytes()).toString(), ${Number(m.amount)}, net.minecraft.entity.ai.attributes.AttributeModifier.Operation.${OPERATIONS_1165[str(m.operation)]});`),
    ];
    if (instant) members.push(override("public boolean isInstantenous()", "return true;"));
    if (soundLegacy && !procedures.handled.has("onStarted")) {
      members.push(instant
        ? override("public void applyInstantenousEffect(net.minecraft.entity.Entity source, net.minecraft.entity.Entity indirectSource, net.minecraft.entity.LivingEntity entity, int amplifier, double health)",
          `super.applyInstantenousEffect(source, indirectSource, entity, amplifier, health);\n        if (!entity.level.isClientSide()) ${soundLegacy}`)
        : override("public void addAttributeModifiers(net.minecraft.entity.LivingEntity entity, net.minecraft.entity.ai.attributes.AttributeModifierManager attributes, int amplifier)",
          `super.addAttributeModifiers(entity, attributes, amplifier);\n        if (!entity.level.isClientSide()) ${soundLegacy}`));
    }
    const expired = procedureCall(env, "potion_effect", effect, "onExpired", { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "entity.level", entity: "entity" });
    if (expired) {
      members.push(override("public void removeAttributeModifiers(net.minecraft.entity.LivingEntity entity, net.minecraft.entity.ai.attributes.AttributeModifierManager attributes, int amplifier)",
        `super.removeAttributeModifiers(entity, attributes, amplifier);\n        if (!entity.level.isClientSide()) ${expired};`));
    }
    if (effect.renderStatusInInventory !== true) {
      members.push(override("public boolean shouldRender(net.minecraft.potion.EffectInstance effect)", "return false;"),
        override("public boolean shouldRenderInvText(net.minecraft.potion.EffectInstance effect)", "return false;"));
    }
    if (effect.renderStatusInHUD !== true) members.push(override("public boolean shouldRenderHUD(net.minecraft.potion.EffectInstance effect)", "return false;"));
    if (effect.isCuredbyHoney === true) {
      members.push(override("public java.util.List<net.minecraft.item.ItemStack> getCurativeItems()",
        `java.util.List<net.minecraft.item.ItemStack> cures = new java.util.ArrayList<>(super.getCurativeItems());
        cures.add(new net.minecraft.item.ItemStack(net.minecraft.item.Items.HONEY_BOTTLE));
        return cures;`));
    }
  } else {
    const base = instant ? (env.mc === "26.3" ? "InstantaneousMobEffect" : "InstantenousMobEffect") : "MobEffect";
    header = `public class ${cls} extends net.minecraft.world.effect.${base}`;
    const particle = str(effect.particle);
    // NeoForge takes the particle lazily. Fabric needs it now: this mod's particle types are registered by touching
    // their registry class, vanilla ones exist already.
    const particleId = qualify(env, particle);
    const ownParticle = (env.generated.particle ?? []).some((p) => `${env.modId}:${p.id}` === particleId);
    const particleExpr = `(net.minecraft.core.particles.SimpleParticleType) ${ownParticle && env.loader === "fabric"
      ? registeredValue(env, "ParticleTypes", particleId.slice(particleId.indexOf(":") + 1).toUpperCase())
      : `net.minecraft.core.registries.BuiltInRegistries.PARTICLE_TYPE.getValue(${idExpr(env, particleId)})`}`;
    const particleArg = !particle || instant ? "" : env.loader === "fabric" ? `, ${particleExpr}` : `, instance -> ${particleExpr}`;
    ctor = [
      `super(net.minecraft.world.effect.MobEffectCategory.${str(effect.mobEffectCategory)}, ${color(effect.color)}${particleArg});`,
      ...(sound ? [`this.withSoundOnAdded(net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${idExpr(env, qualify(env, sound))}));`] : []),
      ...modifiers.map((m, i) => `this.addAttributeModifier(${attributeRef(env, str(m.attribute))}, ${idExpr(env, `${env.modId}:effect.${effect.id}_${i}`)}, ${Number(m.amount)}, net.minecraft.world.entity.ai.attributes.AttributeModifier.Operation.${str(m.operation)});`),
    ];
    const holder = registeredHolder(env, REG, effect.id.toUpperCase());
    if (env.loader === "neoforge") {
      const expired = procedureCall(env, "potion_effect", effect, "onExpired", { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "entity.level()", entity: "entity" });
      if (expired) {
        for (const event of ["Remove", "Expired"]) {
          init.push(`net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.entity.living.MobEffectEvent.${event}.class, event -> {
            net.minecraft.world.effect.MobEffectInstance instance = event.getEffectInstance();
            net.minecraft.world.entity.LivingEntity entity = event.getEntity();
            if (instance != null && instance.is(${holder}) && !entity.level().isClientSide()) ${expired};
        });`);
        }
      }
      if (effect.renderStatusInInventory !== true || effect.renderStatusInHUD !== true) {
        const ext = "net.neoforged.neoforge.client.extensions.common";
        clientInit.push(`modBus.addListener(${ext}.RegisterClientExtensionsEvent.class, event -> event.registerMobEffect(new ${ext}.IClientMobEffectExtensions() {${effect.renderStatusInInventory !== true ? `
            @Override
            public boolean isVisibleInInventory(net.minecraft.world.effect.MobEffectInstance instance) { return false; }` : ""}${effect.renderStatusInHUD !== true ? `
            @Override
            public boolean isVisibleInGui(net.minecraft.world.effect.MobEffectInstance instance) { return false; }` : ""}
        }, ${self}));`);
      }
      if (effect.isCuredbyHoney === true) {
        const c = "net.minecraft.world.item.component";
        const original = env.mc === "26.3" ? `${c}.Consumables.HONEY_BOTTLE` : `net.minecraft.world.item.Items.HONEY_BOTTLE.components().get(net.minecraft.core.component.DataComponents.CONSUMABLE)`;
        const modify = env.mc === "26.3" ? "(builder, registries, item) ->" : "builder ->";
        init.push(`modBus.addListener(net.neoforged.neoforge.event.ModifyDefaultComponentsEvent.class, event -> {
            ${c}.Consumable original = ${original};
            if (original == null) return;
            java.util.List<net.minecraft.world.item.consume_effects.ConsumeEffect> effects = new java.util.ArrayList<>(original.onConsumeEffects());
            effects.add(new net.minecraft.world.item.consume_effects.RemoveStatusEffectsConsumeEffect(${holder}));
            ${c}.Consumable cured = new ${c}.Consumable(original.consumeSeconds(), original.animation(), original.sound(), original.hasConsumeParticles(), effects);
            event.modify(net.minecraft.world.item.Items.HONEY_BOTTLE, ${modify} builder.set(net.minecraft.core.component.DataComponents.CONSUMABLE, cured));
        });`);
      }
    }
  }

  const code = `package ${pkg}.potion;

/** Generated by MCEdge. */
${header} {
    public ${cls}() {
${ctor.map((line) => `        ${line}`).join("\n")}
    }
${members.join("")}}
`;
  const source: JavaSourceFile = { path: `${pkg.replaceAll(".", "/")}/potion/${cls}.java`, code };
  return {
    effectClass: `${pkg}.potion.${cls}`,
    effectSource: source,
    init,
    clientInitCode: clientInit,
    textures: str(effect.icon) ? [{ from: str(effect.icon), to: `mob_effect/${effect.id}` }] : [],
  };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const reg = registryClass(env, {
      name: REG,
      valueType: env.mc === "1.16.5" ? "net.minecraft.potion.Effect" : "net.minecraft.world.effect.MobEffect",
      forge: "net.minecraftforge.registries.ForgeRegistries.POTIONS",
      key: "MOB_EFFECT",
      entries: contexts.map((ctx) => ({ constant: String(ctx.constant), id: String(ctx.id), factory: `new ${ctx.effectClass}()` })),
    });
    return {
      sources: [reg.source, ...contexts.map((ctx) => ctx.effectSource as JavaSourceFile)],
      init: [reg.init],
      clientInit: contexts.flatMap((ctx) => ctx.clientInitCode as string[]),
    };
  },
} satisfies TypeModule;

