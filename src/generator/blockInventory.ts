import type { Element } from "../elements/model.ts";
import { blockDataHolderSource } from "../procedures/runtime.ts";
import { blockExpr, idExpr, jstr, list, pascal, str } from "./java.ts";
import { procedureBuild } from "./procedures.ts";
import { modClassName } from "./registries.ts";
import { openGuiCall } from "./types/gui.ts";
import type { ElementContext, GenEnv, JavaSourceFile } from "./typeModule.ts";

/**
 * Block inventories: a block with `hasInventory` gets a block entity (<Block>BlockEntity) that is a sided container
 * (hoppers insert into the in-slot ids and extract from the out-slot ids), registered in <Mod>BlockEntities. The
 * block creates it, drops its items when broken (unless turned off), feeds comparators and can open its bound GUI
 * on right-click; a GUI opened at the block's position uses the block entity's slots. Energy and fluid tanks live in
 * the block entity too: each engine exposes them through its own API (Forge and NeoForge capabilities, the Fabric
 * fluid transfer API). Fabric API has no energy, so there energy is reachable through BlockDataHolder only.
 */

export interface BlockInventory {
  /** Interface the block class implements (modern EntityBlock), or "". */
  interface: string;
  members: string[];
  /** Statement opening the bound GUI in the right-click override (`world`, `entity`, `pos` in scope), or "". */
  openGui: string;
}

export const beClass = (block: Element) => `${pascal(block.id)}BlockEntity`;
const owner = (env: GenEnv) => `${env.project.mod.package}.init.${modClassName(env)}BlockEntities`;
export const typeExpr = (env: GenEnv, block: Element) => `${owner(env)}.${block.id.toUpperCase()}${env.loader === "fabric" ? "" : ".get()"}`;

export function blockInventory(env: GenEnv, block: Element): BlockInventory | undefined {
  if (block.hasInventory !== true) return undefined;
  const legacy = env.mc === "1.16.5";
  const be = `${env.project.mod.package}.block.entity.${beClass(block)}`;
  const members: string[] = [];
  const S = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
  const P = legacy ? "net.minecraft.util.math.BlockPos" : "net.minecraft.core.BlockPos";
  const L = legacy ? "net.minecraft.world.World" : "net.minecraft.world.level.Level";
  const comparator = block.inventoryComparatorPower === true;
  if (legacy) {
    members.push(`
    @Override
    public boolean hasTileEntity(${S} state) {
        return true;
    }

    @Override
    public net.minecraft.tileentity.TileEntity createTileEntity(${S} state, net.minecraft.world.IBlockReader world) {
        return new ${be}();
    }

    @Override
    public void onRemove(${S} state, ${L} world, ${P} pos, ${S} newState, boolean moving) {
        if (state.getBlock() != newState.getBlock()) {
${block.inventoryDropWhenDestroyed === true ? `            net.minecraft.tileentity.TileEntity blockEntity = world.getBlockEntity(pos);
            if (blockEntity instanceof net.minecraft.inventory.IInventory) net.minecraft.inventory.InventoryHelper.dropContents(world, pos, (net.minecraft.inventory.IInventory) blockEntity);
` : ""}            world.updateNeighbourForOutputSignal(pos, this);
        }
        super.onRemove(state, world, pos, newState, moving);
    }
`);
  } else {
    members.push(`
    @Override
    public net.minecraft.world.level.block.entity.BlockEntity newBlockEntity(${P} pos, ${S} state) {
        return new ${be}(pos, state);
    }
`);
    if (comparator) {
      members.push(`
    @Override
    protected void affectNeighborsAfterRemoval(${S} state, net.minecraft.server.level.ServerLevel world, ${P} pos, boolean moved) {
        net.minecraft.world.Containers.updateNeighboursAfterDestroy(state, world, pos);
    }
`);
    }
  }
  if (comparator) {
    const menu = legacy ? "net.minecraft.inventory.container.Container" : "net.minecraft.world.inventory.AbstractContainerMenu";
    members.push(`
    @Override
    ${legacy ? "public" : "protected"} boolean hasAnalogOutputSignal(${S} state) {
        return true;
    }

    @Override
    ${legacy ? "public" : "protected"} int getAnalogOutputSignal(${S} state, ${L} world, ${P} pos${env.mc === "26.3" ? ", net.minecraft.core.Direction direction" : ""}) {
        return ${menu}.getRedstoneSignalFromBlockEntity(world.getBlockEntity(pos));
    }
`);
  }
  let openGui = "";
  const gui = str(block.guiBoundTo);
  if (gui && block.openGUIOnRightClick === true) {
    if (env.generated.gui?.some((g) => g.id === gui)) {
      const SP = legacy ? "net.minecraft.entity.player.ServerPlayerEntity" : "net.minecraft.server.level.ServerPlayer";
      openGui = `if (entity instanceof ${SP}) ${openGuiCall(env, gui, `(${SP}) entity`, "pos", "null")}`;
    } else {
      procedureBuild(env).warnings.push(`block/${block.id}: bound GUI "${gui}" is not generated`);
    }
  }
  return { interface: legacy ? "" : "net.minecraft.world.level.block.EntityBlock", members, openGui };
}

/** Right-click override opening the bound GUI, for blocks whose right-click procedure does not already do it. */
export function openGuiOverride(env: GenEnv, open: string): string {
  if (env.mc === "1.16.5") {
    return `
    @Override
    public net.minecraft.util.ActionResultType use(net.minecraft.block.BlockState blockstate, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, net.minecraft.entity.player.PlayerEntity entity, net.minecraft.util.Hand hand, net.minecraft.util.math.BlockRayTraceResult hit) {
        if (world.isClientSide() || hand != net.minecraft.util.Hand.MAIN_HAND) return net.minecraft.util.ActionResultType.SUCCESS;
        ${open}
        return net.minecraft.util.ActionResultType.SUCCESS;
    }
`;
  }
  return `
    @Override
    protected net.minecraft.world.InteractionResult useWithoutItem(net.minecraft.world.level.block.state.BlockState blockstate, net.minecraft.world.level.Level world, net.minecraft.core.BlockPos pos, net.minecraft.world.entity.player.Player entity, net.minecraft.world.phys.BlockHitResult hit) {
        if (world.isClientSide()) return net.minecraft.world.InteractionResult.SUCCESS;
        ${open}
        return net.minecraft.world.InteractionResult.SUCCESS;
    }
`;
}

const ENERGY_CAP = "net.minecraftforge.energy.CapabilityEnergy.ENERGY";
const FLUID_CAP = "net.minecraftforge.fluids.capability.CapabilityFluidHandler.FLUID_HANDLER_CAPABILITY";
const DROPLETS_PER_MB = 81;

const hasEnergy = (block: ElementContext) => block.hasEnergyStorage === true;
const hasTank = (block: ElementContext) => block.isFluidTank === true;

/** Fluids a tank accepts, as namespaced ids; none means any. */
function allowedFluids(env: GenEnv, block: ElementContext): string[] {
  return list<unknown>(block.fluidRestrictions)
    .map((row) => (typeof row === "string" ? row : str((row as Record<string, unknown>).fluid)))
    .filter(Boolean)
    .map((id) => (id.includes(":") ? id : `${env.modId}:${id}`));
}

/** Java test that the fluid id expression is allowed. */
const fluidCheck = (ids: string[], id: string) => `java.util.Arrays.asList(${ids.map(jstr).join(", ")}).contains(${id})`;

/** Forge-style energy storage: every change is sent to the client that watches the block. */
function capabilityEnergy(block: ElementContext, storage: string): string {
  const update = (method: string, amount: string) => `        @Override
        public int ${method}(int ${amount}, boolean simulate) {
            int moved = super.${method}(${amount}, simulate);
            if (!simulate) storageChanged();
            return moved;
        }`;
  return `    private final ${storage} energyStorage = new ${storage}(${Number(block.energyCapacity)}, ${Number(block.energyMaxReceive)}, ${Number(block.energyMaxExtract)}, ${Number(block.energyInitial)}) {
${update("receiveEnergy", "maxReceive")}

${update("extractEnergy", "maxExtract")}
    };
`;
}

/** Energy kept by the block entity itself: the transfer limits of a storage, behind BlockDataHolder. */
function fabricEnergy(block: ElementContext): string {
  const capacity = Number(block.energyCapacity);
  const move = (method: string, room: string, limit: number, sign: string) => `    @Override
    public int ${method}(int amount) {
        int moved = Math.max(0, Math.min(amount, Math.min(${room}, ${limit})));
        if (moved > 0) {
            this.energy ${sign}= moved;
            storageChanged();
        }
        return moved;
    }
`;
  return `    private int energy = ${Number(block.energyInitial)};

    @Override
    public int energy(boolean capacity) {
        return capacity ? ${capacity} : this.energy;
    }

${move("receiveEnergy", `${capacity} - this.energy`, Number(block.energyMaxReceive), "+")}
${move("extractEnergy", "this.energy", Number(block.energyMaxExtract), "-")}`;
}

function energyMembers(env: GenEnv, block: ElementContext): string {
  if (env.mc === "1.16.5") return capabilityEnergy(block, "net.minecraftforge.energy.EnergyStorage");
  if (env.loader === "fabric") return fabricEnergy(block);
  if (env.mc === "26.3") {
    const H = "net.neoforged.neoforge.transfer.energy";
    return `    private final ${H}.SimpleEnergyHandler energyStorage = new ${H}.SimpleEnergyHandler(${Number(block.energyCapacity)}, ${Number(block.energyMaxReceive)}, ${Number(block.energyMaxExtract)}, ${Number(block.energyInitial)}) {
        @Override
        protected void onEnergyChanged(int previousAmount) {
            storageChanged();
        }
    };

    public ${H}.EnergyHandler energyStorage() {
        return this.energyStorage;
    }
`;
  }
  return `${capabilityEnergy(block, "net.neoforged.neoforge.energy.EnergyStorage")}
    public net.neoforged.neoforge.energy.IEnergyStorage energyStorage() {
        return this.energyStorage;
    }
`;
}

function tankMembers(env: GenEnv, block: ElementContext): string {
  const capacity = Number(block.fluidCapacity);
  const ids = allowedFluids(env, block);
  if (env.loader === "fabric") {
    const V = "net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariant";
    const S = `net.fabricmc.fabric.api.transfer.v1.storage.base.SingleVariantStorage<${V}>`;
    return `    private final ${S} fluidTank = new ${S}() {
        @Override
        protected ${V} getBlankVariant() {
            return ${V}.blank();
        }

        @Override
        protected long getCapacity(${V} variant) {
            return ${capacity}L * ${DROPLETS_PER_MB}L;
        }
${ids.length ? `
        @Override
        protected boolean canInsert(${V} variant) {
            return ${fluidCheck(ids, "net.minecraft.core.registries.BuiltInRegistries.FLUID.getKey(variant.getFluid()).toString()")};
        }
` : ""}
        @Override
        protected void onFinalCommit() {
            storageChanged();
        }
    };

    public ${S} fluidTank() {
        return this.fluidTank;
    }
`;
  }
  if (env.mc === "26.3") {
    const T = "net.neoforged.neoforge.transfer.fluid";
    return `    private final ${T}.FluidStacksResourceHandler fluidTank = new ${T}.FluidStacksResourceHandler(1, ${capacity}) {
        @Override
        protected void onContentsChanged(int index, net.neoforged.neoforge.fluids.FluidStack previousContents) {
            storageChanged();
        }
${ids.length ? `
        @Override
        public boolean isValid(int index, ${T}.FluidResource resource) {
            return ${fluidCheck(ids, "net.minecraft.core.registries.BuiltInRegistries.FLUID.getKey(resource.getFluid()).toString()")};
        }
` : ""}    };

    public net.neoforged.neoforge.transfer.ResourceHandler<${T}.FluidResource> fluidTank() {
        return this.fluidTank;
    }
`;
  }
  const legacy = env.mc === "1.16.5";
  const Tank = legacy ? "net.minecraftforge.fluids.capability.templates.FluidTank" : "net.neoforged.neoforge.fluids.capability.templates.FluidTank";
  const key = legacy ? "stack.getFluid().getRegistryName().toString()" : "net.minecraft.core.registries.BuiltInRegistries.FLUID.getKey(stack.getFluid()).toString()";
  return `    private final ${Tank} fluidTank = new ${Tank}(${capacity}${ids.length ? `, stack -> ${fluidCheck(ids, key)}` : ""}) {
        @Override
        protected void onContentsChanged() {
            storageChanged();
        }
    };
${legacy ? "" : `
    public ${Tank} fluidTank() {
        return this.fluidTank;
    }
`}`;
}

/** Energy and tank fields of a block entity, with the change hook they call. */
function storageMembers(env: GenEnv, block: ElementContext): string {
  if (!hasEnergy(block) && !hasTank(block)) return "";
  return `${hasEnergy(block) ? energyMembers(env, block) : ""}${hasTank(block) ? `\n${tankMembers(env, block)}` : ""}
    private void storageChanged() {
        this.setChanged();
        if (this.level != null) this.level.sendBlockUpdated(this.worldPosition, this.getBlockState(), this.getBlockState(), 2);
    }
`;
}

/** Statements restoring and storing energy and tanks; the names in scope depend on the version's save methods. */
function storageSaving(env: GenEnv, block: ElementContext): { load: string; save: string } {
  const energy = hasEnergy(block);
  const tank = hasTank(block);
  const lines = (...rows: (string | false)[]) => rows.filter(Boolean).map((row) => `\n        ${row}`).join("");
  const V = "net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariant";
  const S = "net.fabricmc.fabric.api.transfer.v1.storage.base.SingleVariantStorage";
  const fabric = env.loader === "fabric";
  if (env.mc === "1.16.5") {
    return {
      load: lines(energy && `if (tag.contains("energyStorage")) ${ENERGY_CAP}.readNBT(this.energyStorage, null, tag.get("energyStorage"));`, tank && `this.fluidTank.readFromNBT(tag.getCompound("fluidTank"));`),
      save: lines(energy && `tag.put("energyStorage", ${ENERGY_CAP}.writeNBT(this.energyStorage, null));`, tank && `tag.put("fluidTank", this.fluidTank.writeToNBT(new net.minecraft.nbt.CompoundNBT()));`),
    };
  }
  if (env.mc === "26.3") {
    return {
      load: lines(energy && (fabric ? `this.energy = input.getIntOr("energyStorage", this.energy);` : `input.child("energyStorage").ifPresent(this.energyStorage::deserialize);`),
        tank && (fabric ? `input.child("fluidTank").ifPresent(child -> ${S}.readValue(this.fluidTank, ${V}.CODEC, ${V}::blank, child));` : `input.child("fluidTank").ifPresent(this.fluidTank::deserialize);`)),
      save: lines(energy && (fabric ? `output.putInt("energyStorage", this.energy);` : `this.energyStorage.serialize(output.child("energyStorage"));`),
        tank && (fabric ? `${S}.writeValue(this.fluidTank, ${V}.CODEC, output.child("fluidTank"));` : `this.fluidTank.serialize(output.child("fluidTank"));`)),
    };
  }
  return {
    load: lines(energy && (fabric ? `this.energy = tag.getIntOr("energyStorage", this.energy);` : `if (tag.contains("energyStorage")) this.energyStorage.deserializeNBT(registries, tag.get("energyStorage"));`),
      tank && (fabric ? `${S}.readNbt(this.fluidTank, ${V}.CODEC, ${V}::blank, tag.getCompoundOrEmpty("fluidTank"), registries);` : `this.fluidTank.readFromNBT(registries, tag.getCompoundOrEmpty("fluidTank"));`)),
    save: lines(energy && (fabric ? `tag.putInt("energyStorage", this.energy);` : `tag.put("energyStorage", this.energyStorage.serializeNBT(registries));`),
      tank && (fabric ? `net.minecraft.nbt.CompoundTag fluidTag = new net.minecraft.nbt.CompoundTag();\n        ${S}.writeNbt(this.fluidTank, ${V}.CODEC, fluidTag, registries);\n        tag.put("fluidTank", fluidTag);` : `tag.put("fluidTank", this.fluidTank.writeToNBT(registries, new net.minecraft.nbt.CompoundTag()));`)),
  };
}

/**
 * 1.16.5 block entity capabilities, as MCreator made them: the item handler answers per side, and a null side gets the
 * whole inventory (MCreator's LockableTileEntity did; procedures ask with a null side), and the block entity sends its
 * whole tag to clients, which screens read.
 */
export function legacyCapabilities(energy: boolean, tank: boolean): string {
  const Handler = "net.minecraftforge.items.IItemHandler";
  const Lazy = "net.minecraftforge.common.util.LazyOptional";
  return `    private final ${Lazy}<? extends ${Handler}>[] handlers = net.minecraftforge.items.wrapper.SidedInvWrapper.create(this, net.minecraft.util.Direction.values());
    private final ${Lazy}<${Handler}> unsidedHandler = ${Lazy}.of(() -> new net.minecraftforge.items.wrapper.InvWrapper(this));

    @Override
    public <T> ${Lazy}<T> getCapability(net.minecraftforge.common.capabilities.Capability<T> capability, net.minecraft.util.Direction side) {
        if (!this.remove && capability == net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY) return side == null ? this.unsidedHandler.cast() : this.handlers[side.ordinal()].cast();
${energy ? `        if (!this.remove && capability == ${ENERGY_CAP}) return ${Lazy}.of(() -> this.energyStorage).cast();\n` : ""}${tank ? `        if (!this.remove && capability == ${FLUID_CAP}) return ${Lazy}.of(() -> this.fluidTank).cast();\n` : ""}        return super.getCapability(capability, side);
    }

    @Override
    public void setRemoved() {
        super.setRemoved();
        for (${Lazy}<? extends ${Handler}> handler : this.handlers) handler.invalidate();
        this.unsidedHandler.invalidate();
    }

    @Override
    public net.minecraft.network.play.server.SUpdateTileEntityPacket getUpdatePacket() {
        return new net.minecraft.network.play.server.SUpdateTileEntityPacket(this.worldPosition, 0, this.getUpdateTag());
    }

    @Override
    public net.minecraft.nbt.CompoundNBT getUpdateTag() {
        return this.save(new net.minecraft.nbt.CompoundNBT());
    }

    @Override
    public void onDataPacket(net.minecraft.network.NetworkManager net, net.minecraft.network.play.server.SUpdateTileEntityPacket packet) {
        this.load(this.getBlockState(), packet.getTag());
    }`;
}

function beSource(env: GenEnv, block: ElementContext): JavaSourceFile {
  const legacy = env.mc === "1.16.5";
  const v26 = env.mc === "26.3";
  const pkg = env.project.mod.package;
  const cls = beClass(block as unknown as Element);
  const size = Math.max(1, Number(block.inventorySize) || 1);
  const slots = (key: string) => list<Record<string, unknown>>(block[key]).map((row) => Number(row.slot)).filter((n) => Number.isInteger(n));
  const ins = slots("inventoryInSlotIDs");
  const outs = slots("inventoryOutSlotIDs");
  const has = (ids: number[]) => (ids.length ? ids.map((i) => `index == ${i}`).join(" || ") : "false");
  const Stack = legacy ? "net.minecraft.item.ItemStack" : "net.minecraft.world.item.ItemStack";
  const NNL = legacy ? "net.minecraft.util.NonNullList" : "net.minecraft.core.NonNullList";
  const Dir = legacy ? "net.minecraft.util.Direction" : "net.minecraft.core.Direction";
  const Player = legacy ? "net.minecraft.entity.player.PlayerEntity" : "net.minecraft.world.entity.player.Player";
  const Helper = legacy ? "net.minecraft.inventory.ItemStackHelper" : "net.minecraft.world.ContainerHelper";
  const maxStack = Number(block.inventoryStackSize) || 64;
  const storage = storageMembers(env, block);
  const saving = storageSaving(env, block);
  let head: string;
  let nbt: string;
  if (legacy) {
    head = `public class ${cls} extends net.minecraft.tileentity.TileEntity implements net.minecraft.inventory.ISidedInventory {
    private ${NNL}<${Stack}> items = ${NNL}.withSize(${size}, ${Stack}.EMPTY);
${storage}
    public ${cls}() {
        super(${typeExpr(env, block as unknown as Element)});
    }`;
    nbt = `    @Override
    public void load(net.minecraft.block.BlockState state, net.minecraft.nbt.CompoundNBT tag) {
        super.load(state, tag);
        this.items = ${NNL}.withSize(${size}, ${Stack}.EMPTY);
        ${Helper}.loadAllItems(tag, this.items);${saving.load}
    }

    @Override
    public net.minecraft.nbt.CompoundNBT save(net.minecraft.nbt.CompoundNBT tag) {
        super.save(tag);
        ${Helper}.saveAllItems(tag, this.items);${saving.save}
        return tag;
    }

${legacyCapabilities(hasEnergy(block), hasTank(block))}`;
  } else {
    head = `public class ${cls} extends net.minecraft.world.level.block.entity.BlockEntity implements net.minecraft.world.WorldlyContainer, ${pkg}.procedures.BlockDataHolder {
    private ${NNL}<${Stack}> items = ${NNL}.withSize(${size}, ${Stack}.EMPTY);
    private net.minecraft.nbt.CompoundTag data = new net.minecraft.nbt.CompoundTag();
${storage}
    public ${cls}(net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState state) {
        super(${typeExpr(env, block as unknown as Element)}, pos, state);
    }`;
    nbt = v26
      ? `    @Override
    protected void loadAdditional(net.minecraft.world.level.storage.ValueInput input) {
        super.loadAdditional(input);
        this.items = ${NNL}.withSize(${size}, ${Stack}.EMPTY);
        ${Helper}.loadAllItems(input, this.items);
        this.data = input.read(DATA_KEY, net.minecraft.nbt.CompoundTag.CODEC).orElseGet(net.minecraft.nbt.CompoundTag::new);${saving.load}
    }

    @Override
    protected void saveAdditional(net.minecraft.world.level.storage.ValueOutput output) {
        super.saveAdditional(output);
        ${Helper}.saveAllItems(output, this.items);
        output.store(DATA_KEY, net.minecraft.nbt.CompoundTag.CODEC, this.data);${saving.save}
    }`
      : `    @Override
    protected void loadAdditional(net.minecraft.nbt.CompoundTag tag, net.minecraft.core.HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        this.items = ${NNL}.withSize(${size}, ${Stack}.EMPTY);
        ${Helper}.loadAllItems(tag, this.items, registries);
        this.data = tag.getCompoundOrEmpty(DATA_KEY).copy();${saving.load}
    }

    @Override
    protected void saveAdditional(net.minecraft.nbt.CompoundTag tag, net.minecraft.core.HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        ${Helper}.saveAllItems(tag, this.items, registries);
        tag.put(DATA_KEY, this.data.copy());${saving.save}
    }`;
  }
  const stillValid = legacy
    ? `this.level != null && this.level.getBlockEntity(this.worldPosition) == this && player.distanceToSqr(this.worldPosition.getX() + 0.5D, this.worldPosition.getY() + 0.5D, this.worldPosition.getZ() + 0.5D) <= 64.0D`
    : "net.minecraft.world.Container.stillValidBlockEntity(this, player)";
  // 1.21.5+ block entities drop their container when removed; keeping the items means emptying it first.
  const keep = !legacy && block.inventoryDropWhenDestroyed !== true
    ? `
    @Override
    public void preRemoveSideEffects(net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState state) {
        this.items.clear();
        super.preRemoveSideEffects(pos, state);
    }
` : "";
  // Later versions send the whole tag to watching clients (1.16.5 does by itself), so screens read the block data.
  const modernData = legacy ? "" : `
    private static final String DATA_KEY = "mcedge_data";

    @Override
    public net.minecraft.nbt.CompoundTag blockData() {
        return this.data;
    }

    @Override
    public net.minecraft.network.protocol.Packet<net.minecraft.network.protocol.game.ClientGamePacketListener> getUpdatePacket() {
        return net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket.create(this);
    }

    @Override
    public net.minecraft.nbt.CompoundTag getUpdateTag(net.minecraft.core.HolderLookup.Provider registries) {
        return this.saveWithoutMetadata(registries);
    }
`;
  const code = `package ${pkg}.block.entity;

/** Generated by MCEdge: inventory of block "${block.id}". */
${head}
${modernData}
${nbt}

    @Override
    public int getContainerSize() {
        return this.items.size();
    }

    @Override
    public boolean isEmpty() {
        for (${Stack} stack : this.items) if (!stack.isEmpty()) return false;
        return true;
    }

    @Override
    public ${Stack} getItem(int index) {
        return this.items.get(index);
    }

    @Override
    public ${Stack} removeItem(int index, int count) {
        ${Stack} stack = ${Helper}.removeItem(this.items, index, count);
        if (!stack.isEmpty()) this.setChanged();
        return stack;
    }

    @Override
    public ${Stack} removeItemNoUpdate(int index) {
        return ${Helper}.takeItem(this.items, index);
    }

    @Override
    public void setItem(int index, ${Stack} stack) {
        this.items.set(index, stack);
        if (stack.getCount() > this.getMaxStackSize()) stack.setCount(this.getMaxStackSize());
        this.setChanged();
    }

    @Override
    public int getMaxStackSize() {
        return ${maxStack};
    }

    @Override
    public boolean stillValid(${Player} player) {
        return ${stillValid};
    }

    @Override
    public void clearContent() {
        this.items.clear();
    }

    @Override
    public int[] getSlotsForFace(${Dir} side) {
        int[] slots = new int[this.items.size()];
        for (int i = 0; i < slots.length; i++) slots[i] = i;
        return slots;
    }

    @Override
    public boolean canPlaceItemThroughFace(int index, ${Stack} stack, ${Dir} side) {
        return ${has(ins)};
    }

    @Override
    public boolean canTakeItemThroughFace(int index, ${Stack} stack, ${Dir} side) {
        return ${has(outs)};
    }
${keep}}
`;
  return { path: `${pkg.replaceAll(".", "/")}/block/entity/${cls}.java`, code };
}

/** Block entity classes and their <Mod>BlockEntities registry. */
export function blockEntityRuntime(env: GenEnv, blocks: ElementContext[]): { sources: JavaSourceFile[]; init: string[] } {
  const withInventory = blocks.filter((b) => b.hasInventory === true);
  if (!withInventory.length) return { sources: [], init: [] };
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}BlockEntities`;
  const be = (b: ElementContext) => `${pkg}.block.entity.${beClass(b as unknown as Element)}`;
  const block = (b: ElementContext) => blockExpr(env, String(b.id));
  const C = (b: ElementContext) => String(b.id).toUpperCase();
  let fields: string;
  let init: string;
  if (env.mc === "1.16.5") {
    const T = "net.minecraft.tileentity.TileEntityType";
    fields = `    public static final net.minecraftforge.registries.DeferredRegister<${T}<?>> REGISTRY = net.minecraftforge.registries.DeferredRegister.create(net.minecraftforge.registries.ForgeRegistries.TILE_ENTITIES, ${jstr(env.modId)});
${withInventory.map((b) => `    public static final net.minecraftforge.fml.RegistryObject<${T}<${be(b)}>> ${C(b)} = REGISTRY.register(${jstr(String(b.id))}, () -> ${T}.Builder.of(${be(b)}::new, ${block(b)}).build(null));`).join("\n")}`;
    init = `${owner(env)}.REGISTRY.register(modBus);`;
  } else if (env.loader === "neoforge") {
    const T = "net.minecraft.world.level.block.entity.BlockEntityType";
    fields = `    public static final net.neoforged.neoforge.registries.DeferredRegister<${T}<?>> REGISTRY = net.neoforged.neoforge.registries.DeferredRegister.create(net.minecraft.core.registries.Registries.BLOCK_ENTITY_TYPE, ${jstr(env.modId)});
${withInventory.map((b) => `    public static final net.neoforged.neoforge.registries.DeferredHolder<${T}<?>, ${T}<${be(b)}>> ${C(b)} = REGISTRY.register(${jstr(String(b.id))}, () -> new ${T}<>(${be(b)}::new, ${block(b)}));`).join("\n")}`;
    init = `${owner(env)}.REGISTRY.register(modBus);`;
  } else {
    const T = "net.minecraft.world.level.block.entity.BlockEntityType";
    fields = `${withInventory.map((b) => `    public static final ${T}<${be(b)}> ${C(b)} = net.minecraft.core.Registry.register(net.minecraft.core.registries.BuiltInRegistries.BLOCK_ENTITY_TYPE, ${idExpr(env, `${env.modId}:${b.id}`)}, net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder.create(${be(b)}::new, ${block(b)}).build());`).join("\n")}

    /** Loads the class, which registers the block entity types. */
    public static void init() {}`;
    init = `${owner(env)}.init();`;
  }
  const code = `package ${pkg}.init;

/** Generated by MCEdge: block entity types of the mod's blocks with inventories. */
public final class ${cls} {
    private ${cls}() {}

${fields}
}
`;
  return {
    sources: [...withInventory.map((b) => beSource(env, b)), ...(env.mc === "1.16.5" ? [] : [blockDataHolderSource(pkg)]), { path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }],
    init: [init, ...storageInit(env, withInventory)],
  };
}

/** Registers items (NeoForge), energy and tanks with the engine's API so pipes and other mods reach them.
 *  Fabric's item lookup already falls back to the block entity's WorldlyContainer; 1.16.5 answers in getCapability. */
function storageInit(env: GenEnv, blocks: ElementContext[]): string[] {
  const constant = (b: ElementContext) => `${owner(env)}.${String(b.id).toUpperCase()}`;
  if (env.mc === "1.16.5") return [];
  if (env.loader === "fabric") {
    return blocks.filter(hasTank).map((b) => `net.fabricmc.fabric.api.transfer.v1.fluid.FluidStorage.SIDED.registerForBlockEntity((entity, side) -> entity.fluidTank(), ${constant(b)});`);
  }
  const Caps = "net.neoforged.neoforge.capabilities.Capabilities";
  const energy = `${Caps}.${env.mc === "26.3" ? "Energy" : "EnergyStorage"}.BLOCK`;
  const fluid = `${Caps}.${env.mc === "26.3" ? "Fluid" : "FluidHandler"}.BLOCK`;
  // A side gets the block's face rules (getSlotsForFace, can...ThroughFace); no side gets the whole inventory, as on 1.16.5.
  const items = env.mc === "26.3"
    ? `${Caps}.Item.BLOCK, %s, (entity, side) -> side == null ? net.neoforged.neoforge.transfer.item.VanillaContainerWrapper.of(entity) : new net.neoforged.neoforge.transfer.item.WorldlyContainerWrapper(entity, side)`
    : `${Caps}.ItemHandler.BLOCK, %s, (entity, side) -> side == null ? new net.neoforged.neoforge.items.wrapper.InvWrapper(entity) : new net.neoforged.neoforge.items.wrapper.SidedInvWrapper(entity, side)`;
  const lines = [
    ...blocks.map((b) => `event.registerBlockEntity(${items.replace("%s", `${constant(b)}.get()`)});`),
    ...blocks.filter(hasEnergy).map((b) => `event.registerBlockEntity(${energy}, ${constant(b)}.get(), (entity, side) -> entity.energyStorage());`),
    ...blocks.filter(hasTank).map((b) => `event.registerBlockEntity(${fluid}, ${constant(b)}.get(), (entity, side) -> entity.fluidTank());`),
  ];
  return lines.length ? [`modBus.addListener(net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent.class, event -> {\n${lines.join("\n")}\n});`] : [];
}
