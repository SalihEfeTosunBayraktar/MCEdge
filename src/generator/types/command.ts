import type { Element } from "../../elements/model.ts";
import { jstr, str } from "../java.ts";
import { procedureCall } from "../procedures.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * Commands: <Mod>Commands registers each command with brigadier when the server builds its command tree. The
 * command takes an optional free text tail, or the typed arguments of `commandArguments` ("type:name" or, for
 * double and integer, "type:name:min" separated by spaces, all required); its argument program (`argsxml`, procedure IR compiled as procedure "command:<id>") runs on
 * the server with x, y, z, world, entity, `command` (the typed text), which the command word / number blocks read,
 * and `arguments` (the brigadier context, for Java code). Client-side commands (type CLIENTSIDE) run their program on the client with the
 * local player: NeoForge and Fabric register them with their client command events into <Mod>ClientCommands; Forge
 * 1.16.5 has no client commands, so the chat message is caught before it is sent and handled the same way.
 */

const ARGUMENT_TYPES: Record<string, (env: GenEnv, min: string) => string> = {
  word: () => "com.mojang.brigadier.arguments.StringArgumentType.word()",
  string: () => "com.mojang.brigadier.arguments.StringArgumentType.string()",
  greedy: () => "com.mojang.brigadier.arguments.StringArgumentType.greedyString()",
  double: (_env, min) => `com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg(${min})`,
  integer: (_env, min) => `com.mojang.brigadier.arguments.IntegerArgumentType.integer(${min})`,
  logic: () => "com.mojang.brigadier.arguments.BoolArgumentType.bool()",
  player: (env) => `${env.mc === "1.16.5" ? "net.minecraft.command.arguments" : "net.minecraft.commands.arguments"}.EntityArgument.player()`,
  entity: (env) => `${env.mc === "1.16.5" ? "net.minecraft.command.arguments" : "net.minecraft.commands.arguments"}.EntityArgument.entity()`,
};

/** The brigadier argument type for one "type:name[:min]" entry; a min that is not a number is ignored. */
export function argumentType(env: GenEnv, type: string, min = ""): string {
  return (ARGUMENT_TYPES[type] ?? ARGUMENT_TYPES.word)(env, min !== "" && Number.isFinite(Number(min)) ? min : "");
}

/** The command's arguments as a brigadier chain ending in `executes`, innermost last. */
function argumentChain(env: GenEnv, command: ElementContext, Commands: string, executes: string): string | undefined {
  const args = str(command.commandArguments).split(/\s+/).filter(Boolean).map((arg) => arg.split(":") as [string, string, string?]);
  if (!args.length) return undefined;
  return args.reduceRight((inner, [type, name, min]) => {
    const argument = `${Commands}.argument(${jstr(name)}, ${argumentType(env, type, min)})`;
    return `${argument}${inner ? `.then(${inner})` : `.executes(${executes})`}`;
  }, "");
}

const LEVELS_26: Record<string, string> = { "1": "LEVEL_MODERATORS", "2": "LEVEL_GAMEMASTERS", "3": "LEVEL_ADMINS", "4": "LEVEL_OWNERS" };

function element(): ElementContext {
  return {};
}

function requirement(env: GenEnv, command: ElementContext): string {
  const parts: string[] = [];
  const level = str(command.permissionLevel);
  if (LEVELS_26[level]) {
    parts.push(env.mc === "26.3" ? `net.minecraft.commands.Commands.hasPermission(net.minecraft.commands.Commands.${LEVELS_26[level]}).test(source)` : `source.hasPermission(${level})`);
  }
  if (command.type === "SINGLEPLAYER_ONLY") parts.push("source.getServer().isSingleplayer()");
  if (command.type === "MULTIPLAYER_ONLY") parts.push("source.getServer().isDedicatedServer()");
  return parts.length ? parts.join(" && ") : "true";
}

export default {
  element,
  runtime(commands, env) {
    if (!commands.length) return {};
    const client = commands.filter((c) => c.type === "CLIENTSIDE");
    const server = commands.filter((c) => c.type !== "CLIENTSIDE");
    const out = server.length ? serverCommands(server, env) : { sources: [], init: [] };
    return client.length ? { sources: [...out.sources, clientSource(client, env)], init: out.init, clientInit: [clientRegister(env)] } : out;
  },
} satisfies TypeModule;

function serverCommands(commands: ElementContext[], env: GenEnv): { sources: JavaSourceFile[]; init: string[] } {
  {
    const legacy = env.mc === "1.16.5";
    const pkg = env.project.mod.package;
    const cls = `${modClassName(env)}Commands`;
    const owner = `${pkg}.init.${cls}`;
    const Source = legacy ? "net.minecraft.command.CommandSource" : "net.minecraft.commands.CommandSourceStack";
    const Commands = legacy ? "net.minecraft.command.Commands" : "net.minecraft.commands.Commands";
    const Ctx = `com.mojang.brigadier.context.CommandContext<${Source}>`;
    const deps = { x: "source.getPosition().x", y: "source.getPosition().y", z: "source.getPosition().z", world: "source.getLevel()", entity: "entity", command: "ctx.getInput()", arguments: "ctx" };
    const Entity = legacy ? "net.minecraft.entity.Entity" : "net.minecraft.world.entity.Entity";
    // MCreator: a command run without an entity (console, command block) uses a fake player.
    const fake = legacy ? "net.minecraftforge.common.util.FakePlayerFactory.getMinecraft(source.getLevel())"
      : env.loader === "neoforge" ? "net.neoforged.neoforge.common.util.FakePlayerFactory.getMinecraft(source.getLevel())"
        : "net.fabricmc.fabric.api.entity.FakePlayer.get(source.getLevel())";
    const calls = new Map(commands.map((c) => [c, procedureCall(env, "command", { id: String(c.id), program: `command:${c.id}` } as unknown as Element, "program", deps)]));
    const registrations = commands.map((c) => {
      const name = str(c.commandName) || String(c.id);
      const typed = argumentChain(env, c, Commands, `${cls}::${c.id}`);
      if (typed) return `        dispatcher.register(${Commands}.literal(${jstr(name)})
                .requires(source -> ${requirement(env, c)})
                .then(${typed}));`;
      // Free text after the command only when the program reads it; MCreator commands without arguments take none.
      if (!calls.get(c)?.includes("ctx.getInput()")) return `        dispatcher.register(${Commands}.literal(${jstr(name)})
                .requires(source -> ${requirement(env, c)})
                .executes(${cls}::${c.id}));`;
      return `        dispatcher.register(${Commands}.literal(${jstr(name)})
                .requires(source -> ${requirement(env, c)})
                .executes(${cls}::${c.id})
                .then(${Commands}.argument("arguments", com.mojang.brigadier.arguments.StringArgumentType.greedyString()).executes(${cls}::${c.id})));`;
    });
    const runners = commands.map((c) => {
      const call = calls.get(c);
      return `    private static int ${c.id}(${Ctx} ctx) {
        ${Source} source = ctx.getSource();
${call ? `        ${Entity} entity = source.getEntity();
        if (entity == null) entity = ${fake};
        ${call};
` : ""}        return 0;
    }`;
    });
    const dispatcher = `com.mojang.brigadier.CommandDispatcher<${Source}>`;
    let register: string;
    if (legacy) {
      register = `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.event.RegisterCommandsEvent.class, event -> ${owner}.register(event.getDispatcher()));`;
    } else if (env.loader === "neoforge") {
      register = `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.event.RegisterCommandsEvent.class, event -> ${owner}.register(event.getDispatcher()));`;
    } else {
      register = `net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback.EVENT.register((dispatcher, registries, environment) -> ${owner}.register(dispatcher));`;
    }
    const code = `package ${pkg}.init;

/** Generated by MCEdge: the mod's commands. */
public final class ${cls} {
    private ${cls}() {}

    public static void register(${dispatcher} dispatcher) {
${registrations.join("\n")}
    }

${runners.join("\n\n")}
}
`;
    return { sources: [{ path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }], init: [register] };
  }
}

const clientClass = (env: GenEnv) => `${env.project.mod.package}.client.${modClassName(env)}ClientCommands`;

/** Statement registering the client-side commands (client init). */
function clientRegister(env: GenEnv): string {
  const owner = clientClass(env);
  if (env.mc === "1.16.5") {
    return `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.ClientChatEvent.class, event -> {
            if (${owner}.run(event.getMessage())) event.setCanceled(true);
        });`;
  }
  if (env.loader === "neoforge") {
    return `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.neoforge.client.event.RegisterClientCommandsEvent.class, event -> ${owner}.register(event.getDispatcher()));`;
  }
  return `net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback.EVENT.register((dispatcher, context) -> ${owner}.register(dispatcher));`;
}

/** <Mod>ClientCommands: client-side commands and their programs, run with the local player. */
function clientSource(commands: ElementContext[], env: GenEnv): JavaSourceFile {
  const legacy = env.mc === "1.16.5";
  const cls = clientClass(env);
  const name = cls.slice(cls.lastIndexOf(".") + 1);
  const pkg = cls.slice(0, cls.lastIndexOf("."));
  const deps = { x: "player.getX()", y: "player.getY()", z: "player.getZ()", world: legacy ? "player.level" : "player.level()", entity: "player", command: "input" };
  const runners = commands.map((c) => {
    const call = procedureCall(env, "command", { id: String(c.id), program: `command:${c.id}` } as unknown as Element, "program", deps);
    return `    private static void ${c.id}(String input) {
        ${legacy ? "net.minecraft.client.entity.player.ClientPlayerEntity" : "net.minecraft.client.player.LocalPlayer"} player = net.minecraft.client.Minecraft.getInstance().player;
        if (player == null) return;
${call ? `        ${call};
` : ""}    }`;
  });
  let entry: string;
  if (legacy) {
    entry = `    /** Runs the message as a client command when it is one of this mod's; true when it was. */
    public static boolean run(String message) {
        if (!message.startsWith("/")) return false;
        String input = message.substring(1).trim();
        String name = input.split(" ", 2)[0];
        switch (name) {
${commands.map((c) => `        case ${jstr(str(c.commandName) || String(c.id))}:
            ${c.id}(input);
            net.minecraft.client.Minecraft.getInstance().gui.getChat().addRecentChat(message);
            return true;`).join("\n")}
        default:
            return false;
        }
    }`;
  } else {
    const Source = env.loader === "neoforge" ? "net.minecraft.commands.CommandSourceStack" : "net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource";
    const builders = env.loader === "neoforge" ? "net.minecraft.commands.Commands" : env.mc === "26.3" ? "net.fabricmc.fabric.api.client.command.v2.ClientCommands" : "net.fabricmc.fabric.api.client.command.v2.ClientCommandManager";
    entry = `    public static void register(com.mojang.brigadier.CommandDispatcher<${Source}> dispatcher) {
${commands.map((c) => `        dispatcher.register(${builders}.literal(${jstr(str(c.commandName) || String(c.id))})
                .executes(ctx -> { ${c.id}(ctx.getInput()); return 1; })
                .then(${builders}.argument("arguments", com.mojang.brigadier.arguments.StringArgumentType.greedyString()).executes(ctx -> { ${c.id}(ctx.getInput()); return 1; })));`).join("\n")}
    }`;
  }
  const code = `package ${pkg};

/** Generated by MCEdge: client-side commands; loaded only on the physical client. */
public final class ${name} {
    private ${name}() {}

${entry}

${runners.join("\n\n")}
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/${name}.java`, code };
}
