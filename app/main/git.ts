import { ipcMain } from "electron";
import { gitBranches, gitCommit, gitCreateBranch, gitDiff, gitDiscard, gitInit, gitLog, gitPull, gitPush, gitRevert, gitShow, gitStage, gitStatus, gitSwitchBranch, gitUnstage } from "../../src/vcs/git.ts";

/** Git panel: thin IPC over the core git module (src/vcs/git.ts), which the MCP server uses too. */
export function registerGit(): void {
  ipcMain.handle("git:status", (_e, dir: string) => gitStatus(dir));
  ipcMain.handle("git:init", async (_e, dir: string) => (await gitInit(dir), gitStatus(dir)));
  ipcMain.handle("git:diff", (_e, dir: string, path: string, staged: boolean) => gitDiff(dir, path, staged));
  ipcMain.handle("git:stage", async (_e, dir: string, paths: string[]) => (await gitStage(dir, paths), gitStatus(dir)));
  ipcMain.handle("git:unstage", async (_e, dir: string, paths: string[]) => (await gitUnstage(dir, paths), gitStatus(dir)));
  ipcMain.handle("git:discard", async (_e, dir: string, paths: string[]) => {
    // Discarded files change on disk because the user asked; the editor reloads them like any outside change.
    await gitDiscard(dir, paths);
    return gitStatus(dir);
  });
  ipcMain.handle("git:commit", async (_e, dir: string, message: string, all: boolean, branch?: string) => (await gitCommit(dir, message, all, branch), gitStatus(dir)));
  ipcMain.handle("git:branches", (_e, dir: string) => gitBranches(dir));
  ipcMain.handle("git:createBranch", async (_e, dir: string, name: string) => (await gitCreateBranch(dir, name), gitStatus(dir)));
  // Switching rewrites files on disk; the editor reloads them like any outside change.
  ipcMain.handle("git:switchBranch", async (_e, dir: string, name: string) => (await gitSwitchBranch(dir, name), gitStatus(dir)));
  ipcMain.handle("git:log", (_e, dir: string, limit?: number, all?: boolean) => gitLog(dir, limit, all));
  ipcMain.handle("git:show", (_e, dir: string, hash: string) => gitShow(dir, hash));
  ipcMain.handle("git:revert", async (_e, dir: string, hash: string) => (await gitRevert(dir, hash), gitStatus(dir)));
  ipcMain.handle("git:pull", async (_e, dir: string) => ({ output: (await gitPull(dir)).trim(), status: await gitStatus(dir) }));
  ipcMain.handle("git:push", async (_e, dir: string) => ({ output: (await gitPush(dir)).trim(), status: await gitStatus(dir) }));
}
