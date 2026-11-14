// Runs a Gradle run task (runServer, runClient) of a built test engine, sends commands over RCON after startup,
// logs everything to logs/run-<task>-<engine>-<run id>.log, then stops. Every run has its own run id (env RUN_ID, else
// generated), own free ports and own log, registered in logs/runs/, so runs on any engines can go at the same time;
// a second run of the same task in the same project dir is refused (it would share the Gradle project and run/).
// The first output line is "run <id> log <path>"; scripts export RUN_ID and read logs/run-<task>-<engine>-$RUN_ID.log.
// usage: node tools/codegen-test/run.ts <engine> <task> [file with commands, one per line; "@wait N" pauses N seconds,
// "@kill" stops the game] [--world: runClient opens the world the last runServer left (run/world) in singleplayer,
// so entities there are rendered; 1.21.5 and 26.3 only (quick play)] [--join: a 1.16.5 runClient joins the running
// runServer of the same project dir on this machine; it finds that server's ports in the registry]
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { engineSetup } from "../../src/build/gradle.ts";
import { muteClient } from "../../src/build/runs.ts";
import { listEngines } from "../../src/engines/registry.ts";
const [id, task, cmdFile] = process.argv.slice(2);
const engine = listEngines().find((e) => e.id === id)!;
// RUN_PROJECT runs another built project, such as a converted mod.
const dir = `${process.env.RUN_PROJECT ?? `${import.meta.dirname}/project`}/out/${engine.id}`;

// Run registry: logs/runs/<id>-<task>-<engine>.json per live run (ports, log, pid) and lock-*.json per (project dir, task).
const runId = process.env.RUN_ID ?? `p${process.pid}`;
const logsDir = `${import.meta.dirname}/logs`;
const runsDir = `${logsDir}/runs`;
mkdirSync(runsDir, { recursive: true });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
type Entry = { id: string; task: string; engine: string; dir: string; pid: number; log: string; rconPort: number; serverPort: number; servicesPort: number };
const readEntry = (file: string): Entry | undefined => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; } };
const liveEntries = () => readdirSync(runsDir).filter((f) => f.endsWith(".json") && !f.startsWith("lock-"))
  .flatMap((f) => { const e = readEntry(`${runsDir}/${f}`); if (e && alive(e.pid)) return [e]; rmSync(`${runsDir}/${f}`, { force: true }); return []; });
const freePort = () => new Promise<number>((resolve, reject) => {
  const t = createTcpServer();
  t.once("error", reject);
  t.listen(0, "127.0.0.1", () => { const port = (t.address() as { port: number }).port; t.close(() => resolve(port)); });
});
// Short critical section so two runs starting together never pick the same ports.
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const guard = `${runsDir}/.alloc`;
  for (let i = 0; ; i++) {
    try { mkdirSync(guard); break; } catch {
      if (i > 100) rmSync(guard, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try { return await fn(); } finally { rmSync(guard, { recursive: true, force: true }); }
}
const entryFile = `${runsDir}/${runId}-${task}-${engine.id}.json`;
const lockFile = `${runsDir}/lock-${createHash("sha1").update(`${dir}|${task}`).digest("hex")}.json`;
const join = task === "runClient" && process.argv.includes("--join") && engine.minecraft === "1.16.5";
const entry = await exclusive(async () => {
  const held = readEntry(lockFile);
  if (held && held.pid !== process.pid && alive(held.pid)) {
    console.error(`REFUSED: run ${held.id} (pid ${held.pid}) already runs ${task} in ${dir}; its log is ${held.log}`);
    process.exit(3);
  }
  const taken = new Set(liveEntries().flatMap((e) => [e.rconPort, e.serverPort, e.servicesPort]));
  const ports: number[] = [];
  while (ports.length < 3) { const p = await freePort(); if (!taken.has(p) && !ports.includes(p)) ports.push(p); }
  const e: Entry = { id: runId, task, engine: engine.id, dir, pid: process.pid, log: `${logsDir}/run-${task}-${engine.id}-${runId}.log`, rconPort: ports[0], serverPort: ports[1], servicesPort: ports[2] };
  writeFileSync(entryFile, JSON.stringify(e));
  writeFileSync(lockFile, JSON.stringify(e));
  return e;
});
const release = () => { rmSync(entryFile, { force: true }); if (readEntry(lockFile)?.pid === process.pid) rmSync(lockFile, { force: true }); };
process.on("exit", release);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(130));
// A joining client uses the ports of the runServer of this project dir (the lock allows one per dir).
const target = join ? liveEntries().find((e) => e.task === "runServer" && e.dir === dir) : undefined;
if (join && !target) { console.error(`REFUSED: --join needs a running runServer of ${dir}; none is registered`); process.exit(4); }
const rconPort = target?.rconPort ?? entry.rconPort;
const serverPort = target?.serverPort ?? entry.serverPort;
const log = entry.log;
console.log(`run ${runId} log ${log} rcon ${rconPort} server ${serverPort}`);
// A dedicated server with RCON, so the driver can send commands.
mkdirSync(`${dir}/run`, { recursive: true });
writeFileSync(`${dir}/run/eula.txt`, "eula=true\n");
if (task === "runServer") writeFileSync(`${dir}/run/server.properties`, ["enable-rcon=true", "rcon.password=wavethree", `rcon.port=${entry.rconPort}`, `server-port=${entry.serverPort}`, "online-mode=false", "spawn-protection=0", "broadcast-rcon-to-ops=true"].join("\n") + "\n");
// Test clients are silent: master volume 0 in run/options.txt (MCEDGE_TEST_SOUND=1 keeps the sound).
if (task === "runClient") muteClient(dir);
// Test-only: open the server's world in the client (quick play), so its mobs are rendered.
if (task === "runClient" && process.argv.includes("--world") && engine.minecraft !== "1.16.5" && existsSync(`${dir}/run/world`)) {
  rmSync(`${dir}/run/saves/mcedge_world`, { recursive: true, force: true });
  cpSync(`${dir}/run/world`, `${dir}/run/saves/mcedge_world`, { recursive: true, filter: (src) => !src.endsWith("session.lock") });
  // The first-run accessibility screen would wait for a click before quick play starts.
  const options = `${dir}/run/options.txt`;
  const text = existsSync(options) ? readFileSync(options, "utf8") : "";
  writeFileSync(options, /onboardAccessibility:/.test(text) ? text.replace(/onboardAccessibility:\w+/, "onboardAccessibility:false") : `${text}onboardAccessibility:false\n`);
  const gradleFile = `${dir}/build.gradle`;
  let gradle = readFileSync(gradleFile, "utf8");
  if (!gradle.includes("quickPlaySingleplayer")) {
    gradle = engine.loader === "fabric"
      ? `${gradle}
loom { runs { client { programArgs "--quickPlaySingleplayer", "mcedge_world" } } }
`
      : gradle.replace("client { client() }", "client { client(); programArgument '--quickPlaySingleplayer'; programArgument 'mcedge_world' }");
    writeFileSync(gradleFile, gradle);
  }
}
// Test-only: 1.16.5 has no quick play, so its client joins the dedicated server a runServer started on this machine
// (--join). Its multiplayer button stays off while the dev account's privileges cannot be fetched, so the client asks
// a local stub (below) for them, and for skin profiles, instead of Mojang's services.
// The client's server address lives in build.gradle; it is rewritten per run so no stale port stays in it.
if (task === "runClient" && engine.minecraft === "1.16.5") {
  const gradleFile = `${dir}/build.gradle`;
  const gradle = readFileSync(gradleFile, "utf8");
  const stripped = gradle.replace(/\r?\n[ \t]*args '--server'[^\n]*(\r?\n[ \t]*property 'minecraft\.api\.\w+\.host'[^\n]*)*/, "");
  // authlib only takes a custom environment when all four hosts are given.
  const next = join ? stripped.replace(/client \{\r?\n(\s*)workingDirectory project\.file\('run'\)/,
    `client {\n$1workingDirectory project.file('run')\n$1args '--server', '127.0.0.1', '--port', '${serverPort}'${["auth", "account", "session", "services"].map((h) => `\n$1property 'minecraft.api.${h}.host', 'http://127.0.0.1:${entry.servicesPort}'`).join("")}`) : stripped;
  if (next !== gradle) writeFileSync(gradleFile, next);
}
const services = join ? createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url?.startsWith("/privileges")) res.end(JSON.stringify({ privileges: { onlineChat: { enabled: true }, multiplayerServer: { enabled: true }, multiplayerRealms: { enabled: false }, telemetry: { enabled: false } } }));
  else if (req.url?.startsWith("/privacy/blocklist")) res.end(JSON.stringify({ blockedProfiles: [] }));
  // Skins: the profile asked for, without textures.
  else if (req.url?.startsWith("/session/minecraft/profile/")) res.end(JSON.stringify({ id: req.url.split("/")[4]?.split("?")[0], name: "Dev", properties: [] }));
  else { res.statusCode = 404; res.end("{}"); }
}).listen(entry.servicesPort, "127.0.0.1") : undefined;
const s = engineSetup(engine, dir);
const commands = cmdFile ? readFileSync(cmdFile, "utf8").split(/\r?\n/).filter(Boolean) : [];
const child = spawn("cmd.exe", ["/d", "/c", s.launcher, task, "--no-daemon", "--console=plain", `-Dorg.gradle.java.installations.paths=${s.installations.join(",")}`], { cwd: dir, env: { ...process.env, JAVA_HOME: s.javaHome } });
const lines: string[] = [];
const flush = () => writeFileSync(log, lines.join("\n"));
const stop = () => spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
const timer = setTimeout(() => { lines.push("TIMEOUT"); flush(); stop(); }, 900000);
let started = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Minimal RCON client: login once, then one request per command.
let sock: ReturnType<typeof connect> | undefined;
let pending: ((s: string) => void) | undefined;
let buf = Buffer.alloc(0);
function packet(id: number, type: number, body: string) {
  const b = Buffer.from(body, "utf8"); const p = Buffer.alloc(14 + b.length);
  p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8); b.copy(p, 12); return p;
}
async function rcon(cmd: string): Promise<string> {
  if (!sock) {
    sock = connect(rconPort, "127.0.0.1");
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
        const len = buf.readInt32LE(0); const body = buf.subarray(12, 4 + len - 2).toString("utf8"); buf = buf.subarray(4 + len);
        const r = pending; pending = undefined; r?.(body);
      }
    });
    await new Promise<string>((r) => { pending = r; sock!.write(packet(1, 3, "wavethree")); });
  }
  return new Promise<string>((r) => { const t = setTimeout(() => r("(no reply)"), 60000); pending = (s) => { clearTimeout(t); r(s); }; sock!.write(packet(2, 2, cmd)); });
}
async function drive() {
  await sleep(3000);
  for (const c of commands) {
    const m = /^@wait (\d+)/.exec(c);
    if (m) { await sleep(Number(m[1]) * 1000); continue; }
    if (c === "@kill") { lines.push("KILL"); flush(); stop(); return; }
    // "@shot name": the game window's own image (PrintWindow, so other windows never show) to logs/<name>-<run id>.png.
    const shot = /^@shot (\w[\w.-]*)/.exec(c);
    if (shot) {
      const file = `${logsDir}/${shot[1]}-${runId}.png`.replaceAll("/", "\\");
      spawnSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Drawing; Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr h, System.IntPtr dc, uint flags); public struct RECT { public int L, T, R, B; }'; $ids = @(${child.pid}); do { $n = $ids.Count; $ids = @($ids) + @(Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique } while ($ids.Count -ne $n); $p = Get-Process | Where-Object { $ids -contains $_.Id -and $_.MainWindowTitle -like 'Minecraft*' } | Select-Object -First 1; if (-not $p) { exit 1 }; $r = New-Object U.W+RECT; [U.W]::GetClientRect($p.MainWindowHandle, [ref]$r) | Out-Null; $i = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T); $g = [System.Drawing.Graphics]::FromImage($i); $dc = $g.GetHdc(); [U.W]::PrintWindow($p.MainWindowHandle, $dc, 3) | Out-Null; $g.ReleaseHdc($dc); $i.Save('${file}'); $g.Dispose(); $i.Dispose()`]);
      lines.push(`SHOT ${file}`);
      continue;
    }
    lines.push(`>>> ${c}`);
    lines.push(`<<< ${await rcon(c)}`);
    flush();
  }
}
for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", (line) => {
  lines.push(line);
  if (!started && /Done \(|Minecraft finished loading|Created: .*minecraft:textures|Sound engine started/.test(line)) { started = true; flush(); void drive(); }
  if (/Failed to start the minecraft server|Crash report saved|Exception in server tick loop/.test(line)) { flush(); setTimeout(stop, 3000); }
});
child.on("close", (code) => { clearTimeout(timer); services?.close(); lines.push(`EXIT ${code}`); flush(); console.log("closed", code, lines.length, log); });
