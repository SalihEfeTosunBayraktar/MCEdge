// The one-method classes and multi-statement blocks MCreator generates for 1.16.5, as compact Java text (see
// javaPrint.ts). The converter turns a piece of code into blocks only when it prints exactly as one of these; the
// text is what its meaning was checked against. java-ast/templates.ts lists the classes a project actually uses.

/** Block data read: `tileEntity != null ? getTileData().getX(tag) : <default>`, per value type. */
export const BLOCK_DATA_READ: Record<"number" | "logic" | "text", string> = {
  number: "public double getValue(IWorld world,BlockPos pos,String tag){TileEntity tileEntity=world.getBlockEntity(pos);return tileEntity!=null?tileEntity.getTileData().getDouble(tag):-1;}",
  logic: "public boolean getValue(IWorld world,BlockPos pos,String tag){TileEntity tileEntity=world.getBlockEntity(pos);return tileEntity!=null?tileEntity.getTileData().getBoolean(tag):false;}",
  text: 'public String getValue(IWorld world,BlockPos pos,String tag){TileEntity tileEntity=world.getBlockEntity(pos);return tileEntity!=null?tileEntity.getTileData().getString(tag):"";}',
};

/** The item in a slot of the GUI the entity has open. */
export const GUI_SLOT_ITEM = "public ItemStack getItemStack(int sltid){Entity _ent=entity;if((_ent instanceof PlayerEntity)){Container _current=((PlayerEntity)_ent).containerMenu;if((_current instanceof Supplier)){Object invobj=((Supplier)_current).get();if((invobj instanceof Map)){return ((Slot)((Map)invobj).get(sltid)).getItem();}}}return ItemStack.EMPTY;}";

/** The item count in a slot of the GUI the entity has open. */
export const GUI_SLOT_COUNT = "public int getAmount(int sltid){if((entity instanceof PlayerEntity)){Container _current=((PlayerEntity)entity).containerMenu;if((_current instanceof Supplier)){Object invobj=((Supplier)_current).get();if((invobj instanceof Map)){ItemStack stack=((Slot)((Map)invobj).get(sltid)).getItem();if((stack!=null)){return stack.getCount();}}}}return 0;}";

/** A copy of the item in a slot of a block's inventory. */
export const BLOCK_SLOT_ITEM = "public ItemStack getItemStack(BlockPos pos,int sltid){AtomicReference<ItemStack> _retval=new AtomicReference<>(ItemStack.EMPTY);TileEntity _ent=world.getBlockEntity(pos);if((_ent!=null)){_ent.getCapability(CapabilityItemHandler.ITEM_HANDLER_CAPABILITY,null).ifPresent(( capability)->_retval.set(capability.getStackInSlot(sltid).copy()));}return _retval.get();}";

/** The item count in a slot of a block's inventory. */
export const BLOCK_SLOT_COUNT = "public int getAmount(IWorld world,BlockPos pos,int sltid){AtomicInteger _retval=new AtomicInteger(0);TileEntity _ent=world.getBlockEntity(pos);if((_ent!=null)){_ent.getCapability(CapabilityItemHandler.ITEM_HANDLER_CAPABILITY,null).ifPresent(( capability)->_retval.set(capability.getStackInSlot(sltid).getCount()));}return _retval.get();}";

/** A random item of an item tag; air when the tag is empty. */
export const RANDOM_ITEM = "public Item getRandomItem(ResourceLocation name){ITag<Item> _tag=ItemTags.getAllTags().getTagOrEmpty(name);return _tag.getValues().isEmpty()?Items.AIR:(Item)_tag.getRandomElement(java.util.concurrent.ThreadLocalRandom.current());}";

/** The energy stored in / the capacity of a block's energy storage. */
export const ENERGY_STORED = "public int getEnergyStored(IWorld world,BlockPos pos){AtomicInteger _retval=new AtomicInteger(0);TileEntity _ent=world.getBlockEntity(pos);if((_ent!=null)){_ent.getCapability(CapabilityEnergy.ENERGY,null).ifPresent(( capability)->_retval.set(capability.getEnergyStored()));}return _retval.get();}";
export const ENERGY_CAPACITY = "public int getMaxEnergyStored(IWorld world,BlockPos pos){AtomicInteger _retval=new AtomicInteger(0);TileEntity _ent=world.getBlockEntity(pos);if((_ent!=null)){_ent.getCapability(CapabilityEnergy.ENERGY,null).ifPresent(( capability)->_retval.set(capability.getMaxEnergyStored()));}return _retval.get();}";

/** Orders entities by their distance to a point (a comparator the nearest-entity query sorts with). */
export const COMPARE_DISTANCE = " Comparator<Entity> compareDistOf(double _x,double _y,double _z){return Comparator.comparing(( _entcnd)->_entcnd.distanceToSqr(_x,_y,_z));}";

/** A delayed run (Wait): the class around the statements of `run`, which end by unregistering. */
export const DELAY_HEAD = "class{int ticks=0;float waitTicks;IWorld world;public void start(IWorld world,int waitTicks){this.waitTicks=waitTicks;MinecraftForge.EVENT_BUS.register(this);this.world=world;}public void tick(ServerTickEvent event){if((event.phase==Phase.END)){this.ticks++;if((this.ticks>=this.waitTicks)){this.run();}}}private void run(){";
export const DELAY_TAIL = "MinecraftForge.EVENT_BUS.unregister(this);}}";

/**
 * A block replaced by another that keeps the properties both have and the block entity's data (ten statements). Names
 * differ per use, so it is compared after renaming (alpha equivalence); the world is `var24` here, the block id "ID".
 */
export const REPLACE_KEEPING = 'BlockPos _bp=new BlockPos(x,y,z);BlockState _bs=net.minecraftforge.registries.ForgeRegistries.BLOCKS.getValue(new net.minecraft.util.ResourceLocation("ID")).defaultBlockState();BlockState _bso=var24.getBlockState(_bp);UnmodifiableIterator _te=_bso.getValues().entrySet().iterator();while((_te.hasNext())){Entry<Property<?>,Comparable<?>> entry=(Entry<Property<?>,Comparable<?>>)_te.next();Property _property=_bs.getBlock().getStateDefinition().getProperty(entry.getKey().getName());if((_property!=null&&_bs.getValue(_property)!=null)){try{_bs=(BlockState)_bs.setValue((net.minecraft.state.Property)_property,(Comparable)entry.getValue());}catch(Exception var9){}}}TileEntity _tex=var24.getBlockEntity(_bp);CompoundNBT _bnbt=null;if((_tex!=null)){_bnbt=_tex.save(new CompoundNBT());_tex.setRemoved();}var24.setBlock(_bp,_bs,3);if((_bnbt!=null)){TileEntity var35=var24.getBlockEntity(_bp);if((var35!=null)){try{var35.load(_bso,_bnbt);}catch(Exception var22){}}}';
export const REPLACE_KEEPING_WORLD = "var24";

/** Renames the world and the generated names (`_bp`, `_tex`, `var9`, with any number of x's) by first appearance. */
export function alphaNormalize(text: string, world: string): string {
  const names = new Map<string, string>();
  return text
    .replace(new RegExp(`\\b${world.replace(".", "\\.")}\\b`, "g"), "W")
    .replace(/\b(?:BlockState|BlockPos|TileEntity|CompoundNBT|UnmodifiableIterator) (?=_|var)/g, "")
    .replace(/(?:net\.minecraftforge\.registries\.ForgeRegistries\.BLOCKS\.getValue\(new net\.minecraft\.util\.ResourceLocation\("[^"]*"\)\)|Blocks\.[A-Z_0-9]+)\.defaultBlockState\(\)/, "BLOCK.defaultBlockState()")
    .replace(/"[^"]*"/, '"ID"')
    .replace(/^(\w+=new BlockPos\()[^;]*(\);)/, "$1POSITION$2")
    .replace(/\b(?:_[a-z]+|var\d+)x*\b/g, (name) => {
      if (!names.has(name)) names.set(name, `#${names.size + 1}`);
      return names.get(name)!;
    });
}

/** The same without the block entity: the properties are copied and the block is set (six statements). */
export const REPLACE_KEEPING_PLAIN = `${REPLACE_KEEPING.slice(0, REPLACE_KEEPING.indexOf("TileEntity _tex="))}${REPLACE_KEEPING_WORLD}.setBlock(_bp,_bs,3);`;
