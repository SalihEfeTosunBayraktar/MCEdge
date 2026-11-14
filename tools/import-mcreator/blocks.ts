// MCreator 1.16.5 import, blocks (KUYRUK #11): every MCreator block class becomes a block element: registry name,
// names of every language, sound, hardness, light, opacity, facing, shapes, tool, drops, redstone, tooltip, tick
// rate, inventory, and the model with its textures. Blockbench models are copied to models/<id>.json with the
// textures of the block's own model merged in. Block procedures and bound GUIs are wired by later slices, so rerun
// this before them, never after.
// usage: node tools/import-mcreator/blocks.ts <legacy mod dir> <project dir>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { copyTexture } from "./javaText.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/blocks.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const assets = join(main, "resources/assets", modId);
const javaRoot = join(main, "java");
const pkgDir = join(javaRoot, readdirSync(javaRoot)[0]);
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const langs = Object.fromEntries(readdirSync(join(assets, "lang")).map((f) => [f.slice(0, -5), readJson<Record<string, string>>(join(assets, "lang", f))]));

const tabIds = new Map<string, string>();
for (const file of readdirSync(join(pkgDir, "itemgroup"))) {
  const label = /new ItemGroup\("(\w+)"\)/.exec(readFileSync(join(pkgDir, "itemgroup", file), "utf8"))?.[1];
  if (label) tabIds.set(file.replace(/\.java$/, ""), label.replace(/^tab/, ""));
}

const type = typeRegistry().byId.get("block")!;
for (const dir of ["elements/blocks", "models", "textures/blocks", "localization"]) mkdirSync(join(projectDir, dir), { recursive: true });

const num = (code: string, re: RegExp) => { const m = re.exec(code); return m ? Number(m[1]) : undefined; };
/** Body of a method: from its signature to the next member at the same indent. */
const method = (code: string, name: string) => new RegExp(`\\b${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n {6}\\}`).exec(code)?.[1] ?? "";

/** Copies a model's texture reference into the project; the reference keeps working through the file's path. */
function projectTexture(ref: string): string {
  if (!ref.startsWith(`${modId}:`)) return "";
  const path = ref.slice(modId.length + 1);
  const source = join(assets, "textures", `${path}.png`);
  if (!existsSync(source)) return "";
  const target = join(projectDir, "textures", `${path}.png`);
  mkdirSync(dirname(target), { recursive: true });
  copyTexture(source, target);
  return `textures/${path}.png`;
}

/** The `display` transforms of the block item's model, as the JSON text of the item display field. */
function itemDisplay(id: string): Record<string, unknown> {
  const file = join(assets, "models/item", `${id}.json`);
  const display = existsSync(file) ? readJson<{ display?: unknown }>(file).display : undefined;
  return display ? { itemDisplay: JSON.stringify(display, null, 2) } : {};
}

/** Model fields of a block; a Blockbench model becomes the project model models/<id>.json. */
function modelFields(id: string): Record<string, unknown> {
  type Model = { parent?: string; textures?: Record<string, string> } & Record<string, unknown>;
  const own = readJson<Model>(join(assets, "models/block", `${id}.json`));
  const textures = own.textures ?? {};
  const customName = own.parent?.startsWith(`${modId}:custom/`) ? own.parent.slice(`${modId}:custom/`.length) : undefined;
  if (!customName) return { renderType: 11, texture: projectTexture(textures.all ?? "") };
  const { credit: _credit, groups: _groups, ...custom } = readJson<Model>(join(assets, "models/custom", `${customName}.json`));
  const merged = { ...custom.textures, ...textures };
  for (const ref of Object.values(merged)) projectTexture(ref);
  writeFileSync(join(projectDir, "models", `${id}.json`), JSON.stringify({ ...custom, textures: merged }, null, 2));
  const particle = projectTexture(textures.particle ?? "");
  return { renderType: 2, customModelName: id, texture: particle, particleTexture: particle };
}

/** Slots an automation method allows: every slot but the ones its `index == n` chain refuses. */
function allowedSlots(body: string, size: number): { slot: number }[] {
  const refused = new Set([...body.matchAll(/index [!=]= (\d+)/g)].map((m) => Number(m[1])));
  return Array.from({ length: size }, (_, slot) => slot).filter((slot) => !refused.has(slot)).map((slot) => ({ slot }));
}

function inventoryFields(code: string): Record<string, unknown> {
  if (!/hasTileEntity/.test(code)) return {};
  const size = num(code, /NonNullList\.withSize\((\d+)/) ?? 9;
  const energy = /new EnergyStorage\((\d+), (\d+), (\d+), (\d+)\)/.exec(code);
  return {
    hasInventory: true,
    ...(energy ? { hasEnergyStorage: true, energyCapacity: Number(energy[1]), energyMaxReceive: Number(energy[2]), energyMaxExtract: Number(energy[3]), energyInitial: Number(energy[4]) } : {}),
    inventorySize: size,
    inventoryStackSize: num(method(code, "getMaxStackSize"), /return (\d+)/) ?? 64,
    inventoryDropWhenDestroyed: /dropContents/.test(code),
    inventoryComparatorPower: /hasAnalogOutputSignal/.test(code),
    inventoryInSlotIDs: allowedSlots(method(code, "canPlaceItem"), size),
    inventoryOutSlotIDs: allowedSlots(method(code, "canTakeItemThroughFace"), size),
  };
}

function toolFields(code: string): Record<string, unknown> {
  const tool = /harvestTool\(ToolType\.(\w+)\)/.exec(code)?.[1];
  return {
    requiresCorrectTool: /requiresCorrectToolForDrops/.test(code),
    ...(tool ? { destroyTool: tool.toLowerCase(), vanillaToolTier: ["NONE", "STONE", "IRON", "DIAMOND"][num(code, /harvestLevel\((\d+)\)/) ?? 0] } : {}),
  };
}

/** Shape of the north-facing state, the one MCEdge turns with the blockstate variants. */
function boxes(code: string): Record<string, unknown> {
  const shape = /case NORTH:\s*return VoxelShapes\.or\(([\s\S]*?)\)\s*\.move/.exec(code)?.[1];
  if (!shape) return {};
  const rows = [...shape.matchAll(/box\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) => m.slice(1).map(Number));
  return { boundingBoxes: rows.map(([mx, my, mz, Mx, My, Mz]) => ({ mx, my, mz, Mx, My, Mz, subtract: false })) };
}

/** Materials the block type offers (element-types/block/type.json); another one is left at the default. */
const MATERIALS = new Set(["STONE", "METAL", "HEAVY_METAL", "WOOD", "GLASS", "DIRT", "SAND", "GRASS", "WOOL", "CLAY", "ICE"]);
const material = (props: string) => /^\s*(?:net\.minecraft\.block\.material\.)?Material\.(\w+)/.exec(props)?.[1] ?? "";

const blockDir = join(pkgDir, "block");
const files = readdirSync(blockDir).filter((f) => f.endsWith(".java"));
const sources = new Map(files.map((f) => [f.slice(0, -5), readFileSync(join(blockDir, f), "utf8")]));
const idOf = (code: string) => /this\.setRegistryName\("(\w+)"\)/.exec(code)?.[1];
const idByClass = new Map([...sources].map(([cls, code]) => [cls, idOf(code)]));

/** Registry names of the legacy item classes, for blocks that name an item (pick block). */
const itemDir = join(pkgDir, "item");
const idByItemClass = new Map(existsSync(itemDir) ? readdirSync(itemDir).filter((f) => f.endsWith(".java")).map((f) => [f.slice(0, -5), /this\.setRegistryName\("(\w+)"\)/.exec(readFileSync(join(itemDir, f), "utf8"))?.[1]] as const) : []);

/** The item `getPickBlock` returns (middle click), as a block or item element id or a vanilla id; "" when it is not overridden. */
function pickItem(code: string): string {
  const body = method(code, "getPickBlock");
  const mod = /new ItemStack\((\w+)\.block\)/.exec(body)?.[1];
  if (mod) return idByClass.get(mod) ?? idByItemClass.get(mod) ?? "";
  const vanilla = /new ItemStack\((?:Items|Blocks)\.(\w+)\)/.exec(body)?.[1];
  return vanilla ? `minecraft:${vanilla.toLowerCase()}` : "";
}

const localized: Record<string, Record<string, string>> = {};
let count = 0;
for (const code of sources.values()) {
  const id = idOf(code);
  if (!id) continue;
  const props = /super\(\s*(?:net\.minecraft\.block\.AbstractBlock\.)?Properties\.of\(([\s\S]*?)\n {9}\);/.exec(code)?.[1] ?? "";
  const strength = /\.strength\((-?[\d.]+)F?,\s*(-?[\d.]+)F?\)/.exec(props);
  const tab = /new Properties\(\)\.tab\(([\w.]+)\)/.exec(code)?.[1]?.replace(/\.tab$/, "");
  const opacity = num(method(code, "getLightBlock"), /return (\d+)/);
  const signal = num(method(code, "getSignal"), /return (\d+)/);
  const dropClass = /singletonList\(new ItemStack\((\w+)\.block/.exec(code)?.[1];
  const tooltip = [...method(code, "appendHoverText").matchAll(/list\.add\(new StringTextComponent\(("(?:[^"\\]|\\.)*")\)\)/g)].map((m) => JSON.parse(m[1]) as string);
  const key = `block.${modId}.${id}`;
  const element = {
    ...newElement(type, id),
    name: langs.en_us?.[key] ?? id,
    soundOnStep: /SoundType\.(\w+)/.exec(props)?.[1] ?? "STONE",
    ...(MATERIALS.has(material(props)) ? { material: material(props) } : {}),
    ...(strength && Number(strength[1]) < 0 ? { unbreakable: true } : strength ? { hardness: Number(strength[1]), resistance: Number(strength[2]) } : {}),
    luminance: num(props, /lightLevel\(s -> (\d+)\)/) ?? 0,
    emissiveRendering: /emissiveRendering/.test(props),
    hasTransparency: /noOcclusion/.test(props),
    ...(/RenderType\.cutout/.test(code) ? { transparencyType: "CUTOUT" } : {}),
    ...(opacity === undefined ? {} : { hasCustomOpacity: true, lightOpacity: opacity }),
    rotationMode: /HorizontalBlock\.FACING/.test(code) ? 1 : 0,
    creativeTabs: tab && tabIds.has(tab) ? [tabIds.get(tab)] : [],
    specialInformation: tooltip.join("\n"),
    tickRate: num(code, /getBlockTicks\(\)\.scheduleTick\(\w+, this, (\d+)\)/) ?? 0,
    canRedstoneConnect: /canConnectRedstone/.test(code),
    ...(signal === undefined ? {} : { canProvidePower: true, emittedRedstonePower: signal }),
    ...(dropClass ? { customDrop: idByClass.get(dropClass) ?? "" } : {}),
    // Properties MCreator writes from block settings: waterlogging, hiding faces between the same block, post-processing, pick block.
    ...(/implements IWaterLoggable/.test(code) ? { isWaterloggable: true } : {}),
    ...(/boolean skipRendering\(/.test(code) ? { connectedSides: true } : {}),
    ...(/hasPostProcess\(/.test(props) ? { hasPostProcess: true } : {}),
    ...(pickItem(code) ? { creativePickItem: pickItem(code) } : {}),
    ...boxes(code),
    ...toolFields(props),
    ...inventoryFields(code),
    ...modelFields(id),
    ...itemDisplay(id),
  };
  writeFileSync(join(projectDir, "elements/blocks", `${id}.json`), JSON.stringify(element, null, 2));
  for (const [lang, entries] of Object.entries(langs)) if (lang !== "en_us" && entries[key]) (localized[lang] ??= {})[key] = entries[key];
  count++;
}
for (const [lang, entries] of Object.entries(localized)) {
  const file = join(projectDir, "localization", `${lang}.json`);
  const existing = existsSync(file) ? readJson<Record<string, string>>(file) : {};
  writeFileSync(file, JSON.stringify({ ...existing, ...entries }, null, 2));
}
console.log(`imported ${count} blocks`);
