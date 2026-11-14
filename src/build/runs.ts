import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logPath, type GradleSetup } from "./gradle.ts";
import { DEFAULT_PLAYER, isPlayerName } from "./players.ts";

/** Port the debug client's JDWP agent listens on; attach an IDE debugger to localhost:5005. */
export const DEBUG_PORT = 5005;

/** How a client run starts: its player name, whether it joins the local test server, a JDWP agent for a debugger. */
export interface ClientOptions {
  player?: string;
  join?: boolean;
  debug?: boolean;
}

/**
 * Gradle arguments for a client, through an init script of its own (build/mcedge-client-<player>.gradle) that sets the
 * client run only, so clients of one project can run at the same time with their own names (KUYRUK 190):
 *   --username     the player name (no loader passes one of its own when it is given)
 *   join           connects straight to the test server of run/server.properties on this machine (1.16.5 has no quick play)
 *   1.16.5         authlib is pointed at an address that refuses connections: the dev account's privileges then cannot be
 *                  asked for and the game falls back to offline social interactions, which allow multiplayer; with the
 *                  real services the fake dev token gets no privileges and the Multiplayer button stays off
 *   debug          a JDWP agent; it is added to the game JVM only, so Gradle's own JVM never opens the port
 * Game arguments go to the runClient task. ModDevGradle's runClient starts a launcher whose first argument is the main
 * class, read with the run's arguments from a file under build/moddev that every Gradle run of the project rewrites:
 * there they are added after that file, so two clients starting together never read each other's arguments.
 */
export function clientTasks(setup: GradleSetup, minecraft: string, options: ClientOptions = {}): string[] {
  const player = options.player ?? DEFAULT_PLAYER;
  if (!isPlayerName(player)) throw new Error(`bad player name "${player}": 3 to 16 letters, digits or _`);
  const args = ["--username", player];
  if (options.join) {
    const port = testServerPort(setup.projectDir);
    args.push(...(minecraft === "1.16.5" ? ["--server", "127.0.0.1", "--port", String(port)] : ["--quickPlayMultiplayer", `127.0.0.1:${port}`]));
  }
  const jvm: string[] = [];
  if (minecraft === "1.16.5") for (const host of ["auth", "account", "session", "services"]) jvm.push(`-Dminecraft.api.${host}.host=${OFFLINE_SERVICES}`);
  if (options.debug) jvm.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${DEBUG_PORT}`);
  const list = (values: string[]) => values.map((v) => `'${v}'`).join(", ");
  const script = logPath(setup, `mcedge-client-${player}${options.debug ? "-debug" : ""}.gradle`);
  const lines = [
    `if (project.pluginManager.hasPlugin('net.neoforged.moddev')) argumentProviders.add({ [${list(args)}] } as CommandLineArgumentProvider)`,
    `else args(${list(args)})`,
    ...(jvm.length ? [`jvmArgs(${list(jvm)})`] : []),
  ];
  writeFileSync(script, `allprojects {
  tasks.withType(JavaExec).configureEach {
    if (name == 'runClient') {
${lines.map((l) => `      ${l}`).join("\n")}
    }
  }
}
`);
  return ["-I", script, "runClient"];
}

/** Nothing listens on port 1: a connection fails at once instead of waiting for a timeout. */
const OFFLINE_SERVICES = "http://127.0.0.1:1";

/** Port of the local test server: server-port of run/server.properties, else Minecraft's default. */
export function testServerPort(projectDir: string): number {
  const file = join(projectDir, "run", "server.properties");
  const port = existsSync(file) ? /^server-port=(\d+)/m.exec(readFileSync(file, "utf8"))?.[1] : undefined;
  return port ? Number(port) : 25565;
}

/**
 * Gradle arguments for a dedicated server. The EULA of the local test server in run/ is accepted for the user, and it
 * runs with online-mode=false (other properties of run/server.properties stay): dev clients have no Mojang session, so
 * an online-mode server would turn them away (KUYRUK 190).
 */
export function serverTasks(setup: GradleSetup): string[] {
  mkdirSync(join(setup.projectDir, "run"), { recursive: true });
  writeFileSync(join(setup.projectDir, "run", "eula.txt"), "# Accepted for local mod testing from MCEdge\neula=true\n");
  const file = join(setup.projectDir, "run", "server.properties");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("online-mode=")) : [];
  writeFileSync(file, [...lines, "online-mode=false"].join("\n") + "\n");
  return ["runServer"];
}

/**
 * Silences a client before an agent or a test starts it: master volume 0 in run/options.txt of the engine folder (the
 * other options stay). MCEDGE_TEST_SOUND=1 keeps the sound. The user's own runs from the app never call this.
 */
export function muteClient(projectDir: string): void {
  if (process.env.MCEDGE_TEST_SOUND === "1") return;
  const file = join(projectDir, "run", "options.txt");
  mkdirSync(join(projectDir, "run"), { recursive: true });
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("soundCategory_master:")) : [];
  writeFileSync(file, [...lines, "soundCategory_master:0.0"].join("\n") + "\n");
}
