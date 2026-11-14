import { useSyncExternalStore } from "react";

/** Number of editors with an unsaved change; the status bar shows "Saving..." while it is above zero. */
let pending = 0;
const listeners = new Set<() => void>();

export function beginSave(): () => void {
  pending++;
  listeners.forEach((l) => l());
  return () => {
    pending--;
    listeners.forEach((l) => l());
  };
}

export function useSaving(): boolean {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => pending > 0,
  );
}
