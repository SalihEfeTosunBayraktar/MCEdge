import { useState } from "react";

/** View state kept while the app runs, by "scope:name": a view that unmounts (an element editor opens) gets it back. */
const kept = new Map<string, unknown>();

/** useState whose value outlives the component; `scope` separates projects. */
export function useViewState<T>(scope: string, name: string, initial: T): [T, (value: T) => void] {
  const key = `${scope}:${name}`;
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  const set = (next: T) => {
    kept.set(key, next);
    setValue(next);
  };
  return [value, set];
}
