import { useEffect, useRef, useState } from "react";
import type { Preferences } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { CODE_FONTS, TEXT_SIZES, UI_FONTS } from "../preferences.ts";
import { LANGUAGES, t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

interface Props {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
}

/** Language and appearance choices of the Preferences dialog. */
export function PreferencesForm({ preferences, onChange }: Props) {
  const set = (patch: Partial<Preferences>) => onChange({ ...preferences, ...patch });
  return (
    <>
      <FormGroup title={t("prefs.language")}>
        <FormRow label={t("prefs.languageLabel")}>
          <select value={preferences.language} onChange={(e) => set({ language: e.target.value })}>
            {Object.entries(LANGUAGES).map(([code, { name }]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </FormRow>
      </FormGroup>
      <FormGroup title={t("prefs.appearance")}>
        <FormRow label={t("prefs.theme")}>
          <select value={preferences.theme} onChange={(e) => set({ theme: e.target.value as Preferences["theme"] })}>
            <option value="dark">{t("top.dark")}</option>
            <option value="light">{t("top.light")}</option>
          </select>
        </FormRow>
        <FormRow label={t("prefs.textSize")}>
          <select value={preferences.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => <option key={size.id} value={size.scale}>{t(`prefs.size.${size.id}`)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("prefs.uiFont")}>
          <select value={preferences.uiFont} onChange={(e) => set({ uiFont: e.target.value })}>
            {UI_FONTS.map((font) => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("prefs.codeFont")}>
          <select value={preferences.codeFont} onChange={(e) => set({ codeFont: e.target.value })}>
            {CODE_FONTS.map((font) => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("prefs.preview")}>
          <div className="fval prefpreview"><span>{t("catalog.tool")}</span><code>hellomcedge:ruby_pickaxe</code></div>
        </FormRow>
      </FormGroup>
      <FormGroup title={t("prefs.tools")}>
        <BlockbenchRow path={preferences.blockbenchPath ?? ""} onChange={(blockbenchPath) => set({ blockbenchPath })} />
      </FormGroup>
      <FormGroup title={t("prefs.modSources")}>
        <FormRow label={t("prefs.curseforgeKey")}>
          <input type="password" value={preferences.curseforgeKey ?? ""} spellCheck={false} autoComplete="off" placeholder={t("prefs.curseforgeKeyNone")}
            onChange={(e) => set({ curseforgeKey: e.target.value.trim() || undefined })} />
        </FormRow>
        <p className="hint">{t("prefs.curseforgeKeyHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.updates")}>
        <FormRow label={t("prefs.autoUpdate")}>
          <label className="check"><input type="checkbox" checked={preferences.autoUpdate !== false} data-testid="pref-auto-update"
            onChange={(e) => set({ autoUpdate: e.target.checked ? undefined : false })} /></label>
        </FormRow>
        <p className="hint">{t("prefs.autoUpdateHint")}</p>
      </FormGroup>
    </>
  );
}

/** The Blockbench program for Edit in Blockbench (KUYRUK 171): empty uses the usual install places, which it shows. */
function BlockbenchRow({ path, onChange }: { path: string; onChange: (path: string) => void }) {
  const [found, setFound] = useState<string | null>();
  useEffect(() => void api.findBlockbench(path).then(setFound), [path]);
  const browse = async () => {
    const picked = await api.pickProgram(path);
    if (picked) onChange(picked);
  };
  return (
    <FormRow label={t("prefs.blockbench")}>
      <div className="fpair">
        <input className="bbpath" value={path} spellCheck={false} placeholder={found ?? ""} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="abtn" onClick={browse}><Icon name="folder" /><span>{t("prefs.browse")}</span></button>
      </div>
      {found !== undefined && <p className="hint nomargin bbfound">{found ? t("prefs.blockbenchFound", { path: found }) : t("prefs.blockbenchNone")}</p>}
    </FormRow>
  );
}

/**
 * App-wide preferences as a dialog (KUYRUK 122), opened from Window > Preferences and the welcome screen, with or
 * without a project. Changes apply at once; Close, Escape or a click outside closes it. The first control takes focus.
 */
export function PreferencesDialog({ onClose, ...props }: Props & { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog prefsdialog" role="dialog" aria-label={t("section.preferences")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("section.preferences")}</div>
        <div className="form wide-labels">
          <PreferencesForm {...props} />
        </div>
        <p className="hint">{t("prefs.note")}</p>
        <div className="dlg-buttons">
          <button type="button" className="abtn primary" onClick={onClose}><span>{t("dialog.close")}</span></button>
        </div>
      </div>
    </div>
  );
}
