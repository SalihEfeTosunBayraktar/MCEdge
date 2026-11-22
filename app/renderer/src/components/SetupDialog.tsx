import { useEffect, useState } from "react";
import type { ExperienceLevel, Preferences } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { LEVELS, modeFor } from "../experience.ts";
import { applyPreferences, LIGHT_PERFORMANCE } from "../preferences.ts";
import { LANGUAGES, t, type StringKey } from "../strings.ts";
import { Dialog, FormRow } from "./ui.tsx";

/**
 * First-run setup (Q244): the UI language and the user's modding experience, which turns Simple or Advanced mode on.
 * Shown while the preferences have no level; Skip keeps everything shown and does not ask again.
 */
export function SetupDialog({ preferences, onDone }: { preferences: Preferences; onDone: (preferences: Preferences) => void }) {
  const [language, setLanguage] = useState(preferences.language);
  const [level, setLevel] = useState<ExperienceLevel>();
  // The machine is read once (Q250); a weak one starts with light mode ticked, the user decides.
  const [machine, setMachine] = useState<Awaited<ReturnType<typeof api.systemInfo>>>();
  const [light, setLight] = useState(false);
  useEffect(() => void api.systemInfo().then((info) => (setMachine(info), setLight(info.suggestLight))), []);
  const pickLanguage = (code: string) => {
    setLanguage(code);
    // The dialog itself switches language at once; the choice is saved with the answer.
    applyPreferences({ ...preferences, language: code });
  };
  const finish = (answer: ExperienceLevel, mode = modeFor(answer)) => onDone({ ...preferences, language, level: answer, mode, ...(light ? { performance: LIGHT_PERFORMANCE } : {}) });
  return (
    <Dialog title={t("setup.title")} okLabel={t("setup.start")} cancelLabel={t("setup.skip")} canOk={!!level} explicit
      onOk={() => level && finish(level)} onCancel={() => finish("some", "advanced")}>
      <div className="form setup" data-testid="setup">
        <p className="hint nomargin">{t("setup.intro")}</p>
        <FormRow label={t("prefs.languageLabel")}>
          <select value={language} data-testid="setup-language" onChange={(e) => pickLanguage(e.target.value)}>
            {Object.entries(LANGUAGES).map(([code, { name }]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </FormRow>
        <fieldset className="setup-levels">
          <legend>{t("setup.question")}</legend>
          {LEVELS.map(({ id }) => (
            <label key={id} className={`setup-level ${level === id ? "on" : ""}`} data-level={id}>
              <input type="radio" name="setup-level" value={id} checked={level === id} onChange={() => setLevel(id)} />
              <span>
                <b>{t(`setup.level.${id}` as StringKey)}</b>
                <small>{t(`setup.level.${id}Hint` as StringKey)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {machine && (
          <label className="setup-light" data-testid="setup-light-row">
            <input type="checkbox" checked={light} data-testid="setup-light" onChange={(e) => setLight(e.target.checked)} />
            <span>
              <b>{t("setup.light")}</b>
              <small>{t("perf.machine", { ram: machine.ramGb, cores: machine.cores })} {t(machine.suggestLight ? "setup.lightSuggested" : "setup.lightHint")}</small>
            </span>
          </label>
        )}
        <p className="hint nomargin">{t("setup.later")}</p>
      </div>
    </Dialog>
  );
}
