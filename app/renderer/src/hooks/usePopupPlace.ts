import { useLayoutEffect, useState } from "react";

/**
 * Where a picker's pop-up goes when it opens over the whole window (through a portal, not inside a narrow side panel):
 * under the field, or above it when there is more room there, kept inside the window.
 */
export function usePopupPlace(open: boolean, field: React.RefObject<HTMLElement | null>, size: { width: number; height: number }): React.CSSProperties | undefined {
  const [place, setPlace] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return setPlace(undefined);
    const fit = () => {
      const rect = field.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const width = Math.min(size.width, window.innerWidth - 2 * margin);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const height = Math.min(size.height, Math.max(below, above));
      const top = below >= Math.min(320, height) || below >= above ? rect.bottom + 2 : rect.top - 2 - height;
      setPlace({ left, top: Math.max(margin, top), width, maxHeight: height });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, field, size.width, size.height]);
  return place;
}
