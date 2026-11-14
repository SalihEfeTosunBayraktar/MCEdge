import type { FSWatcher } from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { blockbenchCandidates, findBlockbench, launchBlockbench, prepareBlockbench, watchBlockbench } from "../../src/resources/blockbenchEdit.ts";
import { loadProject } from "../../src/ir/storage.ts";
import type { BlockbenchOpen } from "../shared/api.ts";
import { readAppState } from "./appState.ts";

/** Models open in Blockbench, by project folder and model: their work folder is watched while the app runs. */
const sessions = new Map<string, FSWatcher>();

/**
 * Edit in Blockbench (KUYRUK 171): prepares the work folder (src/resources/blockbenchEdit.ts), starts Blockbench on it
 * and copies its saves back into the project, where the project watcher reports them like any outside change.
 */
export function registerBlockbench(): void {
  ipcMain.handle("blockbench:edit", (_e, dir: string, model: string, overrides: Record<string, string> = {}): BlockbenchOpen => {
    const configured = readAppState().preferences?.blockbenchPath;
    const exe = findBlockbench(configured);
    if (!exe) return { ok: false, searched: blockbenchCandidates(configured) };
    const key = `${dir}\n${model}`;
    sessions.get(key)?.close();
    const session = prepareBlockbench(dir, loadProject(dir).mod.id, model, overrides);
    sessions.set(key, watchBlockbench(session, () => {}));
    launchBlockbench(exe, session.file);
    return { ok: true, exe, file: session.file, textures: Object.values(session.textures) };
  });
  ipcMain.handle("blockbench:find", (_e, configured?: string) => findBlockbench(configured) ?? null);
  ipcMain.handle("dialog:program", async (event, current: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      defaultPath: current || undefined, properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Programs", extensions: ["exe"] }] : [],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
