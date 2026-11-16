import { app, BrowserWindow } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import type { UpdateState } from "../shared/api.ts";
import { readAppState } from "./appState.ts";

const RELEASES_API = "https://api.github.com/repos/SalihEfeTosunBayraktar/MCEdge/releases/latest";
/** Automatic checks: on start, then this often while the app runs (Q207). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const { autoUpdater } = electronUpdater;
let state: UpdateState = { status: "idle", current: app.getVersion() };

/** Installed (NSIS) builds update themselves; the portable exe and a dev checkout only link to the new release. */
const selfUpdating = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;

function setState(next: Omit<UpdateState, "current">): void {
  state = { ...next, current: app.getVersion() };
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updates:state", state);
}

export const updateState = (): UpdateState => state;

/**
 * Installed builds download a new GitHub release in the background and report each step to the renderer (Q207); the
 * update installs on Restart now or when the app quits. The portable build cannot replace itself, so it only shows
 * the new release. Checks run on start and every few hours unless Preferences turn them off.
 */
export function startUpdater(): void {
  if (!app.isPackaged) return;
  if (selfUpdating()) {
    // Test-only: the auto-update test (tools/ui-test/auto-update.ts) serves a release from a local generic feed.
    if (process.env.MCEDGE_UPDATE_FEED) autoUpdater.setFeedURL({ provider: "generic", url: process.env.MCEDGE_UPDATE_FEED });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => state.status === "idle" && setState({ status: "checking" }));
    autoUpdater.on("update-not-available", () => setState({ status: "latest" }));
    autoUpdater.on("update-available", (info: UpdateInfo) => setState({ status: "downloading", latest: info.version, notes: releaseNotes(info), percent: 0 }));
    autoUpdater.on("download-progress", (progress: { percent: number }) => setState({ ...state, status: "downloading", percent: Math.floor(progress.percent) }));
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => setState({ status: "ready", latest: info.version, notes: releaseNotes(info) }));
    autoUpdater.on("error", (error: Error) => state.status !== "ready" && setState({ status: "failed", message: error.message }));
  }
  const automatic = () => {
    if (readAppState().preferences?.autoUpdate !== false) void checkForUpdatesNow();
  };
  automatic();
  setInterval(automatic, CHECK_INTERVAL_MS);
}

/** Runs a check and resolves with the state it ends in; Help > Check for updates calls it whatever the preference. */
export async function checkForUpdatesNow(): Promise<UpdateState> {
  try {
    await check();
  } catch (error) {
    setState({ status: "failed", message: error instanceof Error ? error.message : String(error) });
  }
  return state;
}

async function check(): Promise<void> {
  // A download in progress or waiting for the restart is not started again.
  if (state.status === "downloading" || state.status === "ready") return;
  if (selfUpdating()) {
    await autoUpdater.checkForUpdates();
    return;
  }
  setState({ status: "checking" });
  const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const release = (await response.json()) as { tag_name: string; html_url: string; body?: string };
  const latest = release.tag_name.replace(/^v/, "");
  setState(isNewer(latest, app.getVersion()) ? { status: "available", latest, url: release.html_url, notes: release.body?.trim() || undefined } : { status: "latest" });
}

/** Restart now: installs silently and starts the new version. */
export function installUpdate(): void {
  if (state.status === "ready") autoUpdater.quitAndInstall(true, true);
}

/** GitHub sends release notes as HTML; the dialog shows them as plain lines and "- " list items. */
function releaseNotes(info: UpdateInfo): string | undefined {
  const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => n.note ?? "").join("\n") : info.releaseNotes;
  if (!notes) return undefined;
  const text = notes
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|ul|ol|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
