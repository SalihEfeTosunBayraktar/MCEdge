// Writes src/generator/data/screens.json: the screen class of every overlay target (overlay element "overlayTarget")
// on each Minecraft generation, or null where the game version has no such screen. Class lists come from the
// NeoForge merged jars of a built codegen test project (1.21.5, 26.3) and from Mojang's 1.16.5 mappings chained
// to the MCP class names Forge 1.16.5 uses.
// usage: node tools/gen-screens.ts   (needs tools/codegen-test/project/out/neoforge-*/ built, and Forge 1.16.5 in ~/.gradle)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const type = JSON.parse(readFileSync(join(ROOT, "element-types/overlay/type.json"), "utf8"));
const field = type.pages.flatMap((p: { groups: { fields: { key: string }[] }[] }) => p.groups.flatMap((g) => g.fields)).find((f: { key: string }) => f.key === "overlayTarget");
const targets: string[] = field.options.map((o: { value: string }) => o.value).filter((v: string) => v !== "Ingame");

/** Screen class simple names (Mojang names; renamed classes list each name) where the target is not <target>Screen. */
const NAMES: Record<string, string | string[]> = {
  MainMenu: "TitleScreen", IngameMenu: "PauseScreen", AbstractCommandBlock: "AbstractCommandBlockEditScreen", AbstractEditSign: "AbstractSignEditScreen",
  Chest: "ContainerScreen", CommandBlock: "CommandBlockEditScreen", EditBook: "BookEditScreen", EditMinecartCommandBlock: "MinecartCommandBlockEditScreen",
  EditSign: "SignEditScreen", EditStructure: "StructureBlockEditScreen", Jigsaw: "JigsawBlockEditScreen", ReadBook: "BookViewScreen", SmithingTable: "SmithingScreen",
  AddServer: ["ManageServerScreen", "EditServerScreen"], ConfirmBackup: "BackupConfirmScreen", ConfirmOpenLink: "ConfirmLinkScreen", Connecting: "ConnectScreen",
  Creative: "CreativeModeInventoryScreen", CustomizeSkin: "SkinCustomizationScreen", DatapackFailure: "DatapackLoadFailureScreen", DirtMessage: ["GenericMessageScreen", "GenericDirtMessageScreen"],
  EditGamerules: ["WorldCreationGameRulesScreen", "EditGameRulesScreen"], FlatPresets: "PresetFlatWorldScreen", GamemodeSelection: "GameModeSwitcherScreen", GPUWarning: ["GPUWarningScreen", "PopupScreen"],
  Language: "LanguageSelectScreen", MemoryError: "OutOfMemoryScreen", Multiplayer: "JoinMultiplayerScreen", MultiplayerWarning: "SafetyScreen",
  OptionsSounds: "SoundOptionsScreen", Pack: "PackSelectionScreen", ServerList: "DirectJoinServerScreen", ServerLinks: ["ServerLinksDialogScreen", "ServerLinksScreen"],
  Settings: "OptionsSubScreen", SleepInMultiplayer: "InBedChatScreen", SymlinkWarning: "NoticeWithLinkScreen", Working: "ProgressScreen",
  WorldLoadProgress: "LevelLoadingScreen", WorldSelection: "SelectWorldScreen", KeyBinds: ["KeyBindsScreen", "ControlsScreen"], Realms: "RealmsScreen",
};
const simple = (t: string): string[] => [NAMES[t] ?? `${t}Screen`].flat();

/** Classes under net/minecraft/client/gui/screens of a jar, by simple name. */
function screensOf(jar: string): Map<string, string> {
  const list = execFileSync("unzip", ["-Z1", jar], { encoding: "utf8", maxBuffer: 1 << 28 }).split(/\r?\n/);
  const out = new Map<string, string>();
  for (const entry of list) {
    const m = /^((?:net\/minecraft\/client\/gui\/screens|net\/minecraft\/client\/gui\/components|net\/minecraft\/realms|com\/mojang\/realmsclient)\/(?:[a-z_]+\/)*([A-Z]\w*))\.class$/.exec(entry);
    if (m && !out.has(m[2])) out.set(m[2], m[1].replaceAll("/", "."));
  }
  return out;
}
const artifacts = (engine: string) => {
  const dir = join(ROOT, "tools/codegen-test/project/out", engine, "build/moddev/artifacts");
  return join(dir, readdirSync(dir).find((n) => n.endsWith("-merged.jar"))!);
};
const modern = { "1.21.5": screensOf(artifacts("neoforge-1.21.5")), "26.3": screensOf(artifacts("neoforge-26.3")) };

// 1.16.5: Mojang name -> obfuscated name (client_mappings) -> MCP class name (obf_to_srg).
const gradle = join(homedir(), ".gradle/caches/forge_gradle");
const mojang = new Map<string, string>();
for (const line of readFileSync(join(gradle, "minecraft_repo/versions/1.16.5/client_mappings.txt"), "utf8").split(/\r?\n/)) {
  const m = /^((?:net\.minecraft\.client\.gui\.screens|net\.minecraft\.realms|com\.mojang\.realmsclient)\.(?:[a-z_]+\.)*([A-Z][\w$]*)) -> ([\w$]+):$/.exec(line);
  if (m && !m[2].includes("$") && !mojang.has(m[2])) mojang.set(m[2], m[3]);
}
const mcp = new Map<string, string>();
for (const line of readFileSync(join(gradle, "mcp_repo/de/oceanlabs/mcp/mcp_config/1.16.5/mcp_config-1.16.5-obf_to_srg.tsrg"), "utf8").split(/\r?\n/)) {
  const m = /^(\S+) (net\/\S+)$/.exec(line);
  if (m) mcp.set(m[1], m[2].replaceAll("/", "."));
}
const legacy = (name: string) => {
  const obf = mojang.get(name);
  return obf ? mcp.get(obf) ?? null : null;
};

const table: Record<string, Record<string, string | null>> = {};
for (const t of targets) {
  const names = simple(t);
  const pick = (find: (n: string) => string | null | undefined) => names.map(find).find(Boolean) ?? null;
  table[t] = { "1.16.5": pick(legacy), "1.21.5": pick((n) => modern["1.21.5"].get(n)), "26.3": pick((n) => modern["26.3"].get(n)) };
}
writeFileSync(join(ROOT, "src/generator/data/screens.json"), JSON.stringify(table, null, 2) + "\n");
const missing = Object.entries(table).flatMap(([t, v]) => Object.entries(v).filter(([, c]) => !c).map(([g]) => `${t}@${g}`));
console.log(`${targets.length} targets; missing: ${missing.join(" ")}`);
