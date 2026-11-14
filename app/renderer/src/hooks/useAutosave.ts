import { useEffect, useRef, useState } from "react";
import { beginSave } from "../saveStatus.ts";

const SAVE_DELAY_MS = 400;

/**
 * Local editable copy of `source` that is written back with `save` shortly after the last change.
 * A change still waiting when the editor closes is saved right away. Returns the draft, a setter,
 * whether a save is pending, and `replace`, which swaps the draft without saving (the new value is
 * already on disk, e.g. an outside change merged in) and drops a save that was still waiting.
 */
export function useAutosave<T>(source: T, save: (value: T) => Promise<void>): [T, (next: T) => void, boolean, (next: T) => void] {
  const [draft, setDraft] = useState(source);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsaved = useRef<{ value: T } | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => (pending ? beginSave() : undefined), [pending]);
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (unsaved.current) void saveRef.current(unsaved.current.value);
  }, []);

  const update = (next: T) => {
    setDraft(next);
    setPending(true);
    unsaved.current = { value: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      unsaved.current = undefined;
      await saveRef.current(next);
      setPending(false);
    }, SAVE_DELAY_MS);
  };
  const replace = (next: T) => {
    clearTimeout(timer.current);
    unsaved.current = undefined;
    setPending(false);
    setDraft(next);
  };
  return [draft, update, pending, replace];
}
