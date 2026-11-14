import type { Element } from "../../elements/model.ts";
import { idExpr, itemExpr, jfloat, jstr, qualify, str } from "../java.ts";
import { procedureCallById } from "../procedures.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TypeModule } from "../typeModule.ts";

/**
 * Item extensions make an existing item (vanilla or this mod) a furnace fuel and/or compostable. NeoForge reads both
 * from its data maps; Forge 1.16.5 uses the burn time event and the composter table; Fabric 1.21.5 its fuel and
 * composting registries. 26.x keeps both in item components (cooking_fuel, compostable) that point to data-driven
 * context int providers: the extension writes its own providers (vanilla's formats with this burn time and chance)
 * and sets the components through the loader's default component event.
 *
 * Fuel procedures (burn time, fuel condition) decide per stack in <Mod>Fuels.burnTime: Forge 1.16.5 and NeoForge
 * 1.21.5 call it from the burn time event, Fabric 1.21.5 from a FuelValues mixin, 26.x from a context int provider
 * type of this mod ("<modid>:procedure_fuel") that the cooking_fuel component points to. Dispense behaviour registers
 * a dispenser behaviour for the item with its success condition and result procedures.
 */

const procedural = (e: Element) => e.enableFuel === true && (!!str(e.fuelPowerProcedure) || !!str(e.fuelSuccessCondition));
const fuel = (e: Element) => e.enableFuel === true && (Number(e.fuelPower) > 0 || procedural(e));
const fuelsClass = (env: GenEnv) => `${env.project.mod.package}.init.${modClassName(env)}Fuels`;
const compost = (e: Element) => Number(e.compostLayerChance) > 0;

function element(ext: Element, env: GenEnv): ElementContext {
  const target = str(ext.item);
  if (!target) return {};
  const dispense = dispenseInit(ext, env);
  if (env.mc === "26.3") {
    const ctx = components26(ext, env);
    return { ...ctx, init: [...(ctx.init ?? []), ...dispense] };
  }
  const item = itemExpr(env, target);
  const burn = procedural(ext) ? `${fuelsClass(env)}.burnTime(event.getItemStack())` : String(Number(ext.fuelPower));
  if (env.loader === "neoforge") {
    const init = [...dispense];
    if (procedural(ext)) {
      init.push(`net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.furnace.FurnaceFuelBurnTimeEvent.class, event -> {
            if (event.getItemStack().getItem() == ${item}) event.setBurnTime(${burn});
        });`);
    }
    return { init };
  }
  const init: string[] = [...dispense];
  if (env.mc === "1.16.5") {
    if (fuel(ext)) {
      init.push(`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.furnace.FurnaceFuelBurnTimeEvent.class, event -> {
            if (event.getItemStack().getItem() == ${item}) event.setBurnTime(${burn});
        });`);
    }
    if (compost(ext)) {
      init.push(`modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> net.minecraft.block.ComposterBlock.COMPOSTABLES.put(${item}, ${jfloat(ext.compostLayerChance)})));`);
    }
  } else {
    // A procedural fuel still needs a registry entry to count as fuel; its burn time comes from the mixin.
    if (fuel(ext)) init.push(`net.fabricmc.fabric.api.registry.FuelRegistryEvents.BUILD.register((builder, context) -> builder.add(${item}, ${Math.max(1, Number(ext.fuelPower) || 0)}));`);
    if (compost(ext)) init.push(`net.fabricmc.fabric.api.registry.CompostingChanceRegistry.INSTANCE.add(${item}, ${jfloat(ext.compostLayerChance)});`);
  }
  return { init, ...(env.loader === "fabric" && procedural(ext) ? { mixins: [{ id: "FuelValuesMixin", code: fuelMixin(env) }] } : {}) };
}

/** 26.x: context int providers for the burn time and compost layers, and the components that use them. */
function components26(ext: Element, env: GenEnv): ElementContext {
  const id = String(ext.id);
  const files: ResourceFile[] = [];
  const sets: string[] = [];
  const key = (path: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.CONTEXT_INT_PROVIDER, ${idExpr(env, `${env.modId}:${path}`)})`;
  if (fuel(ext)) {
    files.push({ path: `data/${env.modId}/context_int_provider/cooking/time_${id}.json`, json: JSON.stringify({
      type: "minecraft:div",
      left: procedural(ext) ? { type: `${env.modId}:procedure_fuel`, extension: id } : Number(ext.fuelPower),
      right: { type: "minecraft:conditional", condition: "minecraft:block/fast_cooking", on_false: "minecraft:cooking/normal_burn_time_reduction_factor", on_true: "minecraft:cooking/fast_burn_time_reduction_factor" },
    }, null, 2) });
    sets.push(`builder.set(net.minecraft.core.component.DataComponents.COOKING_FUEL, new net.minecraft.world.item.component.CookingFuel(${key(`cooking/time_${id}`)}, net.minecraft.world.level.storage.loot.providers.number.floats.ContextFloatProviders.COOKING_DEFAULT_SPEED_MULTIPLIER));`);
  }
  if (compost(ext)) {
    // Vanilla's format: the first item always adds a layer to an empty composter, later ones by chance.
    const weight = Math.max(0, Math.min(100, Math.round(Number(ext.compostLayerChance) * 100)));
    files.push({ path: `data/${env.modId}/context_int_provider/compostable/${id}.json`, json: JSON.stringify({
      type: "minecraft:number_dispatcher",
      cases: [{ condition: { type: "minecraft:match_block", blocks: "minecraft:composter", state: { level: "0" } }, value: 1 }],
      default: weight >= 100 ? 1 : { type: "minecraft:weighted_list", distribution: [{ data: 1, weight }, { data: 0, weight: 100 - weight }] },
    }, null, 2) });
    sets.push(`builder.set(net.minecraft.core.component.DataComponents.COMPOSTABLE, new net.minecraft.world.item.component.Compostable(${key(`compostable/${id}`)}));`);
  }
  if (!sets.length) return { files };
  const item = itemExpr(env, str(ext.item));
  const body = sets.map((line) => `            ${line}`).join("\n");
  const init = env.loader === "neoforge"
    ? `modBus.addListener(net.neoforged.neoforge.event.ModifyDefaultComponentsEvent.class, event -> event.modify(${item}, (builder, context, key) -> {
${body}
        }));`
    : `net.fabricmc.fabric.api.item.v1.DefaultItemComponentEvents.MODIFY.register(context -> context.modify(${item}, builder -> {
${body}
        }));`;
  return { files, init: [init] };
}

/** NeoForge data maps listing every extension's fuel burn time and compost chance. */
function files(exts: ElementContext[], env: GenEnv): ResourceFile[] {
  if (env.loader !== "neoforge" || env.mc === "26.3") return [];
  const map = (pick: (e: Element) => boolean, value: (e: Element) => unknown) =>
    Object.fromEntries(exts.map((e) => e as unknown as Element).filter((e) => str(e.item) && pick(e)).map((e) => [qualify(env, str(e.item)), value(e)]));
  const out: ResourceFile[] = [];
  const fuels = map(fuel, (e) => ({ burn_time: Number(e.fuelPower) }));
  const compostables = map(compost, (e) => ({ chance: Number(e.compostLayerChance) }));
  if (Object.keys(fuels).length) out.push({ path: "data/neoforge/data_maps/item/furnace_fuels.json", json: JSON.stringify({ values: fuels }, null, 2) });
  if (Object.keys(compostables).length) out.push({ path: "data/neoforge/data_maps/item/compostables.json", json: JSON.stringify({ values: compostables }, null, 2) });
  return out;
}

/** Dispenser behaviour: the success condition decides, the result procedure gives the stack left in the dispenser. */
function dispenseInit(ext: Element, env: GenEnv): string[] {
  if (ext.hasDispenseBehavior !== true || !str(ext.item)) return [];
  const legacy = env.mc === "1.16.5";
  const item = itemExpr(env, str(ext.item));
  const where = `item_extension/${ext.id}`;
  const deps = { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world", itemstack: "stack", direction: "direction" };
  const success = procedureCallById(env, ext.dispenseSuccessCondition, deps, `${where}: dispenseSuccessCondition`, "logic") ?? "true";
  const result = procedureCallById(env, ext.dispenseResultItemstack, deps, `${where}: dispenseResultItemstack`);
  const T = legacy
    ? { behavior: "net.minecraft.dispenser.OptionalDispenseBehavior", source: "net.minecraft.dispenser.IBlockSource", stack: "net.minecraft.item.ItemStack", world: "net.minecraft.world.server.ServerWorld", pos: "net.minecraft.util.math.BlockPos", dir: "net.minecraft.util.Direction", block: "net.minecraft.block.DispenserBlock" }
    : { behavior: "net.minecraft.core.dispenser.OptionalDispenseItemBehavior", source: "net.minecraft.core.dispenser.BlockSource", stack: "net.minecraft.world.item.ItemStack", world: "net.minecraft.server.level.ServerLevel", pos: "net.minecraft.core.BlockPos", dir: "net.minecraft.core.Direction", block: "net.minecraft.world.level.block.DispenserBlock" };
  const [w, p, s] = legacy ? ["source.getLevel()", "source.getPos()", "source.getBlockState()"] : ["source.level()", "source.pos()", "source.state()"];
  const register = `${T.block}.registerBehavior(${item}, new ${T.behavior}() {
            @Override
            protected ${T.stack} execute(${T.source} source, ${T.stack} stack) {
                ${T.world} world = ${w};
                ${T.pos} pos = ${p};
                ${T.dir} direction = ${s}.getValue(${T.block}.FACING);
                boolean success = ${success};
                this.setSuccess(success);
                ${result ? `return ${result};` : "if (success) stack.shrink(1);\n                return stack;"}
            }
        })`;
  if (env.loader === "fabric") return [`${register};`];
  return [legacy
    ? `modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> ${register}));`
    : `modBus.addListener(net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent.class, event -> event.enqueueWork(() -> ${register}));`];
}

/** Fabric 1.21.5 has no per-stack fuel API: a FuelValues mixin asks <Mod>Fuels first. */
function fuelMixin(env: GenEnv): string {
  const m = "org.spongepowered.asm.mixin";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Burn times decided by fuel procedures of item extensions. */
@${m}.Mixin(net.minecraft.world.level.block.entity.FuelValues.class)
public abstract class FuelValuesMixin {
    @${m}.injection.Inject(method = "burnDuration", at = @${m}.injection.At("HEAD"), cancellable = true)
    private void ${env.modId}$procedureFuel(net.minecraft.world.item.ItemStack stack, ${m}.injection.callback.CallbackInfoReturnable<Integer> result) {
        int time = ${fuelsClass(env)}.burnTime(stack);
        if (time >= 0) result.setReturnValue(time);
    }
}
`;
}

/** <Mod>Fuels: burn time of a stack from the item extensions with fuel procedures (-1: not one of them). */
function runtime(exts: ElementContext[], env: GenEnv): { sources?: JavaSourceFile[]; init?: string[] } {
  const list = exts.map((e) => e as unknown as Element).filter((e) => str(e.item) && procedural(e));
  if (!list.length) return {};
  const legacy = env.mc === "1.16.5";
  const S = legacy ? "net.minecraft.item.ItemStack" : "net.minecraft.world.item.ItemStack";
  const cls = fuelsClass(env);
  const name = cls.slice(cls.lastIndexOf(".") + 1);
  const pkg = env.project.mod.package;
  const cases = list.map((e) => {
    const where = `item_extension/${e.id}`;
    const ok = procedureCallById(env, e.fuelSuccessCondition, { itemstack: "stack" }, `${where}: fuelSuccessCondition`, "logic");
    const time = procedureCallById(env, e.fuelPowerProcedure, { itemstack: "stack" }, `${where}: fuelPowerProcedure`, "number") ?? String(Number(e.fuelPower) || 0);
    return { e, body: `${ok ? `if (!(${ok})) return 0;\n            ` : ""}return (int) (${time});` };
  });
  const v26 = env.mc === "26.3";
  const provider = v26 ? `

    /** Context int provider "${env.modId}:procedure_fuel": the burn time of the stack in the furnace's fuel slot. */
    public record ProcedureFuel(String extension) implements net.minecraft.world.level.storage.loot.providers.number.ints.ContextIntProvider {
        public static final com.mojang.serialization.MapCodec<ProcedureFuel> CODEC = com.mojang.serialization.codecs.RecordCodecBuilder.mapCodec(i -> i.group(
                com.mojang.serialization.Codec.STRING.fieldOf("extension").forGetter(ProcedureFuel::extension)).apply(i, ProcedureFuel::new));

        @Override
        public int getIntUnsafe(net.minecraft.world.level.storage.loot.LootContext context) {
            ${S} stack = ${S}.EMPTY;${env.loader === "neoforge" ? `
            Object queried = context.getOptional(net.neoforged.neoforge.common.loot.NeoForgeLootContextParams.QUERIED_STACK);
            if (queried instanceof ${S} queriedStack) stack = queriedStack;` : ""}
            net.minecraft.world.entity.SlotProvider slots = context.getOptional(net.minecraft.world.level.storage.loot.parameters.LootContextParams.CONTAINER);
            if (stack.isEmpty() && slots != null && slots.getSlot(1) != null) stack = slots.getSlot(1).get();
            return Math.max(0, burnTime(stack, this.extension));
        }

        @Override
        public com.mojang.serialization.MapCodec<ProcedureFuel> codec() {
            return CODEC;
        }

        @Override
        public void validate(net.minecraft.world.level.storage.loot.ValidationContext context) {
        }
    }` : "";
  const code = `package ${pkg}.init;

/** Generated by MCEdge: burn times of item extensions with fuel procedures. */
public final class ${name} {
    private ${name}() {}

    /** Burn time of the stack, or -1 when no fuel procedure covers its item. */
    public static int burnTime(${S} stack) {
${list.map((e) => `        if (stack.getItem() == ${itemExpr(env, str(e.item))}) return burnTime(stack, ${jstr(String(e.id))});`).join("\n")}
        return -1;
    }

    static int burnTime(${S} stack, String extension) {
        switch (extension) {
${cases.map(({ e, body }) => `        case ${jstr(String(e.id))}: {\n            ${body}\n        }`).join("\n")}
        default:
            return -1;
        }
    }${provider}
}
`;
  const init: string[] = [];
  if (v26) {
    const key = idExpr(env, `${env.modId}:procedure_fuel`);
    init.push(env.loader === "neoforge"
      ? `modBus.addListener(net.neoforged.neoforge.registries.RegisterEvent.class, event -> event.register(net.minecraft.core.registries.Registries.CONTEXT_INT_PROVIDER_TYPE, ${key}, () -> ${cls}.ProcedureFuel.CODEC));`
      : `net.minecraft.core.Registry.register(net.minecraft.core.registries.BuiltInRegistries.CONTEXT_INT_PROVIDER_TYPE, ${key}, ${cls}.ProcedureFuel.CODEC);`);
  }
  return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${name}.java`, code }], init };
}

export default { element, files, runtime } satisfies TypeModule;

