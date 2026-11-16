import { useCallback, useEffect, useRef, useState } from "react";
import type { AiEvent } from "../../../shared/api.ts";
import { api } from "../api.ts";

/** One piece of an AI reply, in the order it came. */
export type AiPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; status: "running" | "ok" | "error"; result?: string; call?: string };

/** A user message and the AI's reply to it. */
export interface AiTurn {
  id: string;
  user: string;
  parts: AiPart[];
  running: boolean;
  stopped?: boolean;
  /** A provider or server error (message), or the tool round limit (code). */
  error?: { message: string; code?: "rounds" };
}

/** Applies one loop event to its turn. */
function apply(turn: AiTurn, event: AiEvent): AiTurn {
  if (event.type === "text") return { ...turn, parts: [...turn.parts, { kind: "text", text: event.text }] };
  if (event.type === "error") return { ...turn, error: { message: event.message, code: event.code } };
  if (event.type === "done") return { ...turn, running: false, ...(event.stopped ? { stopped: true } : {}) };
  const part: AiPart = { kind: "tool", id: event.id, name: event.name, args: event.args, status: event.status, result: event.result, call: event.call };
  const at = turn.parts.findIndex((p) => p.kind === "tool" && p.id === event.id);
  return { ...turn, parts: at < 0 ? [...turn.parts, part] : turn.parts.map((p, i) => (i === at ? part : p)) };
}

/**
 * The AI panel's conversation of the open project (Q239): kept in memory here, so closing the drawer does not lose it, and
 * dropped with the project (which also stops the panel's MCP server in the main process).
 */
export function useAiPanel(dir: string | undefined) {
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const count = useRef(0);
  const running = turns.some((turn) => turn.running);

  useEffect(() => {
    if (!dir) return;
    setTurns([]);
    const off = api.onAiEvent((message) => {
      if (message.dir !== dir) return;
      setTurns((all) => all.map((turn) => (turn.id === message.reply ? apply(turn, message.event) : turn)));
    });
    return () => {
      off();
      void api.aiReset(dir, true);
    };
  }, [dir]);

  const send = useCallback((text: string) => {
    if (!dir || !text.trim()) return;
    const id = `reply${Date.now().toString(36)}${++count.current}`;
    setTurns((all) => [...all, { id, user: text.trim(), parts: [], running: true }]);
    api.aiSend(dir, id, text.trim()).catch((error) => {
      const message = String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, running: false, error: { message } } : turn)));
    });
  }, [dir]);
  const stop = useCallback(() => dir && void api.aiStop(dir), [dir]);
  const reset = useCallback(() => {
    if (!dir) return;
    void api.aiReset(dir);
    setTurns([]);
  }, [dir]);

  return { turns, running, send, stop, reset };
}
