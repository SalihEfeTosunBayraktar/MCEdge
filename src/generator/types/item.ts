import type { Element } from "../../elements/model.ts";
import { idExpr, itemForm, itemPkg, jfloat, list, meleeModifiers, modifierRows, qualify, stackExpr, str } from "../java.ts";
import { guiIcon, isBuiltinItemModel, itemRows, itemTraits, modelParent, override } from "../itemTraits.ts";
import { isJavaItemModel, javaItemModel } from "../javaModels.ts";
import { itemStates } from "../states.ts";
import { procedureBuild, procedureMembers } from "../procedures.ts";
import { guiSlots, menusClass, openGuiCall } from "./gui.ts";
import type { GenEnv, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/** Use animation constant per generation; values missing from a generation are not offered there (layer.json). */
const ANIMATIONS: Record<GenEnv["mc"], Record<string, string>> = {
  "1.16.5": { none: "NONE", eat: "EAT", drink: "DRINK", block: "BLOCK", bow: "BOW", trident: "SPEAR", crossbow: "CROSSBOW" },
  "1.21.5": {
    none: "NONE", eat: "EAT", drink: "DRINK", block: "BLOCK", bow: "BOW", trident: "SPEAR", crossbow: "CROSSBOW",
    spyglass: "SPYGLASS", toot_horn: "TOOT_HORN", brush: "BRUSH", bundle: "BUNDLE",
  },
  "26.3": {
    none: "NONE", eat: "EAT", drink: "DRINK", block: "BLOCK", bow: "BOW", trident: "TRIDENT", crossbow: "CROSSBOW",
    spyglass: "SPYGLASS", toot_horn: "TOOT_HORN", brush: "BRUSH", bundle: "BUNDLE", spear: "SPEAR",
  },
};

/** Vanilla food takes 32 ticks to eat; 0 keeps that default. */
const DEFAULT_EAT_TICKS = 32;

function element(item: Element, env: GenEnv) {
  const pkg = itemPkg(env);
  const stack = `${pkg}.ItemStack`;
  const legacy = env.mc === "1.16.5";
  const food = item.isFood === true;
  const durability = Number(item.damageCount);
  const animation = str(item.animation);
  const useTicks = Number(item.useDuration);
  const disc = item.isMusicDisc === true;
  const traits = itemTraits(env, {
    id: item.id,
    rarity: item.rarity,
    immuneToFire: item.immuneToFire,
    glow: item.glowCondition,
    // A tooltip procedure replaces the fixed lines.
    tooltip: str(item.specialInformationProcedure) ? "" : item.specialInformation,
    enchantability: Number(item.enchantability),
    repairItems: itemRows(item.repairItems),
    durability,
    stayInGrid: item.stayInGridWhenCrafting,
    damageOnCrafting: item.damageOnCrafting,
    recipeRemainder: str(item.recipeRemainder),
    modifiers: [...(item.enableMeleeDamage === true ? meleeModifiers(item.damageVsEntity, item.attackSpeed) : []), ...modifierRows(item.attributeModifiers)],
  });
  const props = [...traits.props];
  const members = [...traits.members];
  // Procedure fields; an item that starts using on right-click keeps doing so when its use procedure runs.
  const startsUsing = useTicks > 0 && !food;
  // A GUI bound to the item gives it an inventory; right-click can open the GUI on it.
  const gui = boundGui(env, item);
  const opensGui = gui !== "" && item.openGUIOnRightClick === true;
  const openGui = opensGui ? itemGuiOpen(env, item, gui) : "";
  const rightClick = [startsUsing ? "entity.startUsingItem(hand);" : "", openGui].filter(Boolean).join("\n");
  // The item left after eating goes with the finish procedure, which overrides the same method.
  const eatRef = food && str(item.eatResultItem) ? str(item.eatResultItem) : "";
  const useSound = str(item.useSound);
  const procedures = procedureMembers(env, "item", { ...item, glowConditionProcedure: item.glowCondition === true ? "" : item.glowConditionProcedure },
    { ...(rightClick ? { onRightClickedInAir: rightClick } : {}), ...(eatRef ? { onFinishUsingItem: stackExpr(env, eatRef) } : {}) });
  if (opensGui && !procedures.handled.has("onRightClickedInAir")) members.push(useOpensGui(env, openGui, startsUsing));
  if (legacy && opensGui && guiSlots(env.generated.gui!.find((g) => g.id === gui)!) > 0) members.push(legacyInventory(Number(item.inventorySize) || 1, Number(item.inventoryStackSize) || 64));
  const tags: TagEntry[] = [...traits.tags];
  const lang: Record<string, string> = {};

  // Durability makes an item unstackable; the stack size only applies without it.
  if (durability <= 0 && Number(item.stackSize) !== 64) props.push(`.stacksTo(${item.stackSize})`);

  if (food) {
    if (legacy) {
      props.push(`.food(new net.minecraft.item.Food.Builder().nutrition(${item.nutritionalValue}).saturationMod(${jfloat(item.saturation)})${item.isMeat === true ? ".meat()" : ""}${item.isAlwaysEdible === true ? ".alwaysEat()" : ""}.build())`);
    } else {
      const consumable = "net.minecraft.world.item.component.Consumables";
      const anim = animation === "none" || animation === "eat" ? "" : `.animation(${pkg}.ItemUseAnimation.${ANIMATIONS[env.mc][animation]})`;
      const seconds = useTicks > 0 && useTicks !== DEFAULT_EAT_TICKS ? `.consumeSeconds(${jfloat(useTicks / 20)})` : "";
      props.push(`.food(new net.minecraft.world.food.FoodProperties.Builder().nutrition(${item.nutritionalValue}).saturationModifier(${jfloat(item.saturation)})${item.isAlwaysEdible === true ? ".alwaysEdible()" : ""}.build(), ${consumable}.${animation === "drink" ? "defaultDrink()" : "defaultFood()"}${animation === "drink" ? "" : anim}${seconds}${useSound ? `.sound(net.minecraft.core.Holder.direct(net.minecraft.sounds.SoundEvent.createVariableRangeEvent(${idExpr(env, qualify(env, useSound))})))` : ""}.build())`);
      if (item.isMeat === true) tags.push({ registry: "item", tag: "minecraft:meat", value: qualify(env, item.id) });
    }
    if (eatRef && !procedures.handled.has("onFinishUsingItem")) members.push(eatResult(env, eatRef));
  }
  // 1.16.5 asks the item for the sound of eating and drinking; 1.21+ takes it from the consumable (above).
  if (legacy && useSound) {
    const sound = `new net.minecraft.util.SoundEvent(${idExpr(env, qualify(env, useSound))})`;
    members.push(override("public net.minecraft.util.SoundEvent getEatingSound()", `return ${sound};`), override("public net.minecraft.util.SoundEvent getDrinkingSound()", `return ${sound};`));
  }
  // 1.21+ food reads its animation and duration from the consumable component; 1.16.5 food asks the item.
  if (!food || legacy) {
    const useAction = legacy ? "net.minecraft.item.UseAction" : `${pkg}.ItemUseAnimation`;
    if (animation !== "none" && !(food && animation === "eat")) {
      members.push(override(`public ${useAction} getUseAnimation(${stack} stack)`, `return ${useAction}.${ANIMATIONS[env.mc][animation]};`));
    }
    if (useTicks > 0) {
      members.push(override(legacy ? `public int getUseDuration(${stack} stack)` : `public int getUseDuration(${stack} stack, net.minecraft.world.entity.LivingEntity entity)`, `return ${useTicks};`));
      // Non-food items only start being used when told to.
      if (!food && !opensGui && !procedures.handled.has("onRightClickedInAir")) members.push(startUsing(env));
    }
  }

  if (Number(item.toolType) !== 1) {
    const state = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
    members.push(override(`public float getDestroySpeed(${stack} stack, ${state} state)`, `return ${jfloat(item.toolType)};`));
  }
  if (item.destroyAnyBlock === true) {
    members.push(legacy
      ? override("public boolean isCorrectToolForDrops(net.minecraft.block.BlockState state)", "return true;")
      : override(`public boolean isCorrectToolForDrops(${stack} stack, net.minecraft.world.level.block.state.BlockState state)`, "return true;"));
  }
  if (item.isPiglinCurrency === true && env.loader !== "fabric") members.push(override(`public boolean isPiglinCurrency(${stack} stack)`, "return true;"));

  // Banner patterns (1.21.5+): the item names a banner pattern tag listing its patterns. The patterns are banner
  // pattern elements, generated later, so the entries are optional.
  const files: ResourceFile[] = [];
  const patterns = list<Record<string, unknown>>(item.providedBannerPatterns).map((row) => str(row.pattern)).filter(Boolean);
  if (patterns.length && !legacy) {
    const tag = `${env.modId}:pattern_item/${item.id}`;
    const key = `net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.BANNER_PATTERN, ${idExpr(env, tag)})`;
    const component = "net.minecraft.core.component.DataComponents.PROVIDES_BANNER_PATTERNS";
    props.push(env.mc === "26.3" ? `.delayedComponent(${component}, context -> context.getOrThrow(${key}))` : `.component(${component}, ${key})`);
    files.push({ path: `data/${env.modId}/tags/banner_pattern/pattern_item/${item.id}.json`, json: JSON.stringify({ values: patterns.map((p) => ({ id: qualify(env, p), required: false })) }, null, 2) });
    if (env.mc === "26.3") tags.push({ registry: "item", tag: "minecraft:loom_patterns", value: qualify(env, item.id) });
  }

  let superClass = `${pkg}.Item`;
  let superArgs = "properties";
  if (disc) {
    const sound = qualify(env, str(item.musicDiscMusic));
    if (legacy) {
      superClass = "net.minecraft.item.MusicDiscItem";
      superArgs = `${item.musicDiscAnalogOutput}, () -> net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${idExpr(env, sound)}), properties`;
      lang[`item.${env.modId}.${item.id}.desc`] = str(item.musicDiscDescription);
    } else {
      const songs = "net.minecraft.core.registries.Registries.JUKEBOX_SONG";
      props.push(`.jukeboxPlayable(net.minecraft.resources.ResourceKey.create(${songs}, ${idExpr(env, `${env.modId}:${item.id}`)}))`);
      lang[`jukebox_song.${env.modId}.${item.id}`] = str(item.musicDiscDescription);
    }
  }

  // A Java model (models/<name>.java) is drawn by an item renderer.
  const javaItem = isJavaItemModel(env, str(item.model)) ? javaItemModel(env, item.id, str(item.model), `${env.modId}:textures/item/${item.id}.png`, undefined, item.animations) : undefined;
  if (javaItem) props.push(...javaItem.props);
  // Model states: other models while properties (custom procedures or built in) reach their values.
  const plainDefinition = javaItem?.definition ?? { type: "minecraft:model", model: `${env.modId}:item/${item.id}` };
  const states = itemStates(env, item, plainDefinition);
  const plainModel: Record<string, unknown> = javaItem?.modelJson ?? { parent: modelParent(env, `item/${item.id}`, item.model), textures: { layer0: `${env.modId}:item/${item.id}` } };
  if (states) files.push(...states.files);
  // A custom model may show a separate flat icon in inventories.
  const model = states?.overrides.length ? { ...plainModel, overrides: states.overrides } : plainModel;
  const icon = guiIcon(env, item.id, isBuiltinItemModel(item.model) ? "" : str(item.guiTexture), states?.definition ?? plainDefinition, model);
  files.push(...icon.files);
  const textures = states || icon.texture
    ? [{ from: str(item.texture), to: `item/${item.id}` }, ...(states?.textures ?? []), ...(icon.texture ? [icon.texture] : [])]
    : undefined;

  return {
    ...itemForm(env, item.id, item.creativeTabs),
    superClass,
    superArgs: superArgs.replace("properties", ["properties", ...props].join("\n                ")),
    propsType: `${pkg}.Item.Properties`,
    members: [...members, ...procedures.members].join(""),
    itemModelJson: JSON.stringify(icon.modelJson, null, 2),
    itemDefinitionJson: JSON.stringify({ model: icon.definition }, null, 2),
    ...(textures ? { textures } : {}),
    ...(states ? { client: { setup: states.setup } } : {}),
    musicDisc: disc && !legacy,
    jukeboxSongJson: disc && !legacy ? JSON.stringify({
      sound_event: qualify(env, str(item.musicDiscMusic)),
      description: { translate: `jukebox_song.${env.modId}.${item.id}` },
      length_in_seconds: Number(item.musicDiscLengthInTicks) / 20,
      comparator_output: Number(item.musicDiscAnalogOutput),
    }, null, 2) : "",
    tags,
    lang,
    files,
  };
}

/** The GUI element bound to the item, or "" when none is set or the GUI is not generated (warned). */
function boundGui(env: GenEnv, item: Element): string {
  const gui = str(item.guiBoundTo);
  if (!gui) return "";
  if (env.generated.gui?.some((g) => g.id === gui)) return gui;
  procedureBuild(env).warnings.push(`item/${item.id}: bound GUI "${gui}" is not generated`);
  return "";
}

/** Opens the bound GUI on the item's own inventory (`world`, `entity`, `hand` in scope). */
function itemGuiOpen(env: GenEnv, item: Element, gui: string): string {
  const legacy = env.mc === "1.16.5";
  const SP = legacy ? "net.minecraft.entity.player.ServerPlayerEntity" : "net.minecraft.server.level.ServerPlayer";
  const container = guiSlots(env.generated.gui!.find((g) => g.id === gui)!) > 0
    ? `new ${menusClass(env)}.ItemContainer(entity.getItemInHand(hand), ${Number(item.inventorySize) || 1}, ${Number(item.inventoryStackSize) || 64})`
    : "null";
  return `if (!world.isClientSide() && entity instanceof ${SP}) ${openGuiCall(env, gui, `(${SP}) entity`, "entity.blockPosition()", container)}`;
}

/**
 * 1.16.5: the inventory is an item handler capability, which Forge saves under the stack's `ForgeCaps.Parent` (the format
 * MCreator worlds use); the handler refuses the item itself, and the share tag carries the contents to the client.
 */
function legacyInventory(size: number, limit: number): string {
  const ST = "net.minecraft.item.ItemStack";
  const NBT = "net.minecraft.nbt.CompoundNBT";
  const CAP = "net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY";
  const H = "net.minecraftforge.items.ItemStackHandler";
  return override(`public net.minecraftforge.common.capabilities.ICapabilityProvider initCapabilities(${ST} stack, ${NBT} compound)`,
    `final net.minecraft.item.Item self = this;
        return new net.minecraftforge.common.capabilities.ICapabilitySerializable<${NBT}>() {
            private final net.minecraftforge.common.util.LazyOptional<${H}> inventory = net.minecraftforge.common.util.LazyOptional.of(() -> new ${H}(${size}) {
                @Override
                public int getSlotLimit(int slot) {
                    return ${limit};
                }

                @Override
                public boolean isItemValid(int slot, ${ST} other) {
                    return other.getItem() != self;
                }

                @Override
                public void setSize(int newSize) {
                }
            });

            @Override
            public <T> net.minecraftforge.common.util.LazyOptional<T> getCapability(net.minecraftforge.common.capabilities.Capability<T> capability, net.minecraft.util.Direction side) {
                return capability == ${CAP} ? this.inventory.cast() : net.minecraftforge.common.util.LazyOptional.empty();
            }

            @Override
            public ${NBT} serializeNBT() {
                return this.inventory.orElseThrow(RuntimeException::new).serializeNBT();
            }

            @Override
            public void deserializeNBT(${NBT} nbt) {
                this.inventory.orElseThrow(RuntimeException::new).deserializeNBT(nbt);
            }
        };`)
    + override(`public ${NBT} getShareTag(${ST} stack)`,
      `${NBT} nbt = super.getShareTag(stack);
        if (nbt != null) stack.getCapability(${CAP}).ifPresent(handler -> nbt.put("Inventory", ((${H}) handler).serializeNBT()));
        return nbt;`)
    + override(`public void readShareTag(${ST} stack, ${NBT} nbt)`,
      `super.readShareTag(stack, nbt);
        if (nbt != null && nbt.contains("Inventory")) stack.getCapability(${CAP}).ifPresent(handler -> ((${H}) handler).deserializeNBT(nbt.getCompound("Inventory")));`);
}

function useOpensGui(env: GenEnv, open: string, startsUsing: boolean): string {
  const use = startsUsing ? "entity.startUsingItem(hand);\n        " : "";
  if (env.mc === "1.16.5") {
    return override("public net.minecraft.util.ActionResult<net.minecraft.item.ItemStack> use(net.minecraft.world.World world, net.minecraft.entity.player.PlayerEntity entity, net.minecraft.util.Hand hand)",
      `${use}${open}
        return net.minecraft.util.ActionResult.sidedSuccess(entity.getItemInHand(hand), world.isClientSide());`);
  }
  return override("public net.minecraft.world.InteractionResult use(net.minecraft.world.level.Level world, net.minecraft.world.entity.player.Player entity, net.minecraft.world.InteractionHand hand)",
    `${use}${open}
        return net.minecraft.world.InteractionResult.SUCCESS;`);
}

/** Right click starts using the item so its use animation and duration play. */
function startUsing(env: GenEnv): string {
  if (env.mc === "1.16.5") {
    return override("public net.minecraft.util.ActionResult<net.minecraft.item.ItemStack> use(net.minecraft.world.World world, net.minecraft.entity.player.PlayerEntity player, net.minecraft.util.Hand hand)",
      "player.startUsingItem(hand);\n        return net.minecraft.util.ActionResult.consume(player.getItemInHand(hand));");
  }
  return override("public net.minecraft.world.InteractionResult use(net.minecraft.world.level.Level world, net.minecraft.world.entity.player.Player player, net.minecraft.world.InteractionHand hand)",
    "player.startUsingItem(hand);\n        return net.minecraft.world.InteractionResult.CONSUME;");
}

/** After eating, the player also gets the eat result item (like a bowl after stew). */
function eatResult(env: GenEnv, ref: string): string {
  const pkg = itemPkg(env);
  const result = stackExpr(env, ref);
  if (env.mc === "1.16.5") {
    return override(`public ${pkg}.ItemStack finishUsingItem(${pkg}.ItemStack stack, net.minecraft.world.World world, net.minecraft.entity.LivingEntity entity)`,
      `${pkg}.ItemStack remainder = ${result};
        ${pkg}.ItemStack rest = super.finishUsingItem(stack, world, entity);
        if (rest.isEmpty()) return remainder;
        if (entity instanceof net.minecraft.entity.player.PlayerEntity && !((net.minecraft.entity.player.PlayerEntity) entity).abilities.instabuild) {
            net.minecraft.entity.player.PlayerEntity player = (net.minecraft.entity.player.PlayerEntity) entity;
            if (!player.inventory.add(remainder)) player.drop(remainder, false);
        }
        return rest;`);
  }
  return override(`public ${pkg}.ItemStack finishUsingItem(${pkg}.ItemStack stack, net.minecraft.world.level.Level world, net.minecraft.world.entity.LivingEntity entity)`,
    `${pkg}.ItemStack remainder = ${result};
        ${pkg}.ItemStack rest = super.finishUsingItem(stack, world, entity);
        if (rest.isEmpty()) return remainder;
        if (entity instanceof net.minecraft.world.entity.player.Player player && !player.getAbilities().instabuild) {
            player.getInventory().placeItemBackInInventory(remainder${env.mc === "26.3" ? ", net.minecraft.util.Prediction.SERVER_ONLY" : ""});
        }
        return rest;`);
}

export default { element } satisfies TypeModule;
