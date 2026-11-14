import type { Element } from "../../elements/model.ts";
import { derivedConstant, jstr, str } from "../java.ts";
import { procedureCall } from "../procedures.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Key bindings: client-only key mappings in <Mod>KeyMappings, registered with the loader and polled every client
 * tick. Pressing and releasing the key run the procedures on the client with the local player; their server parts
 * reach the server through the procedure system's own packets. 26.x has spectator and debug categories; earlier
 * versions only offer the six vanilla ones (layer.json).
 */

/** GLFW key codes; mouse buttons are 0-2 with the MOUSE input type. */
const KEYS: Record<string, number> = {
  NONE: -1, ADD: 334, APOSTROPHE: 39, BACK: 259, BACKSLASH: 92, DECIMAL: 330, DELETE: 261, DIVIDE: 331, DOWN: 264, END: 269,
  EQUALS: 61, ESCAPE: 256, HOME: 268, INSERT: 260, LCONTROL: 341, LEFT: 263, LSHIFT: 340, LWIN: 343, MOUSELEFT: 0, MOUSERIGHT: 1,
  MOUSEMIDDLE: 2, MINUS: 45, NUMLOCK: 282, NUMPADCOMMA: 330, NUMPADENTER: 335, NUMPADEQUALS: 336, PERIOD: 46, RCONTROL: 345,
  ENTER: 257, RIGHT: 262, RSHIFT: 344, RWIN: 347, SCROLL: 281, SLASH: 47, SPACE: 32, TAB: 258, UP: 265,
};
function keyCode(key: string): number {
  if (key in KEYS) return KEYS[key];
  if (/^[0-9A-Z]$/.test(key)) return key.charCodeAt(0);
  const f = /^F(\d+)$/.exec(key);
  if (f) return 289 + Number(f[1]);
  const pad = /^NUMPAD(\d)$/.exec(key);
  if (pad) return 320 + Number(pad[1]);
  return -1;
}

function element(): ElementContext {
  return {};
}

function source(env: GenEnv, keys: ElementContext[]): { path: string; code: string } {
  const legacy = env.mc === "1.16.5";
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}KeyMappings`;
  const KM = legacy ? "net.minecraft.client.settings.KeyBinding" : "net.minecraft.client.KeyMapping";
  const input = legacy ? "net.minecraft.client.util.InputMappings" : "com.mojang.blaze3d.platform.InputConstants";
  const player = legacy ? "net.minecraft.client.entity.player.ClientPlayerEntity" : "net.minecraft.client.player.LocalPlayer";
  const deps = { x: "player.getX()", y: "player.getY()", z: "player.getZ()", world: legacy ? "player.level" : "player.level()", entity: "player" };
  const fields = keys.map((key) => {
    const name = str(key.triggerKey);
    const type = name.startsWith("MOUSE") ? "MOUSE" : env.mc === "26.3" ? "KEYBOARD" : "KEYSYM";
    const cat = str(key.keyBindingCategoryKey);
    const category = env.mc === "26.3" ? `${KM}.Category.${cat.toUpperCase()}` : jstr(`key.categories.${cat}`);
    return `    public static final ${KM} ${key.constant} = new ${KM}(${jstr(`key.${env.modId}.${key.id}`)}, ${input}.Type.${type}, ${keyCode(name)}, ${category});
    private static boolean ${derivedConstant(String(key.constant), "Down")};
    private static long ${derivedConstant(String(key.constant), "Pressed")};`;
  });
  const checks = keys.map((key) => {
    const pressed = procedureCall(env, "key_binding", key as unknown as Element, "onKeyPressed", deps);
    const released = procedureCall(env, "key_binding", key as unknown as Element, "onKeyReleased", deps);
    const c = key.constant;
    return `        boolean ${String(c).toLowerCase()} = ${c}.isDown();
        if (${String(c).toLowerCase()} != ${c}_DOWN) {
            ${c}_DOWN = ${String(c).toLowerCase()};
            if (${String(c).toLowerCase()}) {
                ${c}_PRESSED = System.currentTimeMillis();${pressed ? `\n                ${pressed};` : ""}
            }${released ? ` else {\n                ${released};\n            }` : ""}
        }`;
  });
  const all = keys.map((key) => key.constant);
  let register: string;
  if (legacy) {
    register = `    public static void register(net.minecraftforge.eventbus.api.IEventBus modBus) {
        modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent.class, event -> {
${all.map((c) => `            net.minecraftforge.fml.client.registry.ClientRegistry.registerKeyBinding(${c});`).join("\n")}
        });
        net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.TickEvent.ClientTickEvent.class, event -> {
            if (event.phase == net.minecraftforge.event.TickEvent.Phase.END) tick();
        });
    }`;
  } else if (env.loader === "neoforge") {
    register = `    public static void register(net.neoforged.bus.api.IEventBus modBus) {
        modBus.addListener(net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent.class, event -> {
${all.map((c) => `            event.register(${c});`).join("\n")}
        });
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.client.event.ClientTickEvent.Post.class, event -> tick());
    }`;
  } else {
    const helper = env.mc === "26.3" ? "net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper.registerKeyMapping" : "net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper.registerKeyBinding";
    register = `    public static void register() {
${all.map((c) => `        ${helper}(${c});`).join("\n")}
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(client -> tick());
    }`;
  }
  const code = `package ${pkg}.client;

/** Generated by MCEdge. Key bindings of this mod; client only. */
public final class ${cls} {
    private ${cls}() {}

${fields.join("\n")}

${register}

    private static void tick() {
        ${player} player = net.minecraft.client.Minecraft.getInstance().player;
        if (player == null) return;
${checks.join("\n")}
    }
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/client/${cls}.java`, code };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const src = source(env, contexts);
    const owner = `${env.project.mod.package}.client.${modClassName(env)}KeyMappings`;
    return { sources: [src], clientInit: [`${owner}.register(${env.loader === "fabric" ? "" : "modBus"});`] };
  },
} satisfies TypeModule;
