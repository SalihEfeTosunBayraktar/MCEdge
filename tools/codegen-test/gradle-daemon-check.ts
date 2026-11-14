// KUYRUK #66: runGradle's recovery when Gradle's daemon is lost, with a fake gradle.bat (no Gradle, no game, Windows).
// usage: node tools/codegen-test/gradle-daemon-check.ts
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGradle } from "../../src/build/gradle.ts";

const dir = mkdtempSync(join(tmpdir(), "mcedge-daemon-check-"));
const launcher = join(dir, "gradle.bat");
const LOST = "echo FAILURE: Build failed with an exception.& echo Could not dispatch a message to the daemon.";
writeFileSync(launcher, [
  "@echo off",
  `if "%FAKE_MODE%"=="game" (echo ^> Task :runClient& ${LOST}& exit /b 1)`,
  `if "%FAKE_MODE%"=="always" (echo ^> Task :compileJava& ${LOST}& exit /b 1)`,
  `if "%FAKE_MODE%"=="once" (if exist "${dir}\seen" (echo BUILD SUCCESSFUL& exit /b 0) else (type nul > "${dir}\seen"& ${LOST}& exit /b 1))`,
  `if "%FAKE_MODE%"=="plain" (echo ^> Task :compileJava FAILED& exit /b 1)`,
  "echo BUILD SUCCESSFUL",
].join("\r\n"));
const setup = { projectDir: dir, launcher, javaHome: dir, installations: [] };

let failed = 0;
async function check(mode: string, expectCode: number, expectLines: RegExp[]) {
  rmSync(join(dir, "seen"), { force: true });
  process.env.FAKE_MODE = mode;
  const lines: string[] = [];
  const code = await runGradle(setup, "x", join(dir, `${mode}.log`), (l) => lines.push(l)).done;
  const notes = lines.filter((l) => l.startsWith("[mcedge]"));
  const ok = code === expectCode && expectLines.every((re) => notes.some((n) => re.test(n))) && (expectLines.length > 0 || notes.length === 0);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${mode}: exit ${code} (want ${expectCode}), notes: ${JSON.stringify(notes)}`);
}
await check("game", 0, [/closed and took Gradle's helper process/]);
await check("once", 0, [/trying once more/]);
await check("always", 1, [/trying once more/, /stopped unexpectedly/]);
await check("plain", 1, []);
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
