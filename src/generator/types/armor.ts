import type { Element } from "../../elements/model.ts";
import { attributeMethod1165, idExpr, ingredientExpr, list, modifierRows, qualify, str, SLOT_GROUPS, vanillaTab1165, itemExpr } from "../java.ts";
import { itemRows, itemTraits, override } from "../itemTraits.ts";
import type { Context } from "../render.ts";
import { modelExists, modelOutputs } from "../mob/models.ts";
import { customModel } from "../models.ts";
import { procedureBuild } from "../procedures.ts";
import { tooltipProcedureMember } from "../tooltips.ts";
import { boneIndex, legacyWornMembers, wornModelsClass, wornModelsSource, type Slot, type WornPiece } from "../wornModels.ts";
import type { ElementContext, GenEnv, TagEntry, TypeModule } from "../typeModule.ts";

/** Armor pieces: field prefix, registry suffix, ArmorType (1.21+), EquipmentSlotType (1.16.5), MCreator base durability. */
const PIECES = [
  { key: "helmet", field: "Helmet", type: "HELMET", slot: "HEAD", base: 13, defense: "damageValueHelmet", texture: "textureHelmet" },
  { key: "body", field: "Body", type: "CHESTPLATE", slot: "CHEST", base: 15, defense: "damageValueBody", texture: "textureBody" },
  { key: "leggings", field: "Leggings", type: "LEGGINGS", slot: "LEGS", base: 16, defense: "damageValueLeggings", texture: "textureLeggings" },
  { key: "boots", field: "Boots", type: "BOOTS", slot: "FEET", base: 11, defense: "damageValueBoots", texture: "textureBoots" },
] as const;
const SUFFIX: Record<string, string> = { helmet: "helmet", body: "chestplate", leggings: "leggings", boots: "boots" };

function element(armor: Element, env: GenEnv): ElementContext {
  const legacy = env.mc === "1.16.5";
  const id = armor.id;
  const pieces = PIECES.filter((p) => armor[`enable${p.field}`] === true);
  const repairs = itemRows(armor.repairItems);
  const repairTag = `${env.modId}:${id}_repair_items`;
  const tags: TagEntry[] = [];
  const lang: Record<string, string> = {};
  const textures: { from: string; to: string }[] = [];
  const layer1 = str(armor.armorTextureFile);
  const layer2 = layer1.includes("_layer_1") ? layer1.replace("_layer_1", "_layer_2") : layer1;
  const sound = str(armor.equipSound);

  let material: string;
  if (legacy) {
    const perSlot = (values: [string, number][]) => values.map(([slot, value]) => `slot == net.minecraft.inventory.EquipmentSlotType.${slot} ? ${value}`).join(" : ") + " : 0";
    material = `public static final net.minecraft.item.IArmorMaterial MATERIAL = new net.minecraft.item.IArmorMaterial() {
        public int getDurabilityForSlot(net.minecraft.inventory.EquipmentSlotType slot) { return ${perSlot(PIECES.map((p) => [p.slot, p.base * Number(armor.maxDamage)]))}; }
        public int getDefenseForSlot(net.minecraft.inventory.EquipmentSlotType slot) { return ${perSlot(PIECES.map((p) => [p.slot, Number(armor[p.defense])]))}; }
        public int getEnchantmentValue() { return ${armor.enchantability}; }
        public net.minecraft.util.SoundEvent getEquipSound() { return ${sound ? `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${idExpr(env, qualify(env, sound))})` : "net.minecraft.util.SoundEvents.ARMOR_EQUIP_GENERIC"}; }
        public net.minecraft.item.crafting.Ingredient getRepairIngredient() { return ${repairs.length ? `net.minecraft.item.crafting.Ingredient.merge(java.util.Arrays.asList(${repairs.map((r) => ingredientExpr(env, r)).join(", ")}))` : "net.minecraft.item.crafting.Ingredient.EMPTY"}; }
        public String getName() { return "${env.modId}:${id}"; }
        public float getToughness() { return ${Number(armor.toughness)}F; }
        public float getKnockbackResistance() { return ${Number(armor.knockbackResistance)}F; }
    };`;
    if (layer1) textures.push({ from: layer1, to: `models/armor/${id}_layer_1` }, { from: layer2, to: `models/armor/${id}_layer_2` });
  } else {
    const eq = "net.minecraft.world.item.equipment";
    const defense = PIECES.map((p) => `${eq}.ArmorType.${p.type}, ${Number(armor[p.defense])}`).join(", ");
    material = `public static final ${eq}.ArmorMaterial MATERIAL = new ${eq}.ArmorMaterial(${Number(armor.maxDamage)},
            java.util.Map.of(${defense}, ${eq}.ArmorType.BODY, 0),
            ${armor.enchantability},
            ${sound ? `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.get(${idExpr(env, qualify(env, sound))}).orElseThrow()` : "net.minecraft.sounds.SoundEvents.ARMOR_EQUIP_GENERIC"},
            ${Number(armor.toughness)}F, ${Number(armor.knockbackResistance)}F,
            net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM, ${idExpr(env, repairTag)}),
            net.minecraft.resources.ResourceKey.create(${eq}.EquipmentAssets.ROOT_ID, ${idExpr(env, `${env.modId}:${id}`)}));`;
    tags.push({ registry: "item", tag: repairTag, value: "" }, ...repairs.map((r) => ({ registry: "item", tag: repairTag, value: qualify(env, r) })));
    if (layer1) textures.push({ from: layer1, to: `entity/equipment/humanoid/${id}` }, { from: layer2, to: `entity/equipment/humanoid_leggings/${id}` });
  }

  const allModifiers = list<Record<string, unknown>>(armor.attributeModifiers);
  const worn: WornPiece[] = [];
  const pieceContexts = pieces.map((p) => {
    const pieceId = `${id}_${SUFFIX[p.key]}`;
    const self = qualify(env, pieceId);
    const name = str(armor[`${p.key}Name`]);
    if (name) lang[`item.${env.modId}.${pieceId}`] = name;
    if (str(armor[p.texture])) textures.push({ from: str(armor[p.texture]), to: `item/${pieceId}` });
    const modifiers = modifierRows(allModifiers.filter((row) => list(row.armorPieces).includes(p.key)));
    const traits = itemTraits(env, {
      id: pieceId,
      rarity: armor.rarity,
      immuneToFire: armor[`${p.key}ImmuneToFire`],
      glow: armor[`${p.key}GlowCondition`],
      tooltip: str(armor[`${p.key}SpecialInformationProcedure`]) ? "" : armor[`${p.key}SpecialInformation`],
      materialHandled: true,
    });
    const members = [...traits.members];
    const tooltip = tooltipProcedureMember(env, "armor", armor, `${p.key}SpecialInformationProcedure`);
    if (tooltip) members.push(tooltip);
    const props = [...traits.props];
    if (legacy) {
      members.push(attributeMethod1165(env, pieceId, modifiers));
      if (armor[`${p.key}PiglinNeutral`] === true) {
        members.push(override("public boolean makesPiglinsNeutral(net.minecraft.item.ItemStack stack, net.minecraft.entity.LivingEntity wearer)", "return true;"));
      }
    } else {
      props.unshift(`.humanoidArmor(MATERIAL, net.minecraft.world.item.equipment.ArmorType.${p.type})`);
      if (modifiers.length) {
        // attributes() replaces the armor values humanoidArmor() set, so they are taken from the material first.
        const attrs = "net.minecraft.world.entity.ai.attributes";
        const added = modifiers.map((m, i) => `\n                    .withModifierAdded(net.minecraft.core.registries.BuiltInRegistries.ATTRIBUTE.get(${idExpr(env, qualify(env, m.attribute))}).orElseThrow(), new ${attrs}.AttributeModifier(${idExpr(env, `${env.modId}:${pieceId}_${i}`)}, ${m.amount}, ${attrs}.AttributeModifier.Operation.${m.operation}), net.minecraft.world.entity.EquipmentSlotGroup.${SLOT_GROUPS[m.slot]})`);
        props.push(`.attributes(MATERIAL.createAttributes(net.minecraft.world.item.equipment.ArmorType.${p.type})${added.join("")})`);
      }
      if (armor[`${p.key}PiglinNeutral`] === true) tags.push({ registry: "item", tag: "minecraft:piglin_safe_armor", value: self });
      tags.push({ registry: "item", tag: `minecraft:${{ helmet: "head", body: "chest", leggings: "leg", boots: "foot" }[p.key]}_armor`, value: self });
    }
    tags.push(...traits.tags);
    // Custom worn model (models/<name>.java) with its parts and texture.
    const wornPiece = wornModel(env, armor, p.key, pieceId, p.key === "leggings" ? layer2 : layer1);
    if (wornPiece) {
      worn.push(wornPiece.piece);
      textures.push({ from: wornPiece.from, to: wornPiece.piece.texture });
      if (legacy) members.push(legacyWornMembers(env, wornPiece.piece));
    }
    return {
      pieceId,
      pieceConstant: pieceId.toUpperCase(),
      pieceClass: p.field,
      pieceSuper: legacy ? "net.minecraft.item.ArmorItem" : "net.minecraft.world.item.Item",
      pieceArgs: legacy
        ? `MATERIAL, net.minecraft.inventory.EquipmentSlotType.${p.slot}, ${["properties", ...props].join("\n                    ")}`
        : ["properties", ...props].join("\n                    "),
      pieceMembers: members.join("").replaceAll("\n    ", "\n        "),
      vanillaTab: vanillaTab1165(env, armor.creativeTabs),
      itemModelJson: JSON.stringify({ parent: itemModel(env, armor, p.key, pieceId), textures: { layer0: `${env.modId}:item/${pieceId}` } }, null, 2),
    };
  });

  return {
    tabItems: pieceContexts.map((p) => itemExpr(env, p.pieceId)),
    material,
    propsType: legacy ? "net.minecraft.item.Item.Properties" : "net.minecraft.world.item.Item.Properties",
    pieces: pieceContexts,
    equipmentJson: JSON.stringify({ layers: { humanoid: [{ texture: `${env.modId}:${id}` }], humanoid_leggings: [{ texture: `${env.modId}:${id}` }] } }, null, 2),
    lang,
    textures,
    tags,
    worn,
  };
}

/** Item model parent of a piece: "Normal" or "Tool", or a project JSON/OBJ model (item model type 1 or 2). */
function itemModel(env: GenEnv, armor: Element, key: string, pieceId: string): string {
  const type = Number(armor[`${key}ItemRenderType`]);
  const name = str(armor[`${key}ItemCustomModelName`]);
  const builtin = name === "Tool" ? "minecraft:item/handheld" : "minecraft:item/generated";
  if (type !== 1 && type !== 2) return builtin;
  return customModel(env, `armor/${armor.id}: ${pieceId}`, name, type === 1 ? "json" : "obj") ?? builtin;
}

/** Fields naming the model parts attached to each body part, per piece. */
const WORN_PARTS: Record<string, [string, Slot][]> = {
  helmet: [["helmetModelPart", "head"]],
  body: [["bodyModelPart", "body"], ["armsModelPartL", "leftArm"], ["armsModelPartR", "rightArm"]],
  leggings: [["leggingsModelPartL", "leftLeg"], ["leggingsModelPartR", "rightLeg"]],
  boots: [["bootsModelPartL", "leftLeg"], ["bootsModelPartR", "rightLeg"]],
};

/** The custom worn model of a piece, or undefined for the vanilla armor shape (warned when the model is missing). */
function wornModel(env: GenEnv, armor: Element, key: string, pieceId: string, layerTexture: string): { piece: WornPiece; from: string } | undefined {
  const model = str(armor[`${key}ModelName`]);
  if (!model || model === "Default") return undefined;
  const warn = (text: string) => procedureBuild(env).warnings.push(`armor/${armor.id}: ${pieceId}: ${text}`);
  if (!modelExists(env, model)) {
    warn(`worn model "${model}" is not a project model (models/${model}.java); the vanilla armor shape is used`);
    return undefined;
  }
  const from = str(armor[`${key}ModelTexture`]) || layerTexture;
  if (!from) {
    warn(`worn model "${model}" has no texture (model texture or armor texture); the vanilla armor shape is used`);
    return undefined;
  }
  const parts: WornPiece["parts"] = {};
  for (const [field, slot] of WORN_PARTS[key]) {
    const index = boneIndex(env, model, str(armor[field]), warn);
    if (index !== undefined) parts[slot] = index;
  }
  return { piece: { pieceId, model, parts, texture: `entity/armor/${pieceId}`, translucent: armor[`${key}Translucency`] === true }, from };
}

export default {
  element,
  runtime: (armors: ElementContext[], env: GenEnv) => {
    const worn = armors.flatMap((a) => (a.worn as WornPiece[] | undefined) ?? []);
    const models = modelOutputs(env, "armor");
    if (!worn.length) return models;
    const register = `${wornModelsClass(env)}.register(${env.loader === "neoforge" ? "modBus" : ""});`;
    return {
      sources: [...models.sources, wornModelsSource(env, worn)],
      clientInit: [...models.clientInit, ...(env.mc === "1.16.5" ? [] : [register])],
    };
  },
  global: (armors: ElementContext[]): Context => ({
    armorPieces: armors.flatMap((a) => (a.pieces as Context[]).map((p) => ({ id: p.pieceId, itemModelJson: p.itemModelJson }))),
  }),
} satisfies TypeModule;
