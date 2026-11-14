// MCreator 1.16.5 import, first slice (KUYRUK #11): reads a decompiled MCreator Forge 1.16.5 mod and writes an
// MCEdge project with its items and creative tabs: registry name, texture, stack size, rarity, tab, and the item
// names of every language. Item behaviour (procedures) and the other element types come in later slices.
// usage: node tools/import-mcreator/items.ts <legacy mod dir> <new project dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { copyTexture } from "./javaText.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/items.ts <legacy mod dir> <new project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const toml = readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8");
const field = (key: string) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml)?.[1] ?? "";
const modId = field("modId");
const assets = join(main, "resources/assets", modId);
const javaRoot = join(main, "java");
const pkg = readdirSync(javaRoot)[0];
const langs = Object.fromEntries(readdirSync(join(assets, "lang")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(assets, "lang", f), "utf8")) as Record<string, string>]));
const en = langs.en_us ?? {};

// Creative tabs: each MCreator ItemGroup class becomes a creative_tab element named after its lang key.
const groupDir = join(javaRoot, pkg, "itemgroup");
const tabs = new Map<string, { id: string; name: string; iconClass: string; vanillaIcon: string; search: boolean }>();
for (const file of existsSync(groupDir) ? readdirSync(groupDir) : []) {
  const code = readFileSync(join(groupDir, file), "utf8");
  const label = /new ItemGroup\("(\w+)"\)/.exec(code)?.[1];
  if (!label) continue;
  // The icon is `makeIcon()` returning a stack of an item or block class (or a vanilla constant); the search bar is `hasSearchBar()`.
  const icon = /makeIcon\(\) \{\s*return new ItemStack\(([\w.]+)\)/.exec(code)?.[1] ?? "";
  tabs.set(file.replace(/\.java$/, ""), {
    id: label.replace(/^tab/, ""), name: en[`itemGroup.${label}`] ?? label,
    iconClass: /^(\w+)\.block$/.exec(icon)?.[1] ?? "",
    vanillaIcon: /^(?:Items|Blocks)\.(\w+)$/.exec(icon)?.[1] ?? "",
    search: /hasSearchBar\(\) \{\s*return true;/.test(code),
  });
}
const VANILLA_TABS: Record<string, string> = {
  TAB_BUILDING_BLOCKS: "BUILDING_BLOCKS", TAB_DECORATIONS: "DECORATIONS", TAB_REDSTONE: "REDSTONE", TAB_TRANSPORTATION: "TRANSPORTATION",
  TAB_MISC: "MISC", TAB_FOOD: "FOOD", TAB_TOOLS: "TOOLS", TAB_COMBAT: "COMBAT", TAB_BREWING: "BREWING", TAB_MATERIALS: "MATERIALS",
};

const registry = typeRegistry();
const itemType = registry.byId.get("item")!;
const tabType = registry.byId.get("creative_tab")!;
mkdirSync(join(projectDir, "elements/items"), { recursive: true });
mkdirSync(join(projectDir, "elements/creative_tabs"), { recursive: true });
mkdirSync(join(projectDir, "textures/items"), { recursive: true });
mkdirSync(join(projectDir, "localization"), { recursive: true });

/** SoundEvents constants (1.16.5 names) an item may return for eating or drinking. */
const USE_SOUNDS: Record<string, string> = { GENERIC_DRINK: "minecraft:entity.generic.drink", GENERIC_EAT: "minecraft:entity.generic.eat", GENERIC_BURN: "minecraft:entity.generic.burn" };

const itemDir = join(javaRoot, pkg, "item");
const names: Record<string, Record<string, string>> = Object.fromEntries(Object.keys(langs).map((l) => [l, {}]));
const imported: string[] = [];
const tabIcons = new Map<string, string>();
for (const file of readdirSync(itemDir).filter((f) => f.endsWith(".java"))) {
  const code = readFileSync(join(itemDir, file), "utf8");
  const id = /setRegistryName\("(\w+)"\)/.exec(code)?.[1];
  const props = /super\(\s*new Properties\(\)([\s\S]*?)\);/.exec(code)?.[1];
  if (!id || props === undefined) continue;
  const tab = /\.tab\(([\w.]+)\)/.exec(props)?.[1] ?? "null";
  const durability = Number(/\.durability\((\d+)\)/.exec(props)?.[1] ?? 0);
  const stack = durability ? 1 : Number(/\.stacksTo\((\d+)\)/.exec(props)?.[1] ?? 64);
  const rarity = /Rarity\.(\w+)/.exec(props)?.[1] ?? "COMMON";
  const modTab = tabs.get(tab.replace(/\.tab$/, ""));
  const creativeTabs = tab === "null" ? [] : modTab ? [modTab.id] : VANILLA_TABS[tab.replace("ItemGroup.", "")] ? [VANILLA_TABS[tab.replace("ItemGroup.", "")]] : [];
  if (modTab && !tabIcons.has(modTab.id)) tabIcons.set(modTab.id, id);
  // The texture is the item model's layer0 ("<modid>:items/<file>").
  const modelFile = join(assets, "models/item", `${id}.json`);
  const layer = existsSync(modelFile) ? (JSON.parse(readFileSync(modelFile, "utf8")) as { textures?: { layer0?: string } }).textures?.layer0 : undefined;
  let texture = "";
  if (layer) {
    const path = layer.replace(/^\w+:/, "");
    const source = join(assets, "textures", `${path}.png`);
    if (existsSync(source)) {
      texture = `textures/${path}.png`;
      mkdirSync(join(projectDir, "textures", path, ".."), { recursive: true });
      copyTexture(source, join(projectDir, texture));
    }
  }
  // Food (MCreator drinks are food with the drink animation).
  const food = /\.food\(new \w+\(\)([^;]*?)\.build\(\)\)/.exec(props)?.[1];
  const leftover = /ItemStack retval = new ItemStack\(Items\.(\w+)\);/.exec(code)?.[1];
  // getDrinkingSound (func_225519_S__) or getEatingSound (func_225520_T__) returning a vanilla sound.
  const sound = /public SoundEvent (?:getDrinkingSound|getEatingSound|func_225519_S__|func_225520_T__)\(\) \{\s*return SoundEvents\.(\w+);/.exec(code)?.[1];
  const foodValues = food === undefined ? {} : {
    isFood: true,
    nutritionalValue: Number(/nutrition\((\d+)\)/.exec(food)?.[1] ?? 0),
    saturation: Number(/saturationMod\(([\d.]+)F?\)/.exec(food)?.[1] ?? 0),
    isAlwaysEdible: /alwaysEat\(\)/.test(food),
    isMeat: /\.meat\(\)/.test(food),
    animation: /UseAction\.DRINK/.test(code) ? "drink" : "eat",
    // finishUsingItem starts with the stack left behind: `ItemStack retval = new ItemStack(Items.GLASS_BOTTLE);`.
    ...(leftover ? { eatResultItem: `minecraft:${leftover.toLowerCase()}` } : {}),
  };
  const tooltip = [...code.matchAll(/list\.add\(new StringTextComponent\(("(?:[^"\\]|\\.)*")\)\)/g)].map((m) => JSON.parse(m[1]) as string);
  const useDuration = /public int getUseDuration\(ItemStack \w+\) \{\s*return (\d+);/.exec(code)?.[1];
  const traits = {
    ...(durability ? { damageCount: durability } : {}),
    ...(tooltip.length ? { specialInformation: tooltip.join("\n") } : {}),
    ...(useDuration ? { useDuration: Number(useDuration) } : {}),
    ...(sound && USE_SOUNDS[sound] ? { useSound: USE_SOUNDS[sound] } : {}),
    // The item stays in the crafting grid and wears out.
    ...(/public ItemStack getContainerItem\(/.test(code) ? { stayInGridWhenCrafting: true, damageOnCrafting: /setDamageValue/.test(code) } : {}),
  };
  const element = { ...newElement(itemType, id), name: en[`item.${modId}.${id}`] ?? id, texture, stackSize: stack, rarity, creativeTabs, ...foodValues, ...traits };
  writeFileSync(join(projectDir, "elements/items", `${id}.json`), JSON.stringify(element, null, 2));
  for (const [lang, entries] of Object.entries(langs)) if (lang !== "en_us" && entries[`item.${modId}.${id}`]) names[lang][`item.${modId}.${id}`] = entries[`item.${modId}.${id}`];
  imported.push(id);
}
/** Registry names of the legacy block classes: a tab icon may be a block. */
const blockDir = join(javaRoot, pkg, "block");
const idByClass = new Map<string, string>();
for (const dir of [blockDir, itemDir]) {
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".java")) : []) {
    const id = /setRegistryName\("(\w+)"\)/.exec(readFileSync(join(dir, file), "utf8"))?.[1];
    if (id) idByClass.set(file.slice(0, -5), id);
  }
}
for (const [, tab] of tabs) {
  const named = (tab.iconClass && idByClass.get(tab.iconClass)) || (tab.vanillaIcon && `minecraft:${tab.vanillaIcon.toLowerCase()}`) || "";
  const element = { ...newElement(tabType, tab.id), name: tab.name, icon: named || tabIcons.get(tab.id) || imported[0] || "minecraft:stone", ...(tab.search ? { showSearch: true } : {}) };
  writeFileSync(join(projectDir, "elements/creative_tabs", `${tab.id}.json`), JSON.stringify(element, null, 2));
}
for (const [lang, entries] of Object.entries(names)) if (Object.keys(entries).length) writeFileSync(join(projectDir, "localization", `${lang}.json`), JSON.stringify(entries, null, 2));

const version = /^version\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? "1.0.0";
const logo = field("logoFile");
if (logo && existsSync(join(main, "resources", logo))) copyFileSync(join(main, "resources", logo), join(projectDir, "textures", logo));
writeFileSync(join(projectDir, "mcedge.json"), JSON.stringify({
  schemaVersion: 2,
  mod: {
    id: modId, name: field("displayName") || modId, version, package: pkg, authors: field("authors") ? [field("authors")] : [],
    description: field("description").trim(), license: /^license\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? "All Rights Reserved", website: "", credits: "Imported from MCreator by MCEdge",
    logo: logo && existsSync(join(projectDir, "textures", logo)) ? `textures/${logo}` : "", dependencies: [],
  },
}, null, 2));
console.log(`imported ${imported.length} items and ${tabs.size} creative tabs from ${modId} into ${projectDir}`);
