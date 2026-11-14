import { useEffect } from "react";

/**
 * Quick open (KUYRUK 136) shows a result in its section by handing the section a search text: the section's view takes
 * it when it mounts, or at once when it is already shown. Targets: "localization", "variables", "tags", "sounds",
 * "files:model", "files:structure".
 */
const pending = new Map<string, string>();
const listeners = new Set<(target: string) => void>();

export function reveal(target: string, query: string): void {
  pending.set(target, query);
  listeners.forEach((listener) => listener(target));
}

/** Applies a search text quick open left for this view. */
export function useRevealQuery(target: string, setQuery: (query: string) => void): void {
  useEffect(() => {
    const apply = () => {
      const query = pending.get(target);
      if (query === undefined) return;
      pending.delete(target);
      setQuery(query);
    };
    apply();
    const listener = (changed: string) => changed === target && apply();
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
}
