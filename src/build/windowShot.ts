import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Which window to capture: the first visible window in a process tree, or of named processes, whose title matches. */
export interface WindowTarget {
  /** Root of a process tree (a Gradle launcher whose game JVM owns the window). */
  rootPid?: number;
  /** Process names without .exe ("MCEdge", "electron"), used when there is no rootPid. */
  processNames?: string[];
  /** PowerShell -like pattern on the window title ("Minecraft*"). */
  title: string;
}

/**
 * Saves a window's own image as PNG (PrintWindow, so windows in front of it never show and it may be in the
 * background), the way tools/codegen-test/run.ts takes game shots. Windows only. Returns an error text or undefined.
 */
export function captureWindow(target: WindowTarget, file: string): string | undefined {
  if (process.platform !== "win32") return "window screenshots work on Windows only";
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const pick = target.rootPid
    ? `$ids = @(${target.rootPid}); do { $n = $ids.Count; $ids = @($ids) + @(Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique } while ($ids.Count -ne $n); $p = Get-Process | Where-Object { $ids -contains $_.Id -and $_.MainWindowTitle -like ${quote(target.title)} } | Select-Object -First 1`
    : `$p = Get-Process -Name ${(target.processNames ?? []).map(quote).join(",")} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like ${quote(target.title)} } | Select-Object -First 1`;
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr h, System.IntPtr dc, uint flags); public struct RECT { public int L, T, R, B; }'`,
    pick,
    "if (-not $p) { Write-Output 'NOWINDOW'; exit 0 }",
    "$r = New-Object U.W+RECT; [U.W]::GetClientRect($p.MainWindowHandle, [ref]$r) | Out-Null",
    "if ($r.R -le $r.L -or $r.B -le $r.T) { Write-Output 'MINIMIZED'; exit 0 }",
    "$i = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T); $g = [System.Drawing.Graphics]::FromImage($i); $dc = $g.GetHdc()",
    "[U.W]::PrintWindow($p.MainWindowHandle, $dc, 3) | Out-Null; $g.ReleaseHdc($dc)",
    `$i.Save(${quote(file)}); $g.Dispose(); $i.Dispose(); Write-Output $p.MainWindowTitle`,
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  const out = (result.stdout ?? "").trim();
  if (out.includes("NOWINDOW")) return `no window titled "${target.title}" found`;
  if (out.includes("MINIMIZED")) return "the window is minimized; restore it first";
  if (!existsSync(file)) return `screenshot failed: ${(result.stderr ?? "").trim().slice(0, 300) || out}`;
  return undefined;
}
