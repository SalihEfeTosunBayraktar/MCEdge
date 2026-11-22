/**
 * Q250: memory, CPU and start time of the app (hidden window, own user data), for before/after numbers of light mode.
 *   PERF_PREFS='{"performance":{"render3d":false}}' node tools/ui-test/perf-measure.ts [label]
 * Prints one JSON line: start time to the element grid, then the working set (MB) and idle CPU (%) of the whole process
 * tree with the project open, and again with a block element (3D cube preview) open.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject, launchApp } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "block", "cube_demo", { name: "Ruby Cube", texture: "textures/ruby_block.png" });
const userData = mkdtempSync(join(tmpdir(), "mcedge-perf-"));
mkdirSync(userData, { recursive: true });
const preferences = { language: "en", theme: "dark", fontScale: 1, uiFont: "", codeFont: "", level: "java", mode: "advanced", ...JSON.parse(process.env.PERF_PREFS ?? "{}") };
writeFileSync(join(userData, "app-state.json"), JSON.stringify({ exportFolders: {}, recent: [{ dir: project, name: "perf", openedAt: new Date().toISOString() }], preferences }));

/** Working set (MB) and CPU seconds of a process and all its descendants. */
function tree(rootPid: number): { mb: number; cpu: number; processes: number } {
  const script = `$all = Get-CimInstance Win32_Process; $ids = @(${rootPid}); $n = 0
    do { $n = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -gt $n)
    $m = $all | Where-Object { $ids -contains $_.ProcessId }
    $cpu = ($m | ForEach-Object { ($_.KernelModeTime + $_.UserModeTime) } | Measure-Object -Sum).Sum / 1e7
    $ws = ($m | Measure-Object WorkingSetSize -Sum).Sum / 1MB
    "$ws $cpu $($m.Count)"`;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true }).stdout.trim().split(" ").map(Number);
  return { mb: Math.round(out[0]), cpu: out[1], processes: out[2] };
}

const t0 = Date.now();
const app = await launchApp({ project, userData });
try {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  const startMs = Date.now() - t0;
  const pid = await app.mainEval<number>("process.pid");
  const sample = async () => {
    await app.sleep(4000);
    const a = tree(pid);
    await app.sleep(5000);
    const b = tree(pid);
    return { mb: b.mb, processes: b.processes, idleCpuPct: Math.round(((b.cpu - a.cpu) / 5) * 1000) / 10 };
  };
  const grid = await sample();
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === "Ruby Cube").id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Cube"`);
  const editor = await sample();
  console.log(JSON.stringify({ label: process.argv[2] ?? "run", startMs, grid, editor, cores: 16 }));
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
