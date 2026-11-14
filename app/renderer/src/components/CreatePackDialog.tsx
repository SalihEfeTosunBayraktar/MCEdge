import { useEffect, useRef, useState } from "react";
import type { PackKind, PackOptions, PackPreview, ProjectSnapshot } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

const KINDS: PackKind[] = ["ore", "tool", "armor", "wood", "material"];
const idFor = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "p$1");

/**
 * Tools > Create pack (KUYRUK 134): one name and colour make a set of elements with textures and recipes. The list
 * shows what the pack makes before it is made; elements and textures the project already has are kept.
 */
export function CreatePackDialog({ snapshot, onCreated, onClose }: { snapshot: ProjectSnapshot; onCreated: (next: ProjectSnapshot) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const [kind, setKind] = useState<PackKind>("ore");
  const [name, setName] = useState("");
  const [id, setId] = useState<string>();
  const [color, setColor] = useState("#3fbf6f");
  const [look, setLook] = useState<"ingot" | "gem">("ingot");
  const [preview, setPreview] = useState<PackPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const packId = id ?? idFor(name);
  const options: PackOptions = { kind, name: name.trim(), id: packId, color, look };
  const optionsKey = JSON.stringify(options);
  useEffect(() => {
    if (!packId) return setPreview(undefined);
    let alive = true;
    api.planPack(snapshot.dir, JSON.parse(optionsKey) as PackOptions).then((p) => alive && (setPreview(p), setError(undefined)),
      (e) => alive && (setPreview(undefined), setError(message(e))));
    return () => void (alive = false);
  }, [snapshot.dir, optionsKey, packId]);
  const fresh = preview?.elements.filter((e) => !e.exists).length ?? 0;
  const create = async () => {
    setBusy(true);
    try {
      onCreated(await api.createPack(snapshot.dir, options));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="backdrop" onMouseDown={() => !busy && onClose()}>
      <form ref={box} className="dialog createpack" data-testid="create-pack" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()} onSubmit={(e) => (e.preventDefault(), fresh && !busy && void create())}>
        <div className="ptitle">{t("pack.title")}</div>
        <FormGroup title={t("pack.group")}>
          <FormRow label={t("pack.name")}>
            <input name="name" value={name} placeholder={t("pack.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          </FormRow>
          <FormRow label={t("pack.kind")}>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PackKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`pack.kind.${k}` as StringKey)}</option>)}
            </select>
          </FormRow>
          <p className="hint">{t(`pack.kindHint.${kind}` as StringKey)}</p>
          <FormRow label={t("pack.id")}>
            <input name="id" className="mono" value={packId} spellCheck={false} onChange={(e) => setId(e.target.value)} />
          </FormRow>
          <FormRow label={t("pack.color")}>
            <div className="fpair">
              <input type="color" className="swatch" name="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <code>{color}</code>
            </div>
          </FormRow>
          {kind !== "wood" && (
            <FormRow label={t("pack.look")}>
              <select name="look" value={look} onChange={(e) => setLook(e.target.value as "ingot" | "gem")}>
                <option value="ingot">{t("pack.look.ingot")}</option>
                <option value="gem">{t("pack.look.gem")}</option>
              </select>
            </FormRow>
          )}
        </FormGroup>
        <FormGroup title={t("pack.makes", { count: fresh })}>
          {preview ? (
            <>
              <div className="packtextures">
                {preview.textures.map((x) => <img key={x.path} className="pixel" src={x.dataUrl} title={x.path} alt="" width={32} height={x.height > x.width ? 64 : 32 * (x.height / x.width)} />)}
              </div>
              <ul className="plain packlist">
                {preview.elements.map((e) => (
                  <li key={`${e.type}/${e.id}`} className={e.exists ? "dim" : ""}>
                    <code>{e.type}/{e.id}</code>{e.exists && <span> · {t("pack.exists")}</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="hint">{t("pack.nameFirst")}</p>}
        </FormGroup>
        {error && <p className="error-text">{error}</p>}
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!fresh || busy}><Icon name="check" /><span>{t("pack.create")}</span></button>
          <button type="button" className="abtn" disabled={busy} onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}

const message = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
