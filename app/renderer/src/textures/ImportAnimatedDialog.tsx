import { useRef, useState } from "react";
import type { ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { Dialog, FormGroup, FormRow } from "../components/ui.tsx";
import { t } from "../strings.ts";
import { parseMcmeta } from "./animation.ts";

/** File names follow resource-location rules, as Resources > Import does (src/resources/files.ts resourceName). */
const resourceName = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "texture";

interface Picked {
  name: string;
  png: File;
  mcmeta?: File;
  /** Frames and frame time read from the files, or why it is not animated. */
  note: string;
}

/**
 * Resources > Import > Animated texture: PNG strips with their "<name>.png.mcmeta" (picked together), copied into
 * textures/<folder>/. A PNG picked without its .mcmeta is imported as a still texture.
 */
export function ImportAnimatedDialog({ snapshot, folders, onCancel, onImported }: {
  snapshot: ProjectSnapshot;
  folders: string[];
  onCancel: () => void;
  onImported: (snapshot: ProjectSnapshot) => void;
}) {
  const [folder, setFolder] = useState(folders.includes("block") ? "block" : folders[0] ?? "");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    const pngs = list.filter((f) => /\.png$/i.test(f.name));
    setPicked(await Promise.all(pngs.map(async (png): Promise<Picked> => {
      const mcmeta = list.find((f) => f.name.toLowerCase() === `${png.name.toLowerCase()}.mcmeta`);
      const name = resourceName(png.name.replace(/\.png$/i, ""));
      const image = await createImageBitmap(png);
      const frames = image.height % image.width === 0 ? image.height / image.width : 0;
      if (!mcmeta) return { name, png, note: t("paint.importNoMcmeta") };
      try {
        const animation = parseMcmeta(await mcmeta.text());
        if (!animation) return { name, png, mcmeta, note: t("paint.importNoAnimation") };
        return { name, png, mcmeta, note: frames ? t("paint.importFrames", { count: frames, ticks: animation.frametime }) : t("paint.importNotStrip") };
      } catch (e) {
        return { name, png, note: t("paint.importBadMcmeta", { error: (e as Error).message }) };
      }
    })));
  };
  const importAll = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let next = snapshot;
      for (const p of picked) {
        const path = `textures/${folder ? `${folder}/` : ""}${p.name}.png`;
        const bytes = new Uint8Array(await p.png.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        next = await api.writeTexture(snapshot.dir, path, btoa(binary));
        if (p.mcmeta) await api.codeWrite(snapshot.dir, `${path}.mcmeta`, await p.mcmeta.text());
      }
      onImported(await api.reloadProject(next.dir));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const taken = picked.filter((p) => snapshot.textures.includes(`textures/${folder ? `${folder}/` : ""}${p.name}.png`));
  return (
    <Dialog title={t("paint.importAnimTitle")} okLabel={t("resources.import")} canOk={picked.length > 0 && taken.length === 0 && !busy} onOk={importAll} onCancel={onCancel}>
      <FormGroup title={t("paint.importAnimGroup")}>
        <FormRow label={t("paint.importFiles")}>
          {/* The native file button shows the system's language; ours shows the app's. */}
          <input ref={input} type="file" multiple accept=".png,.mcmeta" hidden aria-label={t("paint.importFiles")} onChange={(e) => void pick(e.target.files)} />
          <div className="fpair">
            <button type="button" className="abtn" onClick={() => input.current?.click()}><Icon name="folder" />{t("paint.importChoose")}</button>
            <span className="dim">{t("paint.importPicked", { count: picked.length })}</span>
          </div>
          <p className="fhelp">{t("paint.importFilesHint")}</p>
        </FormRow>
        <FormRow label={t("paint.folder")}>
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            {folders.map((f) => <option key={f} value={f}>textures/{f}</option>)}
          </select>
        </FormRow>
        {picked.length > 0 && (
          <ul className="plain importlist">
            {picked.map((p) => <li key={p.name}><code>{p.name}.png</code> <span className="dim">{p.note}</span></li>)}
          </ul>
        )}
        {taken.length > 0 && <p className="ferr">{t("paint.importReplaces", { names: taken.map((p) => `${p.name}.png`).join(", ") })}</p>}
        {error && <p className="ferr">{error}</p>}
      </FormGroup>
    </Dialog>
  );
}
