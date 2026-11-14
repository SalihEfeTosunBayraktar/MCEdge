/**
 * KUYRUK #145 part 4: run and observe. Without flags (no Gradle): log grouping on a sample log, the RCON client
 * against a local fake server, enableRcon, and the tools' answers when nothing runs.
 *   --server  observe_run on a neoforge-1.21.5 server: RCON commands, a command whose java_code throws, the exception
 *             grouped with its stack pointed at the command's java_code block (heavy: Gradle + server)
 *   --client  observe_run on the client with a screenshot, then game_screenshot of a kept client (heavy)
 *   --editor  editor_screenshot of a MCEdge window started by the UI test helper (needs npm run build:app)
 *   node tools/mcp-test/observe.ts [--server] [--client] [--editor]
 */
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupLogProblems } from "../../src/build/logProblems.ts";
import { enableRcon, RconClient } from "../../src/build/rcon.ts";
import { clientTasks, muteClient, serverTasks } from "../../src/build/runs.ts";
import { exampleProject, launchApp } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const ENGINE = "neoforge-1.21.5";
const heavy = ["--server", "--client"].some((f) => process.argv.includes(f));
if (heavy && existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); run without --server/--client");

// ---- log grouping ----
const sample = [
  "[12:00:01] [main/INFO] [minecraft/Main]: starting",
  "[12:00:02] [Server thread/WARN] [minecraft/Foo]: Missing sound for 12 events",
  "[12:00:03] [Server thread/WARN] [minecraft/Foo]: Missing sound for 7 events",
  "[12:00:04] [Server thread/ERROR] [minecraft/Commands]: Command exception: /probecrash",
  "java.lang.RuntimeException: mcedge-probe-crash",
  "\tat dev.mcedge.hello.command.ProbecrashCommandProgram.execute(ProbecrashCommandProgram.java:14)",
  "\tat com.mojang.brigadier.CommandDispatcher.execute(CommandDispatcher.java:200)",
  "[12:00:05] [Server thread/ERROR] [minecraft/Commands]: Command exception: /probecrash",
  "java.lang.RuntimeException: mcedge-probe-crash",
  "\tat dev.mcedge.hello.command.ProbecrashCommandProgram.execute(ProbecrashCommandProgram.java:14)",
  "Exception in thread \"main\" java.lang.IllegalStateException: boom",
  "\tat a.B.c(B.java:1)",
  "[12:00:06] [Render thread/WARN] (Minecraft) Fabric style warning",
  "FAILURE: Build failed with an exception.",
];
const grouped = groupLogProblems(sample);
assert(grouped.errors === 4 && grouped.warnings === 3, `log grouping counts (${grouped.errors} errors, ${grouped.warnings} warnings)`);
const crash = grouped.problems.find((p) => p.message.startsWith("Command exception"))!;
assert(crash.count === 2 && crash.stack?.[0] === "java.lang.RuntimeException: mcedge-probe-crash" && crash.stack[1].startsWith("at dev.mcedge"), "repeats count once; the stack stays with the first one");
assert(grouped.problems.find((p) => p.message.startsWith("Missing sound"))?.count === 2, "numbers are masked when grouping");
assert(grouped.problems.some((p) => p.source === "Minecraft" && p.level === "warning"), "Fabric log lines");
assert(grouped.problems.some((p) => p.message.startsWith("Exception in thread")) && grouped.problems.some((p) => p.source === "gradle"), "uncaught exceptions and Gradle failures");
assert(grouped.problems[0].level === "error", "errors first");
assert(groupLogProblems(sample, { warnings: false }).warnings === 0, "warnings can be left out");
assert(groupLogProblems(sample, { match: /hellomcedge|dev\.mcedge\.hello/ }).problems.length === 1, "mod-only filter matches the stack");
// Fabric's loader writes the reason as message lines between the exception and its frames (KUYRUK 150).
const fabric = groupLogProblems([
  "[17:30:42] [main/ERROR] (FabricLoader) Incompatible mods found!",
  "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!",
  "A potential solution has been determined, this may resolve your problem:",
  "\t - Install geckolib, any version.",
  "More details:",
  "\t - Mod 'Hello MCEdge' (hellomcedge) 0.1.0 requires any version of geckolib, which is missing!",
  "\tat net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51) ~[fabric-loader-0.20.1.jar:?]",
  "[17:30:43] [main/INFO] (FabricLoader) next",
]).problems;
assert(fabric.length === 1 && fabric[0].stack?.some((s) => s.includes("requires any version of geckolib")) && fabric[0].stack.at(-1)!.startsWith("at net.fabricmc"), "exception message lines stay with the problem");

// ---- RCON client against a fake server, and enableRcon ----
const fake = createServer((socket) => {
  let buf = Buffer.alloc(0);
  socket.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
      const len = buf.readInt32LE(0), id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.subarray(12, 4 + len - 2).toString();
      buf = buf.subarray(4 + len);
      const reply = (rid: number, text: string) => {
        const b = Buffer.from(text), p = Buffer.alloc(14 + b.length);
        p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(rid, 4); p.writeInt32LE(type === 3 ? 2 : 0, 8); b.copy(p, 12); socket.write(p);
      };
      if (type === 3) reply(body === "secret" ? id : -1, "");
      else reply(id, `ran ${body}`);
    }
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const port = (fake.address() as { port: number }).port;
const rcon = await RconClient.open({ port, password: "secret" });
assert((await rcon.command("/say hi")) === "ran say hi", "RCON client: login, command, leading / dropped");
rcon.close();
let refused = "";
await RconClient.open({ port, password: "wrong" }).catch((e: Error) => (refused = e.message));
assert(refused.includes("refused"), "RCON client: wrong password refused");
fake.close();
const engineDir = mkdtempSync(join(tmpdir(), "mcedge-rcon-"));
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(join(engineDir, "run"));
writeFileSync(join(engineDir, "run", "server.properties"), "motd=kept\nenable-rcon=false\nrcon.port=1\n");
const config = await enableRcon(engineDir);
const props = readFileSync(join(engineDir, "run", "server.properties"), "utf8");
assert(props.includes("motd=kept") && props.includes("enable-rcon=true") && props.includes(`rcon.port=${config.port}`) && !props.includes("rcon.port=1\n") && config.password.length === 24, "enableRcon keeps other properties");
// KUYRUK 190: the test server is offline-mode (other properties kept); clients join it on its server-port.
writeFileSync(join(engineDir, "run", "server.properties"), `${props}online-mode=true\nserver-port=25600\n`);
const engineSetup = { projectDir: engineDir, launcher: "", javaHome: "", installations: [] };
serverTasks(engineSetup);
const offline = readFileSync(join(engineDir, "run", "server.properties"), "utf8");
assert(offline.includes("motd=kept") && offline.includes("online-mode=false") && !offline.includes("online-mode=true"), "serverTasks sets online-mode=false and keeps the rest");
const script = (tasks: string[]) => readFileSync(tasks[1], "utf8");
const old = script(clientTasks(engineSetup, "1.16.5", { player: "Dev2", join: true }));
assert(old.includes("'--username', 'Dev2', '--server', '127.0.0.1', '--port', '25600'") && old.includes("-Dminecraft.api.services.host=http://127.0.0.1:1"), "1.16.5 client script: player, --server/--port, offline services");
const modern = script(clientTasks(engineSetup, "1.21.5", { join: true }));
assert(modern.includes("argumentProviders.add({ ['--username', 'Dev', '--quickPlayMultiplayer', '127.0.0.1:25600'] }") && modern.includes("else args('--username', 'Dev', '--quickPlayMultiplayer', '127.0.0.1:25600')") && !modern.includes("minecraft.api"), "modern client script: player and quick play, after ModDevGradle's argument file");

// ---- silent test clients ----
const quiet = mkdtempSync(join(tmpdir(), "mcedge-mute-"));
mkdirSync(join(quiet, "run"));
writeFileSync(join(quiet, "run", "options.txt"), "fov:0.5\r\nsoundCategory_master:1.0\r\nsoundCategory_music:0.7\r\n");
const sound = process.env.MCEDGE_TEST_SOUND;
delete process.env.MCEDGE_TEST_SOUND;
muteClient(quiet);
const muted = readFileSync(join(quiet, "run", "options.txt"), "utf8");
assert(muted.includes("soundCategory_master:0.0") && !muted.includes("soundCategory_master:1.0") && muted.includes("fov:0.5") && muted.includes("soundCategory_music:0.7"), "muteClient sets master volume 0 and keeps the other options");
process.env.MCEDGE_TEST_SOUND = "1";
writeFileSync(join(quiet, "run", "options.txt"), "soundCategory_master:1.0\n");
muteClient(quiet);
assert(readFileSync(join(quiet, "run", "options.txt"), "utf8").includes("soundCategory_master:1.0"), "MCEDGE_TEST_SOUND=1 keeps the sound");
if (sound === undefined) delete process.env.MCEDGE_TEST_SOUND;
else process.env.MCEDGE_TEST_SOUND = sound;

// ---- the tools ----
const project = exampleProject();
const mcp = await connect(project);
try {
  for (const tool of ["log_problems", "server_command", "game_screenshot", "editor_screenshot", "observe_run"]) assert(mcp.tools.includes(tool), `tool ${tool}`);
  const idle = await mcp.call("log_problems", { source: "server" });
  assert(idle.running === false && idle.errors === 0, "log_problems with nothing run");
  assert(String(await mcp.call("server_command", { commands: ["say hi"] }, true)).includes("no server"), "server_command without a server");
  assert(String(await mcp.call("game_screenshot", {}, true)).includes("no client"), "game_screenshot without a client");
  const wrong = await mcp.call("observe_run", { side: "client", engine: ENGINE, commands: ["say hi"] }, true);
  assert(String(wrong).includes("commands need side"), "observe_run refuses commands on the client");
  // KUYRUK 190: clients by player name.
  assert(String(await mcp.call("client_log", { username: "Dev2" })).startsWith("running: false"), "client_log of a player");
  assert(String(await mcp.call("stop_client", { username: "Dev2" })) === "no client of Dev2 running", "stop_client of a player");
  assert(String(await mcp.call("stop_client")) === "no client running", "stop_client of all");
  assert(String(await mcp.call("game_screenshot", { username: "Dev2" }, true)).includes("no client of Dev2"), "game_screenshot of a player");
  assert(/username/.test(String(await mcp.call("run_client", { engine: ENGINE, username: "no name" }, true))), "run_client refuses a bad player name");

  if (process.argv.includes("--server")) {
    await mcp.call("create_element", { type: "command", id: "probecrash", values: {
      commandName: "probecrash", type: "STANDARD", permissionLevel: "No requirement",
      argsxml: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [
        { block: "start" },
        { block: "log", inputs: { text: "[probe] before crash" } },
        { block: "java_code", fields: { code: "throw new RuntimeException(\"mcedge-probe-crash\");", deps: "", imports: "", gen: "1.21.5" } },
      ] }] },
    } });
    const run = await mcp.call("observe_run", { side: "server", engine: ENGINE, commands: ["say observe", "probecrash", "list"], waitSeconds: 3, modOnly: false });
    console.log(JSON.stringify({ ...run, problems: run.problems.slice(0, 4) }, null, 2).slice(0, 4000));
    assert(run.ready && run.readyAfterSeconds > 0 && run.stopped, `observe_run: server ready after ${run.readyAfterSeconds} s, stopped`);
    assert(run.commands.length === 3 && /players online/.test(run.commands[2].reply), "observe_run: RCON replies");
    const thrown = run.problems.find((p: any) => JSON.stringify(p).includes("mcedge-probe-crash"));
    assert(thrown, "observe_run: the command's exception is a problem");
    assert(thrown.origin?.element === "command/probecrash" && thrown.origin.block?.block === "java_code" && thrown.origin.block.path === "stacks[0].blocks[2]", `observe_run: stack pointed at the java_code block (${JSON.stringify(thrown.origin)})`);
    const after = await mcp.call("log_problems", { source: "server", modOnly: true });
    assert(after.running === false && after.problems.some((p: any) => p.origin?.element === "command/probecrash"), "log_problems after the run, mod only");
  }

  if (process.argv.includes("--client")) {
    const run = await mcp.call("observe_run", { side: "client", engine: ENGINE, screenshot: true, waitSeconds: 5, keepRunning: true, warnings: false });
    assert(run.ready && run.screenshot && existsSync(run.screenshot) && statSync(run.screenshot).size > 10_000, `observe_run: client ready, screenshot ${run.screenshot}`);
    const shot = await mcp.call("game_screenshot");
    assert(existsSync(shot.file) && statSync(shot.file).size > 10_000, `game_screenshot ${shot.file}`);
    await mcp.call("stop_client");
  }

  if (process.argv.includes("--editor")) {
    const app = await launchApp({ project });
    try {
      await new Promise((r) => setTimeout(r, 4000));
      const shot = await mcp.call("editor_screenshot");
      assert(existsSync(shot.file) && statSync(shot.file).size > 5_000, `editor_screenshot ${shot.file} (${statSync(shot.file).size} bytes), open: ${shot.open}`);
    } finally {
      await app.close();
    }
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
