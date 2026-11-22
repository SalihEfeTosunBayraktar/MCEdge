import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Engine } from "../engines/registry.ts";
import { toolchainPath } from "../engines/toolchains.ts";
import { memoryLimits, readPerformancePrefs } from "../performance.ts";

export interface BuildResult {
  ok: boolean;
  exitCode: number;
  jar?: string;
  logFile: string;
}

/** A running Gradle invocation; `done` resolves with the exit code. */
export interface GradleRun {
  done: Promise<number>;
  stop(): void;
  /** Process id of the current Gradle launcher (the game runs in its process tree). */
  readonly pid?: number;
}

/** How to invoke Gradle for one project: which launcher, which JVM runs it, which JDKs it may use. */
export interface GradleSetup {
  projectDir: string;
  /** gradle(.bat) of a managed distribution, or the project's own gradlew(.bat). */
  launcher: string;
  javaHome: string;
  /** JDK homes offered to Gradle toolchain resolution. */
  installations: string[];
}

/** Gradle setup for a project generated from an engine (managed Gradle and JDKs). */
export function engineSetup(engine: Engine, projectDir: string): GradleSetup {
  const gradleHome = toolchainPath("gradle", engine.gradle.version);
  return {
    projectDir,
    launcher: join(gradleHome, "bin", process.platform === "win32" ? "gradle.bat" : "gradle"),
    javaHome: toolchainPath("jdk", engine.gradle.jdk),
    installations: [toolchainPath("jdk", engine.java)],
  };
}

/** Builds a project; output streams to `onLine` and mcedge-build.log. */
export async function buildTarget(engine: Engine, projectDir: string, onLine: (line: string) => void = () => {}, onStart?: (run: GradleRun) => void): Promise<BuildResult> {
  return buildProject(engineSetup(engine, projectDir), onLine, onStart);
}

/** `onStart` gets the running Gradle process, so a caller can stop it (Build & run > Cancel task). */
export async function buildProject(setup: GradleSetup, onLine: (line: string) => void = () => {}, onStart?: (run: GradleRun) => void): Promise<BuildResult> {
  const logFile = logPath(setup, "mcedge-build.log");
  const run = runGradle(setup, "build", logFile, onLine);
  onStart?.(run);
  const exitCode = await run.done;
  return { ok: exitCode === 0, exitCode, jar: findJar(setup.projectDir), logFile };
}

/** The client of a Gradle mod (code project mode); clients of MCEdge projects start with clientTasks (src/build/runs.ts). */
export function runProjectClient(setup: GradleSetup, onLine: (line: string) => void = () => {}): GradleRun {
  return runGradle(setup, "runClient", logPath(setup, "mcedge-run.log"), onLine);
}

/** Notes the runner adds to the output when Gradle's helper process (the daemon) is lost. */
export type GradleNote = "daemonRetry" | "daemonEndedWithGame" | "daemonLost";
const ENGLISH_NOTES: Record<GradleNote, string> = {
  daemonRetry: "Gradle lost its helper process before the build got going; trying once more.",
  daemonEndedWithGame: "The game closed and took Gradle's helper process with it. This is normal for this Minecraft version; the run counts as finished.",
  daemonLost: "Gradle's helper process stopped unexpectedly. Something may have ended Java processes (a test run, a task manager); try again. Details are in the log.",
};
let noteText: (note: GradleNote) => string = (note) => ENGLISH_NOTES[note];
/** The app sets the text of the notes in the UI language; MCP and the CLI keep English. */
export function setGradleNoteText(text: (note: GradleNote) => string): void {
  noteText = text;
}

// The client's own message when the (single-use) daemon it talks to is gone.
const DAEMON_LOST = /Could not (?:dispatch a message to|receive a message from) the daemon|Gradle build daemon disappeared unexpectedly/;
// A task that starts the game; once it ran, the build got past configuration and compilation.
const GAME_TASK = /^> Task :(?:\S+:)?run\w*/;

/**
 * Runs Gradle tasks (and options such as -I); output goes to `onLine` and `logFile`.
 *
 * Losing the daemon is handled here (KUYRUK #66). Forge 1.16.5 runs the game inside the single-use daemon, so
 * closing the game ends the daemon with System.exit and Gradle reports "Could not dispatch/receive a message to/from
 * the daemon" for a run that worked: that counts as finished. A daemon killed before the game started (a test run
 * ending Java processes) is retried once; a second loss is reported with a readable note.
 */
export function runGradle(setup: GradleSetup, task: string | string[], logFile: string, onLine: (line: string) => void): GradleRun {
  const gradleMb = memoryLimits(readPerformancePrefs()).gradleMb;
  const args = [...(Array.isArray(task) ? task : [task]), "--no-daemon", "--console=plain", `-Dorg.gradle.java.installations.paths=${setup.installations.join(",")}`,
    // Light mode (Q250): the heap limit of the Gradle JVM; it replaces the project's org.gradle.jvmargs (no space in the value: the launcher is a .bat run through cmd.exe).
    ...(gradleMb ? [`-Dorg.gradle.jvmargs=-Xmx${gradleMb}m`] : [])];
  const isWindows = process.platform === "win32";
  // A .bat cannot be spawned directly; run it through cmd.exe instead of shell: true (unescaped args).
  const [command, commandArgs] = isWindows ? ["cmd.exe", ["/d", "/c", setup.launcher, ...args]] : [setup.launcher, args];

  const log = createWriteStream(logFile);
  const emit = (line: string) => { log.write(line + "\n"); onLine(line); };
  // English, UTF-8 output whatever the system locale: on a Turkish system Gradle otherwise prints "BUİLD" in the
  // console code page, which arrives garbled and breaks matching on "BUILD SUCCESSFUL".
  const gradleOpts = [process.env.GRADLE_OPTS ?? "", "-Duser.language=en", "-Duser.country=US", "-Dfile.encoding=UTF-8"].join(" ").trim();
  let child: ChildProcess | undefined;
  let stopped = false;
  const attempt = () => new Promise<{ code: number; daemonLost: boolean; gameRan: boolean }>((resolve) => {
    // No stdin: Gradle forwards it to the daemon and complains when the daemon is already gone at the end of input.
    const proc = spawn(command, commandArgs, { cwd: setup.projectDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, JAVA_HOME: setup.javaHome, GRADLE_OPTS: gradleOpts } });
    child = proc;
    let daemonLost = false;
    let gameRan = false;
    for (const stream of [proc.stdout, proc.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        if (DAEMON_LOST.test(line)) daemonLost = true;
        if (GAME_TASK.test(line)) gameRan = true;
        emit(line);
      });
    }
    proc.on("close", (code) => resolve({ code: code ?? -1, daemonLost, gameRan }));
  });
  const done = (async () => {
    let result = await attempt();
    if (result.code !== 0 && result.daemonLost && !result.gameRan && !stopped) {
      emit(`[mcedge] ${noteText("daemonRetry")}`);
      result = await attempt();
    }
    let code = result.code;
    if (code !== 0 && result.daemonLost && !stopped) {
      emit(`[mcedge] ${noteText(result.gameRan ? "daemonEndedWithGame" : "daemonLost")}`);
      if (result.gameRan) code = 0;
    }
    log.end();
    return code;
  })();
  return {
    done,
    get pid() {
      return child?.pid;
    },
    stop() {
      stopped = true;
      if (!child || child.exitCode !== null || !child.pid) return;
      // Gradle forks the game JVM; kill the whole tree, not just cmd.exe.
      if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    },
  };
}

/** Logs go under build/, which every mod project already ignores, so they never show up as changes. */
export function logPath(setup: GradleSetup, name: string): string {
  const dir = join(setup.projectDir, "build");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

/**
 * The mod jar a build made: build/libs keeps jars of earlier versions, so the jar named for the project's current
 * version wins ("etreco-1.8.7.jar", not 1.8.6 or 1.8.71), else the newest one (KUYRUK 109).
 */
export function findJar(projectDir: string): string | undefined {
  const libs = join(projectDir, "build", "libs");
  if (!existsSync(libs)) return undefined;
  const jars = readdirSync(libs)
    .filter((name) => name.endsWith(".jar") && !/-(sources|dev|all|javadoc)\.jar$/.test(name))
    .map((name) => ({ name, time: statSync(join(libs, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  const version = projectVersion(projectDir);
  const current = version ? jars.find((j) => j.name.endsWith(`-${version}.jar`)) : undefined;
  const jar = current ?? jars[0];
  return jar && join(libs, jar.name);
}

/** `version = '1.2.3'` of build.gradle, else mod_version / version of gradle.properties. */
function projectVersion(projectDir: string): string | undefined {
  const read = (name: string) => (existsSync(join(projectDir, name)) ? readFileSync(join(projectDir, name), "utf8") : "");
  const gradle = /^\s*version\s*=\s*['"]([^'"$]+)['"]/m.exec(read("build.gradle"));
  if (gradle) return gradle[1];
  return /^\s*(?:mod_)?version\s*=\s*(\S+)/m.exec(read("gradle.properties"))?.[1];
}
