import { useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { TexturePicker } from "../components/TexturePicker.tsx";
import { Dialog, FormGroup, FormRow } from "../components/ui.tsx";
import { t } from "../strings.ts";
import { putDraft } from "./drafts.ts";
import { NEW_ANIMATION, stripOf } from "./animation.ts";
import { blank, decodePng } from "./pixels.ts";

/** Folders under textures/ offered for a texture, plus every folder the project already has. */
const FOLDERS = ["block", "item", "entity", "screens", "armor", "particle", "painting", "effect"];
const SIZES = [16, 32, 64, 128];
const FRAME_COUNTS = [1, 2, 4, 8, 16];

interface Props {
  snapshot: ProjectSnapshot;
  onCancel: () => void;
  /** The editor opens the path; nothing is written until the user saves there. */
  onCreated: (snapshot: ProjectSnapshot, path: string) => void;
}

/**
 * Resources > New texture (menu and toolbar): name, folder, size and what to start from (an empty canvas
 * or a copy of a project texture). Like MCreator's texture maker nothing is written yet: the editor opens the new
 * texture unsaved and its first Save creates the PNG.
 */
export function NewTextureDialog({ snapshot, onCancel, onCreated }: Props) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("item");
  const [size, setSize] = useState(16);
  const [template, setTemplate] = useState("");
  const [frames, setFrames] = useState(1);
  const [busy, setBusy] = useState(false);
  const path = texturePath(folder, name);
  const taken = snapshot.textures.includes(path);

  const create = async () => {
    setBusy(true);
    try {
      const first = template ? await decodePng(await api.readTexture(snapshot.dir, template)) : blank(size, size);
      // An animated texture starts as a strip of copies of the first frame.
      putDraft(snapshot.dir, path, frames > 1
        ? { pixels: stripOf(first, frames), isNew: true, animation: { ...NEW_ANIMATION } }
        : { pixels: first, isNew: true });
      onCreated(snapshot, path);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("paint.newTitle")} okLabel={t("paint.create")} canOk={validName(name) && !taken && !busy} onOk={create} onCancel={onCancel}>
      <FormGroup title={t("paint.newGroup")}>
        <FileFields snapshot={snapshot} name={name} folder={folder} onName={setName} onFolder={setFolder} />
        {taken && <p className="ferr">{t("paint.nameTaken")}</p>}
        <FormRow label={t("paint.startFrom")}>
          <TexturePicker dir={snapshot.dir} textures={snapshot.textures} value={template} allowNone onChange={setTemplate} />
          <p className="fhelp">{t("paint.startFromHint")}</p>
        </FormRow>
        {!template && (
          <FormRow label={t("paint.size")}>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s) => <option key={s} value={s}>{t("paint.customSize", { width: s, height: s })}</option>)}
            </select>
          </FormRow>
        )}
        <FormRow label={t("paint.animFrames")}>
          <select value={frames} onChange={(e) => setFrames(Number(e.target.value))}>
            {FRAME_COUNTS.map((n) => <option key={n} value={n}>{n === 1 ? t("paint.still") : t("paint.framesCount", { count: n })}</option>)}
          </select>
          <p className="fhelp">{t("paint.animFramesHint")}</p>
        </FormRow>
        <FormRow label={t("paint.file")}><div className="fval"><code>{name ? path : "-"}</code></div></FormRow>
      </FormGroup>
    </Dialog>
  );
}

/**
 * Texture editor > Save as: another name and folder for the texture being edited. An existing file is replaced
 * only after the user ticks Replace it.
 */
export function SaveAsDialog({ snapshot, current, onCancel, onSave }: {
  snapshot: ProjectSnapshot;
  /** Path being edited, textures/<folder>/<name>.png. */
  current: string;
  onCancel: () => void;
  onSave: (path: string) => void;
}) {
  const parts = current.split("/");
  const [name, setName] = useState(`${parts.at(-1)!.replace(/\.png$/, "")}_copy`);
  const [folder, setFolder] = useState(parts.slice(1, -1).join("/"));
  const [replace, setReplace] = useState(false);
  const path = texturePath(folder, name);
  const taken = snapshot.textures.includes(path) && path !== current;
  return (
    <Dialog title={t("paint.saveAsTitle")} okLabel={t("paint.save")} canOk={validName(name) && (!taken || replace)} onOk={() => onSave(path)} onCancel={onCancel}>
      <FormGroup title={t("paint.saveAsGroup")}>
        <FileFields snapshot={snapshot} name={name} folder={folder} onName={(n) => (setName(n), setReplace(false))} onFolder={(f) => (setFolder(f), setReplace(false))} />
        {taken && (
          <FormRow label="">
            <p className="ferr">{t("paint.nameTaken")}</p>
            <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />{t("paint.replace")}</label>
          </FormRow>
        )}
        <FormRow label={t("paint.file")}><div className="fval"><code>{name ? path : "-"}</code></div></FormRow>
      </FormGroup>
    </Dialog>
  );
}

const validName = (name: string) => /^[a-z0-9_]+$/.test(name);
const texturePath = (folder: string, name: string) => `textures/${folder ? `${folder}/` : ""}${name}.png`;

function FileFields({ snapshot, name, folder, onName, onFolder }: {
  snapshot: ProjectSnapshot;
  name: string;
  folder: string;
  onName: (name: string) => void;
  onFolder: (folder: string) => void;
}) {
  const existing = snapshot.textures.map((p) => p.split("/").slice(1, -1).join("/")).filter(Boolean);
  const folders = [...new Set([...FOLDERS, ...existing, ...(folder ? [folder] : [])])];
  return (
    <>
      <FormRow label={t("paint.name")}>
        <input autoFocus value={name} spellCheck={false} placeholder="ruby_ingot"
          onChange={(e) => onName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
        <p className="fhelp">{t("paint.nameHint")}</p>
      </FormRow>
      <FormRow label={t("paint.folder")}>
        <select value={folder} onChange={(e) => onFolder(e.target.value)}>
          {folders.map((f) => <option key={f} value={f}>textures/{f}</option>)}
          <option value="">{t("paint.root")}</option>
        </select>
      </FormRow>
    </>
  );
}
