// KUYRUK 109: build/libs keeps the jars of earlier versions (ETR: etreco-1.8.6, 1.8.7, 1.8.71) and the build reported
// the first one, 1.8.6, while Gradle wrote 1.8.7; Export jar copies the reported jar. findJar picks the jar of the
// project's current version (build.gradle `version`, else gradle.properties mod_version), else the newest; sources,
// dev, all and javadoc jars never count.
// usage: node tools/codegen-test/find-jar-check.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findJar } from "../../src/build/gradle.ts";

const dir = mkdtempSync(join(tmpdir(), "mcedge-findjar-"));
try {
  const libs = join(dir, "build", "libs");
  mkdirSync(libs, { recursive: true });
  // 1.8.6 sorts first and is oldest; 1.8.71 is the newest; 1.8.7 is the current version; a sources jar is newer still.
  const jars: [string, number][] = [["etreco-1.8.6.jar", 1000], ["etreco-1.8.7.jar", 2000], ["etreco-1.8.71.jar", 3000], ["etreco-1.8.7-sources.jar", 4000]];
  for (const [name, t] of jars) {
    writeFileSync(join(libs, name), "");
    utimesSync(join(libs, name), t, t);
  }
  const pick = () => basename(findJar(dir) ?? "");

  writeFileSync(join(dir, "build.gradle"), "plugins {}\nversion = '1.8.7'\ngroup = 'etreco'\n");
  assert.equal(pick(), "etreco-1.8.7.jar", "current version from build.gradle, not the first or the newest name");

  writeFileSync(join(dir, "build.gradle"), "plugins {}\nversion = project.mod_version\n");
  writeFileSync(join(dir, "gradle.properties"), "org.gradle.jvmargs=-Xmx2G\nmod_version=1.8.6\n");
  assert.equal(pick(), "etreco-1.8.6.jar", "current version from gradle.properties when build.gradle reads it");

  writeFileSync(join(dir, "gradle.properties"), "mod_version=2.0.0\n");
  assert.equal(pick(), "etreco-1.8.71.jar", "no jar of the current version: the newest");

  rmSync(join(dir, "build.gradle"));
  rmSync(join(dir, "gradle.properties"));
  assert.equal(pick(), "etreco-1.8.71.jar", "no version known: the newest");

  rmSync(libs, { recursive: true });
  assert.equal(findJar(dir), undefined, "no build/libs: no jar");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("find-jar-check OK");
