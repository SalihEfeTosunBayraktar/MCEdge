import { app, dialog, shell } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateCheck } from "../shared/api.ts";

const RELEASES_API = "https://api.github.com/repos/SalihEfeTosunBayraktar/MCEdge/releases/latest";

/**
 * Installed builds update themselves from GitHub Releases (download in the background, install on quit).
 * The portable build cannot replace itself, so it only points the user to the new release.
 */
export function checkForUpdates(): void {
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    void notifyPortableUpdate().catch(() => {});
    return;
  }
  void electronUpdater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

async function notifyPortableUpdate(): Promise<void> {
  const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) return;
  const release = (await response.json()) as { tag_name: string; html_url: string };
  const latest = release.tag_name.replace(/^v/, "");
  if (!isNewer(latest, app.getVersion())) return;
  const { response: choice } = await dialog.showMessageBox({
    type: "info",
    message: `MCEdge ${latest} is available (you have ${app.getVersion()}).`,
    detail: "The portable version cannot update itself. Download the new portable build from GitHub.",
    buttons: ["Open download page", "Later"],
  });
  if (choice === 0) await shell.openExternal(release.html_url);
}

function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Help > Check for updates (KUYRUK 128): asks GitHub for the latest release; an installed build downloads it (installed on quit). */
export async function checkForUpdatesNow(): Promise<UpdateCheck> {
  const current = app.getVersion();
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return { status: "failed", current, message: `${response.status} ${response.statusText}` };
    const release = (await response.json()) as { tag_name: string; html_url: string };
    const latest = release.tag_name.replace(/^v/, "");
    if (!isNewer(latest, current)) return { status: "latest", current, latest };
    const install = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR ? "download" : "manual";
    if (install === "download") void electronUpdater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    return { status: "available", current, latest, url: release.html_url, install };
  } catch (error) {
    return { status: "failed", current, message: error instanceof Error ? error.message : String(error) };
  }
}
