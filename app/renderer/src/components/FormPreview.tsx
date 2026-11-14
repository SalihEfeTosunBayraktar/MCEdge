import { typeFields, visibility, type ElementType } from "../../../../src/elements/model.ts";
import type { Element, ProjectSnapshot } from "../../../shared/api.ts";
import { mappedSlots } from "../../../../src/resources/modelTextures.ts";
import { elementTexture } from "../model.ts";
import { ModelPreview } from "../models/ModelPreview.tsx";
import { t } from "../strings.ts";
import { Texture } from "./Texture.tsx";

/**
 * Live preview beside an element form (MCreator shows the textures next to its forms): the main texture large and
 * in an inventory slot with the element's name as a tooltip, and every other texture field that is set. Follows the
 * draft, so a picked texture shows at once. Nothing is shown for types without textures. A block with a custom JSON model
 * shows the model in 3D with its mapped slot textures (KUYRUK 161) instead of the flat main texture. Animated textures
 * play (KUYRUK 166).
 */
export function FormPreview({ snapshot, type, draft, name }: { snapshot: ProjectSnapshot; type: ElementType; draft: Element; name: string }) {
  const fields = typeFields(type);
  const visible = visibility({ fields, values: draft });
  const textures = fields.filter((f) => f.type === "texture" && visible(f.key) && typeof draft[f.key] === "string" && draft[f.key]);
  const main = elementTexture(snapshot, type.id, draft) || (textures[0] ? String(draft[textures[0].key]) : "");
  if (!main) return null;
  const blockModel = type.id === "block" && Number(draft.renderType) === 2 && typeof draft.customModelName === "string" ? draft.customModelName : "";
  const model = blockModel && snapshot.models.includes(`models/${blockModel}.json`) ? blockModel : "";
  const slots = type.id === "block" && [2, 3].includes(Number(draft.renderType)) && visible("customModelTextures") ? mappedSlots(draft.customModelTextures) : [];
  return (
    <aside className="formpreview" aria-label={t("preview.title")}>
      <div className="pvtitle">{t("preview.title")}</div>
      {model ? (
        <div className="pvmodel">
          <ModelPreview dir={snapshot.dir} modId={snapshot.project.mod.id} model={model} textures={snapshot.textures} height={200}
            itemDisplay={typeof draft.itemDisplay === "string" ? draft.itemDisplay : undefined} textureOverrides={Object.fromEntries(slots)} />
        </div>
      ) : (
        <div className="pvbig"><Texture dir={snapshot.dir} path={main} size={128} animate /></div>
      )}
      <div className="pvlabel">{t("preview.inventory")}</div>
      <div className="pvinv">
        <span className="slot small"><Texture dir={snapshot.dir} path={main} size={16} animate /></span>
        <span className="slot small"><Texture dir={snapshot.dir} path={main} size={32} animate /></span>
        <span className="pvtip">{name}</span>
      </div>
      {textures.length + slots.length > 1 && (
        <>
          <div className="pvlabel">{t("preview.textures")}</div>
          <div className="pvfaces">
            {textures.map((f) => (
              <figure key={f.key} title={String(draft[f.key])}>
                <span className="slot small"><Texture dir={snapshot.dir} path={String(draft[f.key])} size={32} animate /></span>
                <figcaption>{f.label}</figcaption>
              </figure>
            ))}
            {slots.map(([slot, path]) => (
              <figure key={`slot:${slot}`} title={path}>
                <span className="slot small"><Texture dir={snapshot.dir} path={path} size={32} animate /></span>
                <figcaption>{t("preview.modelSlot", { slot })}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
