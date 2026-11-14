import { ipcMain } from "electron";
import { readActivity, readPresence, writePresence } from "../../src/live/activity.ts";
import { addNote, deleteNote, readNotes } from "../../src/live/notes.ts";
import { createTask, deleteTask, listTasks, reviewTask, type TaskSource } from "../../src/live/tasks.ts";
import { readShow } from "../../src/live/show.ts";
import { undoCalls } from "../../src/live/timeline.ts";
import type { LiveState } from "../shared/api.ts";

/** Calls the agent timeline shows (older ones stay in activity.jsonl until it is trimmed). */
const TIMELINE_CALLS = 800;

/** Live co-editing: the agent's timeline, presence, notes and tasks for the app, and the app's presence for the agent. */
export function registerLive(): void {
  ipcMain.handle("live:state", (_e, dir: string): LiveState => ({ entries: readActivity(dir, TIMELINE_CALLS), agent: readPresence(dir, "agent"), notes: readNotes(dir), show: readShow(dir) }));
  ipcMain.handle("live:presence", (_e, dir: string, open: string, shown?: { id: string; error?: string }) =>
    writePresence(dir, { who: "app", at: new Date().toISOString(), open, pid: process.pid, ...(shown ? { shown } : {}) }));
  // Written like an outside change: the watcher reloads the project and the open editor merges the undone fields.
  ipcMain.handle("live:undo", (_e, dir: string, calls: string[]) => undoCalls(dir, calls));
  ipcMain.handle("live:addNote", (_e, dir: string, text: string, target?: string) => addNote(dir, text, target));
  ipcMain.handle("live:deleteNote", (_e, dir: string, id: string) => deleteNote(dir, id));
  // Tasks for the agent (KUYRUK 146); the watcher reports .mcedge/tasks changes, so the list refreshes from disk.
  ipcMain.handle("tasks:list", (_e, dir: string) => listTasks(dir));
  ipcMain.handle("tasks:create", (_e, dir: string, input: { title: string; detail?: string; source: TaskSource }) => createTask(dir, input));
  ipcMain.handle("tasks:review", (_e, dir: string, id: string, verdict: "accepted" | "reopened", comment?: string) => reviewTask(dir, id, verdict, comment));
  ipcMain.handle("tasks:delete", (_e, dir: string, id: string) => deleteTask(dir, id));
}
