import { useEffect, useRef } from "react";

/**
 * Ctrl + mouse wheel zooms the view under the pointer (KUYRUK 179). React's wheel handlers are passive, so they
 * cannot stop the browser's own Ctrl + wheel page zoom (in MCEdge the window zoom is the Text size preference); this
 * listens natively, takes the event and calls `onStep` with +1 (wheel away: in) or -1 (towards: out).
 */
export function useCtrlWheel(ref: React.RefObject<HTMLElement | null>, onStep: (step: 1 | -1) => void): void {
  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => {
      if (!e.ctrlKey || !e.deltaY) return;
      e.preventDefault();
      latest.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [ref]);
}

// Anywhere else Ctrl + wheel does nothing: never the window zoom, which is the Text size preference.
window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
