import "./env.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { readAppState } from "./appState.ts";
import { setCurseforgeKeyReader } from "../../src/build/modDependencies.ts";
import { registerIpc } from "./ipc.ts";
import { registerCodeProject } from "./codeProject.ts";
import { registerGit } from "./git.ts";
import { registerBlockbench } from "./blockbench.ts";
import { registerLive } from "./live.ts";
import { registerGradleNotes } from "./gradleNotes.ts";
import { registerTools } from "./tools.ts";
import { checkForUpdates } from "./updater.ts";

/** Height of the app's own menu bar; the native window buttons are drawn over its right end. */
const TITLE_BAR_HEIGHT = 34;
const TITLE_BAR_THEMES = {
  dark: { color: "#1f1813", symbolColor: "#f4e8d6" },
  light: { color: "#e8dcc6", symbolColor: "#231a10" },
} as const;

/** In development the window would show Electron's icon; packaged builds take the icon from the exe. */
function devIcon(): string | undefined {
  const icon = join(app.getAppPath(), "build-resources", "icon.png");
  return !app.isPackaged && existsSync(icon) ? icon : undefined;
}

const TEST_HIDDEN = process.env.MCEDGE_TEST_HIDDEN === "1";

function createWindow(): void {
  const window = new BrowserWindow({
    icon: devIcon(),
    // No native title bar: the renderer's menu bar is the drag area and the system buttons overlay it.
    titleBarStyle: "hidden",
    titleBarOverlay: { ...TITLE_BAR_THEMES.dark, height: TITLE_BAR_HEIGHT },
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#1f1813",
    autoHideMenuBar: true,
    // UI tests (tools/ui-test/cdp.ts) set MCEDGE_TEST_HIDDEN=1: the window opens transparent, off screen, without focus
    // or a taskbar button. A hidden window would not paint, and CDP screenshots wait for a painted frame.
    ...(TEST_HIDDEN ? { show: false, x: -20000, y: -20000, opacity: 0, skipTaskbar: true, focusable: false } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (TEST_HIDDEN) window.once("ready-to-show", () => window.showInactive());
  // Chromium resets the zoom when a page finishes loading, so the saved text size is applied after that.
  window.webContents.on("did-finish-load", () => window.webContents.setZoomFactor(readAppState().preferences?.fontScale ?? 1));
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(join(__dirname, "../renderer/index.html"));
}

app.setAppUserModelId("dev.mcedge.app");

// Dependency jars from CurseForge use the key in this computer's Preferences (KUYRUK 173), read when they resolve.
setCurseforgeKeyReader(() => readAppState().preferences?.curseforgeKey);

app.whenReady().then(() => {
  // The menu bar is drawn by the app; the hidden native menu keeps only editing and view keys. Electron's default
  // Window menu would close the window on Ctrl+W, which closes the open editor (KUYRUK 128).
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }, { role: "viewMenu" }]));
  registerIpc();
  registerGradleNotes();
  registerTools();
  registerCodeProject();
  registerGit();
  registerBlockbench();
  registerLive();
  ipcMain.handle("window:theme", (event, theme: keyof typeof TITLE_BAR_THEMES) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setTitleBarOverlay({ ...TITLE_BAR_THEMES[theme], height: TITLE_BAR_HEIGHT });
  });
  createWindow();
  checkForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
