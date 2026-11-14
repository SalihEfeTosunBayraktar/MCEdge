import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LIVE_DIR } from "./activity.ts";

/**
 * Notes the user leaves for the AI agent in the app's Agents panel (.mcedge/live/notes.json). The agent reads
 * them over MCP (read_notes; every tool result mentions new ones) and acknowledges them, optionally with a reply.
 */
export interface AgentNote {
  id: string;
  /** ISO time it was written. */
  at: string;
  text: string;
  /** What it is about: "item/ruby", a field "item/ruby#stackSize", or nothing. */
  target?: string;
  ack?: { at: string; reply?: string; client?: string };
}

const notesFile = (dir: string) => join(dir, LIVE_DIR, "notes.json");

export function readNotes(dir: string): AgentNote[] {
  try {
    return existsSync(notesFile(dir)) ? (JSON.parse(readFileSync(notesFile(dir), "utf8")) as AgentNote[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(dir: string, notes: AgentNote[]): AgentNote[] {
  mkdirSync(dirname(notesFile(dir)), { recursive: true });
  writeFileSync(notesFile(dir), JSON.stringify(notes, null, 2) + "\n");
  return notes;
}

export function addNote(dir: string, text: string, target?: string): AgentNote[] {
  const notes = readNotes(dir);
  const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return writeNotes(dir, [...notes, { id, at: new Date().toISOString(), text: text.trim(), ...(target ? { target } : {}) }]);
}

export function deleteNote(dir: string, id: string): AgentNote[] {
  return writeNotes(dir, readNotes(dir).filter((n) => n.id !== id));
}

export function ackNote(dir: string, id: string, reply?: string, client?: string): AgentNote {
  const notes = readNotes(dir);
  const note = notes.find((n) => n.id === id);
  if (!note) throw new Error(`no note ${id}; read_notes lists them`);
  note.ack = { at: new Date().toISOString(), ...(reply ? { reply } : {}), ...(client ? { client } : {}) };
  writeNotes(dir, notes);
  return note;
}
