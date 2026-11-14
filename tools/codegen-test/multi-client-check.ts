// KUYRUK 190: the test server and two clients with their own player names on one engine of a built project, all at the
// same time in the same Gradle project and run/ folder, the way the app and the MCP run them (clientTasks, serverTasks).
// Phase 1: a client without join shows the title screen (screenshot: is Multiplayer enabled?).
// Phase 2: the server (online-mode=false, a free port) and clients Dev and Dev2 that join it; passes when the server log
// shows both joining. Prints one RESULT line; stops everything it started.
// usage: node tools/codegen-test/multi-client-check.ts <engine> <built project dir> [screenshot folder]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { engineSetup, logPath, runGradle, type GradleRun } from "../../src/build/gradle.ts";
import { freePort } from "../../src/build/rcon.ts";
import { clientTasks, muteClient, serverTasks } from "../../src/build/runs.ts";
import { captureWindow } from "../../src/build/windowShot.ts";
import { listEngines } from "../../src/engines/registry.ts";

const [engineId, project, shots = "design/190"] = process.argv.slice(2);
const engine = listEngines().find((e) => e.id === engineId)!;
const dir = resolve(project, "out", engine.id);
const setup = engineSetup(engine, dir);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(shots, { recursive: true });
muteClient(dir);

interface Started { name: string; run: GradleRun; lines: string[]; log: string; ended: boolean }
const started: Started[] = [];
const start = (name: string, tasks: string[]): Started => {
  const lines: string[] = [];
  const log = logPath(setup, `mcedge-run-${name}.log`);
  const run = runGradle(setup, tasks, log, (line) => lines.push(line));
  const s = { name, run, lines, log, ended: false };
  run.done.then((code) => (lines.push(`[check] gradle ended with ${code}`), (s.ended = true)));
  started.push(s);
  return s;
};
const waitFor = async (s: Started, regex: RegExp, seconds: number) => {
  for (let i = 0; i < seconds; i++) {
    if (s.lines.some((l) => regex.test(l))) return true;
    if (s.ended || s.lines.some((l) => /BUILD FAILED|Crash report saved|Exception in thread "main"/.test(l))) return false;
    await sleep(1000);
  }
  return false;
};
const stopAll = async () => {
  for (const s of started) s.run.stop();
  await Promise.race([Promise.all(started.map((s) => s.run.done)), sleep(30_000)]);
  started.length = 0;
};
const CLIENT_READY = /Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas/;
const results: string[] = [];
try {
  // Phase 1: title screen.
  const title = start("Title", clientTasks(setup, engine.minecraft, { player: "Title" }));
  const titleReady = await waitFor(title, CLIENT_READY, 600);
  await sleep(15_000);
  const titleShot = resolve(shots, `title-${engine.id}.png`);
  const titleError = titleReady ? captureWindow({ rootPid: title.run.pid, title: "Minecraft*" }, titleShot) : "not ready";
  const user = title.lines.find((l) => /Setting user: /.test(l));
  results.push(`title ready=${titleReady} ${user?.replace(/^.*Setting user: /, "user=") ?? "user=?"} shot=${titleError ?? titleShot}`);
  await stopAll();

  // Phase 2: server and two joining clients.
  const tasks = serverTasks(setup);
  const props = resolve(dir, "run", "server.properties");
  const port = await freePort();
  const kept = existsSync(props) ? readFileSync(props, "utf8").split(/\r?\n/).filter((l) => l && !/^server-port=/.test(l)) : [];
  writeFileSync(props, [...kept, `server-port=${port}`].join("\n") + "\n");
  const server = start("server", tasks);
  const serverReady = await waitFor(server, /Done \(\d/, 900);
  results.push(`server ready=${serverReady} port=${port} online-mode=${/^online-mode=(\w+)/m.exec(readFileSync(props, "utf8"))?.[1]}`);
  if (serverReady) {
    // Both clients start together: two Gradle builds of one project and two games in one run/ folder.
    const dev = start("Dev", clientTasks(setup, engine.minecraft, { join: true }));
    const dev2 = start("Dev2", clientTasks(setup, engine.minecraft, { player: "Dev2", join: true }));
    const joined = (name: string) => server.lines.some((l) => new RegExp(`\\b${name} joined the game`).test(l));
    for (let i = 0; i < 900 && !(joined("Dev") && joined("Dev2")); i++) {
      if ([dev, dev2, server].some((c) => c.ended || c.lines.some((l) => /BUILD FAILED|Crash report saved/.test(l)))) break;
      await sleep(1000);
    }
    await sleep(10_000);
    for (const c of [dev, dev2]) {
      const shot = resolve(shots, `joined-${engine.id}-${c.name}.png`);
      results.push(`${c.name} ${c.lines.find((l) => /Setting user: /.test(l))?.replace(/^.*Setting user: /, "user=") ?? "user=?"} shot=${captureWindow({ rootPid: c.run.pid, title: "Minecraft*" }, shot) ?? shot}`);
    }
    results.push(...server.lines.filter((l) => /joined the game|logged in with entity id|lost connection/.test(l)).map((l) => `server: ${l.replace(/^.*\]: /, "")}`));
    // Each game plays as its own player (two clients starting together must not read each other's arguments).
    const own = [dev, dev2].every((c) => c.lines.some((l) => l.endsWith(`Setting user: ${c.name}`)));
    results.push(`RESULT ${engine.id} joined Dev=${joined("Dev")} Dev2=${joined("Dev2")} own names=${own}`);
  } else results.push(`RESULT ${engine.id} server not ready`);
} finally {
  await stopAll();
}
console.log(results.join("\n"));
