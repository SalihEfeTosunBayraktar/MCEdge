import { useEffect, useState } from "react";
import vanillaModels from "../../../../config/vanilla-block-models.json" with { type: "json" };
import type { BlockModelJson } from "../../../../src/resources/blockModel.ts";
import { modelTextureSlots, type ModelTextureSlot } from "../../../../src/resources/modelTextures.ts";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Texture } from "../components/Texture.tsx";
import { TexturePicker } from "../components/TexturePicker.tsx";
import { t } from "../strings.ts";

/** Block render types with a custom model: JSON, OBJ, Java (block entity). */
const KINDS: Record<number, "json" | "obj" | "java"> = { 2: "json", 3: "obj", 4: "java" };

/**
 * The texture slots of a block's custom model (KUYRUK 161): one row per slot with the texture the model names and the
 * project texture the block maps it to (none keeps the model's). A Java model draws with the block's main texture.
 */
export function ModelTexturesInput({ snapshot, model, renderType, value, set }: {
  snapshot: ProjectSnapshot;
  model: string;
  renderType: number;
  value: Record<string, string>;
  set: (value: Record<string, string>) => void;
}) {
  const kind = KINDS[renderType];
  const { dir, textures } = snapshot;
  const modId = snapshot.project.mod.id;
  const [slots, setSlots] = useState<ModelTextureSlot[]>();
  const [error, setError] = useState<string>();
  const [rev, setRev] = useState(0);

  useEffect(() => api.onFsChange((change) => {
    if (change.dir === dir && change.paths.some((p) => p.startsWith("models/"))) setRev((n) => n + 1);
  }), [dir]);

  useEffect(() => {
    if (kind !== "json" && kind !== "obj") return;
    let alive = true;
    const read = async (path: string) => {
      try {
        const file = await api.codeRead(dir, path);
        return file.binary ? undefined : file.text;
      } catch {
        return undefined;
      }
    };
    void modelTextureSlots(kind, model, modId, read, textures, vanillaModels as unknown as Record<string, BlockModelJson>)
      .then((next) => alive && (setSlots(next), setError(undefined)))
      .catch((e: Error) => alive && (setSlots(undefined), setError(e.message)));
    return () => void (alive = false);
  }, [kind, model, modId, dir, textures, rev]);

  if (kind === "java") return <p className="fhelp mtnote">{t("modelTextures.java")}</p>;
  if (!kind) return null;
  if (!model) return <p className="fhelp mtnote">{t("modelTextures.noModel")}</p>;
  if (error) return <p className="fhelp mtnote">{t("modelTextures.unreadable", { error })}</p>;
  if (!slots) return null;
  const change = (slot: string, path: string) => {
    const next = { ...value };
    if (path) next[slot] = path;
    else delete next[slot];
    set(next);
  };
  // Slots the block maps but the model no longer has stay listed, so they can be cleared.
  const stale = Object.keys(value).filter((slot) => !slots.some((s) => s.slot === slot));
  if (!slots.length && !stale.length) return <p className="fhelp mtnote">{t("modelTextures.none")}</p>;
  return (
    <div className="mtslots" role="table" aria-label={t("modelTextures.title")}>
      <div className="mtrow mthead" role="row">
        <span role="columnheader">{t("modelTextures.slot")}</span>
        <span role="columnheader">{t("modelTextures.model")}</span>
        <span role="columnheader">{t("modelTextures.block")}</span>
      </div>
      {slots.map((s) => (
        <div key={s.slot} className="mtrow" role="row" data-slot={s.slot}>
          <code className="mtslot" title={s.slot}>{s.slot || t("modelTextures.unnamed")}</code>
          <span className="mtmodel" title={s.texture}>
            <span className="slot small">{s.file && <Texture dir={dir} path={s.file} size={24} />}</span>
            <span className="mtname">{s.texture || t("field.none")}</span>
          </span>
          <TexturePicker dir={dir} textures={textures} value={value[s.slot] ?? ""} allowNone onChange={(path) => change(s.slot, path)} />
        </div>
      ))}
      {stale.map((slot) => (
        <div key={slot} className="mtrow stale" role="row" data-slot={slot}>
          <code className="mtslot" title={slot}>{slot}</code>
          <span className="mtname dim">{t("modelTextures.notInModel")}</span>
          <TexturePicker dir={dir} textures={textures} value={value[slot] ?? ""} allowNone onChange={(path) => change(slot, path)} />
        </div>
      ))}
    </div>
  );
}
