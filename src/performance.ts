import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import PERFORMANCE from "../config/performance.json" with { type: "json" };
import { userDataDir } from "./userData.ts";

/**
 * Light mode for weak computers (Q250). The renderer reads the three switches from the preferences; the memory limit is
 * applied here, for jdtls and for every Gradle run the app, the CLI and the MCP server start (config/performance.json).
 */
export interface PerformancePrefs {
  /** false hides the live previews of the element editor (the form preview, the radial menu wheel). */
  previews?: boolean;
  /** false draws no 3D (model preview, block face cube, seat preview, model tiles); the fields stay. */
  render3d?: boolean;
  /** true runs jdtls and Gradle with the smaller heap limits. */
  lowMemory?: boolean;
}

export interface MemoryLimits {
  mode: "normal" | "low";
  jdtlsMb: number;
  /** Heap limit of Gradle's JVM; undefined leaves what the project's gradle.properties says. */
  gradleMb?: number;
}

export function memoryLimits(prefs: PerformancePrefs | undefined): MemoryLimits {
  const mode = prefs?.lowMemory ? "low" : "normal";
  return { mode, ...PERFORMANCE.memory[mode] } as MemoryLimits;
}

/** The performance preferences of this computer, read from the app's state file (also for the CLI and the MCP server). */
export function readPerformancePrefs(): PerformancePrefs | undefined {
  try {
    return (JSON.parse(readFileSync(join(userDataDir(), "app-state.json"), "utf8")) as { preferences?: { performance?: PerformancePrefs } }).preferences?.performance;
  } catch {
    return undefined;
  }
}

export interface MachineInfo {
  ramGb: number;
  cores: number;
}

export function machineInfo(): MachineInfo {
  return { ramGb: Math.round((totalmem() / 2 ** 30) * 10) / 10, cores: cpus().length };
}

/** A computer at or under these limits is offered light mode on the first start. */
export function suggestLight(machine: MachineInfo): boolean {
  return machine.ramGb <= PERFORMANCE.suggestLight.maxRamGb || machine.cores <= PERFORMANCE.suggestLight.maxCores;
}
