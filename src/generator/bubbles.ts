import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Element } from "../elements/model.ts";
import { timingJson } from "../elements/transitions.ts";
import { animationSchedule } from "../resources/textureAnimation.ts";
import { BUBBLE_PIXEL_BLOCKS, BUILT_IN_BUBBLE, bubbleColor, bubbleLayout, CAPTION_PIXELS, DEFAULT_BUBBLE, OVER_HEAD, OVER_NAME, speechBubble } from "../elements/bubbleLayout.ts";
import type { ProcEnv, Segment } from "../procedures/compile.ts";
import type { JavaSource } from "../procedures/runtime.ts";
import { str } from "./java.ts";
import { readPng, writePng } from "./png.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * Status bubbles above players (Q206, Q214, Q216), one data-driven path for every engine.
 *
 * Data: every bubble element of the project (element type `bubble`, src/elements/bubbleLayout.ts) and the built-in
 * bubble become one entry of assets/<modid>/bubbles.json ("styles"), with their images copied under
 * textures/bubble/. The old icon blocks show the built-in bubble ("default"; a bubble element with that id replaces it)
 * with an icon from textures/bubbles/<icon>.png (file name = icon id, [a-z0-9_]); "icons" lists the animated ones with their frames (Q229: order, times, playback mode).
 *
 * Server: <Mod>Bubbles keeps one bubble per player (style, icon, caption) until its time runs out, it is cleared, or the
 * player logs out or dies, and sends each dimension's clients its players' bubbles when they change and once a second.
 *
 * Client: <Mod>BubbleRender reads the same JSON and draws any bubble from it, facing the camera above the player's head
 * or name tag: background (stretched or 9-slice), icon, caption, show/hide animation. Hooks: forge-1.16.5
 * RenderNameplateEvent, NeoForge RenderLivingEvent.Post, Fabric a mixin at the end of LivingEntityRenderer.render
 * (1.21.5) / submit (26.3).
 */

export const BUBBLE_DIR = "textures/bubbles";
const ICON_ID = /^[a-z0-9_]+$/;
/** Where the mod's bubbles.json sits under src/main/resources. */
export const bubbleDataPath = (modId: string) => `assets/${modId}/bubbles.json`;

/** Icon ids of a project: its textures/bubbles/<id>.png files. */
export function bubbleIcons(projectDir: string): string[] {
  const dir = join(projectDir, BUBBLE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).filter((id) => ICON_ID.test(id)).sort();
}

/** An image of a bubble: its texture id and one frame's size; a strip of square frames animates. */
export interface BubbleImage {
  id: string;
  width: number;
  height: number;
  frames: number;
  /** Ticks per frame. */
  time: number;
  /** The frames it plays, [frame, ticks] each, with its playback mode applied (Q229); empty: every frame in order. */
  seq: [number, number][];
  /** Frame a once mode stays on after one pass (Q229), -1: loops. */
  hold: number;
}

/** Frames of an image: one taller than wide is a strip of square frames, top to bottom, like a block texture. */
const frameCount = (width: number, height: number) => (height > width && height % width === 0 ? height / width : 1);

/** Ticks per frame of an animated image: `frametime` of its .png.mcmeta, 1 by default. */
function frameTime(png: string): number {
  const meta = `${png}.mcmeta`;
  if (!existsSync(meta)) return 1;
  const time = Number(JSON.parse(readFileSync(meta, "utf8"))?.animation?.frametime ?? 1);
  return Number.isInteger(time) && time > 0 ? time : 1;
}

/** Reads a project PNG as an image written to textures/<to>.png of the mod (bubbles, radial menus). */
export function projectImage(file: string, modId: string, to: string): { image: BubbleImage; bytes: Buffer } {
  const bytes = readFileSync(file);
  const { width, height } = readPng(bytes);
  const frames = frameCount(width, height);
  const image: BubbleImage = { id: `${modId}:textures/${to}.png`, width, height: height / frames, frames, time: frames > 1 ? frameTime(file) : 1, seq: [], hold: -1 };
  // The .mcmeta's own frame order and times, and its playback mode (Q229: ping-pong, play once and hold a frame).
  const meta = `${file}.mcmeta`;
  const schedule = frames > 1 && existsSync(meta) ? animationSchedule(readFileSync(meta, "utf8"), width, height) : undefined;
  if (schedule && schedule.frameWidth === width && schedule.frameCount === frames) {
    image.seq = schedule.frames.map((f): [number, number] => [f.index, f.time]);
    image.hold = schedule.hold ?? -1;
  }
  return { image, bytes };
}

/** The data fields of an animated image (<prefix>Frames, <prefix>Time, <prefix>Seq, <prefix>Hold); `<Mod>Transitions.Frames.of` reads them. */
export function framesJson(prefix: string, image: BubbleImage | undefined): Record<string, unknown> {
  return { [`${prefix}Frames`]: image?.frames ?? 1, [`${prefix}Time`]: image?.time ?? 1, ...(image?.seq.length ? { [`${prefix}Seq`]: image.seq, [`${prefix}Hold`]: image.hold } : {}) };
}

/** One entry of bubbles.json "styles": what <Mod>Bubbles.Style reads. */
function styleJson(bubble: object, background: BubbleImage | undefined, icon: BubbleImage | undefined): Record<string, unknown> {
  const layout = bubbleLayout(bubble);
  const values = bubble as Record<string, unknown>;
  return {
    width: layout.width, height: layout.height,
    background: background?.id ?? "", backgroundWidth: background?.width ?? 1, backgroundHeight: background?.height ?? 1,
    ...framesJson("background", background), slice: layout.slice,
    icon: icon?.id ?? "", ...framesJson("icon", icon),
    iconX: layout.iconX, iconY: layout.iconY, iconSize: layout.iconSize,
    caption: str(values.caption), color: bubbleColor(values.captionColor), shadow: values.captionShadow === true,
    captionScale: layout.captionScale, scale: layout.scale, offset: layout.offset,
    timing: timingJson(layout.timing), sound: str(values.sound),
  };
}

/**
 * Bubble outputs of a project: images to write under the mod's textures/ (`to` without .png), bubbles.json and the
 * images it could not read. Nothing when the project has neither bubble icons nor bubble elements, unless `used` (the
 * mod has the bubble runtime, which reads the built-in bubble from bubbles.json).
 */
export function bubbleOutputs(env: GenEnv, used = false): { images: { to: string; bytes: Buffer }[]; json?: string; problems: string[] } {
  const { projectDir, modId } = env;
  const elements: Element[] = env.generated.bubble ?? [];
  const icons = bubbleIcons(projectDir);
  if (!elements.length && !icons.length && !used) return { images: [], problems: [] };
  const images: { to: string; bytes: Buffer }[] = [];
  const problems: string[] = [];
  const read = (file: string, to: string, label: string): BubbleImage | undefined => {
    try {
      const { image, bytes } = projectImage(file, modId, to);
      images.push({ to, bytes });
      return image;
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      return undefined;
    }
  };
  // The built-in speech bubble, the background of the built-in bubble and of bubble elements without their own.
  const builtIn = speechBubble();
  images.push({ to: "bubble/default", bytes: writePng(builtIn) });
  const speech: BubbleImage = { id: `${modId}:textures/bubble/default.png`, width: builtIn.width, height: builtIn.height, frames: 1, time: 1, seq: [], hold: -1 };
  const styles: Record<string, unknown> = { [DEFAULT_BUBBLE]: styleJson(BUILT_IN_BUBBLE, speech, undefined) };
  for (const bubble of elements) {
    // The element's own images, copied to textures/bubble/<id>_<part>.png; an unreadable one is left out.
    const own = (key: "background" | "icon") => (str(bubble[key]) ? read(resolve(projectDir, str(bubble[key])), `bubble/${bubble.id}_${key}`, `bubble/${bubble.id}: ${str(bubble[key])}`) : undefined);
    styles[bubble.id] = styleJson(bubble, str(bubble.background) ? own("background") : speech, own("icon"));
  }
  // Icons of the old blocks: copied as they are; the animated ones are listed with [frames, ticks per frame].
  const animated: Record<string, Record<string, unknown>> = {};
  for (const id of icons) {
    const image = read(join(projectDir, BUBBLE_DIR, `${id}.png`), `bubbles/${id}`, `${BUBBLE_DIR}/${id}.png`);
    if (image && image.frames > 1) animated[id] = framesJson("", image);
  }
  return { images, json: `${JSON.stringify({ styles, icons: animated }, null, 2)}\n`, problems };
}

export const BUBBLE_SEGMENT = "BubbleSync";
const bubblesClass = (env: ProcEnv) => `${env.pkg}.procedures.${env.modClass}Bubbles`;
const renderClass = (env: ProcEnv) => `${env.pkg}.procedures.client.${env.modClass}BubbleRender`;

/** Whether procedure sources call <Mod>Bubbles (bubble blocks). */
export const usesBubbles = (env: ProcEnv, sources: string[]) => sources.some((s) => s.includes(`${env.modClass}Bubbles.`));

/** The packet carrying a dimension's bubbles (records "<entity id> <style> <icon> <caption>"). */
export const bubbleSegment = (env: ProcEnv): Segment =>
  ({ name: BUBBLE_SEGMENT, path: "bubbles", direction: "toClient", fields: [{ name: "data", type: "text" }], method: "receive", owner: bubblesClass(env) });

/** Server tick listener statement for the mod's procedure registration. */
export function bubbleTick(env: ProcEnv): string {
  const tick = `${bubblesClass(env)}.tick`;
  if (env.loader === "neoforge") return `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.tick.ServerTickEvent.Post.class, event -> ${tick}(event.getServer()));`;
  if (env.loader === "forge") return `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.TickEvent.ServerTickEvent.class, event -> {
if (event.phase == net.minecraftforge.event.TickEvent.Phase.END) ${tick}(net.minecraftforge.fml.server.ServerLifecycleHooks.getCurrentServer());
});`;
  return `net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(${bubblesClass(env)}::tick);`;
}

/** Client init statement registering the renderer's listener; Fabric draws from a mixin (bubbleRenderMixin) instead. */
export const bubbleClientInit = (env: ProcEnv): string[] => (env.loader === "fabric" ? [] : [`${renderClass(env)}.register();`]);

/** Java names of the store per generation. */
function storeNames(env: ProcEnv) {
  const legacy = env.gen === "1.16.5";
  const id = (expr: string) => (legacy ? `new net.minecraft.util.ResourceLocation(${expr})` : env.gen === "26.3" ? `net.minecraft.resources.Identifier.parse(${expr})` : `net.minecraft.resources.ResourceLocation.parse(${expr})`);
  return legacy
    ? {
      Entity: "net.minecraft.entity.Entity", ServerPlayer: "net.minecraft.entity.player.ServerPlayerEntity", ServerLevel: "net.minecraft.world.server.ServerWorld", Level: "net.minecraft.world.World",
      server: "player.getServer()", level: "player.level",
      sound: (expr: string) => `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${id(expr)})`, SoundEvent: "net.minecraft.util.SoundEvent", source: "net.minecraft.util.SoundCategory.PLAYERS",
      parse: "new com.google.gson.JsonParser().parse", logger: `org.apache.logging.log4j.LogManager.getLogger(${JSON.stringify(env.modId)})`,
    }
    : {
      Entity: "net.minecraft.world.entity.Entity", ServerPlayer: "net.minecraft.server.level.ServerPlayer", ServerLevel: "net.minecraft.server.level.ServerLevel", Level: "net.minecraft.world.level.Level",
      server: "player.level().getServer()", level: "player.level()",
      sound: (expr: string) => `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${id(expr)})`, SoundEvent: "net.minecraft.sounds.SoundEvent", source: "net.minecraft.sounds.SoundSource.PLAYERS",
      parse: "com.google.gson.JsonParser.parseReader", logger: "com.mojang.logging.LogUtils.getLogger()",
    };
}

export function bubblesSource(env: ProcEnv): JavaSource {
  const cls = `${env.modClass}Bubbles`;
  const network = `${env.pkg}.procedures.${env.modClass}Network`;
  const N = storeNames(env);
  const T = `${env.pkg}.procedures.${env.modClass}Transitions`;
  return {
    path: `${env.pkg.replaceAll(".", "/")}/procedures/${cls}.java`,
    code: `package ${env.pkg}.procedures;

/**
 * Generated by MCEdge: status bubbles above players (Q206, Q216). The server keeps one per player until its time runs
 * out, it is cleared, or the player logs out or dies; each dimension's clients get the bubbles of its players when they
 * change and once a second. How each bubble looks is data: assets/${env.modId}/bubbles.json, read by Style.
 */
public final class ${cls} {
    private ${cls}() {}

    /** Id of the bubble the icon blocks show (the built-in one, or the project's bubble element "default"). */
    public static final String DEFAULT = ${JSON.stringify(DEFAULT_BUBBLE)};

    /** The look of one bubble: an entry of bubbles.json "styles", sizes and positions in bubble pixels. */
    public static final class Style {
        public final int width, height, slice, backgroundWidth, backgroundHeight;
        public final int iconX, iconY, iconSize, color, duration;
        public final String background, icon, caption, sound;
        public final boolean shadow;
        public final float captionScale, scale, offset;
        /** Frames the background and the icon play (Q229: order, times and playback mode of their .png.mcmeta). */
        public final ${T}.Frames backgroundFrames, iconFrames;
        /** How the bubble shows and hides (Q228); \`duration\` is its active time. */
        public final ${T}.Timing timing;

        Style(com.google.gson.JsonObject o) {
            width = number(o, "width", 32); height = number(o, "height", 32); slice = number(o, "slice", 0);
            background = text(o, "background"); backgroundWidth = Math.max(1, number(o, "backgroundWidth", 1)); backgroundHeight = Math.max(1, number(o, "backgroundHeight", 1));
            backgroundFrames = ${T}.Frames.of(o, "background");
            icon = text(o, "icon"); iconFrames = ${T}.Frames.of(o, "icon");
            iconX = number(o, "iconX", 0); iconY = number(o, "iconY", 0); iconSize = number(o, "iconSize", 0);
            caption = text(o, "caption"); color = number(o, "color", 0xFFFFFF); shadow = o.has("shadow") && o.get("shadow").getAsBoolean();
            captionScale = (float) decimal(o, "captionScale", 1); scale = (float) decimal(o, "scale", 1); offset = (float) decimal(o, "offset", 0);
            timing = new ${T}.Timing(o.has("timing") ? o.getAsJsonObject("timing") : null); duration = timing.active; sound = text(o, "sound");
        }

        private static int number(com.google.gson.JsonObject o, String key, int fallback) {
            return o.has(key) ? o.get(key).getAsInt() : fallback;
        }

        private static double decimal(com.google.gson.JsonObject o, String key, double fallback) {
            return o.has(key) ? o.get(key).getAsDouble() : fallback;
        }

        private static String text(com.google.gson.JsonObject o, String key) {
            return o.has(key) ? o.get(key).getAsString() : "";
        }
    }

    private static java.util.Map<String, Style> styles;
    /** Animated icons of the icon blocks: icon id -> {frames, ticks per frame}. */
    private static final java.util.Map<String, ${T}.Frames> ICON_FRAMES = new java.util.HashMap<>();

    /** The bubbles of bubbles.json, read once (from the mod's own jar, on the server and on the client). */
    private static synchronized java.util.Map<String, Style> styles() {
        if (styles != null) return styles;
        styles = new java.util.HashMap<>();
        try (java.io.InputStream in = ${cls}.class.getResourceAsStream(${JSON.stringify(`/${bubbleDataPath(env.modId)}`)})) {
            if (in == null) throw new java.io.FileNotFoundException(${JSON.stringify(bubbleDataPath(env.modId))});
            com.google.gson.JsonObject root = ${N.parse}(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            for (java.util.Map.Entry<String, com.google.gson.JsonElement> entry : root.getAsJsonObject("styles").entrySet()) styles.put(entry.getKey(), new Style(entry.getValue().getAsJsonObject()));
            for (java.util.Map.Entry<String, com.google.gson.JsonElement> entry : root.getAsJsonObject("icons").entrySet()) {
                ICON_FRAMES.put(entry.getKey(), ${T}.Frames.of(entry.getValue().getAsJsonObject(), ""));
            }
        } catch (Exception e) {
            ${N.logger}.error("Bubbles could not be read", e);
        }
        return styles;
    }

    /** The look of bubble \`id\`; the default bubble for "" or an id the mod does not have, null when none could be read. */
    public static Style style(String id) {
        Style style = styles().get(id);
        return style != null ? style : styles().get(DEFAULT);
    }

    /** The frames an animated icon of the icon blocks or a runtime icon plays, null when it is still. */
    public static ${T}.Frames iconFrames(String icon) {
        styles();
        RuntimeIcon runtime = RUNTIME_ICONS.get(icon);
        return runtime != null ? runtime.frames : ICON_FRAMES.get(icon);
    }

    /** Client side: an icon id whose image is a texture made at runtime (Q227: runtime image folders). */
    private static final class RuntimeIcon {
        final String texture;
        final ${T}.Frames frames;

        RuntimeIcon(String texture, int frames, int time) {
            this.texture = texture;
            this.frames = ${T}.Frames.still(frames, time);
        }
    }

    private static final java.util.Map<String, RuntimeIcon> RUNTIME_ICONS = new java.util.HashMap<>();

    /** Client side: icon \`icon\` draws texture \`texture\` (a full id), a strip of \`frames\` frames of \`time\` ticks; null texture removes it. */
    public static void registerIcon(String icon, String texture, int frames, int time) {
        if (texture == null) RUNTIME_ICONS.remove(icon);
        else RUNTIME_ICONS.put(icon, new RuntimeIcon(texture, Math.max(1, frames), Math.max(1, time)));
    }

    /** The texture (a full id) of an icon id: a runtime icon's, else the project's textures/bubbles/<icon>.png. */
    public static String iconTexture(String icon) {
        RuntimeIcon runtime = RUNTIME_ICONS.get(icon);
        return runtime != null ? runtime.texture : ${JSON.stringify(`${env.modId}:textures/bubbles/`)} + icon + ".png";
    }

    private static final class Bubble {
        /** Bubble element id, "" for the icon blocks' default bubble. */
        final String style;
        /** Icon id of the icon blocks (textures/bubbles/<icon>.png), "" for the bubble's own icon. */
        final String icon;
        /** Caption drawn over the bubble, "" none. */
        final String text;
        /** Server tick it ends at, -1: until cleared. */
        final long until;

        Bubble(String style, String icon, String text, long until) {
            this.style = style;
            this.icon = icon;
            this.text = text;
            this.until = until;
        }
    }

    private static final java.util.Map<java.util.UUID, Bubble> BUBBLES = new java.util.HashMap<>();
    private static boolean changed;
    private static int ticks;

    /** Shows the default bubble with \`icon\` (textures/bubbles/<icon>.png) above a player for \`duration\` ticks, 0 or less: until cleared. */
    public static void show(${N.Entity} entity, String icon, double duration) {
        show(entity, icon, "", duration);
    }

    /** Like show, with \`text\` (a name, a short line) drawn above the bubble. */
    public static void show(${N.Entity} entity, String icon, String text, double duration) {
        if (icon == null || icon.isEmpty()) return;
        put(entity, new Bubble("", icon, clean(text), 0L), (long) duration);
    }

    /**
     * Shows bubble element \`bubble\` above a player. \`caption\` fills the bubble's {text}, or replaces its caption when it
     * has none; \`duration\` ticks, 0: until cleared, below 0: the bubble's own duration. Plays the bubble's sound.
     */
    public static void showBubble(${N.Entity} entity, String bubble, String caption, double duration) {
        String id = bubble == null || bubble.isEmpty() ? DEFAULT : bubble;
        Style style = style(id);
        if (style == null) return;
        String passed = caption == null ? "" : caption;
        String text = style.caption.contains("{text}") ? style.caption.replace("{text}", passed) : passed.isEmpty() ? style.caption : passed;
        if (put(entity, new Bubble(id, "", clean(text), 0L), duration < 0 ? style.duration : (long) duration) && !style.sound.isEmpty()) sound((${N.ServerPlayer}) entity, style.sound);
    }

    /** Keeps \`bubble\` for a player for \`duration\` ticks (0 or less: until cleared); false when the entity is not a player on a server. */
    private static boolean put(${N.Entity} entity, Bubble bubble, long duration) {
        if (!(entity instanceof ${N.ServerPlayer})) return false;
        ${N.ServerPlayer} player = (${N.ServerPlayer}) entity;
        if (${N.server} == null) return false;
        long now = ${N.server}.getTickCount();
        BUBBLES.put(player.getUUID(), new Bubble(bubble.style, bubble.icon, bubble.text, duration > 0 ? now + duration : -1L));
        changed = true;
        return true;
    }

    private static void sound(${N.ServerPlayer} player, String id) {
        try {
            ${N.SoundEvent} sound = ${N.sound("id")};
            if (sound != null) ${N.level}.playSound(null, player.getX(), player.getY(), player.getZ(), sound, ${N.source}, 1.0F, 1.0F);
        } catch (RuntimeException e) {
            // A malformed sound id plays nothing.
        }
    }

    /** The separators of the packet cannot be in a caption. */
    private static String clean(String text) {
        return text == null ? "" : text.replace(FIELD, ' ').replace(RECORD, ' ');
    }

    private static final char FIELD = '\\u001f', RECORD = '\\u001e';

    /** Removes a player's bubble. */
    public static void clear(${N.Entity} entity) {
        if (entity instanceof ${N.ServerPlayer} && BUBBLES.remove(entity.getUUID()) != null) changed = true;
    }

    /** The icon of a player's bubble on the server (the bubble element id for a bubble element), "" without one. */
    public static String icon(${N.Entity} entity) {
        Bubble bubble = entity == null ? null : BUBBLES.get(entity.getUUID());
        return bubble == null ? "" : bubble.icon.isEmpty() ? bubble.style : bubble.icon;
    }

    /** End of every server tick: drops ended bubbles and sends each dimension's when they changed, else once a second. */
    public static void tick(net.minecraft.server.MinecraftServer server) {
        if (server == null) return;
        long now = server.getTickCount();
        java.util.Iterator<java.util.Map.Entry<java.util.UUID, Bubble>> it = BUBBLES.entrySet().iterator();
        while (it.hasNext()) {
            java.util.Map.Entry<java.util.UUID, Bubble> entry = it.next();
            ${N.ServerPlayer} player = server.getPlayerList().getPlayer(entry.getKey());
            if (player == null || !player.isAlive() || entry.getValue().until >= 0 && now >= entry.getValue().until) {
                it.remove();
                changed = true;
            }
        }
        ticks++;
        if (!changed && ticks % 20 != 0) return;
        boolean send = changed;
        changed = false;
        for (${N.ServerLevel} level : server.getAllLevels()) {
            StringBuilder data = new StringBuilder();
            for (${N.ServerPlayer} player : level.players()) {
                Bubble bubble = BUBBLES.get(player.getUUID());
                if (bubble != null) data.append(player.getId()).append(FIELD).append(bubble.style).append(FIELD).append(bubble.icon).append(FIELD).append(bubble.text).append(RECORD);
            }
            if (send || data.length() > 0) ${network}.toClients(level, new ${network}.${BUBBLE_SEGMENT}(data.toString()));
        }
    }

    /** Client side: a bubble above an entity. */
    public static final class Shown {
        public final String style, icon, text;
        /** Client game time it appeared, or started to go when \`leaving\`. */
        public final long since;
        /** Client game time it appeared (kept while it leaves: a once-playing image does not restart). */
        public final long born;
        /** Removed on the server: drawn while its disappear transition plays. */
        public final boolean leaving;

        Shown(String style, String icon, String text, long since, long born, boolean leaving) {
            this.style = style;
            this.icon = icon;
            this.text = text;
            this.since = since;
            this.born = born;
            this.leaving = leaving;
        }

        boolean same(String style, String icon, String text) {
            return !leaving && this.style.equals(style) && this.icon.equals(icon) && this.text.equals(text);
        }
    }

    // Client side: the bubbles of the players in the client's dimension, by entity id.
    private static final java.util.Map<Integer, Shown> SHOWN = new java.util.HashMap<>();

    /** Client side: the bubbles of the dimension, records "<entity id> <style> <icon> <text>" (separated by FIELD, RECORD). */
    public static void receive(${N.Level} level, String data) {
        long now = level.getGameTime();
        java.util.Map<Integer, Shown> next = new java.util.HashMap<>();
        for (String part : data.split(String.valueOf(RECORD))) {
            String[] fields = part.split(String.valueOf(FIELD), -1);
            if (fields.length < 4) continue;
            try {
                int id = Integer.parseInt(fields[0]);
                Shown old = SHOWN.get(id);
                next.put(id, old != null && old.same(fields[1], fields[2], fields[3]) ? old : new Shown(fields[1], fields[2], fields[3], now, now, false));
            } catch (NumberFormatException e) {
                // A malformed entry is skipped.
            }
        }
        // Bubbles that went play their disappear transition first.
        for (java.util.Map.Entry<Integer, Shown> entry : SHOWN.entrySet()) {
            Shown old = entry.getValue();
            Style style = style(old.style);
            int length = style == null ? 0 : style.timing.disappear.length();
            if (next.containsKey(entry.getKey()) || length == 0) continue;
            if (!old.leaving) next.put(entry.getKey(), new Shown(old.style, old.icon, old.text, now, old.born, true));
            else if (now - old.since < length) next.put(entry.getKey(), old);
        }
        SHOWN.clear();
        SHOWN.putAll(next);
    }

    /** Client side: the bubble above the entity with this id, null without one. */
    public static Shown shown(int entityId) {
        return SHOWN.get(entityId);
    }

    /** {alpha, scale, offset} of a bubble at client time \`time\` (game time plus partial tick), from its appear or disappear transition (Q228). */
    public static float[] state(Shown shown, Style style, float time) {
        return shown.leaving ? style.timing.leaving(time - shown.since) : style.timing.appearing(time - shown.since);
    }

    /** {first v, last v} of the frame of an image's strip shown at game time \`gameTime\`; a once mode counts from when the bubble appeared. */
    public static float[] frame(${T}.Frames frames, Shown shown, long gameTime) {
        return frames.v(frames.once() ? gameTime - shown.born : gameTime);
    }
}
`,
  };
}

/** Java names of the client renderer per generation. */
function renderNames(env: ProcEnv) {
  if (env.gen === "1.16.5") {
    return {
      Pose: "com.mojang.blaze3d.matrix.MatrixStack", Buffers: "net.minecraft.client.renderer.IRenderTypeBuffer", Matrix: "net.minecraft.util.math.vector.Matrix4f",
      Vertex: "com.mojang.blaze3d.vertex.IVertexBuilder", partial: "mc.getFrameTime()", rotate: "pose.mulPose(mc.getEntityRenderDispatcher().cameraOrientation());",
      vertex: "b.vertex(m, x, y, z).color(255, 255, 255, alpha).uv(u, v).uv2(FULL_BRIGHT).endVertex();",
    };
  }
  const v26 = env.gen === "26.3";
  return {
    Pose: "com.mojang.blaze3d.vertex.PoseStack", Buffers: v26 ? "net.minecraft.client.renderer.SubmitNodeCollector" : "net.minecraft.client.renderer.MultiBufferSource", Matrix: "org.joml.Matrix4f",
    Vertex: "com.mojang.blaze3d.vertex.VertexConsumer", partial: "mc.getDeltaTracker().getGameTimeDeltaPartialTick(false)",
    rotate: v26 ? "pose.rotate(mc.getEntityRenderDispatcher().camera.rotation());" : "pose.mulPose(mc.getEntityRenderDispatcher().cameraOrientation());",
    vertex: "b.addVertex(m, x, y, z).setColor(255, 255, 255, alpha).setUv(u, v).setLight(FULL_BRIGHT);",
  };
}

/** The textured quad and the caption: the only drawing that differs between generations. */
function drawingMethods(env: ProcEnv): string {
  const R = renderNames(env);
  const corners = "        vertex(b, m, x0, y1, z, u0, v1, alpha);\n        vertex(b, m, x1, y1, z, u1, v1, alpha);\n        vertex(b, m, x1, y0, z, u1, v0, alpha);\n        vertex(b, m, x0, y0, z, u0, v0, alpha);";
  // Both windings, so a quad shows whichever way the render type culls.
  const both = `${corners}\n${corners.split("\n").reverse().join("\n")}`;
  const quadHead = `    /** A texture (a full id) over x0..x1, y0..y1 at depth z, from u0, v0 to u1, v1, full bright. */
    private static void quad(${R.Pose} pose, ${R.Buffers} buffers, String texture, float x0, float y0, float x1, float y1, float z, float u0, float v0, float u1, float v1, int alpha) {`;
  const vertex = `    private static void vertex(${R.Vertex} b, ${R.Matrix} m, float x, float y, float z, float u, float v, int alpha) {
        ${R.vertex}
    }`;
  if (env.gen === "1.16.5") {
    return `${quadHead}
        ${R.Matrix} m = pose.last().pose();
        ${R.Vertex} b = buffers.getBuffer(net.minecraft.client.renderer.RenderType.text(new net.minecraft.util.ResourceLocation(texture)));
${both}
    }

${vertex}

    /** \`text\` centred at x, its top at y, \`size\` bubble pixels per font pixel. */
    private static void text(${R.Pose} pose, ${R.Buffers} buffers, String text, float x, float y, float size, int color, boolean shadow, int background, int light) {
        pose.pushPose();
        pose.translate(x, y, CAPTION_Z);
        pose.scale(size, size, 1.0F);
        net.minecraft.client.gui.FontRenderer font = net.minecraft.client.Minecraft.getInstance().font;
        font.drawInBatch(text, -font.width(text) / 2.0F, 0.0F, color, shadow, pose.last().pose(), buffers, false, background, light);
        pose.popPose();
    }`;
  }
  if (env.gen === "26.3") {
    return `${quadHead}
        buffers.submitCustomGeometry(pose, net.minecraft.client.renderer.rendertype.RenderTypes.text(net.minecraft.resources.Identifier.parse(texture)), (entry, b) -> {
        ${R.Matrix} m = entry.pose();
${both}
        });
    }

${vertex}

    /** \`text\` centred at x, its top at y, \`size\` bubble pixels per font pixel. */
    private static void text(${R.Pose} pose, ${R.Buffers} buffers, String text, float x, float y, float size, int color, boolean shadow, int background, int light) {
        pose.pushPose();
        pose.translate(x, y, CAPTION_Z);
        pose.scale(size, size, 1.0F);
        net.minecraft.client.gui.Font font = net.minecraft.client.Minecraft.getInstance().font;
        buffers.submitText(pose, -font.width(text) / 2.0F, 0.0F, net.minecraft.network.chat.Component.literal(text).getVisualOrderText(), shadow, net.minecraft.client.gui.Font.DisplayMode.NORMAL, light, color, background, 0);
        pose.popPose();
    }`;
  }
  return `${quadHead}
        ${R.Matrix} m = pose.last().pose();
        ${R.Vertex} b = buffers.getBuffer(net.minecraft.client.renderer.RenderType.text(net.minecraft.resources.ResourceLocation.parse(texture)));
${both}
    }

${vertex}

    /** \`text\` centred at x, its top at y, \`size\` bubble pixels per font pixel. */
    private static void text(${R.Pose} pose, ${R.Buffers} buffers, String text, float x, float y, float size, int color, boolean shadow, int background, int light) {
        pose.pushPose();
        pose.translate(x, y, CAPTION_Z);
        pose.scale(size, size, 1.0F);
        net.minecraft.client.gui.Font font = net.minecraft.client.Minecraft.getInstance().font;
        font.drawInBatch(text, -font.width(text) / 2.0F, 0.0F, color, shadow, pose.last().pose(), buffers, net.minecraft.client.gui.Font.DisplayMode.NORMAL, background, light);
        pose.popPose();
    }`;
}

/** Where the renderer hooks into entity drawing, and the entry it calls with the pose at the entity's feet. */
function hookMethods(env: ProcEnv): string {
  const cls = `${env.modClass}BubbleRender`;
  const R = renderNames(env);
  if (env.gen === "1.16.5") {
    return `    public static void register() {
        net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.RenderNameplateEvent.class, ${cls}::render);
    }

    /** Fired for every entity drawn, whether its name tag shows or not. */
    private static void render(net.minecraftforge.client.event.RenderNameplateEvent event) {
        net.minecraft.entity.Entity entity = event.getEntity();
        if (!(entity instanceof net.minecraft.entity.player.PlayerEntity) || entity.isInvisible() || entity.isDiscrete()) return;
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        boolean nameShown = event.getResult() != net.minecraftforge.eventbus.api.Event.Result.DENY && net.minecraft.client.Minecraft.renderNames() && entity != mc.getCameraEntity() && mc.getEntityRenderDispatcher().distanceToSqr(entity) <= 4096.0D;
        draw(event.getMatrixStack(), event.getRenderTypeBuffer(), entity.getBbHeight(), nameShown, entity.getId(), event.getPackedLight());
    }`;
  }
  const v26 = env.gen === "26.3";
  const entry = `    /** After a living entity is drawn, the pose back at its feet: draws a player's bubble. */
    public static void render(net.minecraft.client.renderer.entity.state.LivingEntityRenderState state, ${R.Pose} pose, ${R.Buffers} buffers, int light) {
        if (!(state instanceof net.minecraft.client.renderer.entity.state.${v26 ? "AvatarRenderState" : "PlayerRenderState"}) || state.isInvisible || state.isDiscrete) return;
        draw(pose, buffers, state.boundingBoxHeight, state.nameTag != null, ((net.minecraft.client.renderer.entity.state.${v26 ? "AvatarRenderState" : "PlayerRenderState"}) state).id, light);
    }`;
  if (env.loader === "fabric") return entry;
  return `    public static void register() {
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.client.event.RenderLivingEvent.Post.class, event ->
            render(event.getRenderState(), event.getPoseStack(), ${v26 ? "event.getSubmitNodeCollector(), event.getRenderState().lightCoords" : "event.getMultiBufferSource(), event.getPackedLight()"}));
    }

${entry}`;
}

/** The client renderer: draws any bubble of bubbles.json above a player, the same code for every bubble. */
export function bubbleRenderSource(env: ProcEnv): JavaSource {
  const cls = `${env.modClass}BubbleRender`;
  const B = bubblesClass(env);
  const T = `${env.pkg}.procedures.${env.modClass}Transitions`;
  const R = renderNames(env);
  const legacy = env.gen === "1.16.5";
  return {
    path: `${env.pkg.replaceAll(".", "/")}/procedures/client/${cls}.java`,
    code: `package ${env.pkg}.procedures.client;

/**
 * Generated by MCEdge: draws status bubbles (Q206, Q216) above players, facing the camera. Every bubble is drawn by the
 * same code from its data (${env.modClass}Bubbles.Style, assets/${env.modId}/bubbles.json), in bubble pixels: the bubble's
 * bottom middle sits OVER_NAME above the player's height when the name tag shows, else OVER_HEAD, plus its offset. It
 * appears and goes with its transitions (${env.modClass}Transitions: fade, scale, slide).
 */
public final class ${cls} {
    private ${cls}() {}

    private static final int FULL_BRIGHT = 15728880;
    /**
     * Lift of the bubble's bottom over the player's height (Q217, Q223; values shared with the editor preview from
     * bubbleLayout.ts): on the top of the name tag's box (drawn from 0.5 over the height down) or, without one, just over
     * the head.
     */
    private static final double OVER_NAME = ${OVER_NAME}D, OVER_HEAD = ${OVER_HEAD}D;
    /** Blocks per bubble pixel at scale 1, and bubble pixels per font pixel at caption scale 1 (name-tag size). */
    private static final float PIXEL = ${BUBBLE_PIXEL_BLOCKS}F, CAPTION = ${Math.round(CAPTION_PIXELS * 1e6) / 1e6}F;
    /** Mirrors x so textures and text read left to right, as the game's name tags do in this version. */
    private static final float MIRROR = ${legacy ? "-1.0F" : "1.0F"};
    /** Depths in bubble pixels, toward the camera: the icon over the background, the caption over both. */
    private static final float ICON_Z = ${legacy ? "-0.5F" : "0.5F"}, CAPTION_Z = ${legacy ? "-1.0F" : "1.0F"};

${hookMethods(env)}

    /** Draws the bubble of entity \`entityId\` above an entity of height \`height\`; \`pose\` stands at the entity's feet. */
    private static void draw(${R.Pose} pose, ${R.Buffers} buffers, float height, boolean nameShown, int entityId, int light) {
        ${B}.Shown shown = ${B}.shown(entityId);
        ${B}.Style style = shown == null ? null : ${B}.style(shown.style);
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (style == null || mc.level == null) return;
        long gameTime = mc.level.getGameTime();
        // The appear / disappear transition (Q228): alpha, size and a slide (a fraction of the bubble's height).
        float[] state = ${B}.state(shown, style, gameTime + ${R.partial});
        int alpha = Math.round(255.0F * state[0]);
        if (alpha <= 0 || state[1] <= 0.0F) return;
        float k = PIXEL * style.scale * state[1];
        pose.pushPose();
        pose.translate(0.0D, height + (nameShown ? OVER_NAME : OVER_HEAD) + style.offset + state[2] * style.height * PIXEL * style.scale, 0.0D);
        ${R.rotate}
        // Bubble pixels from here: x right, y down, the bubble's bottom middle at the lift point.
        pose.scale(MIRROR * k, -k, k);
        pose.translate(-style.width / 2.0F, -style.height, 0.0F);
        if (!style.background.isEmpty()) background(pose, buffers, shown, style, gameTime, alpha);
        String icon = shown.icon.isEmpty() ? style.icon : ${B}.iconTexture(shown.icon);
        ${T}.Frames frames = shown.icon.isEmpty() ? style.iconFrames : ${B}.iconFrames(shown.icon);
        if (!icon.isEmpty() && style.iconSize > 0) {
            float[] v = frames == null ? new float[] { 0.0F, 1.0F } : ${B}.frame(frames, shown, gameTime);
            quad(pose, buffers, icon, style.iconX, style.iconY, style.iconX + style.iconSize, style.iconY + style.iconSize, ICON_Z, 0.0F, v[0], 1.0F, v[1], alpha);
        }
        // The caption: just above the bubble, on a dim background like a name tag; too faint text is skipped.
        float captionSize = CAPTION * style.captionScale;
        if (!shown.text.isEmpty() && alpha > 12) text(pose, buffers, shown.text, style.width / 2.0F, -10.0F * captionSize, captionSize, alpha << 24 | style.color, style.shadow, Math.round(0x40 * alpha / 255.0F) << 24, light);
        pose.popPose();
    }

    /** The background: stretched over the bubble, or a 9-slice whose corners keep \`slice\` pixels. */
    private static void background(${R.Pose} pose, ${R.Buffers} buffers, ${B}.Shown shown, ${B}.Style style, long gameTime, int alpha) {
        float[] v = ${B}.frame(style.backgroundFrames, shown, gameTime);
        if (style.slice <= 0) {
            quad(pose, buffers, style.background, 0.0F, 0.0F, style.width, style.height, 0.0F, 0.0F, v[0], 1.0F, v[1], alpha);
            return;
        }
        float b = Math.min(style.slice, Math.min(style.width, style.height) / 2.0F);
        float bu = (float) style.slice / style.backgroundWidth, bv = (float) style.slice / style.backgroundHeight * (v[1] - v[0]);
        float[] xs = { 0.0F, b, style.width - b, style.width }, us = { 0.0F, bu, 1.0F - bu, 1.0F };
        float[] ys = { 0.0F, b, style.height - b, style.height }, vs = { v[0], v[0] + bv, v[1] - bv, v[1] };
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) quad(pose, buffers, style.background, xs[i], ys[j], xs[i + 1], ys[j + 1], 0.0F, us[i], vs[j], us[i + 1], vs[j + 1], alpha);
        }
    }

${drawingMethods(env)}
}
`,
  };
}

/** Fabric: a mixin calling the renderer after each living entity is drawn (Fabric has no such event). */
export function bubbleRenderMixin(env: ProcEnv): { id: string; code: string; client: boolean } {
  const at = "org.spongepowered.asm.mixin.injection";
  const v26 = env.gen === "26.3";
  const state = "Lnet/minecraft/client/renderer/entity/state/LivingEntityRenderState;Lcom/mojang/blaze3d/vertex/PoseStack;";
  const method = v26 ? `submit(${state}Lnet/minecraft/client/renderer/SubmitNodeCollector;Lnet/minecraft/client/renderer/state/level/CameraRenderState;)V`
    : `render(${state}Lnet/minecraft/client/renderer/MultiBufferSource;I)V`;
  const params = v26
    ? "net.minecraft.client.renderer.entity.state.LivingEntityRenderState state, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.SubmitNodeCollector collector, net.minecraft.client.renderer.state.level.CameraRenderState camera"
    : "net.minecraft.client.renderer.entity.state.LivingEntityRenderState state, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light";
  const id = "BubbleRenderMixin";
  return {
    id,
    client: true,
    code: `package ${env.pkg}.mixin;

/** Generated by MCEdge: draws status bubbles (Q216) after each living entity, the pose back at its feet. */
@org.spongepowered.asm.mixin.Mixin(net.minecraft.client.renderer.entity.LivingEntityRenderer.class)
public abstract class ${id} {
    @${at}.Inject(method = "${method}", at = @${at}.At("TAIL"))
    private void ${env.modId}$bubble(${params}, ${at}.callback.CallbackInfo info) {
        ${renderClass(env)}.render(state, pose, ${v26 ? "collector, state.lightCoords" : "buffers, light"});
    }
}
`,
  };
}
