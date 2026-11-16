// Opens a built project's dev client straight into the world its last runServer left (out/<engine>/run/world), for a
// person to play in: the world is copied to run/saves/<name> (once), quick play opens it, and the client is started detached so
// it keeps running after this script (it is not muted and has no time limit). Prints the PIDs and how to stop it.
// 1.21.5 and 26.x only (1.16.5 has no quick play). Make the world first, e.g. a flat creative one:
//   RUN_PROJECT=<project> RUN_SERVER_PROPERTIES="level-type=minecraft\:flat;gamemode=creative" node tools/codegen-test/run.ts <engine> runServer <commands>
// usage: node tools/codegen-test/open-world.ts <project dir> <engine> [world name, default mcedge_world] [player, default Dev]
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineSetup, logPath } from "../../src/build/gradle.ts";
import { clientTasks } from "../../src/build/runs.ts";
import { listEngines } from "../../src/engines/registry.ts";

const [project, engineId, world = "mcedge_world", player = "Dev"] = process.argv.slice(2);
const engine = listEngines().find((e) => e.id === engineId);
if (!project || !engine) throw new Error("usage: node tools/codegen-test/open-world.ts <project dir> <engine> [world] [player]");
if (engine.minecraft === "1.16.5") throw new Error("1.16.5 has no quick play");
if (existsSync("C:/BrainOS/.ingame")) throw new Error("the user is in a game (C:/BrainOS/.ingame); not starting a client");
const dir = join(project, "out", engine.id);
const source = join(dir, "run", "world");
if (!existsSync(source)) throw new Error(`no world at ${source}; run runServer first`);

// A save of that name is kept (the person may have played in it); the world is copied only the first time.
const saves = join(dir, "run", "saves", world);
if (!existsSync(saves)) cpSync(source, saves, { recursive: true, filter: (src) => !src.endsWith("session.lock") });
// The first-run accessibility screen would wait for a click before quick play starts.
const options = join(dir, "run", "options.txt");
const text = existsSync(options) ? readFileSync(options, "utf8") : "";
writeFileSync(options, /onboardAccessibility:/.test(text) ? text.replace(/onboardAccessibility:\w+/, "onboardAccessibility:false") : `${text}onboardAccessibility:false\n`);

const setup = engineSetup(engine, dir);
// The run manager's client arguments (player name), plus quick play into the world through a second init script.
const quickPlay = logPath(setup, "mcedge-open-world.gradle");
writeFileSync(quickPlay, `allprojects {
  tasks.withType(JavaExec).configureEach {
    if (name == 'runClient') {
      if (project.pluginManager.hasPlugin('net.neoforged.moddev')) argumentProviders.add({ ['--quickPlaySingleplayer', '${world}'] } as CommandLineArgumentProvider)
      else args('--quickPlaySingleplayer', '${world}')
    }
  }
}
`);
const log = logPath(setup, `mcedge-open-world-${player}.log`);
const out = openSync(log, "w");
const child = spawn("cmd.exe", ["/d", "/c", setup.launcher, "-I", quickPlay, ...clientTasks(setup, engine.minecraft, { player }), "--no-daemon", "--console=plain",
  `-Dorg.gradle.java.installations.paths=${setup.installations.join(",")}`], { cwd: dir, env: { ...process.env, JAVA_HOME: setup.javaHome }, detached: true, stdio: ["ignore", out, out] });
child.unref();
console.log(`started: launcher pid ${child.pid}, log ${log}`);

// The game's own JVM: a java process under the launcher that is not Gradle (Gradle itself carries the init script path).
const games = () => {
  const ps = spawnSync("powershell", ["-NoProfile", "-Command",
    `$all = Get-CimInstance Win32_Process; $tree = @(${child.pid}); do { $more = @($all | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId }); $tree += $more } while ($more.Count); ` +
    `$all | Where-Object { $tree -contains $_.ProcessId -and $_.Name -match '^javaw?\\.exe$' -and $_.CommandLine -notmatch 'GradleMain|GradleDaemon|gradle-launcher|GradleWrapperMain|mcedge-open-world' } | ForEach-Object { $_.ProcessId }`], { encoding: "utf8" });
  return ps.stdout.split(/\s+/).filter(Boolean);
};
// Gradle's output may not reach the launcher log, so the game's own log (written after the start) tells when the world is open.
const gameLog = join(dir, "run", "logs", "latest.log");
const started = Date.now();
for (let i = 0; i < 180; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  if (/BUILD FAILED/.test(existsSync(log) ? readFileSync(log, "utf8") : "")) throw new Error(`the client failed; see ${log}`);
  const lines = existsSync(gameLog) && statSync(gameLog).mtimeMs >= started ? readFileSync(gameLog, "utf8") : "";
  if (/Crash report saved/.test(lines)) throw new Error(`the client crashed; see ${gameLog}`);
  const pids = games();
  if (pids.length && /joined the game|Local game hosted|Started serving on/.test(lines)) {
    console.log(`game pid ${pids.join(", ")} (world "${world}", player ${player})`);
    console.log(`stop: close the game window, or taskkill /PID ${child.pid} /T /F`);
    process.exit(0);
  }
}
console.log(`still starting after 6 minutes; launcher pid ${child.pid}, logs ${log}, ${gameLog}`);
