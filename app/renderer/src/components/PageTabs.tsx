import { useEffect, useRef, useState } from "react";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { MenuList, TabList } from "./ui.tsx";

export interface PageTab {
  id: string;
  title: string;
  /** Problems on the page. */
  count?: number;
}

/**
 * The page tabs of an element editor (Q279): one 32 px row. Pages that do not fit scroll inside the row (the shown one is
 * kept in view) and the "More pages" menu at its end lists all of them, so an 11- or 13-page type works at 150 % text.
 */
export function PageTabs({ pages, active, onShow, label }: { pages: PageTab[]; active: string; onShow: (id: string) => void; label: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // The overflow is learned from the observer, which reports after the first layout: no forced layout while the editor mounts
  // (Q284: it was part of the element-switch long tasks). The shown page is scrolled into view only when it changes.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setOverflows(el.scrollWidth > el.clientWidth + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages.length]);
  const firstPage = useRef(true);
  useEffect(() => {
    // Block bodies on purpose: Chromium's scrollIntoView returns a Promise, which React would treat as a cleanup.
    const show = () => {
      row.current?.querySelector<HTMLElement>(".ltab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    if (!firstPage.current) {
      show();
      return;
    }
    firstPage.current = false;
    // A remembered page other than the first may sit off the row: bring it in after the first frame.
    if (pages[0]?.id !== active) requestAnimationFrame(show);
  }, [active]);
  return (
    <div className="pagetabbar">
      <div ref={row} className="pagetabrow">
        <TabList className="langtabs pagetabs" label={label}>
          {pages.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === active} className={`ltab ${p.id === active ? "on" : ""}`} onClick={() => onShow(p.id)}>
              {p.title}{!!p.count && <span className="pcount">{p.count}</span>}
            </button>
          ))}
        </TabList>
      </div>
      {overflows && (
        <div className="menuwrap pagemore">
          <button type="button" className="abtn compact" title={t("pages.more")} aria-label={t("pages.more")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="more" />
          </button>
          {menu && <MenuList onClose={() => setMenu(false)} label={t("pages.more")}
            items={pages.map((p) => ({ label: p.title, checked: p.id === active, onClick: () => onShow(p.id) }))} />}
        </div>
      )}
    </div>
  );
}
