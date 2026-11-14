import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { toolchainPath } from "../engines/toolchains.ts";
import type { GradleSetup } from "../build/gradle.ts";

/**
 * A hand-written Gradle mod (e.g. a decompiled or MCreator-exported project) that MCEdge builds and runs
 * as-is with the project's own Gradle wrapper. Optional settings live in .mcedge/gradle-project.json.
 */
export interface GradleModProject {
  dir: string;
  name: string;
  /** JDK feature version used to run Gradle and compile, e.g. 8 for Forge 1.16.5. */
  jdk: number;
}

const DESCRIPTOR = join(".mcedge", "gradle-project.json");
const DEFAULT_JDK = 8;

export function isGradleModProject(dir: string): boolean {
  return existsSync(join(dir, "build.gradle")) || existsSync(join(dir, "build.gradle.kts"));
}

export function loadGradleModProject(dir: string): GradleModProject {
  const descriptor = join(dir, DESCRIPTOR);
  const settings: Partial<GradleModProject> = existsSync(descriptor) ? JSON.parse(readFileSync(descriptor, "utf8")) : {};
  return { dir, name: settings.name ?? basename(dir), jdk: settings.jdk ?? detectJdk(dir) };
}

export function gradleModSetup(project: GradleModProject): GradleSetup {
  const wrapper = join(project.dir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!existsSync(wrapper)) throw new Error(`no Gradle wrapper in ${project.dir}`);
  const jdk = toolchainPath("jdk", project.jdk);
  return { projectDir: project.dir, launcher: wrapper, javaHome: jdk, installations: [jdk] };
}

/** Reads `JavaLanguageVersion.of(N)` from the build script; mods without it are old enough for Java 8. */
function detectJdk(dir: string): number {
  const script = ["build.gradle", "build.gradle.kts"].map((name) => join(dir, name)).find(existsSync);
  const match = script && /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/.exec(readFileSync(script, "utf8"));
  return match ? Number(match[1]) : DEFAULT_JDK;
}
