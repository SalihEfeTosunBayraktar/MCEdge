import { useState } from "react";

/** A yes/no setting of the window (a panel collapsed or expanded) kept in localStorage on this machine; unavailable storage just does not keep it. */
export function useStoredFlag(name: string, initial: boolean): [boolean, (value: boolean) => void] {
  const key = `mcedge.ui.${name}`;
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  return [value, (next) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch { /* not kept */ }
  }];
}
