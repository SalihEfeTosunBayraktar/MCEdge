import { useEffect, useRef, useState } from "react";
import type { AiConfig, ExperienceLevel, Preferences, UiMode } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { CODE_FONTS, TEXT_SIZES, UI_FONTS } from "../preferences.ts";
import { LEVELS } from "../experience.ts";
import { LANGUAGES, t, type StringKey } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

interface Props {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  /** Opens this collapsed section at once (the AI panel sends the user to its settings). */
  openSection?: "ai";
}

/** Language and appearance choices of the Preferences dialog. */
export function PreferencesForm({ preferences, onChange, openSection }: Props) {
  const set = (patch: Partial<Preferences>) => onChange({ ...preferences, ...patch });
  const ai: AiConfig = preferences.ai ?? { provider: "openai", model: "" };
  const setAi = (patch: Partial<AiConfig>) => set({ ai: { ...ai, ...patch } });
  // A switch back to its default is removed, so unset preferences stay unset (Q250).
  const setPerformance = (patch: NonNullable<Preferences["performance"]>) => {
    const next = { ...preferences.performance, ...patch };
    set({ performance: Object.values(next).some((v) => v !== undefined) ? next : undefined });
  };
  const [machine, setMachine] = useState<Awaited<ReturnType<typeof api.systemInfo>>>();
  useEffect(() => void api.systemInfo().then(setMachine), []);
  return (
    <>
      <FormGroup title={t("prefs.language")} collapsible>
        <FormRow label={t("prefs.languageLabel")}>
          <select value={preferences.language} onChange={(e) => set({ language: e.target.value })}>
            {Object.entries(LANGUAGES).map(([code, { name }]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </FormRow>
      </FormGroup>
      <FormGroup title={t("prefs.experience")} collapsible>
        <FormRow label={t("prefs.level")}>
          <select value={preferences.level ?? "some"} data-testid="pref-level" onChange={(e) => set({ level: e.target.value as ExperienceLevel })}>
            {LEVELS.map(({ id }) => <option key={id} value={id}>{t(`setup.level.${id}` as StringKey)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("prefs.mode")}>
          <select value={preferences.mode ?? "advanced"} data-testid="pref-mode" onChange={(e) => set({ mode: e.target.value as UiMode })}>
            <option value="simple">{t("prefs.mode.simple")}</option>
            <option value="advanced">{t("prefs.mode.advanced")}</option>
          </select>
        </FormRow>
        <p className="hint">{t("prefs.modeHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.appearance")} collapsible>
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
      <FormGroup title={t("prefs.access")} collapsible>
        <FormRow label={t("prefs.highContrast")}>
          <label className="check"><input type="checkbox" checked={!!preferences.highContrast} data-testid="pref-high-contrast"
            onChange={(e) => set({ highContrast: e.target.checked || undefined })} /></label>
        </FormRow>
        <FormRow label={t("prefs.colorBlind")}>
          <label className="check"><input type="checkbox" checked={!!preferences.colorBlind} data-testid="pref-color-blind"
            onChange={(e) => set({ colorBlind: e.target.checked || undefined })} /></label>
        </FormRow>
        <FormRow label={t("prefs.motion")}>
          <select value={preferences.reducedMotion ?? "system"} data-testid="pref-motion" onChange={(e) => set({ reducedMotion: e.target.value as Preferences["reducedMotion"] })}>
            <option value="system">{t("prefs.motion.system")}</option>
            <option value="on">{t("prefs.motion.on")}</option>
            <option value="off">{t("prefs.motion.off")}</option>
          </select>
        </FormRow>
        <p className="hint">{t("prefs.accessHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.performance")} collapsible>
        <FormRow label={t("prefs.previews")}>
          <label className="check"><input type="checkbox" checked={preferences.performance?.previews !== false} data-testid="pref-previews"
            onChange={(e) => setPerformance({ previews: e.target.checked ? undefined : false })} /></label>
        </FormRow>
        <FormRow label={t("prefs.render3d")}>
          <label className="check"><input type="checkbox" checked={preferences.performance?.render3d !== false} data-testid="pref-render3d"
            onChange={(e) => setPerformance({ render3d: e.target.checked ? undefined : false })} /></label>
        </FormRow>
        <FormRow label={t("prefs.lowMemory")}>
          <label className="check"><input type="checkbox" checked={!!preferences.performance?.lowMemory} data-testid="pref-low-memory"
            onChange={(e) => setPerformance({ lowMemory: e.target.checked || undefined })} /></label>
        </FormRow>
        <p className="hint" data-testid="pref-machine">{machine ? t("perf.machine", { ram: machine.ramGb, cores: machine.cores }) + (machine.suggestLight ? " " + t("perf.suggest") : "") : ""}</p>
        <p className="hint">{t("prefs.performanceHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.tools")} collapsible>
        <BlockbenchRow path={preferences.blockbenchPath ?? ""} onChange={(blockbenchPath) => set({ blockbenchPath })} />
      </FormGroup>
      <FormGroup title={t("prefs.modSources")} collapsible defaultOpen={false}>
        <FormRow label={t("prefs.curseforgeKey")}>
          <input type="password" value={preferences.curseforgeKey ?? ""} spellCheck={false} autoComplete="off" placeholder={t("prefs.curseforgeKeyNone")}
            onChange={(e) => set({ curseforgeKey: e.target.value.trim() || undefined })} />
        </FormRow>
        <p className="hint">{t("prefs.curseforgeKeyHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.publishing")} collapsible defaultOpen={false}>
        <FormRow label={t("prefs.modrinthToken")}>
          <input type="password" value={preferences.modrinthToken ?? ""} spellCheck={false} autoComplete="off" placeholder={t("prefs.tokenNone")}
            data-testid="pref-modrinth-token" onChange={(e) => set({ modrinthToken: e.target.value.trim() || undefined })} />
        </FormRow>
        <FormRow label={t("prefs.curseforgeToken")}>
          <input type="password" value={preferences.curseforgeToken ?? ""} spellCheck={false} autoComplete="off" placeholder={t("prefs.tokenNone")}
            data-testid="pref-curseforge-token" onChange={(e) => set({ curseforgeToken: e.target.value.trim() || undefined })} />
        </FormRow>
        <p className="hint">{t("prefs.publishingHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.ai")} collapsible defaultOpen={openSection === "ai"}>
        <FormRow label={t("prefs.aiProvider")}>
          <select value={ai.provider} data-testid="pref-ai-provider" onChange={(e) => setAi({ provider: e.target.value as AiConfig["provider"] })}>
            <option value="openai">{t("prefs.aiOpenai")}</option>
            <option value="anthropic">{t("prefs.aiAnthropic")}</option>
          </select>
        </FormRow>
        {ai.provider === "openai" && (
          <FormRow label={t("prefs.aiBaseUrl")}>
            <input value={ai.baseUrl ?? ""} spellCheck={false} placeholder={t("prefs.aiBaseUrlNone")} data-testid="pref-ai-base-url"
              onChange={(e) => setAi({ baseUrl: e.target.value.trim() || undefined })} />
          </FormRow>
        )}
        <FormRow label={t("prefs.aiModel")}>
          <input value={ai.model} spellCheck={false} placeholder={t("prefs.aiModelNone")} data-testid="pref-ai-model" onChange={(e) => setAi({ model: e.target.value.trim() })} />
        </FormRow>
        <FormRow label={t("prefs.aiKey")}>
          <input type="password" value={ai.apiKey ?? ""} spellCheck={false} autoComplete="off" placeholder={t("prefs.aiKeyNone")} data-testid="pref-ai-key"
            onChange={(e) => setAi({ apiKey: e.target.value.trim() || undefined })} />
        </FormRow>
        <p className="hint">{t("prefs.aiHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.agentRuns")} collapsible>
        <FormRow label={t("prefs.agentRunsLabel")}>
          <select value={preferences.agentRuns ?? "ask"} data-testid="pref-agent-runs" onChange={(e) => set({ agentRuns: e.target.value === "allow" ? "allow" : undefined })}>
            <option value="ask">{t("prefs.agentRunsAsk")}</option>
            <option value="allow">{t("prefs.agentRunsAllow")}</option>
          </select>
        </FormRow>
        <p className="hint">{t("prefs.agentRunsHint")}</p>
      </FormGroup>
      <FormGroup title={t("prefs.updates")} collapsible>
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
  const form = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  useDialogFocus(box);
  // The category list on the left (Q279) is read from the groups of the form, so a new group appears in it by itself.
  useEffect(() => setCategories([...(form.current?.querySelectorAll<HTMLElement>("fieldset.fgroup > legend") ?? [])].map((l) => l.textContent ?? "")), []);
  const show = (index: number) => form.current?.querySelectorAll<HTMLElement>("fieldset.fgroup")[index]?.scrollIntoView({ block: "start", behavior: "auto" });
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog prefsdialog" role="dialog" aria-label={t("section.preferences")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("section.preferences")}</div>
        <div className="prefsbody">
          <nav className="prefsnav" aria-label={t("prefs.categories")}>
            {categories.map((name, i) => <button key={name} type="button" className="prefscat" onClick={() => show(i)}>{name}</button>)}
          </nav>
          <div ref={form} className="form wide-labels">
            <PreferencesForm {...props} />
          </div>
        </div>
        <p className="hint">{t("prefs.note")}</p>
        <div className="dlg-buttons">
          <button type="button" className="abtn primary" onClick={onClose}><span>{t("dialog.close")}</span></button>
        </div>
      </div>
    </div>
  );
}
