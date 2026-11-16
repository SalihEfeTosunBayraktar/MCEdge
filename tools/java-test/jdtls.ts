/**
 * Q240 integration: downloads jdtls if missing (pinned version, checked SHA-256), starts it on a temp copy of
 * ETREconomy-Legacy (Forge 1.16.5, JDK 8, Gradle 7.6.4 wrapper), waits for the Gradle import, and gets a real
 * completion from the Minecraft classpath and an error diagnostic for a broken line. Stops jdtls and the Gradle
 * daemon it started; prints the RAM of that process tree. Heavy (Gradle import): first run several minutes.
 *   node tools/java-test/jdtls.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findToolchain, toolchainsDir } from "../../src/engines/toolchains.ts";
import { JavaServer, JDTLS_VERSION, type JavaStatus, type LspDiagnostic } from "../../src/java/jdtls.ts";
import { copyProject } from "../ui-test/cdp.ts";
import { assert } from "../mcp-test/client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting jdtls");

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-Legacy", "ETREconomy-Legacy");
const dataDir = mkdtempSync(join(tmpdir(), "mcedge-jdtls-"));
const FILE = "src/main/java/etreco/EtrecoMod.java";
const hadJdtls = !!findToolchain("jdtls", JDTLS_VERSION);
const statuses: JavaStatus[] = [];
const diagnostics = new Map<string, LspDiagnostic[]>();
const started = Date.now();
const server = new JavaServer({
  projectDir: project, projectJdk: 8, dataDir,
  onStatus: (s) => (statuses.push(s), s.state !== "downloading" && console.log(`status ${s.state}${s.detail ? `: ${s.detail}` : ""} (${Math.round((Date.now() - started) / 1000)} s)`)),
  onDiagnostics: (path, list) => diagnostics.set(path, list),
  onLog: (line) => process.env.JDTLS_VERBOSE && console.log(`  log ${line}`),
});
const waitFor = async (what: string, test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}; last status ${JSON.stringify(statuses.at(-1))}`);
    if (statuses.at(-1)?.state === "failed") throw new Error(`jdtls failed: ${statuses.at(-1)?.detail}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

/** Process ids of a process tree and its working set in MB (Windows). */
const tree = (pid: number): { ids: number[]; mb: number } => {
  const script = `$all = Get-CimInstance Win32_Process; $ids = @(${pid}); $i = 0; while ($i -lt $ids.Count) { $ids += @($all | ? { $_.ParentProcessId -eq $ids[$i] } | % { $_.ProcessId }); $i++ }; $p = @($all | ? { $ids -contains $_.ProcessId }); "$([math]::Round(($p | Measure-Object WorkingSetSize -Sum).Sum / 1MB)) $(($p | % { $_.ProcessId }) -join ',')"`;
  const [mb, ids] = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).stdout.trim().split(" ");
  return { mb: Number(mb), ids: (ids ?? "").split(",").filter(Boolean).map(Number) };
};

let ids: number[] = [];
try {
  // The decompiled sources use CRLF; the probes below are written with LF.
  const text = readFileSync(join(project, FILE), "utf8").replace(/\r\n/g, "\n");
  server.open(FILE, text);
  await server.start();
  if (!hadJdtls) {
    const folder = findToolchain("jdtls", JDTLS_VERSION)!;
    assert(statuses.some((s) => s.state === "downloading"), `jdtls ${JDTLS_VERSION} downloaded into ${folder}`);
    assert(statSync(join(folder, "plugins")).isDirectory(), "extracted into its own folder");
  }
  assert(!dataDir.startsWith(project) && existsSync(join(dataDir, "workspace")), `workspace data outside the project: ${dataDir}`);
  await waitFor("the Gradle import", () => server.state.state === "ready", 20 * 60_000);
  assert(statuses.some((s) => s.state === "importing"), "status went through importing");
  console.log(`ready after ${Math.round((Date.now() - started) / 1000)} s`);
  const eclipseFiles = [".project", ".classpath", ".settings"].filter((name) => existsSync(join(project, name)));
  assert(eclipseFiles.length === 0, `no Eclipse files written into the mod (${eclipseFiles.join(", ") || "none"})`);

  // Members of a Minecraft class: `net.minecraft.item.ItemStack.EMPTY.` inside the constructor body.
  const anchor = "   public EtrecoMod() {\n";
  const probe = "      net.minecraft.item.ItemStack.EMPTY.";
  const edited = text.replace(anchor, `${anchor}${probe}\n`);
  assert(edited !== text, "probe inserted into the constructor");
  server.change(FILE, edited);
  const line = edited.slice(0, edited.indexOf(probe)).split("\n").length - 1;
  let items: { label: string }[] = [];
  const end = Date.now() + 120_000;
  while (Date.now() < end && !items.some((i) => i.label.startsWith("getCount"))) {
    items = (await server.completion(FILE, { line, character: probe.length })).items;
    if (!items.length) await new Promise((r) => setTimeout(r, 2000));
  }
  assert(items.some((i) => i.label.startsWith("getCount")), `ItemStack members from the Forge 1.16.5 classpath: ${items.slice(0, 6).map((i) => i.label).join(" | ")}`);
  const resolved = await server.resolveCompletion(items.find((i) => i.label.startsWith("getCount"))!);
  assert(!!resolved.label, `resolve: ${resolved.detail ?? resolved.label}`);
  // Hover on `ResourceLocation` of the channel line (jdtls may be slow to attach sources: informational only).
  const hoverLine = edited.split("\n").findIndex((l) => l.includes("new ResourceLocation("));
  const hover = await server.hover(FILE, { line: hoverLine, character: edited.split("\n")[hoverLine].indexOf("ResourceLocation") + 2 }).catch((e: Error) => e.message);
  console.log(`hover: ${JSON.stringify(typeof hover === "string" ? hover : hover?.contents ?? null).slice(0, 160)}`);

  // A broken line gets an error diagnostic.
  const broken = text.replace(anchor, `${anchor}      int broken = "not a number";\n`);
  server.change(FILE, broken);
  // Diagnostics of the earlier probe text may still arrive first; wait for the one on the broken line.
  const onLine = () => (diagnostics.get(FILE) ?? []).find((d) => d.severity === 1 && d.range.start.line === line);
  await waitFor("an error diagnostic on the broken line", () => !!onLine(), 120_000);
  const error = onLine()!;
  assert(error.range.start.line === line, `error on the broken line ${error.range.start.line + 1}: ${error.message}`);
  server.change(FILE, text);
  await waitFor("the error to clear", () => !(diagnostics.get(FILE) ?? []).some((d) => d.severity === 1), 60_000);
  assert(true, "fixing the line clears the error");

  const memory = tree(server.pid!);
  ids = memory.ids;
  console.log(`RAM: jdtls tree ${memory.mb} MB in ${ids.length} processes (jdtls and the Gradle daemon); toolchains ${toolchainsDir()}`);
} finally {
  await server.stop();
}
await new Promise((r) => setTimeout(r, 1500));
const alive = spawnSync("powershell", ["-NoProfile", "-Command", `@(Get-Process -Id ${ids.join(",") || 0} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).stdout.trim();
assert(alive === "0", `no process of the jdtls tree left (${ids.length} checked)`);
console.log("PASS jdtls");
