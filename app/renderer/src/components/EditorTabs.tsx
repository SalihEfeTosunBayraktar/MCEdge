import { useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { spriteFor } from "../catalog.ts";
import { elementName, elementTexture, findElement } from "../model.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { Texture } from "./Texture.tsx";
import { ContextMenu } from "./ui.tsx";

/**
 * Editor tabs (KUYRUK 130, MCreator's tabbed editors): every element, procedure and texture opened stays as a tab after
 * the section's own tab. Click shows it, the x or a middle click closes it, the right-click menu closes it, the
 * others or all. A tab key is "element:<type>/<id>" or "texture:<path>".
 */
export type TabKey = string;
export const elementTab = (typeId: string, id: string): TabKey => `element:${typeId}/${id}`;
export const textureTab = (path: string): TabKey => `texture:${path}`;

/** The element or texture a tab key names. */
export function parseTab(key: TabKey): { kind: "element"; typeId: string; id: string } | { kind: "texture"; path: string } | undefined {
  if (key.startsWith("texture:")) return { kind: "texture", path: key.slice(8) };
  const m = /^element:([^/]+)\/(.+)$/.exec(key);
  return m ? { kind: "element", typeId: m[1], id: m[2] } : undefined;
}

/** Whether what a tab names still exists in the project. */
export function tabExists(snapshot: ProjectSnapshot, key: TabKey): boolean {
  const tab = parseTab(key);
  if (!tab) return false;
  return tab.kind === "texture" ? snapshot.textures.includes(tab.path) : !!findElement(snapshot, tab);
}

function TabLabel({ snapshot, tabKey }: { snapshot: ProjectSnapshot; tabKey: TabKey }) {
  const tab = parseTab(tabKey)!;
  if (tab.kind === "texture") {
    return <><Texture dir={snapshot.dir} path={tab.path} size={16} /><span className="etname">{tab.path.slice(tab.path.lastIndexOf("/") + 1)}</span></>;
  }
  const element = findElement(snapshot, tab);
  const texture = element ? elementTexture(snapshot, tab.typeId, element) : "";
  return (
    <>
      {texture ? <Texture dir={snapshot.dir} path={texture} size={16} /> : <Sprite name={spriteFor(tab.typeId)} size={16} />}
      <span className="etname">{element ? elementName(tab.typeId, element) : tab.id}</span>
    </>
  );
}

export function EditorTabs({ snapshot, sectionName, tabs, active, onShow, onShowSection, onClose }: {
  snapshot: ProjectSnapshot;
  /** The section's own tab, first and never closed. */
  sectionName: string;
  tabs: TabKey[];
  active?: TabKey;
  onShow: (key: TabKey) => void;
  onShowSection: () => void;
  /** Closes these tabs. */
  onClose: (keys: TabKey[]) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; key: TabKey }>();
  return (
    <div className="edtabs" role="tablist" aria-label={t("tabs.label")}>
      <button type="button" role="tab" aria-selected={!active} className={`edtab section ${!active ? "on" : ""}`} onClick={onShowSection}>
        <span className="etname">{sectionName}</span>
      </button>
      {tabs.map((key) => (
        <div key={key} role="tab" aria-selected={key === active} data-tab={key} className={`edtab ${key === active ? "on" : ""}`} tabIndex={0}
          onClick={() => onShow(key)} onKeyDown={(e) => e.key === "Enter" && onShow(key)}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => e.button === 1 && onClose([key])}
          onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, key }))}>
          <TabLabel snapshot={snapshot} tabKey={key} />
          <button type="button" className="etclose" title={`${t("tabs.close")} (Ctrl+W)`} aria-label={t("tabs.close")}
            onClick={(e) => (e.stopPropagation(), onClose([key]))}><Icon name="close" size={10} /></button>
        </div>
      ))}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} items={[
          { label: t("tabs.close"), shortcut: "Ctrl+W", onClick: () => onClose([menu.key]) },
          { label: t("tabs.closeOthers"), onClick: tabs.length > 1 ? () => onClose(tabs.filter((k) => k !== menu.key)) : undefined },
          { label: t("tabs.closeAll"), onClick: () => onClose(tabs) },
        ]} />
      )}
    </div>
  );
}
