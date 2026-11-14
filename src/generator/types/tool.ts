import type { Element } from "../../elements/model.ts";
import { blockExpr, idExpr, ingredientExpr, itemExpr, itemForm, itemPkg, jfloat, meleeModifiers, modifierRows, qualify, str } from "../java.ts";
import { guiIcon, isBuiltinItemModel, itemRows, itemTraits, override } from "../itemTraits.ts";
import { isJavaItemModel, javaItemModel, type JavaItemModel } from "../javaModels.ts";
import { customModel } from "../models.ts";
import { procedureMembers } from "../procedures.ts";
import type { GenEnv, TagEntry, TypeModule } from "../typeModule.ts";

/** Vanilla tier -> block tag of blocks it cannot drop (1.21+) and harvest level (1.16.5). */
const TIERS: Record<string, [string, number]> = {
  WOOD: ["incorrect_for_wooden_tool", 0], STONE: ["incorrect_for_stone_tool", 1], IRON: ["incorrect_for_iron_tool", 2],
  DIAMOND: ["incorrect_for_diamond_tool", 3], GOLD: ["incorrect_for_gold_tool", 0], NETHERITE: ["incorrect_for_netherite_tool", 4],
};
/** Tool types with vanilla behaviour: Properties helper / 1.21.5 class / 1.16.5 class / item tag. */
const KINDS: Record<string, { helper: string; cls215?: string; cls116: string; tag: string }> = {
  Pickaxe: { helper: "pickaxe", cls116: "PickaxeItem", tag: "pickaxes" },
  Axe: { helper: "axe", cls215: "AxeItem", cls116: "AxeItem", tag: "axes" },
  Sword: { helper: "sword", cls116: "SwordItem", tag: "swords" },
  Spade: { helper: "shovel", cls215: "ShovelItem", cls116: "ShovelItem", tag: "shovels" },
  Hoe: { helper: "hoe", cls215: "HoeItem", cls116: "HoeItem", tag: "hoes" },
};
const MINEABLE = ["pickaxe", "axe", "shovel", "hoe"];

function element(tool: Element, env: GenEnv) {
  const pkg = itemPkg(env);
  const stack = `${pkg}.ItemStack`;
  const legacy = env.mc === "1.16.5";
  const type = str(tool.toolType);
  const kind = KINDS[type];
  const id = tool.id;
  const self = qualify(env, id);
  const durability = Number(tool.usageCount);
  const repairs = itemRows(tool.repairItems);
  const tiered = Boolean(kind) || type === "Special" || type === "MultiTool";
  const [incorrect, level] = TIERS[str(tool.blockDropsTier)] ?? TIERS.WOOD;
  const damage = Math.round((Number(tool.damageVsEntity) - 1) * 1e6) / 1e6;
  const speed = Math.round((Number(tool.attackSpeed) - 4) * 1e6) / 1e6;
  const tags: TagEntry[] = [];
  const fields: string[] = [];
  const members: string[] = [];
  const props: string[] = [];
  const state = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";

  // Custom material: the tier decides drops, the element its durability, speed, enchantability and repairs.
  const repairTag = `${env.modId}:${id}_repair_items`;
  if (tiered) {
    if (legacy) {
      fields.push(`public static final net.minecraft.item.IItemTier TIER = new net.minecraft.item.IItemTier() {
        public int getUses() { return ${durability}; }
        public float getSpeed() { return ${jfloat(tool.efficiency)}; }
        public float getAttackDamageBonus() { return 0F; }
        public int getLevel() { return ${level}; }
        public int getEnchantmentValue() { return ${tool.enchantability}; }
        public net.minecraft.item.crafting.Ingredient getRepairIngredient() { return ${repairs.length ? `net.minecraft.item.crafting.Ingredient.merge(java.util.Arrays.asList(${repairs.map((r) => ingredientExpr(env, r)).join(", ")}))` : "net.minecraft.item.crafting.Ingredient.EMPTY"}; }
    };`);
    } else {
      const tagKey = (registry: string, tag: string) => `net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.${registry}, ${idExpr(env, tag)})`;
      fields.push(`public static final ${pkg}.ToolMaterial MATERIAL = new ${pkg}.ToolMaterial(net.minecraft.tags.BlockTags.${incorrect.toUpperCase()}, ${durability}, ${jfloat(tool.efficiency)}, 0F, ${tool.enchantability}, ${tagKey("ITEM", repairTag)});`);
      tags.push({ registry: "item", tag: repairTag, value: "" }, ...repairs.map((r) => ({ registry: "item", tag: repairTag, value: qualify(env, r) })));
    }
  } else {
    // Without durability the item is unbreakable and unstackable.
    props.push(durability > 0 ? `.durability(${durability})` : ".stacksTo(1)");
    if (legacy) {
      if (Number(tool.enchantability)) members.push(override("public int getEnchantmentValue()", `return ${tool.enchantability};`));
      if (repairs.length) members.push(override(`public boolean isValidRepairItem(${stack} stack, ${stack} repair)`, `return ${repairs.map((r) => `${ingredientExpr(env, r)}.test(repair)`).join(" || ")};`));
    } else {
      if (Number(tool.enchantability)) props.push(`.enchantable(${tool.enchantability})`);
      if (repairs.length) {
        props.push(`.repairable(net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, repairTag)}))`);
        tags.push(...repairs.map((r) => ({ registry: "item", tag: repairTag, value: qualify(env, r) })));
      }
    }
  }

  let superClass = `${pkg}.Item`;
  let superArgs = "properties";
  const extraModifiers = modifierRows(tool.attributeModifiers);
  if (kind) {
    if (!legacy) tags.push({ registry: "item", tag: `minecraft:${kind.tag}`, value: self });
    if (legacy) {
      superClass = `net.minecraft.item.${kind.cls116}`;
      const whole = ["PickaxeItem", "HoeItem", "SwordItem"].includes(kind.cls116);
      superArgs = `TIER, ${whole ? Math.trunc(damage) : jfloat(damage)}, ${jfloat(speed)}, properties`;
    } else if (env.mc === "1.21.5" && kind.cls215) {
      superClass = `${pkg}.${kind.cls215}`;
      superArgs = `MATERIAL, ${jfloat(damage)}, ${jfloat(speed)}, properties`;
    } else {
      props.unshift(`.${kind.helper}(MATERIAL, ${jfloat(damage)}, ${jfloat(speed)})`);
    }
  } else if (type === "Shield") {
    superClass = legacy ? "net.minecraft.item.ShieldItem" : `${pkg}.ShieldItem`;
    if (legacy) {
      // Forge 1.16.5 only treats the vanilla shield as a shield unless told; vanilla repairs it with planks.
      members.push(override(`public boolean isShield(${stack} stack, net.minecraft.entity.LivingEntity entity)`, "return true;"));
      if (!repairs.length) members.push(override(`public boolean isValidRepairItem(${stack} stack, ${stack} repair)`, "return false;"));
    } else {
      const sounds = "net.minecraft.sounds.SoundEvents";
      const blocks = (bypass: string) => `new ${pkg}.component.BlocksAttacks(0.25F, 1F, java.util.List.of(new ${pkg}.component.BlocksAttacks.DamageReduction(90F, java.util.Optional.empty(), 0F, 1F)), new ${pkg}.component.BlocksAttacks.ItemDamageFunction(3F, 1F, 1F), java.util.Optional.of(${bypass}), java.util.Optional.of(${sounds}.SHIELD_BLOCK), java.util.Optional.of(${sounds}.SHIELD_BREAK))`;
      const bypass = "net.minecraft.tags.DamageTypeTags.BYPASSES_SHIELD";
      props.push(
        ".equippableUnswappable(net.minecraft.world.entity.EquipmentSlot.OFFHAND)",
        `.component(net.minecraft.core.component.DataComponents.BREAK_SOUND, ${sounds}.SHIELD_BREAK)`,
        env.mc === "26.3" ? `.delayedComponent(net.minecraft.core.component.DataComponents.BLOCKS_ATTACKS, context -> ${blocks(`context.getOrThrow(${bypass})`)})`
          : `.component(net.minecraft.core.component.DataComponents.BLOCKS_ATTACKS, ${blocks(bypass)})`,
      );
    }
  } else if (type === "Fishing rod") {
    superClass = legacy ? "net.minecraft.item.FishingRodItem" : `${pkg}.FishingRodItem`;
    if (!legacy) tags.push({ registry: "item", tag: "minecraft:enchantable/fishing", value: self });
  } else if (type === "Shears") {
    if (legacy) superClass = "net.minecraft.item.ShearsItem";
    else {
      superClass = `${pkg}.ShearsItem`;
      props.unshift(`.component(net.minecraft.core.component.DataComponents.TOOL, ${pkg}.ShearsItem.createToolProperties())`);
    }
    members.push(override(`public float getDestroySpeed(${stack} stack, ${state} state)`, `float speed = super.getDestroySpeed(stack, state);\n        return speed > 1F ? ${jfloat(tool.efficiency)} : speed;`));
  } else if (type === "Special" || type === "MultiTool") {
    const effective = `${env.modId}:${id}_effective`;
    const blocks = type === "Special"
      ? (tool.blocksAffected as { block: string }[] ?? []).map((row) => str(row.block)).filter(Boolean)
      : MINEABLE.map((t) => `#minecraft:mineable/${t}`);
    if (legacy) {
      superClass = "net.minecraft.item.TieredItem";
      superArgs = "TIER, properties";
      const test = type === "Special"
        ? blocks.map((b) => (b.startsWith("#") ? `state.is(net.minecraft.tags.BlockTags.createOptional(${idExpr(env, b.slice(1))}))` : `state.getBlock() == ${blockExpr(env, b)}`)).join(" || ") || "false"
        : "state.isToolEffective(net.minecraftforge.common.ToolType.PICKAXE) || state.isToolEffective(net.minecraftforge.common.ToolType.AXE) || state.isToolEffective(net.minecraftforge.common.ToolType.SHOVEL) || state.isToolEffective(net.minecraftforge.common.ToolType.HOE)";
      // Forge harvests blocks that name a tool through the item's tool types.
      if (type === "MultiTool") props.push(...["PICKAXE", "AXE", "SHOVEL", "HOE"].map((t) => `.addToolType(net.minecraftforge.common.ToolType.${t}, ${level})`));
      members.push(override(`public float getDestroySpeed(${stack} stack, ${state} state)`, `return (${test}) ? ${jfloat(tool.efficiency)} : 1F;`));
      members.push(override(`public boolean isCorrectToolForDrops(${state} state)`, `return (${test}) && TIER.getLevel() >= state.getHarvestLevel();`));
    } else {
      props.unshift(`.tool(MATERIAL, net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.BLOCK, ${idExpr(env, effective)}), ${jfloat(damage)}, ${jfloat(speed)}, 0F)`);
      tags.push({ registry: "block", tag: effective, value: "" }, ...blocks.map((b) => ({ registry: "block", tag: effective, value: qualify(env, b) })));
    }
  }

  const melee = (type === "Special" || type === "MultiTool") && legacy ? meleeModifiers(tool.damageVsEntity, tool.attackSpeed) : [];
  // A later attributes() call replaces the tool's own damage and speed, so they are repeated there.
  const modern = !legacy && extraModifiers.length && tiered ? meleeModifiers(tool.damageVsEntity, tool.attackSpeed) : [];
  const traits = itemTraits(env, {
    id,
    rarity: tool.rarity,
    immuneToFire: tool.immuneToFire,
    glow: tool.glowCondition,
    tooltip: str(tool.specialInformationProcedure) ? "" : tool.specialInformation,
    durability,
    stayInGrid: tool.stayInGridWhenCrafting,
    damageOnCrafting: tool.damageOnCrafting,
    modifiers: [...melee, ...modern, ...extraModifiers],
    materialHandled: true,
  });

  const { javaProps, ...models } = toolModels(env, tool, type);
  return {
    ...itemForm(env, id, tool.creativeTabs),
    superClass,
    superArgs: superArgs.replace("properties", ["properties", ...props, ...traits.props, ...javaProps].join("\n                ")),
    propsType: `${pkg}.Item.Properties`,
    fields: fields.map((f) => `    ${f}\n`).join(""),
    members: [...members, ...traits.members, ...procedureMembers(env, "tool", { ...tool, glowConditionProcedure: tool.glowCondition === true ? "" : tool.glowConditionProcedure }).members].join(""),
    ...models,
    tags: [...tags, ...traits.tags],
  };
}

/**
 * Item models: held like vanilla tools, a fishing rod like the vanilla rod, and a shield gets a raised model while
 * it blocks (1.21.4+: in the item definition; 1.16.5: a model override on the "blocking" property, which the
 * client registers for the item).
 */
function toolModels(env: GenEnv, tool: Element, type: string) {
  const texture = `${env.modId}:item/${tool.id}`;
  const own = `${env.modId}:item/${tool.id}`;
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const legacy = env.mc === "1.16.5";
  const shield = type === "Shield";
  // Java models (models/<name>.java) are drawn by item renderers. On 1.16.5 one renderer serves the item: it draws
  // the blocking model while the local player blocks with it when both models are Java models.
  const javaTexture = `${env.modId}:textures/item/${tool.id}.png`;
  const mainJava = isJavaItemModel(env, str(tool.model));
  const blockJava = shield && isJavaItemModel(env, str(tool.blockingModel));
  let main: JavaItemModel | undefined;
  let block: JavaItemModel | undefined;
  if (legacy && (mainJava || blockJava)) {
    const j = javaItemModel(env, tool.id, str(mainJava ? tool.model : tool.blockingModel), javaTexture, mainJava && blockJava ? str(tool.blockingModel) : undefined);
    if (mainJava) main = j;
    if (blockJava) block = j;
  } else {
    if (mainJava) main = javaItemModel(env, tool.id, str(tool.model), javaTexture);
    if (blockJava) block = javaItemModel(env, `${tool.id}_blocking`, str(tool.blockingModel), javaTexture);
  }
  // "Normal" is the vanilla shape of the tool type; any other name is a project model (models/<name>.json, .obj).
  const builtin = type === "Fishing rod" ? "minecraft:item/handheld_rod" : "minecraft:item/handheld";
  const parent = str(tool.model) === "Normal" || !str(tool.model) || mainJava ? builtin : customModel(env, `tool/${tool.id}`, str(tool.model)) ?? builtin;
  const model = main?.modelJson ?? { parent, textures: { layer0: texture } };
  const raised = { rotation: [45, -35, 0] };
  const customBlocking = shield && !blockJava && str(tool.blockingModel) !== "Normal blocking" && str(tool.blockingModel) ? customModel(env, `tool/${tool.id}`, str(tool.blockingModel)) : undefined;
  const blocking = block?.modelJson ?? (customBlocking ? { parent: customBlocking } : { parent: "minecraft:item/handheld", textures: { layer0: texture }, display: {
    thirdperson_righthand: raised, thirdperson_lefthand: raised,
    firstperson_righthand: { rotation: [0, 0, 5], translation: [-5, 2, -1] }, firstperson_lefthand: { rotation: [0, 0, 5], translation: [-5, 2, -1] },
  } });
  const plain = main?.definition ?? { type: "minecraft:model", model: own };
  const definition = shield
    ? { type: "minecraft:condition", property: "minecraft:using_item", on_false: plain, on_true: block?.definition ?? { type: "minecraft:model", model: `${own}_blocking` } }
    : plain;
  // A custom model may show a separate flat icon in inventories.
  const icon = guiIcon(env, tool.id, isBuiltinItemModel(tool.model) ? "" : str(tool.guiTexture), definition,
    shield && legacy ? { ...model, overrides: [{ predicate: { blocking: 1 }, model: `${own}_blocking` }] } : model);
  return {
    javaProps: main?.props ?? block?.props ?? [],
    itemModelJson: json(icon.modelJson),
    itemDefinitionJson: json({ model: icon.definition }),
    ...(icon.texture ? { textures: [{ from: str(tool.texture), to: `item/${tool.id}` }, icon.texture] } : {}),
    files: [...(shield ? [{ path: `assets/${env.modId}/models/item/${tool.id}_blocking.json`, json: json(blocking) }] : []), ...icon.files],
    client: shield && legacy ? { setup: [`net.minecraft.item.ItemModelsProperties.register(${itemExpr(env, tool.id)}, new net.minecraft.util.ResourceLocation("blocking"), (stack, world, entity) -> entity != null && entity.isUsingItem() && entity.getUseItem() == stack ? 1F : 0F);`] } : undefined,
    // Vanilla keeps a fishing bobber only for the vanilla rod; Fabric patches that check (NeoForge asks the item).
    mixins: type === "Fishing rod" && env.loader === "fabric" ? [{ id: "FishingHookMixin", code: fishingHookMixin(env) }] : [],
  };
}

function fishingHookMixin(env: GenEnv): string {
  const arg = env.mc === "26.3" ? "java.lang.Object" : "net.minecraft.world.item.Item";
  const descriptor = env.mc === "26.3" ? "Ljava/lang/Object;" : "Lnet/minecraft/world/item/Item;";
  const mixin = "org.spongepowered.asm.mixin";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Keeps a fishing bobber out while its owner holds any fishing rod, not only the vanilla one. */
@${mixin}.Mixin(net.minecraft.world.entity.projectile.FishingHook.class)
public abstract class FishingHookMixin {
    @${mixin}.injection.Redirect(method = "shouldStopFishing", at = @${mixin}.injection.At(value = "INVOKE", target = "Lnet/minecraft/world/item/ItemStack;is(${descriptor})Z"))
    private boolean ${env.modId}$anyFishingRod(net.minecraft.world.item.ItemStack stack, ${arg} item) {
        return stack.getItem() == item || stack.getItem() instanceof net.minecraft.world.item.FishingRodItem;
    }
}
`;
}

export default { element } satisfies TypeModule;
