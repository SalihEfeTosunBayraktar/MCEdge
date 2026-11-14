import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { spriteFor } from "../catalog.ts";
import { elementModel, elementName, elementTexture, issuesFor } from "../model.ts";
import { useModelThumbnail } from "../models/modelThumbnail.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { Texture } from "./Texture.tsx";

/** Drag data of an element tile: its folder key. */
export const ELEMENT_DRAG = "application/x-mcedge-element";

interface Props {
  snapshot: ProjectSnapshot;
  typeId: string;
  element: Element;
  selected: boolean;
  /** The current engine does not generate this element's type yet. */
  noCode: boolean;
  /** Its generated code is locked (KUYRUK 131). */
  locked?: boolean;
  /** An AI agent changed it moments ago (live co-editing). */
  live?: boolean;
  /** The AI agent works on it right now (its latest MCP call). */
  agentHere?: boolean;
  /** The click that selected it, when there was one: Ctrl and Shift extend the selection. */
  onSelect: (event?: React.MouseEvent) => void;
  onOpen: () => void;
  onDelete: () => void;
  /** Right click: the context menu at the pointer. */
  onMenu: (event: React.MouseEvent) => void;
}

/** A press with Ctrl, Shift, Cmd or the right button focuses the tile first; that focus must not drop the selection the click is about to extend. */
let modifierPress = false;

/** Notched plate: square texture slot, big name, one-line type description. Click selects, double-click/Enter opens. */
export function ElementTile({ snapshot, typeId, element, selected, noCode, locked, live, agentHere, onSelect, onOpen, onDelete, onMenu }: Props) {
  const hasIssues = issuesFor(snapshot, { typeId, id: element.id }).length > 0;
  const texture = elementTexture(snapshot, typeId, element);
  // A JSON model is drawn once into a picture and cached (KUYRUK 176); the texture shows until it is ready.
  const model = elementModel(snapshot, typeId, element);
  const thumbnail = useModelThumbnail(snapshot.dir, snapshot.project.mod.id, model?.model, snapshot.textures, model?.overrides);
  const type = typeOf(typeId);
  return (
    <button className={`tile ${selected ? "sel" : ""} ${live ? "live" : ""} ${agentHere ? "agenthere" : ""}`} role="option" aria-selected={selected} draggable
      onDragStart={(e) => e.dataTransfer.setData(ELEMENT_DRAG, `${typeId}/${element.id}`)}
      onMouseDown={(e) => (modifierPress = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 2)}
      onClick={(e) => (onSelect(e), (modifierPress = false))} onFocus={() => !modifierPress && onSelect()} onDoubleClick={onOpen}
      onContextMenu={(e) => (e.preventDefault(), (modifierPress = false), onMenu(e))}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.preventDefault(), onOpen());
        if (e.key === "Delete" && selected) (e.preventDefault(), onDelete());
      }}>
      <span className="slot">
        {thumbnail ? <img className="tmodel" src={thumbnail} width={32} height={32} alt="" data-model={model?.model} draggable={false} />
          : texture ? <Texture dir={snapshot.dir} path={texture} size={32} /> : <Sprite name={spriteFor(typeId)} size={32} />}
      </span>
      <span className="meta">
        <span className="tname">{elementName(typeId, element)}</span>
        <span className="tdesc">
          <span className="ttype">{type?.name ?? typeId}</span>
          {noCode ? <span className="tnocode">{t("editor.notGenerated")}</span> : <code className="dim">{element.id}</code>}
        </span>
      </span>
      {agentHere ? <span className="tlive here" title={t("timeline.agentHereHint")}>{t("timeline.agentHere")}</span>
        : live && <span className="tlive" title={t("live.tileHint")}>{t("live.agent")}</span>}
      {locked && <span className="flagl" data-testid="tile-locked" title={t("lock.tileHint")}><Icon name="lock" size={12} /></span>}
      {hasIssues && <span className="flagi" title={t("workspace.hasProblems")}><Icon name="warn" size={12} /></span>}
    </button>
  );
}
