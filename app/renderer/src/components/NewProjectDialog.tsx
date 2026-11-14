import { useEffect, useRef, useState } from "react";
import type { EngineInfo, Opened } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

/** "Ruby Tools" -> "ruby_tools" (src/ir/createProject.ts suggestModId; kept here so the renderer needs no Node code). */
const modIdFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "mod_$1").slice(0, 64);
const packageFor = (modId: string, author: string) => {
  const owner = author.toLowerCase().replace(/[^a-z0-9_]/g, "") || "example";
  return `com.${/^[a-z_]/.test(owner) ? owner : `_${owner}`}.${modId || "mymod"}`;
};

/**
 * File > New project and the welcome screen (KUYRUK 126): name, mod id and package (suggested from the name until
 * edited), the target engines, a template and the folder the project goes in. Create makes it and opens it.
 */
export function NewProjectDialog({ engines, onCreated, onClose }: { engines: EngineInfo[]; onCreated: (opened: Opened) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const [name, setName] = useState("");
  const [modId, setModId] = useState<string>();
  const [pkg, setPkg] = useState<string>();
  const [author, setAuthor] = useState("");
  const [parent, setParent] = useState("");
  const [template, setTemplate] = useState<"empty" | "example">("example");
  const [selected, setSelected] = useState(engines.map((e) => e.id));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => void api.newProjectFolder().then(setParent), []);

  const id = modId ?? modIdFor(name);
  const packageName = pkg ?? packageFor(id, author);
  const canCreate = !busy && name.trim() !== "" && id !== "" && packageName !== "" && parent.trim() !== "" && selected.length > 0;
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await api.createProject({ parent: parent.trim(), name: name.trim(), modId: id, package: packageName, engines: selected, template, ...(author.trim() ? { author: author.trim() } : {}) }));
    } catch (e) {
      // Electron wraps the main process error: keep its own message.
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      // The Create button was disabled while busy and lost the focus: keep it in the dialog so Escape still closes it.
      setTimeout(() => box.current?.querySelector<HTMLInputElement>('input[name="parent"]')?.focus());
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    const picked = await api.pickFolder(parent);
    if (picked) setParent(picked);
  };
  const toggle = (engine: string, on: boolean) => setSelected(on ? [...selected, engine] : selected.filter((e) => e !== engine));

  return (
    <div className="backdrop" onMouseDown={() => !busy && onClose()}>
      <form ref={box} className="dialog newproject" data-testid="new-project" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()} onSubmit={(e) => (e.preventDefault(), canCreate && create())}>
        <div className="ptitle">{t("newProject.title")}</div>
        <FormGroup title={t("newProject.mod")}>
          <FormRow label={t("newProject.name")}>
            <input name="name" value={name} placeholder={t("newProject.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          </FormRow>
          <FormRow label={t("newProject.modId")}>
            <input name="modId" className="mono" value={id} spellCheck={false} onChange={(e) => setModId(e.target.value)} />
          </FormRow>
          <FormRow label={t("newProject.author")}>
            <input name="author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </FormRow>
          <FormRow label={t("newProject.package")}>
            <input name="package" className="mono" value={packageName} spellCheck={false} onChange={(e) => setPkg(e.target.value)} />
          </FormRow>
        </FormGroup>
        <FormGroup title={t("newProject.start")}>
          <div className="check-list">
            {(["example", "empty"] as const).map((value) => (
              <label key={value} className="check">
                <input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} />
                <span>{t(`newProject.template.${value}`)}</span>
              </label>
            ))}
          </div>
        </FormGroup>
        <FormGroup title={t("newProject.engines")}>
          <div className="check-list">
            {engines.map((engine) => (
              <label key={engine.id} className="check">
                <input type="checkbox" name="engine" value={engine.id} checked={selected.includes(engine.id)} onChange={(e) => toggle(engine.id, e.target.checked)} />
                <span>{engine.name}</span>
              </label>
            ))}
          </div>
        </FormGroup>
        <FormGroup title={t("newProject.location")}>
          <FormRow label={t("newProject.folder")}>
            <div className="fpair">
              <input name="parent" value={parent} spellCheck={false} onChange={(e) => setParent(e.target.value)} />
              <button type="button" className="abtn" onClick={browse}><Icon name="folder" /><span>{t("export.browse")}</span></button>
            </div>
          </FormRow>
          <FormRow label={t("newProject.path")}>
            <div className="fval"><code data-testid="new-project-path">{parent ? `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${id}` : ""}</code></div>
          </FormRow>
        </FormGroup>
        {error && <p className="error-text" data-testid="new-project-error">{error}</p>}
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!canCreate}><Icon name="check" /><span>{t("newProject.create")}</span></button>
          <button type="button" className="abtn" disabled={busy} onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}
