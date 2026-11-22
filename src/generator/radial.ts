import { resolve } from "node:path";
import type { Element } from "../elements/model.ts";
import { radialLayout, RUNTIME_IMAGE_TICKS, sectorImage } from "../elements/radialLayout.ts";
import type { ProcEnv, Segment } from "../procedures/compile.ts";
import type { JavaSource } from "../procedures/runtime.ts";
import { RADIAL_LISTENERS } from "../procedures/triggers.ts";
import { framesJson, projectImage, type BubbleImage } from "./bubbles.ts";
import { timingJson } from "../elements/transitions.ts";
import { list, str } from "./java.ts";
import { writePng } from "./png.ts";
import { keyCode, keyMappingRegister } from "./types/key_binding.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * Radial menus (Q227), one data-driven runtime for every engine.
 *
 * Data: every radial_menu element becomes one entry of assets/<modid>/radial_menus.json (look, tabs, slices and their
 * actions) with its images under textures/radial/; a slice's shape is a white image of the top slice (one per slice count,
 * hole and gap), turned to each slice and tinted. No menu gets code of its own.
 *
 * Server: RadialMenus reads the same JSON. A menu opens when the client asks (its key) or a procedure opens it: the server
 * works out which slices the player sees (condition procedures, per-player overrides) and sends that with the menu. A
 * chosen slice is checked again, its action runs (command as the player, procedure, another menu, a GUI, a bubble, a
 * runtime image bubble) and the "Radial menu slice chosen" trigger's listeners are called.
 *
 * Runtime image folders: RuntimeImages loads config/<modid>/<folder>/ PNG and GIF files on the server (size-capped, GIFs
 * decoded into a strip of frames), sends them to each player on join and after /<modid> reload; clients make textures of
 * them, which radial tabs list as slices and bubbles show as icons ("img:<folder>/<name>").
 *
 * Client: RadialMenusClient polls the menus' keys and opens RadialMenuScreen, which draws any menu from its data: the
 * mouse's direction picks a slice, a click or releasing the key chooses it, the wheel or 1-9 change tabs.
 */

/** Where the mod's radial_menus.json sits under src/main/resources. */
export const radialDataPath = (modId: string) => `assets/${modId}/radial_menus.json`;

const menusClass = (env: ProcEnv) => `${env.pkg}.procedures.RadialMenus`;
const imagesClass = (env: ProcEnv) => `${env.pkg}.procedures.RuntimeImages`;
const clientClass = (env: ProcEnv) => `${env.pkg}.procedures.client.RadialMenusClient`;
const imagesClientClass = (env: ProcEnv) => `${env.pkg}.procedures.client.RuntimeImagesClient`;
const network = (env: ProcEnv) => `${env.pkg}.procedures.${env.modClass}Network`;

/** Whether the mod needs the radial runtime: radial menus, its blocks, or the slice chosen trigger. */
export function radialUsed(env: GenEnv, sources: string[], triggers: string[]): boolean {
  return (env.generated.radial_menu?.length ?? 0) > 0 || sources.some((s) => s.includes(".RadialMenus.") || s.includes(".RuntimeImages."))
    || triggers.some((t) => t.includes(RADIAL_LISTENERS));
}

/** The runtime's packets: a client's open / choose request, a menu to open, and runtime images. */
export function radialSegments(env: ProcEnv): Segment[] {
  return [
    { name: "RadialAction", path: "radial_action", direction: "toServer", sender: true, method: "receive", owner: menusClass(env),
      fields: [{ name: "kind", type: "text" }, { name: "menu", type: "text" }, { name: "tab", type: "number" }, { name: "slice", type: "text" }] },
    { name: "RadialOpen", path: "radial_open", direction: "toClient", method: "open", owner: clientClass(env), fields: [{ name: "menu", type: "text" }, { name: "states", type: "text" }] },
    { name: "RuntimeImageSync", path: "runtime_image", direction: "toClient", method: "receive", owner: imagesClientClass(env), fields: [{ name: "data", type: "tag" }] },
  ];
}

// ---- data ----

const LOCAL_ID = /^[a-z0-9_]+$/;
const textKey = (modId: string, ...parts: string[]) => `radial.${modId}.${parts.join(".")}`;
/** The radial menus of the project with their ids checked; a menu without tabs is left out. */
const menusOf = (env: GenEnv): Element[] => (env.generated.radial_menu ?? []).filter((m) => list(m.tabs).length > 0);
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => list<Row>(value).filter((r) => r && typeof r === "object" && LOCAL_ID.test(str(r.id)));
const local = (value: unknown) => str(value).replace(/^.*:/, "");

/** Lang entries of a menu: its key name, title, tab labels, slice labels and descriptions. */
export function radialLang(menu: Element, modId: string): Record<string, string> {
  const lang: Record<string, string> = {};
  const title = str(menu.title);
  lang[`key.${modId}.radial.${menu.id}`] = str(menu.keyName) || title || menu.id;
  if (title) lang[textKey(modId, menu.id, "title")] = title;
  for (const tab of rows(menu.tabs)) {
    if (str(tab.label)) lang[textKey(modId, menu.id, str(tab.id))] = str(tab.label);
    for (const slice of tab.source === "folder" ? [] : rows(tab.slices)) {
      if (str(slice.label)) lang[textKey(modId, menu.id, str(tab.id), str(slice.id))] = str(slice.label);
      if (str(slice.description)) lang[textKey(modId, menu.id, str(tab.id), str(slice.id), "desc")] = str(slice.description);
    }
  }
  return lang;
}

/** The action fields of a slice or a folder tab. */
function actionJson(row: Row): Record<string, unknown> {
  const duration = Math.round(Number(row.duration ?? -1));
  return {
    kind: str(row.action) || "none", command: str(row.command).replace(/^\//, ""), procedure: str(row.procedure), menu: local(row.menu), gui: local(row.gui),
    bubble: local(row.bubble), caption: str(row.caption), image: str(row.image), duration: Number.isFinite(duration) ? duration : -1,
  };
}

/** Folders of runtime images the menus name: folder tabs and image bubble slices. */
export function runtimeFolders(env: GenEnv): string[] {
  const folders = new Set<string>();
  for (const menu of menusOf(env)) {
    for (const tab of rows(menu.tabs)) {
      if (tab.source === "folder" && LOCAL_ID.test(str(tab.folder))) folders.add(str(tab.folder));
      for (const slice of tab.source === "folder" ? [] : rows(tab.slices)) {
        const folder = str(slice.image).split("/")[0];
        if (slice.action === "image_bubble" && LOCAL_ID.test(folder)) folders.add(folder);
      }
    }
  }
  return [...folders].sort();
}

/** The PNG of a slice shape, drawn once per shape (it is a pure function of its three numbers, and ~100 ms to draw: Q280). */
const sectorPngs = new Map<string, Buffer>();
function sectorPng(n: number, hole: number, gap: number): Buffer {
  const key = `${n}:${hole}:${gap}`;
  let png = sectorPngs.get(key);
  if (!png) sectorPngs.set(key, (png = writePng(sectorImage(n, hole, gap))));
  return png;
}

/**
 * Radial outputs of a project: images to write under the mod's textures/ (`to` without .png), radial_menus.json and the
 * images it could not read. Nothing without radial menus.
 */
export function radialOutputs(env: GenEnv): { images: { to: string; bytes: Buffer }[]; json?: string; problems: string[] } {
  const { projectDir, modId } = env;
  const menus = menusOf(env);
  if (!menus.length) return { images: [], problems: [] };
  const images: { to: string; bytes: Buffer }[] = [];
  const problems: string[] = [];
  const read = (file: string, to: string, label: string): BubbleImage | undefined => {
    if (!file) return undefined;
    try {
      const { image, bytes } = projectImage(resolve(projectDir, file), modId, to);
      images.push({ to, bytes });
      return image;
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      return undefined;
    }
  };
  const sectors = new Set<string>();
  const data: Record<string, unknown> = {};
  for (const menu of menus) {
    const layout = radialLayout(menu);
    const tabs = rows(menu.tabs);
    // One slice shape per slice count the menu can show (hidden slices make fewer).
    const most = Math.max(1, ...tabs.map((t) => (t.source === "folder" ? Math.round(Number(t.pageSize ?? 8)) : rows(t.slices).length)));
    const shape = `sector_${Math.round(layout.hole * 100)}_${layout.gap}`;
    for (let n = 1; n <= Math.min(12, most); n++) {
      if (sectors.has(`${shape}_${n}`)) continue;
      sectors.add(`${shape}_${n}`);
      images.push({ to: `radial/${shape}_${n}`, bytes: sectorPng(n, layout.hole, layout.gap) });
    }
    const own = (key: string) => read(str(menu[key]), `radial/${menu.id}_${key}`, `radial_menu/${menu.id}: ${str(menu[key])}`);
    const background = own("background");
    data[menu.id] = {
      key: `key.${modId}.radial.${menu.id}`, mode: menu.openMode === "toggle" ? "toggle" : "hold",
      size: layout.size, hole: layout.hole, sector: `${modId}:textures/radial/${shape}_`, iconSize: layout.iconSize,
      sliceColor: layout.slice, hoverColor: layout.hover, disabledColor: layout.disabled,
      sliceImage: own("sliceImage")?.id ?? "", hoverImage: own("hoverImage")?.id ?? "", disabledImage: own("disabledImage")?.id ?? "",
      sliceImageSize: layout.sliceImageSize,
      background: background?.id ?? "", backgroundWidth: background?.width ?? 1, backgroundHeight: background?.height ?? 1,
      backgroundSlice: menu.backgroundMode === "nine_slice" ? Math.round(Number(menu.sliceBorder ?? 4)) || 4 : 0,
      padding: layout.padding,
      title: str(menu.title) ? textKey(modId, menu.id, "title") : "", showLabel: menu.showLabel !== false, showDescription: menu.showDescription !== false,
      centerIcon: menu.centerIcon === true, textColor: layout.text, timing: timingJson(layout.timing),
      tabs: tabs.map((tab) => {
        const folder = tab.source === "folder" ? str(tab.folder) : "";
        return {
          id: str(tab.id), label: str(tab.label) ? textKey(modId, menu.id, str(tab.id)) : "", folder,
          pageSize: Math.min(12, Math.max(2, Math.round(Number(tab.pageSize ?? 8)) || 8)), action: folder ? actionJson(tab) : actionJson({}),
          slices: folder ? [] : rows(tab.slices).map((slice) => {
            const icon = slice.iconKind === "texture" ? read(str(slice.icon), `radial/${menu.id}_${str(tab.id)}_${str(slice.id)}`, `radial_menu/${menu.id}: ${str(slice.icon)}`) : undefined;
            return {
              id: str(slice.id), label: str(slice.label) ? textKey(modId, menu.id, str(tab.id), str(slice.id)) : "",
              description: str(slice.description) ? textKey(modId, menu.id, str(tab.id), str(slice.id), "desc") : "",
              icon: icon?.id ?? "", ...framesJson("icon", icon),
              item: slice.iconKind === "item" ? str(slice.item) : "",
              condition: str(slice.condition), hide: slice.conditionMode !== "disabled", action: actionJson(slice),
            };
          }),
        };
      }),
    };
  }
  return { images, json: `${JSON.stringify({ menus: data }, null, 2)}\n`, problems };
}

// ---- Java names ----

function names(env: ProcEnv) {
  const legacy = env.gen === "1.16.5";
  const v26 = env.gen === "26.3";
  const configDir = env.loader === "fabric" ? "net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir()"
    : env.loader === "neoforge" ? "net.neoforged.fml.loading.FMLPaths.CONFIGDIR.get()" : "net.minecraftforge.fml.loading.FMLPaths.CONFIGDIR.get()";
  const id = (expr: string) => (legacy ? `new net.minecraft.util.ResourceLocation(${expr})` : v26 ? `net.minecraft.resources.Identifier.parse(${expr})` : `net.minecraft.resources.ResourceLocation.parse(${expr})`);
  return legacy
    ? {
      legacy, v26, id, configDir,
      Entity: "net.minecraft.entity.Entity", Player: "net.minecraft.entity.player.PlayerEntity", ServerPlayer: "net.minecraft.entity.player.ServerPlayerEntity",
      Level: "net.minecraft.world.World", Tag: "net.minecraft.nbt.CompoundNBT", server: "player.getServer()", Server: "net.minecraft.server.MinecraftServer",
      parse: "new com.google.gson.JsonParser().parse", logger: `org.apache.logging.log4j.LogManager.getLogger(${JSON.stringify(env.modId)})`,
      command: "server.getCommands().performCommand(player.createCommandSourceStack(), command);",
      getString: (k: string) => `tag.getString(${k})`, getInt: (k: string) => `tag.getInt(${k})`, getBool: (k: string) => `tag.getBoolean(${k})`, getBytes: (k: string) => `tag.getByteArray(${k})`,
      ResourceLocation: "net.minecraft.util.ResourceLocation",
    }
    : {
      legacy, v26, id, configDir,
      Entity: "net.minecraft.world.entity.Entity", Player: "net.minecraft.world.entity.player.Player", ServerPlayer: "net.minecraft.server.level.ServerPlayer",
      Level: "net.minecraft.world.level.Level", Tag: "net.minecraft.nbt.CompoundTag", server: "player.level().getServer()", Server: "net.minecraft.server.MinecraftServer",
      parse: "com.google.gson.JsonParser.parseReader", logger: "com.mojang.logging.LogUtils.getLogger()",
      command: "server.getCommands().performPrefixedCommand(player.createCommandSourceStack(), command);",
      getString: (k: string) => `tag.getStringOr(${k}, "")`, getInt: (k: string) => `tag.getIntOr(${k}, 0)`, getBool: (k: string) => `tag.getBooleanOr(${k}, false)`, getBytes: (k: string) => `tag.getByteArray(${k}).orElse(new byte[0])`,
      ResourceLocation: v26 ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation",
    };
}

// ---- server ----

/** Procedure calls the menus make: a switch over procedure ids, the same call for every slice naming one. */
function procedureSwitch(env: GenEnv, penv: ProcEnv, call: (id: string, deps: Record<string, string>, returns?: "logic") => string | undefined): { calls: string; tests: string } {
  const N = names(penv);
  const deps = { x: "player.getX()", y: "player.getY()", z: "player.getZ()", world: N.legacy ? "player.level" : "player.level()", entity: "player", menu: "menu", tab: "tab", slice: "slice" };
  const calls = new Map<string, string>();
  const tests = new Map<string, string>();
  for (const menu of menusOf(env)) {
    for (const tab of rows(menu.tabs)) {
      const actions = tab.source === "folder" ? [tab] : rows(tab.slices);
      for (const row of actions) {
        const id = str(row.procedure);
        if (row.action === "procedure" && id && !calls.has(id)) {
          const expr = call(id, deps);
          if (expr) calls.set(id, expr);
        }
        const condition = str(row.condition);
        if (tab.source !== "folder" && condition && !tests.has(condition)) {
          const expr = call(condition, deps, "logic");
          if (expr) tests.set(condition, expr);
        }
      }
    }
  }
  const cases = (map: Map<string, string>, body: (e: string) => string) => [...map].map(([id, expr]) => `            case ${JSON.stringify(id)}:\n                ${body(expr)}`).join("\n");
  return {
    calls: cases(calls, (e) => `${e};\n                break;`),
    tests: cases(tests, (e) => `return ${e};`),
  };
}

function menusSource(env: GenEnv, penv: ProcEnv, call: Parameters<typeof procedureSwitch>[2]): JavaSource {
  const N = names(penv);
  const net = network(penv);
  const T = `${penv.pkg}.procedures.${penv.modClass}Transitions`;
  const { calls, tests } = procedureSwitch(env, penv, call);
  const guis = (env.generated.gui ?? []).length > 0;
  const openGui = guis ? `${penv.pkg}.init.${penv.modClass}Menus.open(player, gui, player.blockPosition());` : "// The mod has no GUIs.";
  return {
    path: `${penv.pkg.replaceAll(".", "/")}/procedures/RadialMenus.java`,
    code: `package ${penv.pkg}.procedures;

/**
 * Generated by MCEdge: radial menus (Q227). Every menu is data, assets/${penv.modId}/radial_menus.json, read on both sides.
 * The server decides which slices a player sees when a menu opens, checks a chosen slice again, runs its action and calls
 * the "Radial menu slice chosen" listeners.
 */
public final class RadialMenus {
    private RadialMenus() {}

    /** Called after a chosen slice's action ran. */
    public interface Listener {
        void chosen(${N.ServerPlayer} player, String menu, String tab, String slice);
    }

    public static final java.util.List<Listener> LISTENERS = new java.util.ArrayList<>();

    /** What choosing a slice does. */
    public static final class Action {
        public final String kind, command, procedure, menu, gui, bubble, caption, image;
        public final int duration;

        Action(com.google.gson.JsonObject o) {
            kind = text(o, "kind"); command = text(o, "command"); procedure = text(o, "procedure"); menu = text(o, "menu"); gui = text(o, "gui");
            bubble = text(o, "bubble"); caption = text(o, "caption"); image = text(o, "image"); duration = number(o, "duration", -1);
        }
    }

    public static final class Slice {
        public final String id, label, description, icon, item, condition;
        /** Frames its icon plays (Q229: order, times, playback mode). */
        public final ${T}.Frames anim;
        /** Hidden, else greyed out, while the condition is false. */
        public final boolean hide;
        public final Action action;

        Slice(com.google.gson.JsonObject o) {
            id = text(o, "id"); label = text(o, "label"); description = text(o, "description"); icon = text(o, "icon"); item = text(o, "item");
            condition = text(o, "condition"); anim = ${T}.Frames.of(o, "icon");
            hide = !o.has("hide") || o.get("hide").getAsBoolean(); action = new Action(o.getAsJsonObject("action"));
        }
    }

    public static final class Tab {
        public final String id, label, folder;
        public final int pageSize;
        /** The action of every slice of a folder tab. */
        public final Action action;
        public final java.util.List<Slice> slices = new java.util.ArrayList<>();

        Tab(com.google.gson.JsonObject o) {
            id = text(o, "id"); label = text(o, "label"); folder = text(o, "folder"); pageSize = Math.max(2, Math.min(12, number(o, "pageSize", 8)));
            action = new Action(o.getAsJsonObject("action"));
            for (com.google.gson.JsonElement slice : o.getAsJsonArray("slices")) slices.add(new Slice(slice.getAsJsonObject()));
        }
    }

    /** One menu; sizes in GUI pixels, colours ARGB. */
    public static final class Menu {
        public final String key, mode, sector, sliceImage, hoverImage, disabledImage, background, title;
        public final int size, iconSize, sliceColor, hoverColor, disabledColor, sliceImageSize, backgroundWidth, backgroundHeight, backgroundSlice, padding, textColor;
        public final float hole;
        /** How it opens (Q228): the appear transition; the wheel closes at once. */
        public final ${T}.Timing timing;
        public final boolean showLabel, showDescription, centerIcon;
        public final java.util.List<Tab> tabs = new java.util.ArrayList<>();

        Menu(com.google.gson.JsonObject o) {
            key = text(o, "key"); mode = text(o, "mode"); sector = text(o, "sector"); sliceImage = text(o, "sliceImage"); hoverImage = text(o, "hoverImage");
            disabledImage = text(o, "disabledImage"); background = text(o, "background"); title = text(o, "title"); timing = new ${T}.Timing(o.has("timing") ? o.getAsJsonObject("timing") : null);
            size = number(o, "size", 160); iconSize = number(o, "iconSize", 24); sliceColor = (int) o.get("sliceColor").getAsLong(); hoverColor = (int) o.get("hoverColor").getAsLong();
            disabledColor = (int) o.get("disabledColor").getAsLong(); sliceImageSize = number(o, "sliceImageSize", 28); backgroundWidth = Math.max(1, number(o, "backgroundWidth", 1));
            backgroundHeight = Math.max(1, number(o, "backgroundHeight", 1)); backgroundSlice = number(o, "backgroundSlice", 0); padding = number(o, "padding", 8);
            textColor = number(o, "textColor", 0xFFFFFF); hole = (float) o.get("hole").getAsDouble();
            showLabel = o.get("showLabel").getAsBoolean(); showDescription = o.get("showDescription").getAsBoolean(); centerIcon = o.get("centerIcon").getAsBoolean();
            for (com.google.gson.JsonElement tab : o.getAsJsonArray("tabs")) tabs.add(new Tab(tab.getAsJsonObject()));
        }
    }

    static int number(com.google.gson.JsonObject o, String key, int fallback) {
        return o.has(key) ? o.get(key).getAsInt() : fallback;
    }

    static String text(com.google.gson.JsonObject o, String key) {
        return o.has(key) ? o.get(key).getAsString() : "";
    }

    private static java.util.Map<String, Menu> menus;

    /** The menus of radial_menus.json, read once from the mod's own jar. */
    public static synchronized java.util.Map<String, Menu> menus() {
        if (menus != null) return menus;
        menus = new java.util.LinkedHashMap<>();
        try (java.io.InputStream in = RadialMenus.class.getResourceAsStream(${JSON.stringify(`/${radialDataPath(penv.modId)}`)})) {
            if (in == null) return menus;
            com.google.gson.JsonObject root = ${N.parse}(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            for (java.util.Map.Entry<String, com.google.gson.JsonElement> entry : root.getAsJsonObject("menus").entrySet()) menus.put(entry.getKey(), new Menu(entry.getValue().getAsJsonObject()));
        } catch (Exception e) {
            ${N.logger}.error("Radial menus could not be read", e);
        }
        return menus;
    }

    public static Menu menu(String id) {
        return id == null ? null : menus().get(id);
    }

    // ---- server ----

    public static final int SHOWN = 0, DISABLED = 1, HIDDEN = 2;
    /** Slices a procedure set for one player: "menu/tab/slice" -> SHOWN, DISABLED or HIDDEN. */
    private static final java.util.Map<java.util.UUID, java.util.Map<String, Integer>> OVERRIDES = new java.util.HashMap<>();
    /** Server tick of each player's last choice: a client cannot choose faster than every few ticks. */
    private static final java.util.Map<java.util.UUID, Integer> LAST_CHOICE = new java.util.HashMap<>();

    /** Opens menu \`id\` on a player's screen with the slices they see. */
    public static void open(${N.Entity} entity, String id) {
        Menu menu = menu(id);
        if (!connected(entity) || menu == null) return;
        ${N.ServerPlayer} player = (${N.ServerPlayer}) entity;
        ${net}.toPlayer(player, new ${net}.RadialOpen(id, states(player, id, menu)));
    }

    /** Closes the radial menu a player has open. */
    public static void close(${N.Entity} entity) {
        if (connected(entity)) ${net}.toPlayer(entity, new ${net}.RadialOpen("", ""));
    }

    /** A player with a client to send to (fake players of other mods have none). */
    static boolean connected(${N.Entity} entity) {
        return entity instanceof ${N.ServerPlayer} && ((${N.ServerPlayer}) entity).connection != null;
    }

    /** Sets slice \`slice\` of tab \`tab\` for a player: "shown", "hidden", "disabled", else back to its condition. */
    public static void setSlice(${N.Entity} entity, String menu, String tab, String slice, String state) {
        if (!(entity instanceof ${N.ServerPlayer})) return;
        java.util.Map<String, Integer> set = OVERRIDES.computeIfAbsent(entity.getUUID(), key -> new java.util.HashMap<>());
        String key = menu + "/" + tab + "/" + slice;
        if ("shown".equals(state)) set.put(key, SHOWN);
        else if ("hidden".equals(state)) set.put(key, HIDDEN);
        else if ("disabled".equals(state)) set.put(key, DISABLED);
        else set.remove(key);
    }

    /** SHOWN, DISABLED or HIDDEN for a player: what a procedure set, else the slice's condition. */
    public static int state(${N.ServerPlayer} player, String menu, Tab tab, Slice slice) {
        java.util.Map<String, Integer> set = OVERRIDES.get(player.getUUID());
        Integer state = set == null ? null : set.get(menu + "/" + tab.id + "/" + slice.id);
        if (state != null) return state;
        if (slice.condition.isEmpty() || test(slice.condition, player, menu, tab.id, slice.id)) return SHOWN;
        return slice.hide ? HIDDEN : DISABLED;
    }

    /** The slices a player does not see as shown, "<tab index>:<slice id>=<state>;" each, sent with the menu. */
    private static String states(${N.ServerPlayer} player, String id, Menu menu) {
        StringBuilder states = new StringBuilder();
        for (int t = 0; t < menu.tabs.size(); t++) {
            for (Slice slice : menu.tabs.get(t).slices) {
                int state = state(player, id, menu.tabs.get(t), slice);
                if (state != SHOWN) states.append(t).append(':').append(slice.id).append('=').append(state).append(';');
            }
        }
        return states.toString();
    }

    /** A client's request: "open" a menu (its key was pressed) or "choose" slice \`slice\` of tab \`tab\` of an open one. */
    public static void receive(${N.Level} level, ${N.Player} sender, String kind, String id, double tab, String slice) {
        Menu menu = menu(id);
        if (!(sender instanceof ${N.ServerPlayer}) || menu == null) return;
        ${N.ServerPlayer} player = (${N.ServerPlayer}) sender;
        if ("open".equals(kind)) {
            open(player, id);
            return;
        }
        if (!"choose".equals(kind) || ${N.server} == null || tab < 0 || tab >= menu.tabs.size()) return;
        int now = ${N.server}.getTickCount();
        Integer last = LAST_CHOICE.put(player.getUUID(), now);
        if (last != null && now - last < 4) return;
        Tab chosen = menu.tabs.get((int) tab);
        Action action = null;
        if (!chosen.folder.isEmpty()) {
            if (RuntimeImages.has(chosen.folder, slice)) action = chosen.action;
        } else {
            for (Slice s : chosen.slices) if (s.id.equals(slice) && state(player, id, chosen, s) == SHOWN) action = s.action;
        }
        if (action == null) return;
        run(action, player, id, chosen, slice);
        for (Listener listener : LISTENERS) listener.chosen(player, id, chosen.id, slice);
    }

    private static void run(Action action, ${N.ServerPlayer} player, String menu, Tab tab, String slice) {
        String caption = action.caption.replace("{id}", slice);
        switch (action.kind) {
            case "command":
                command(player, action.command.replace("{id}", slice));
                break;
            case "procedure":
                call(action.procedure, player, menu, tab.id, slice);
                break;
            case "menu":
                open(player, action.menu);
                break;
            case "gui":
                gui(player, action.gui);
                break;
            case "bubble":
                ${penv.modClass}Bubbles.showBubble(player, action.bubble, caption, action.duration);
                break;
            case "image_bubble":
                RuntimeImages.showBubble(player, tab.folder.isEmpty() ? action.image : tab.folder + "/" + slice, caption, action.duration);
                break;
            default:
                break;
        }
    }

    /** Runs a command as the player, with their own permissions. */
    private static void command(${N.ServerPlayer} player, String command) {
        ${N.Server} server = ${N.server};
        if (server != null && !command.isEmpty()) ${N.command}
    }

    private static void gui(${N.ServerPlayer} player, String gui) {
        ${openGui}
    }

    private static void call(String procedure, ${N.ServerPlayer} player, String menu, String tab, String slice) {
        switch (procedure) {
${calls}
            default:
                break;
        }
    }

    private static boolean test(String procedure, ${N.ServerPlayer} player, String menu, String tab, String slice) {
        switch (procedure) {
${tests}
            default:
                return true;
        }
    }
}
`,
  };
}

function imagesSource(env: GenEnv, penv: ProcEnv): JavaSource {
  const N = names(penv);
  const net = network(penv);
  const folders = runtimeFolders(env);
  return {
    path: `${penv.pkg.replaceAll(".", "/")}/procedures/RuntimeImages.java`,
    code: `package ${penv.pkg}.procedures;

/**
 * Generated by MCEdge: runtime image folders (Q227). The server reads the PNG and GIF files of config/${penv.modId}/<folder>/
 * (names [a-z0-9_], at most MAX_FILES files of MAX_BYTES each; a GIF becomes a strip of square frames, a PNG strip of
 * square frames plays too) and sends them to every player on join and after /${penv.modId} reload. Clients make textures of
 * them (RuntimeImagesClient): radial menu tabs list a folder's images as slices, bubbles show one as their icon.
 */
public final class RuntimeImages {
    private RuntimeImages() {}

    public static final int MAX_FILES = 64, MAX_BYTES = 1 << 20, MAX_FRAMES = 32, FRAME = 64, MAX_SIDE = 1024;
    /** Folders the mod's radial menus name, loaded when the server starts; others load when a procedure first names them. */
    private static final String[] FOLDERS = { ${folders.map((f) => JSON.stringify(f)).join(", ")} };
    private static final java.util.regex.Pattern NAME = java.util.regex.Pattern.compile("[a-z0-9_]{1,32}");

    /** An image, as a PNG strip of \`frames\` square frames, \`time\` ticks each. */
    public static final class Image {
        public final String folder, name;
        public final byte[] png;
        public final int frames, time;

        Image(String folder, String name, byte[] png, int frames, int time) {
            this.folder = folder;
            this.name = name;
            this.png = png;
            this.frames = frames;
            this.time = time;
        }
    }

    private static final java.util.Map<String, java.util.Map<String, Image>> LOADED = new java.util.TreeMap<>();
    private static ${N.Server} server;

    /** Server start: loads the menus' folders. */
    public static synchronized void start(${N.Server} started) {
        server = started;
        LOADED.clear();
        for (String folder : FOLDERS) folder(folder);
    }

    /** /${penv.modId} reload: reads every folder again and sends them to the players; the number of images. */
    public static synchronized int reload() {
        java.util.Set<String> names = new java.util.TreeSet<>(LOADED.keySet());
        java.util.Collections.addAll(names, FOLDERS);
        LOADED.clear();
        int count = 0;
        for (String folder : names) count += folder(folder).size();
        if (server != null) for (${N.ServerPlayer} player : server.getPlayerList().getPlayers()) sendAll(player);
        return count;
    }

    /** The images of a folder, read on first use; empty for a name that is not a plain folder name. */
    public static synchronized java.util.Map<String, Image> folder(String folder) {
        if (folder == null || !NAME.matcher(folder).matches()) return java.util.Collections.emptyMap();
        java.util.Map<String, Image> images = LOADED.get(folder);
        if (images != null) return images;
        images = load(folder);
        LOADED.put(folder, images);
        if (server != null) for (${N.ServerPlayer} player : server.getPlayerList().getPlayers()) for (Image image : images.values()) send(player, image);
        return images;
    }

    public static boolean has(String folder, String name) {
        return name != null && folder(folder).containsKey(name);
    }

    private static java.util.Map<String, Image> load(String folder) {
        java.util.Map<String, Image> images = new java.util.TreeMap<>();
        java.nio.file.Path dir = ${N.configDir}.resolve(${JSON.stringify(penv.modId)}).resolve(folder);
        java.util.List<java.nio.file.Path> files;
        try {
            java.nio.file.Files.createDirectories(dir);
            try (java.util.stream.Stream<java.nio.file.Path> listed = java.nio.file.Files.list(dir)) {
                files = listed.filter(file -> java.nio.file.Files.isRegularFile(file, java.nio.file.LinkOption.NOFOLLOW_LINKS)).sorted().collect(java.util.stream.Collectors.toList());
            }
        } catch (java.io.IOException e) {
            ${N.logger}.warn("Runtime image folder {} could not be read: {}", dir, e.toString());
            return images;
        }
        for (java.nio.file.Path file : files) {
            String fileName = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
            int dot = fileName.lastIndexOf('.');
            String type = dot < 0 ? "" : fileName.substring(dot + 1);
            if (!type.equals("png") && !type.equals("gif")) continue;
            String name = fileName.substring(0, dot).replace('-', '_').replace(' ', '_');
            if (!NAME.matcher(name).matches() || images.containsKey(name)) {
                ${N.logger}.warn("Runtime image {} skipped: its name must be up to 32 of a-z, 0-9 and _", file.getFileName());
                continue;
            }
            if (images.size() >= MAX_FILES) {
                ${N.logger}.warn("Runtime image folder {}: only the first {} images are used", folder, MAX_FILES);
                break;
            }
            try {
                if (java.nio.file.Files.size(file) > MAX_BYTES) throw new java.io.IOException("larger than " + MAX_BYTES + " bytes");
                Image image = decode(folder, name, java.nio.file.Files.readAllBytes(file));
                images.put(name, image);
                ${N.logger}.info("Runtime image registered: {}/{} ({} {} frames, {} ticks each)", folder, name, type, image.frames, image.time);
            } catch (Exception e) {
                ${N.logger}.warn("Runtime image {} skipped: {}", file.getFileName(), e.getMessage());
            }
        }
        return images;
    }

    /** Reads a PNG or GIF into square frames of at most FRAME pixels, as one PNG strip. */
    static Image decode(String folder, String name, byte[] bytes) throws java.io.IOException {
        try (javax.imageio.stream.ImageInputStream in = javax.imageio.ImageIO.createImageInputStream(new java.io.ByteArrayInputStream(bytes))) {
            java.util.Iterator<javax.imageio.ImageReader> readers = in == null ? java.util.Collections.emptyIterator() : javax.imageio.ImageIO.getImageReaders(in);
            if (!readers.hasNext()) throw new java.io.IOException("not an image");
            javax.imageio.ImageReader reader = readers.next();
            try {
                reader.setInput(in, false);
                String format = reader.getFormatName().toLowerCase(java.util.Locale.ROOT);
                boolean gif = format.equals("gif");
                if (!gif && !format.equals("png")) throw new java.io.IOException("not a PNG or GIF");
                int width = reader.getWidth(0), height = reader.getHeight(0);
                javax.imageio.metadata.IIOMetadataNode screen = gif ? node(reader.getStreamMetadata(), "javax_imageio_gif_stream_1.0", "LogicalScreenDescriptor") : null;
                if (screen != null && number(screen, "logicalScreenWidth") > 0) {
                    width = number(screen, "logicalScreenWidth");
                    height = number(screen, "logicalScreenHeight");
                }
                if (width > MAX_SIDE || height > MAX_SIDE) throw new java.io.IOException("larger than " + MAX_SIDE + " pixels");
                java.util.List<java.awt.image.BufferedImage> frames = new java.util.ArrayList<>();
                int delay = 0, delays = 0;
                if (gif) {
                    // Frames are drawn over the previous ones at their offsets, as a GIF plays.
                    java.awt.image.BufferedImage canvas = new java.awt.image.BufferedImage(width, height, java.awt.image.BufferedImage.TYPE_INT_ARGB);
                    int count = reader.getNumImages(true);
                    for (int i = 0; i < count && frames.size() < MAX_FRAMES; i++) {
                        java.awt.image.BufferedImage frame = reader.read(i);
                        javax.imageio.metadata.IIOMetadata meta = reader.getImageMetadata(i);
                        javax.imageio.metadata.IIOMetadataNode place = node(meta, "javax_imageio_gif_image_1.0", "ImageDescriptor");
                        javax.imageio.metadata.IIOMetadataNode control = node(meta, "javax_imageio_gif_image_1.0", "GraphicControlExtension");
                        int x = number(place, "imageLeftPosition"), y = number(place, "imageTopPosition");
                        String disposal = control == null ? "" : control.getAttribute("disposalMethod");
                        int time = number(control, "delayTime");
                        if (time > 0) {
                            delay += time;
                            delays++;
                        }
                        java.awt.image.BufferedImage before = "restoreToPrevious".equals(disposal) ? copy(canvas) : null;
                        java.awt.Graphics2D g = canvas.createGraphics();
                        g.drawImage(frame, x, y, null);
                        g.dispose();
                        frames.add(square(canvas));
                        if ("restoreToBackgroundColor".equals(disposal)) {
                            g = canvas.createGraphics();
                            g.setComposite(java.awt.AlphaComposite.Clear);
                            g.fillRect(x, y, frame.getWidth(), frame.getHeight());
                            g.dispose();
                        } else if (before != null) canvas = before;
                    }
                } else {
                    java.awt.image.BufferedImage image = reader.read(0);
                    int count = height > width && height % width == 0 ? Math.min(MAX_FRAMES, height / width) : 1;
                    for (int i = 0; i < count; i++) frames.add(square(count > 1 ? image.getSubimage(0, i * width, width, width) : image));
                }
                if (frames.isEmpty()) throw new java.io.IOException("no frames");
                int side = frames.get(0).getWidth();
                java.awt.image.BufferedImage strip = new java.awt.image.BufferedImage(side, side * frames.size(), java.awt.image.BufferedImage.TYPE_INT_ARGB);
                java.awt.Graphics2D g = strip.createGraphics();
                for (int i = 0; i < frames.size(); i++) g.drawImage(frames.get(i), 0, i * side, null);
                g.dispose();
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                javax.imageio.ImageIO.write(strip, "png", out);
                // GIF delays are in hundredths of a second, five to a tick; a PNG strip plays at 2 ticks a frame.
                int time = delays == 0 ? 2 : Math.max(1, Math.round(delay / (float) delays / 5.0F));
                return new Image(folder, name, out.toByteArray(), frames.size(), time);
            } finally {
                reader.dispose();
            }
        }
    }

    private static javax.imageio.metadata.IIOMetadataNode node(javax.imageio.metadata.IIOMetadata meta, String format, String name) {
        if (meta == null) return null;
        org.w3c.dom.NodeList found = ((javax.imageio.metadata.IIOMetadataNode) meta.getAsTree(format)).getElementsByTagName(name);
        return found.getLength() == 0 ? null : (javax.imageio.metadata.IIOMetadataNode) found.item(0);
    }

    private static int number(javax.imageio.metadata.IIOMetadataNode node, String attribute) {
        try {
            return node == null ? 0 : Integer.parseInt(node.getAttribute(attribute));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static java.awt.image.BufferedImage copy(java.awt.image.BufferedImage image) {
        java.awt.image.BufferedImage copy = new java.awt.image.BufferedImage(image.getWidth(), image.getHeight(), java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = copy.createGraphics();
        g.drawImage(image, 0, 0, null);
        g.dispose();
        return copy;
    }

    /** A frame as a square of at most FRAME pixels, the image centred and scaled down to fit. */
    private static java.awt.image.BufferedImage square(java.awt.image.BufferedImage image) {
        int w = image.getWidth(), h = image.getHeight(), side = Math.min(FRAME, Math.max(w, h));
        float k = Math.min(1.0F, (float) side / Math.max(w, h));
        int sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
        java.awt.image.BufferedImage out = new java.awt.image.BufferedImage(side, side, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = out.createGraphics();
        g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, k < 1.0F ? java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR : java.awt.RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
        g.drawImage(image, (side - sw) / 2, (side - sh) / 2, sw, sh, null);
        g.dispose();
        return out;
    }

    /** Join: the player's client forgets older images and gets every loaded one. */
    public static synchronized void sendAll(${N.ServerPlayer} player) {
        if (!RadialMenus.connected(player)) return;
        ${N.Tag} clear = new ${N.Tag}();
        clear.putBoolean("clear", true);
        ${net}.toPlayer(player, new ${net}.RuntimeImageSync(clear));
        for (java.util.Map<String, Image> images : LOADED.values()) for (Image image : images.values()) send(player, image);
    }

    private static void send(${N.ServerPlayer} player, Image image) {
        if (!RadialMenus.connected(player)) return;
        ${N.Tag} tag = new ${N.Tag}();
        tag.putString("folder", image.folder);
        tag.putString("name", image.name);
        tag.putByteArray("png", image.png);
        tag.putInt("frames", image.frames);
        tag.putInt("time", image.time);
        ${net}.toPlayer(player, new ${net}.RuntimeImageSync(tag));
    }

    /** Shows the default bubble with runtime image "folder/name" as its icon; -1: ${RUNTIME_IMAGE_TICKS} ticks, 0: until cleared. */
    public static void showBubble(${N.Entity} entity, String image, String caption, double duration) {
        int slash = image == null ? -1 : image.indexOf('/');
        if (slash < 0 || !has(image.substring(0, slash), image.substring(slash + 1))) return;
        ${penv.modClass}Bubbles.show(entity, "img:" + image, caption, duration < 0 ? ${RUNTIME_IMAGE_TICKS} : duration);
    }
}
`,
  };
}

/** Server hooks: images load when the server starts and go to each player who joins; /<modid> reload reads them again. */
export function radialServerHooks(env: ProcEnv): string[] {
  const images = imagesClass(env);
  const literal = JSON.stringify(env.modId);
  const reload = (command: string, source: string, permission: string, reply: string) =>
    `${command}.literal(${literal}).then(${command}.literal("reload").requires(source -> ${permission}).executes(context -> {
int count = ${images}.reload();
${reply}
return count;
}))`;
  if (env.loader === "forge") {
    return [
      `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.server.FMLServerStartedEvent.class, event -> ${images}.start(event.getServer()));`,
      `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent.class, event -> {
if (event.getPlayer() instanceof net.minecraft.entity.player.ServerPlayerEntity) ${images}.sendAll((net.minecraft.entity.player.ServerPlayerEntity) event.getPlayer());
});`,
      `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.RegisterCommandsEvent.class, event -> event.getDispatcher().register(${reload("net.minecraft.command.Commands", "source", "source.hasPermission(2)",
        `context.getSource().sendSuccess(new net.minecraft.util.text.StringTextComponent("Runtime images: " + count), true);`)}));`,
    ];
  }
  const permission = env.gen === "26.3" ? "net.minecraft.commands.Commands.hasPermission(net.minecraft.commands.Commands.LEVEL_GAMEMASTERS).test(source)" : "source.hasPermission(2)";
  const reply = `context.getSource().sendSuccess(() -> net.minecraft.network.chat.Component.literal("Runtime images: " + count), true);`;
  const command = reload("net.minecraft.commands.Commands", "source", permission, reply);
  if (env.loader === "neoforge") {
    return [
      `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.server.ServerStartedEvent.class, event -> ${images}.start(event.getServer()));`,
      `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent.class, event -> {
if (event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player) ${images}.sendAll(player);
});`,
      `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.RegisterCommandsEvent.class, event -> event.getDispatcher().register(${command}));`,
    ];
  }
  return [
    `net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents.SERVER_STARTED.register(${images}::start);`,
    `net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> ${images}.sendAll(handler.player));`,
    `net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback.EVENT.register((dispatcher, registries, environment) -> dispatcher.register(${command}));`,
  ];
}

// ---- client ----

/** The menus with a key: [menu id, GLFW key code]. */
const keyedMenus = (env: GenEnv) => menusOf(env).map((m) => [m.id, keyCode(str(m.openKey) || "R")] as const).filter(([, code]) => code >= 0);

function clientSource(env: GenEnv, penv: ProcEnv): JavaSource {
  const N = names(penv);
  const KM = N.legacy ? "net.minecraft.client.settings.KeyBinding" : "net.minecraft.client.KeyMapping";
  const input = N.legacy ? "net.minecraft.client.util.InputMappings" : "com.mojang.blaze3d.platform.InputConstants";
  const type = N.v26 ? "KEYBOARD" : "KEYSYM";
  const category = N.v26 ? `${KM}.Category.MISC` : JSON.stringify("key.categories.misc");
  const keys = keyedMenus(env);
  const screen = N.v26 ? "mc.gui.screen()" : "mc.screen";
  const setScreen = (s: string) => (N.v26 ? `mc.gui.setScreen(${s})` : `mc.setScreen(${s})`);
  const net = network(penv);
  return {
    path: `${penv.pkg.replaceAll(".", "/")}/procedures/client/RadialMenusClient.java`,
    code: `package ${penv.pkg}.procedures.client;

/** Generated by MCEdge: radial menu keys and opening (Q227); client only. A key asks the server, which opens the menu. */
public final class RadialMenusClient {
    private RadialMenusClient() {}

    /** Menus with a key, and their keys. */
    private static final String[] MENUS = { ${keys.map(([id]) => JSON.stringify(id)).join(", ")} };
${keys.map(([id, code], i) => `    private static final ${KM} KEY_${i} = new ${KM}(${JSON.stringify(`key.${penv.modId}.radial.${id}`)}, ${input}.Type.${type}, ${code}, ${category});`).join("\n")}
    private static final ${KM}[] KEYS = { ${keys.map((_, i) => `KEY_${i}`).join(", ")} };
    /** The menu whose key was pressed and is still held while the server answers, "" none. */
    private static String held = "";
    /** The key of the menu a slice was last chosen in, and when: a menu without a key that the server opens right after
     * (a slice that opens another menu) chooses with it too (Q237). */
    private static ${KM} lastKey;
    private static long lastAt;

${keyMappingRegister(env, keys.map((_, i) => `KEY_${i}`))}

    private static void tick() {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        for (int i = 0; i < KEYS.length; i++) {
            while (KEYS[i].consumeClick()) {
                if (mc.player == null || ${screen} != null) continue;
                held = MENUS[i];
                ${clientClass(penv).replace(/^.*\./, "")}.ask(MENUS[i]);
            }
            if (MENUS[i].equals(held) && !KEYS[i].isDown()) held = "";
        }
    }

    /** A slice of a menu was chosen; key is the key that menu chose with, null when none. */
    static void chosen(String menu, ${KM} key) {
        int i = java.util.Arrays.asList(MENUS).indexOf(menu);
        lastKey = key != null ? key : i >= 0 ? KEYS[i] : null;
        lastAt = System.currentTimeMillis();
    }

    /** Asks the server to open a menu. */
    static void ask(String menu) {
        ${penv.pkg}.procedures.client.${penv.modClass}NetworkClient.toServer(new ${net}.RadialAction("open", menu, 0, ""));
    }

    /** The server opens \`menu\` with the slices this player does not see as shown (\`states\`), or closes the open one (""). */
    public static void open(${N.Level} level, String menu, String states) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        ${penv.pkg}.procedures.RadialMenus.Menu data = ${penv.pkg}.procedures.RadialMenus.menu(menu);
        if (data == null) {
            if (${screen} instanceof RadialMenuScreen) ${setScreen("null")};
            return;
        }
        int key = java.util.Arrays.asList(MENUS).indexOf(menu);
        // Held: releasing the key chooses; a key let go before the menu came acts like a toggle key.
        boolean hold = "hold".equals(data.mode) && key >= 0 && menu.equals(held);
        ${KM} follow = key < 0 && System.currentTimeMillis() - lastAt < 2000L ? lastKey : null;
        lastKey = null;
        ${setScreen(`new RadialMenuScreen(menu, data, states, hold ? KEYS[key] : follow, hold)`)};
    }
}
`,
  };
}

function imagesClientSource(penv: ProcEnv): JavaSource {
  const N = names(penv);
  const texture = N.legacy ? "new net.minecraft.client.renderer.texture.DynamicTexture(image)" : "new net.minecraft.client.renderer.texture.DynamicTexture(() -> name, image)";
  const NativeImage = N.legacy ? "net.minecraft.client.renderer.texture.NativeImage" : "com.mojang.blaze3d.platform.NativeImage";
  return {
    path: `${penv.pkg.replaceAll(".", "/")}/procedures/client/RuntimeImagesClient.java`,
    code: `package ${penv.pkg}.procedures.client;

/** Generated by MCEdge: runtime images the server sent (Q227), as textures; client only. */
public final class RuntimeImagesClient {
    private RuntimeImagesClient() {}

    private static final java.util.regex.Pattern NAME = java.util.regex.Pattern.compile("[a-z0-9_]{1,32}");
    /** Image names by folder, sorted. */
    private static final java.util.Map<String, java.util.TreeSet<String>> NAMES = new java.util.HashMap<>();
    /** "folder/name" -> {frames, ticks per frame}. */
    private static final java.util.Map<String, int[]> FRAMES = new java.util.HashMap<>();

    /** One image ("folder", "name", "png" strip, "frames", "time") or "clear" (join: forget older images). */
    public static void receive(${N.Level} level, ${N.Tag} tag) {
        if (tag == null) return;
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (${N.getBool(JSON.stringify("clear"))}) {
            for (String image : FRAMES.keySet()) {
                mc.getTextureManager().release(${N.id("texture(image)")});
                ${penv.pkg}.procedures.${penv.modClass}Bubbles.registerIcon("img:" + image, null, 0, 0);
            }
            FRAMES.clear();
            NAMES.clear();
            return;
        }
        String folder = ${N.getString(JSON.stringify("folder"))}, file = ${N.getString(JSON.stringify("name"))};
        byte[] png = ${N.getBytes(JSON.stringify("png"))};
        int frames = Math.max(1, Math.min(64, ${N.getInt(JSON.stringify("frames"))})), time = Math.max(1, Math.min(200, ${N.getInt(JSON.stringify("time"))}));
        if (!NAME.matcher(folder).matches() || !NAME.matcher(file).matches() || png.length == 0) return;
        String key = folder + "/" + file, name = texture(key);
        try {
            ${NativeImage} image = ${NativeImage}.read(new java.io.ByteArrayInputStream(png));
            if (image.getHeight() != image.getWidth() * frames) {
                image.close();
                return;
            }
            mc.getTextureManager().register(${N.id("name")}, ${texture});
            ${penv.pkg}.procedures.${penv.modClass}Bubbles.registerIcon("img:" + key, name, frames, time);
            FRAMES.put(key, new int[] { frames, time });
            NAMES.computeIfAbsent(folder, f -> new java.util.TreeSet<>()).add(file);
        } catch (java.io.IOException e) {
            // An image the client cannot read is left out.
        }
    }

    /** The texture id of image "folder/name". */
    public static String texture(String image) {
        return ${JSON.stringify(`${penv.modId}:runtime/`)} + image;
    }

    /** The images of a folder, sorted. */
    public static java.util.List<String> names(String folder) {
        java.util.TreeSet<String> names = NAMES.get(folder);
        return names == null ? java.util.Collections.emptyList() : new java.util.ArrayList<>(names);
    }

    /** {frames, ticks per frame} of image "folder/name", {1, 1} when unknown. */
    public static int[] frames(String image) {
        int[] frames = FRAMES.get(image);
        return frames == null ? new int[] { 1, 1 } : frames;
    }
}
`,
  };
}

/** The drawing and input calls that differ between generations, for RadialMenuScreen. */
function screenParts(penv: ProcEnv) {
  const N = names(penv);
  if (N.legacy) {
    return {
      G: "com.mojang.blaze3d.matrix.MatrixStack", title: "new net.minecraft.util.text.StringTextComponent(\"\")",
      I18n: "net.minecraft.client.resources.I18n.get", font: "this.font",
      push: "g.pushPose();", pop: "g.popPose();",
      scale: "g.translate(0.0D, dy, 0.0D);\n        g.translate(cx, cy, 0.0D);\n        g.scale(s, s, 1.0F);\n        g.translate(-cx, -cy, 0.0D);",
      rotate: "g.translate(cx, cy, 0.0D);\n        g.mulPose(net.minecraft.util.math.vector.Vector3f.ZP.rotation(angle));\n        g.translate(-cx, -cy, 0.0D);",
      blit: `this.minecraft.getTextureManager().bind(${N.id("texture")});
        com.mojang.blaze3d.systems.RenderSystem.enableBlend();
        com.mojang.blaze3d.systems.RenderSystem.defaultBlendFunc();
        com.mojang.blaze3d.systems.RenderSystem.color4f((color >> 16 & 255) / 255.0F, (color >> 8 & 255) / 255.0F, (color & 255) / 255.0F, (color >>> 24) / 255.0F);
        net.minecraft.client.gui.AbstractGui.blit(g, x, y, w, h, u, v, uw, vh, tw, th);
        com.mojang.blaze3d.systems.RenderSystem.color4f(1.0F, 1.0F, 1.0F, 1.0F);`,
      text: "net.minecraft.client.gui.AbstractGui.drawCenteredString(g, this.font, text, x, y, color);",
      item: "this.itemRenderer.renderAndDecorateItem(stack, x, y);",
      stack: `new net.minecraft.item.ItemStack(net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(${N.id("id")}))`,
      Stack: "net.minecraft.item.ItemStack",
      render: `    @Override
    public void render(com.mojang.blaze3d.matrix.MatrixStack g, int mouseX, int mouseY, float partial) {
        draw(g, mouseX, mouseY, partial);
    }`,
      input: `    @Override
    public boolean mouseClicked(double x, double y, int button) {
        return click(x, y, button) || super.mouseClicked(x, y, button);
    }

    @Override
    public boolean mouseScrolled(double x, double y, double amount) {
        return scroll(amount);
    }

    @Override
    public boolean keyPressed(int key, int scan, int modifiers) {
        return press(this.key != null && this.key.matches(key, scan)) || digit(key) || super.keyPressed(key, scan, modifiers);
    }

    @Override
    public boolean keyReleased(int key, int scan, int modifiers) {
        if (this.key != null && this.key.matches(key, scan)) return !armed || release();
        return super.keyReleased(key, scan, modifiers);
    }`,
      close: "this.minecraft.setScreen(null);",
    };
  }
  const v26 = N.v26;
  return {
    G: v26 ? "net.minecraft.client.gui.GuiGraphicsExtractor" : "net.minecraft.client.gui.GuiGraphics", title: "net.minecraft.network.chat.Component.empty()",
    I18n: "net.minecraft.client.resources.language.I18n.get", font: "this.font",
    push: v26 ? "g.pose().pushMatrix();" : "g.pose().pushPose();", pop: v26 ? "g.pose().popMatrix();" : "g.pose().popPose();",
    scale: v26 ? "g.pose().translate(0.0F, dy);\n        g.pose().translate(cx, cy);\n        g.pose().scale(s, s);\n        g.pose().translate(-cx, -cy);"
      : "g.pose().translate(0.0F, dy, 0.0F);\n        g.pose().translate(cx, cy, 0.0F);\n        g.pose().scale(s, s, 1.0F);\n        g.pose().translate(-cx, -cy, 0.0F);",
    rotate: v26 ? "g.pose().translate(cx, cy);\n        g.pose().rotate(angle);\n        g.pose().translate(-cx, -cy);"
      : "g.pose().translate(cx, cy, 0.0F);\n        g.pose().mulPose(com.mojang.math.Axis.ZP.rotation(angle));\n        g.pose().translate(-cx, -cy, 0.0F);",
    blit: `g.blit(${v26 ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured"}, ${N.id("texture")}, x, y, u, v, w, h, uw, vh, tw, th, color);`,
    text: v26 ? "g.centeredText(this.font, text, x, y, color);" : "g.drawCenteredString(this.font, text, x, y, color);",
    item: v26 ? "g.item(stack, x, y);" : "g.renderItem(stack, x, y);",
    stack: `new net.minecraft.world.item.ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(${N.id("id")}))`,
    Stack: "net.minecraft.world.item.ItemStack",
    render: v26
      ? `    @Override
    public void extractRenderState(net.minecraft.client.gui.GuiGraphicsExtractor g, int mouseX, int mouseY, float partial) {
        draw(g, mouseX, mouseY, partial);
    }

    /** No blurred or dimmed background: the world stays visible around the wheel. */
    @Override
    public void extractBackground(net.minecraft.client.gui.GuiGraphicsExtractor g, int mouseX, int mouseY, float partial) {
    }`
      : `    @Override
    public void render(net.minecraft.client.gui.GuiGraphics g, int mouseX, int mouseY, float partial) {
        draw(g, mouseX, mouseY, partial);
    }

    /** No blurred or dimmed background: the world stays visible around the wheel. */
    @Override
    public void renderBackground(net.minecraft.client.gui.GuiGraphics g, int mouseX, int mouseY, float partial) {
    }`,
    input: v26
      ? `    @Override
    public boolean mouseClicked(net.minecraft.client.input.MouseButtonEvent event, boolean twice) {
        return click(event.x(), event.y(), event.button()) || super.mouseClicked(event, twice);
    }

    @Override
    public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
        return scroll(scrollY);
    }

    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyEvent event) {
        return press(this.key != null && this.key.matches(event)) || digit(event.key()) || super.keyPressed(event);
    }

    @Override
    public boolean keyReleased(net.minecraft.client.input.KeyEvent event) {
        if (this.key != null && this.key.matches(event)) return !armed || release();
        return super.keyReleased(event);
    }`
      : `    @Override
    public boolean mouseClicked(double x, double y, int button) {
        return click(x, y, button) || super.mouseClicked(x, y, button);
    }

    @Override
    public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
        return scroll(scrollY);
    }

    @Override
    public boolean keyPressed(int key, int scan, int modifiers) {
        return press(this.key != null && this.key.matches(key, scan)) || digit(key) || super.keyPressed(key, scan, modifiers);
    }

    @Override
    public boolean keyReleased(int key, int scan, int modifiers) {
        if (this.key != null && this.key.matches(key, scan)) return !armed || release();
        return super.keyReleased(key, scan, modifiers);
    }`,
    close: v26 ? "this.minecraft.gui.setScreen(null);" : "this.minecraft.setScreen(null);",
  };
}

function screenSource(penv: ProcEnv): JavaSource {
  const N = names(penv);
  const P = screenParts(penv);
  const KM = N.legacy ? "net.minecraft.client.settings.KeyBinding" : "net.minecraft.client.KeyMapping";
  const M = `${penv.pkg}.procedures.RadialMenus`;
  const net = network(penv);
  const T = `${penv.pkg}.procedures.${penv.modClass}Transitions`;
  const Screen = N.legacy ? "net.minecraft.client.gui.screen.Screen" : "net.minecraft.client.gui.screens.Screen";
  return {
    path: `${penv.pkg.replaceAll(".", "/")}/procedures/client/RadialMenuScreen.java`,
    code: `package ${penv.pkg}.procedures.client;

/**
 * Generated by MCEdge: the screen of every radial menu (Q227), drawn from the menu's data. The mouse's direction from the
 * middle picks a slice; a click, or releasing the held key, chooses it; the wheel or 1-9 change tabs (a folder tab with more
 * images than a page holds has a tab per page).
 */
public final class RadialMenuScreen extends ${Screen} {
    /** A slice as shown: its id, texts, icon and state (RadialMenus.SHOWN or DISABLED). */
    private static final class Entry {
        final String id, label, description, icon, item;
        final ${T}.Frames anim;
        final int state;

        Entry(String id, String label, String description, String icon, String item, ${T}.Frames anim, int state) {
            this.id = id;
            this.label = label;
            this.description = description;
            this.icon = icon;
            this.item = item;
            this.anim = anim;
            this.state = state;
        }
    }

    /** A tab as shown: a list tab, or one page of a folder tab. */
    private static final class Page {
        final int tab;
        final String label;
        final java.util.List<Entry> entries = new java.util.ArrayList<>();

        Page(int tab, String label) {
            this.tab = tab;
            this.label = label;
        }
    }

    private final String id;
    private final ${M}.Menu menu;
    /** The key that chooses on release: the menu's own key when it was held to open it, or the key of the menu it was
     * opened from (Q237); null when only a click chooses. */
    private final ${KM} key;
    /** The key went down while the menu was open, or was held to open it: letting it go chooses. */
    private boolean armed;
    private final java.util.List<Page> pages = new java.util.ArrayList<>();
    private int page;
    private int ticks;
    private double mouseX, mouseY;

    public RadialMenuScreen(String id, ${M}.Menu menu, String states, ${KM} key, boolean held) {
        super(${P.title});
        this.id = id;
        this.menu = menu;
        this.key = key;
        this.armed = held;
        java.util.Map<String, Integer> hidden = new java.util.HashMap<>();
        for (String part : states.split(";")) {
            int eq = part.lastIndexOf('=');
            if (eq > 0) hidden.put(part.substring(0, eq), Integer.parseInt(part.substring(eq + 1)));
        }
        for (int t = 0; t < menu.tabs.size(); t++) {
            ${M}.Tab tab = menu.tabs.get(t);
            String label = tab.label.isEmpty() ? tab.id : ${P.I18n}(tab.label);
            if (tab.folder.isEmpty()) {
                Page shown = new Page(t, label);
                for (${M}.Slice slice : tab.slices) {
                    int state = hidden.getOrDefault(t + ":" + slice.id, ${M}.SHOWN);
                    if (state == ${M}.HIDDEN) continue;
                    shown.entries.add(new Entry(slice.id, slice.label.isEmpty() ? slice.id : ${P.I18n}(slice.label), slice.description.isEmpty() ? "" : ${P.I18n}(slice.description),
                        slice.icon, slice.item, slice.anim, state));
                }
                pages.add(shown);
                continue;
            }
            java.util.List<String> names = RuntimeImagesClient.names(tab.folder);
            int count = Math.max(1, (names.size() + tab.pageSize - 1) / tab.pageSize);
            for (int p = 0; p < count; p++) {
                Page shown = new Page(t, count > 1 ? label + " " + (p + 1) + "/" + count : label);
                for (String name : names.subList(p * tab.pageSize, Math.min(names.size(), (p + 1) * tab.pageSize))) {
                    int[] frames = RuntimeImagesClient.frames(tab.folder + "/" + name);
                    shown.entries.add(new Entry(name, name, "", RuntimeImagesClient.texture(tab.folder + "/" + name), "", ${T}.Frames.still(frames[0], frames[1]), ${M}.SHOWN));
                }
                pages.add(shown);
            }
        }
    }

    @Override
    public void tick() {
        ticks++;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

${P.render}

${P.input}

    /** The slice under the mouse on the current page, -1 none. */
    private int hovered() {
        java.util.List<Entry> entries = pages.get(page).entries;
        double dx = mouseX - this.width / 2.0D, dy = mouseY - this.height / 2.0D;
        int n = entries.size();
        // Within half the hole no slice is picked (deadZone in radialLayout.ts); elsewhere the direction picks one.
        if (n == 0 || Math.sqrt(dx * dx + dy * dy) < menu.size / 2.0D * menu.hole * 0.5D) return -1;
        double angle = (Math.atan2(dx, -dy) + 2.0D * Math.PI) % (2.0D * Math.PI);
        return (int) Math.floor((angle + Math.PI / n) / (2.0D * Math.PI / n)) % n;
    }

    private boolean click(double x, double y, int button) {
        mouseX = x;
        mouseY = y;
        if (button != 0) return false;
        choose();
        return true;
    }

    private boolean release() {
        choose();
        return true;
    }

    /** The menu's key went down: letting it go now chooses the slice under the mouse, or closes over none. */
    private boolean press(boolean matches) {
        if (matches) armed = true;
        return matches;
    }

    private boolean scroll(double amount) {
        if (amount == 0 || pages.size() < 2) return false;
        // Wheel up (amount > 0) goes to the next tab, down to the previous one (Q232).
        page = Math.floorMod(page + (amount > 0 ? 1 : -1), pages.size());
        return true;
    }

    /** 1-9 pick a tab. */
    private boolean digit(int key) {
        int index = key - 49;
        if (index < 0 || index > 8 || index >= pages.size()) return false;
        page = index;
        return true;
    }

    /** Sends the slice under the mouse (when it can be chosen) and closes. */
    private void choose() {
        int slice = hovered();
        if (slice >= 0) {
            Entry entry = pages.get(page).entries.get(slice);
            if (entry.state == ${M}.DISABLED) return;
            ${penv.pkg}.procedures.client.${penv.modClass}NetworkClient.toServer(new ${net}.RadialAction("choose", id, pages.get(page).tab, entry.id));
            RadialMenusClient.chosen(id, key);
        }
        ${P.close}
    }

    private void draw(${P.G} g, int x, int y, float partial) {
        mouseX = x;
        mouseY = y;
        Page shown = pages.get(page);
        int n = shown.entries.size(), hover = hovered();
        int cx = this.width / 2, cy = this.height / 2, size = menu.size, half = size / 2;
        // The opening transition (Q228): size, alpha and a slide (a fraction of the wheel's size).
        float[] opening = menu.timing.appearing(ticks + partial);
        float s = opening[1], dy = opening[2] * menu.size;
        int alpha = Math.round(255 * opening[0]);
        long time = this.minecraft.level == null ? ticks : this.minecraft.level.getGameTime();
        ${P.push}
        ${P.scale}
        if (!menu.background.isEmpty()) background(g, cx - half - menu.padding, cy - half - menu.padding, size + 2 * menu.padding, alpha);
        for (int i = 0; i < n; i++) {
            Entry entry = shown.entries.get(i);
            int color = entry.state == ${M}.DISABLED ? menu.disabledColor : i == hover ? menu.hoverColor : menu.sliceColor;
            float angle = (float) (2.0D * Math.PI * i / n);
            ${P.push}
            ${P.rotate}
            blit(g, menu.sector + n + ".png", cx - half, cy - half, size, size, 0, 1, fade(color, alpha));
            ${P.pop}
        }
        float ring = half * (1.0F + menu.hole) / 2.0F;
        for (int i = 0; i < n; i++) {
            Entry entry = shown.entries.get(i);
            double angle = 2.0D * Math.PI * i / n;
            int ix = cx + (int) Math.round(Math.sin(angle) * ring), iy = cy - (int) Math.round(Math.cos(angle) * ring);
            String image = entry.state == ${M}.DISABLED && !menu.disabledImage.isEmpty() ? menu.disabledImage : i == hover && !menu.hoverImage.isEmpty() ? menu.hoverImage : menu.sliceImage;
            if (!image.isEmpty()) blit(g, image, ix - menu.sliceImageSize / 2, iy - menu.sliceImageSize / 2, menu.sliceImageSize, menu.sliceImageSize, 0, 1, fade(0xFFFFFFFF, alpha));
            icon(g, entry, ix, iy, menu.iconSize, time, fade(entry.state == ${M}.DISABLED ? 0xFF808080 : 0xFFFFFFFF, alpha));
        }
        // The middle: the slice under the mouse (icon, label, description) or the title; the tab above the wheel.
        int text = fade(0xFF000000 | menu.textColor, alpha);
        Entry over = hover >= 0 ? shown.entries.get(hover) : null;
        String title = over != null && menu.showLabel ? over.label : over == null && !menu.title.isEmpty() ? ${P.I18n}(menu.title) : "";
        int lines = (title.isEmpty() ? 0 : 1) + (over != null && menu.showDescription && !over.description.isEmpty() ? 1 : 0);
        int top = cy - lines * 5;
        if (over != null && menu.centerIcon) {
            icon(g, over, cx, top - menu.iconSize / 2 - 2, menu.iconSize, time, fade(0xFFFFFFFF, alpha));
            top += menu.iconSize / 2;
        }
        if (!title.isEmpty()) {
            text(g, title, cx, top, text);
            top += 10;
        }
        if (over != null && menu.showDescription && !over.description.isEmpty()) text(g, over.description, cx, top, fade(0xFFA0A0A0, alpha));
        if (pages.size() > 1 || menu.tabs.size() > 1) text(g, "< " + shown.label + " >  " + (page + 1) + "/" + pages.size(), cx, cy - half - menu.padding - 12, text);
        ${P.pop}
    }

    /** A slice's icon centred at x, y: a texture (its frame at \`time\`), else an item. */
    private void icon(${P.G} g, Entry entry, int x, int y, int size, long time, int color) {
        if (!entry.icon.isEmpty()) {
            // A once mode (Q229) plays from when the wheel opened, the rest on the game clock.
            blit(g, entry.icon, x - size / 2, y - size / 2, size, size, entry.anim.at(entry.anim.once() ? ticks : time), entry.anim.count, color);
        } else if (!entry.item.isEmpty()) {
            try {
                String id = entry.item;
                ${P.Stack} stack = ${P.stack};
                x -= 8;
                y -= 8;
                ${P.item}
            } catch (RuntimeException e) {
                // A malformed item id draws nothing.
            }
        }
    }

    /** The background image, stretched or as a 9-slice keeping \`backgroundSlice\` pixels at each edge. */
    private void background(${P.G} g, int x, int y, int size, int alpha) {
        int color = fade(0xFFFFFFFF, alpha), b = menu.backgroundSlice;
        if (b <= 0) {
            region(g, menu.background, x, y, size, size, 0, 0, menu.backgroundWidth, menu.backgroundHeight, color);
            return;
        }
        int bw = menu.backgroundWidth, bh = menu.backgroundHeight;
        int[] xs = { x, x + b, x + size - b, x + size }, us = { 0, b, bw - b, bw };
        int[] ys = { y, y + b, y + size - b, y + size }, vs = { 0, b, bh - b, bh };
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) region(g, menu.background, xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j], us[i], vs[j], us[i + 1] - us[i], vs[j + 1] - vs[j], color);
        }
    }

    /** Frame \`frame\` of a strip of \`frames\` square frames over x, y, w, h. */
    private void blit(${P.G} g, String texture, int x, int y, int w, int h, int frame, int frames, int color) {
        draw(g, texture, x, y, w, h, 0.0F, (float) frame, 1, 1, 1, Math.max(1, frames), color);
    }

    /** Texture pixels u, v, uw, vh of a bw x bh texture over x, y, w, h. */
    private void region(${P.G} g, String texture, int x, int y, int w, int h, int u, int v, int uw, int vh, int color) {
        if (w > 0 && h > 0) draw(g, texture, x, y, w, h, u, v, uw, vh, menu.backgroundWidth, menu.backgroundHeight, color);
    }

    private void draw(${P.G} g, String texture, int x, int y, int w, int h, float u, float v, int uw, int vh, int tw, int th, int color) {
        ${P.blit}
    }

    private void text(${P.G} g, String text, int x, int y, int color) {
        ${P.text}
    }

    private static int fade(int color, int alpha) {
        return (Math.round((color >>> 24) * alpha / 255.0F) << 24) | (color & 0xFFFFFF);
    }
}
`,
  };
}

/** The radial runtime's sources; `call` gives a procedure call expression (procedureCallById). */
export function radialSources(env: GenEnv, penv: ProcEnv, call: Parameters<typeof procedureSwitch>[2]): JavaSource[] {
  return [menusSource(env, penv, call), imagesSource(env, penv), clientSource(env, penv), imagesClientSource(penv), screenSource(penv)];
}

/** Client initialisation: the menus' keys. */
export const radialClientInit = (penv: ProcEnv): string[] => [`${clientClass(penv)}.register(${penv.loader === "fabric" ? "" : "modBus"});`];
