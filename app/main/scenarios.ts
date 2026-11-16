import { join } from "node:path";
import { ipcMain, type WebContents } from "electron";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { resolveModDependencies } from "../../src/build/modDependencies.ts";
import { loadProject } from "../../src/ir/storage.ts";
import {
  DEFAULT_TIMEOUT_SECONDS, listScenarioFiles, readScenarioFile, reloadServerData, runProbe, scenarioTemplate, serverPortInUse, textProblems, writeScenarioFile,
  type ProbeHost,
} from "../../src/build/scenarioRun.ts";
import type { Scenario } from "../../src/build/scenario.ts";
import { runKey, type ScenarioRunOutcome, type ScenarioStatus } from "../shared/api.ts";
import { runActive, serverRun, startServer, stopRun } from "./tools.ts";

const engineOf = (id: string) => {
  const engine = listEngines().find((e) => e.id === id);
  if (!engine) throw new Error(`unknown engine ${id}`);
  return engine;
};

/** The app's dedicated server of an engine as the shared scenario runner's host (the same run Build & run > Run server makes). */
function host(sender: WebContents, dir: string, engineId: string): ProbeHost {
  const key = runKey(engineId, "server");
  return {
    running: () => runActive(key),
    exitCode: () => serverRun(key)?.exitCode,
    tail: (lines) => (serverRun(key)?.lines ?? []).slice(-lines).join("\n"),
    logFile: () => serverRun(key)?.logFile,
    start: async () => {
      void startServer(sender, dir, engineId, {});
      // Preparing (toolchains, generation) counts as running; wait until the run has been taken.
      for (let i = 0; i < 50 && !runActive(key); i++) await new Promise((r) => setTimeout(r, 100));
    },
    stop: () => stopRun(key),
  };
}

/** Scenarios panel (Q241): the project's scenario files, runs on a dedicated server and Reload data. */
export function registerScenarios(): void {
  ipcMain.handle("scenarios:list", (_e, dir: string) => listScenarioFiles(dir));
  ipcMain.handle("scenarios:read", (_e, dir: string, name: string) => readScenarioFile(dir, name));
  ipcMain.handle("scenarios:write", (_e, dir: string, name: string, text: string) => writeScenarioFile(dir, name, text));
  ipcMain.handle("scenarios:template", () => JSON.stringify(scenarioTemplate(), null, 2));
  ipcMain.handle("scenarios:problems", (_e, text: string) => textProblems(text));
  ipcMain.handle("scenarios:status", async (_e, dir: string, engineId: string): Promise<ScenarioStatus> => {
    engineOf(engineId);
    const key = runKey(engineId, "server");
    const own = runActive(key);
    return { own, foreign: !own && await serverPortInUse(join(dir, "out", engineId)), reloadable: own && !!serverRun(key)?.rcon };
  });
  ipcMain.handle("scenarios:run", async (event, dir: string, engineId: string, name: string): Promise<ScenarioRunOutcome> => {
    try {
      engineOf(engineId);
      const key = runKey(engineId, "server");
      if (runActive(key)) return { ok: false, error: "serverRunning" };
      if (await serverPortInUse(join(dir, "out", engineId))) return { ok: false, error: "serverForeign" };
      const text = readScenarioFile(dir, name);
      const problems = textProblems(text);
      if (problems.length) return { ok: false, error: problems.join("\n") };
      const result = await runProbe(host(event.sender, dir, engineId), join(dir, "out", engineId), JSON.parse(text) as Scenario, DEFAULT_TIMEOUT_SECONDS);
      return { ok: result.failed === 0 && result.errors === 0 && !result.fatal, result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // Regenerates the project into the engine's folder and runs /reload on the app's running dedicated server.
  ipcMain.handle("scenarios:reload", async (_e, dir: string, engineId: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const engine = engineOf(engineId);
      const rcon = serverRun(runKey(engineId, "server"))?.rcon;
      if (!runActive(runKey(engineId, "server")) || !rcon) return { ok: false, message: "noServer" };
      const outDir = join(dir, "out", engineId);
      await resolveModDependencies(loadProject(dir).mod.dependencies, engine);
      generateTarget(loadProject(dir), dir, engine, outDir);
      return { ok: true, message: await reloadServerData(outDir, rcon) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}
