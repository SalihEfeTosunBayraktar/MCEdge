// Q221 check: what is drawn over ANOTHER player (the bubble over its name tag), seen by a second client. A player's own
// name tag never shows, so bubble-client-check.sh cannot show the tag case. Here a dedicated server runs with two clients
// that join it (offline names Dev and Dev2, started the way the app and the MCP start them: clientTasks, serverTasks):
//   - the server gives Dev2 the designed bubble (bubbleshot/<engine>/BubbleShotServer*.java, limited to Dev2) and creative;
//   - Dev is the camera: first person (BubbleShotClient*.java, THIRD_PERSON_FRONT swapped for FIRST_PERSON) and, over
//     RCON, put 3 blocks in front of Dev2 looking at it (tp Dev ^ ^ ^3 facing entity Dev2 feet, run as Dev2), both on
//     a stone platform high up so no test block is in view.
// The window image of Dev is saved to <shots>/bubble-other-<engine>[-<bubble>].png: Dev2's model with its name tag and
// the bubble above it. Helpers are copied into the built test project for the run and removed afterwards (Fabric ones are
// mixins, listed in the mod's mixin config for the run). The built test project must exist (make.ts, build.sh).
// Needs the players' windows, so never run it while the user is in a game (C:/BrainOS/.ingame).
// usage: [BUBBLE=trade_offer] node tools/codegen-test/bubble-other-check.ts <engine> [shots folder, default design/221]
// Through the MCP the same needs no script: run_server, run_client Dev2 (join_server), run_client Dev (join_server),
// server_command "execute as Dev2 at Dev2 run tp Dev ^ ^ ^3 facing entity Dev2 feet", game_screenshot (see docs/MCP.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineSetup, logPath, runGradle, type GradleRun } from "../../src/build/gradle.ts";
import { enableRcon, freePort, RconClient } from "../../src/build/rcon.ts";
import { clientTasks, muteClient, serverTasks } from "../../src/build/runs.ts";
import { captureWindow } from "../../src/build/windowShot.ts";
import { listEngines } from "../../src/engines/registry.ts";

const [engineId, shots = "design/221"] = process.argv.slice(2);
const bubble = process.env.BUBBLE ?? "trade_offer";
const engine = listEngines().find((e) => e.id === engineId);
if (!engine) throw new Error(`usage: bubble-other-check.ts <engine> [shots folder]; engines: ${listEngines().map((e) => e.id).join(", ")}`);
if (existsSync("C:/BrainOS/.ingame")) throw new Error("INGAME: the user is in a game, stop");
const dir = resolve("tools/codegen-test/project/out", engine.id);
const setup = engineSetup(engine, dir);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(shots, { recursive: true });

// Helpers: the bubble-client-check ones, the bubble only on Dev2 and the camera in first person.
const mod = join(dir, "src/main/java/dev/mcedge/wavethree");
const fabric = engine.loader === "fabric";
const helperDir = join(mod, fabric ? "mixin" : "custom");
const mixinConfig = join(dir, "src/main/resources/wavethree.mixins.json");
const mixinBackup = fabric ? readFileSync(mixinConfig, "utf8") : "";
const edits: [file: string, from: string | RegExp, to: string][] = [
  ["BubbleShotServer", "if (dev.mcedge", 'if (player.getName().getString().equals("Dev2") && dev.mcedge'],
  ["BubbleShotServer", 'WavethreeModBubbles.show(player, "wave", "Ali", 0)', `WavethreeModBubbles.showBubble(player, "${bubble}", "Ali", 0)`],
  ["BubbleShotClient", "THIRD_PERSON_FRONT", "FIRST_PERSON"],
];
const helpers = readdirSync(join(import.meta.dirname, "bubbleshot", engine.id)).filter((f) => f.endsWith(".java"));

interface Started { name: string; run: GradleRun; lines: string[]; ended: boolean }
const started: Started[] = [];
const start = (name: string, tasks: string[]): Started => {
  const lines: string[] = [];
  const run = runGradle(setup, tasks, logPath(setup, `mcedge-run-${name}.log`), (line) => lines.push(line));
  const s = { name, run, lines, ended: false };
  run.done.then(() => (s.ended = true));
  started.push(s);
  return s;
};
const stopAll = async () => {
  for (const s of started) s.run.stop();
  await Promise.race([Promise.all(started.map((s) => s.run.done)), sleep(30_000)]);
  started.length = 0;
};
const failed = (s: Started) => s.ended || s.lines.some((l) => /BUILD FAILED|Crash report saved|Exception in thread "main"/.test(l));
const results: string[] = [];
try {
  mkdirSync(helperDir, { recursive: true });
  for (const file of helpers) {
    const target = join(helperDir, file);
    copyFileSync(join(import.meta.dirname, "bubbleshot", engine.id, file), target);
    let text = readFileSync(target, "utf8");
    for (const [name, from, to] of edits) if (file.startsWith(name)) text = text.replaceAll(from, to);
    writeFileSync(target, text);
  }
  if (fabric) writeFileSync(mixinConfig, mixinBackup.replace('"mixins": [', '"mixins": ["BubbleShotServerMixin",').replace('"client": [', '"client": ["BubbleShotClientMixin",'));
  muteClient(dir);
  // Two windows: the one without focus would open the game menu (pause on lost focus) over the picture.
  const options = join(dir, "run", "options.txt");
  const lines = readFileSync(options, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("pauseOnLostFocus:"));
  writeFileSync(options, [...lines, "pauseOnLostFocus:false"].join("\n") + "\n");
  const tasks = serverTasks(setup);
  const props = join(dir, "run", "server.properties");
  const port = await freePort();
  const rcon = await enableRcon(dir);
  const kept = readFileSync(props, "utf8").split(/\r?\n/).filter((l) => l && !/^server-port=/.test(l));
  writeFileSync(props, [...kept, `server-port=${port}`].join("\n") + "\n");
  rmSync(join(dir, "run", "world"), { recursive: true, force: true });
  const server = start("server", tasks);
  for (let i = 0; i < 900 && !server.lines.some((l) => /Done \(\d/.test(l)) && !failed(server); i++) await sleep(1000);
  const joined = (name: string) => server.lines.some((l) => new RegExp(`\\b${name} joined the game`).test(l));
  if (!server.lines.some((l) => /Done \(\d/.test(l))) throw new Error("the server did not start");
  // Both clients start together: two Gradle builds of one project and two games in one run/ folder.
  const dev2 = start("Dev2", clientTasks(setup, engine.minecraft, { player: "Dev2", join: true }));
  const dev = start("Dev", clientTasks(setup, engine.minecraft, { join: true }));
  for (let i = 0; i < 900 && !(joined("Dev") && joined("Dev2")); i++) {
    if ([dev, dev2, server].some(failed)) break;
    await sleep(1000);
  }
  results.push(`joined Dev=${joined("Dev")} Dev2=${joined("Dev2")}`);
  if (joined("Dev") && joined("Dev2")) {
    await sleep(15_000);
    const client = await RconClient.open(rcon);
    try {
      // A stone platform 120 blocks up keeps the test project's blocks and mobs out of the picture; then the camera
      // goes 3 blocks in front of Dev2 (^ ^ ^3 is in Dev2's facing direction) and looks level at it (the look is
      // measured from the camera player's feet, so "eyes" would tilt the view up). The look is sent again after a
      // few seconds: one that arrives while the client is still loading the new chunks can be lost.
      for (const command of ["time set day", "execute as Dev2 at Dev2 run fill ~-6 ~120 ~-6 ~6 ~120 ~6 minecraft:smooth_stone", "execute as Dev2 at Dev2 run tp Dev2 ~ ~121 ~"]) results.push(`${command}: ${await client.command(command)}`);
      for (let i = 0; i < 3; i++) {
        await sleep(4000);
        const look = await client.command("execute as Dev2 at Dev2 run tp Dev ^ ^ ^3 facing entity Dev2 feet");
        if (i === 2) results.push(look);
      }
    } finally {
      client.close();
    }
    await sleep(5000);
    const file = resolve(shots, `bubble-other-${engine.id}${process.env.BUBBLE ? `-${bubble}` : ""}.png`);
    results.push(`Dev shot ${captureWindow({ rootPid: dev.run.pid, title: "Minecraft*" }, file) ?? file}`);
  }
  results.push(...[dev, dev2].flatMap((c) => c.lines.filter((l) => /Exception|Caused by|Error executing/.test(l) && !/Win32Exception|Realms|FileSystemException/.test(l)).slice(0, 3).map((l) => `${c.name}: ${l.slice(0, 190)}`)));
  results.push(`RESULT ${engine.id} bubble=${bubble}`);
} finally {
  await stopAll();
  for (const file of helpers) rmSync(join(helperDir, file), { force: true });
  if (fabric) writeFileSync(mixinConfig, mixinBackup);
}
console.log(results.join("\n"));
