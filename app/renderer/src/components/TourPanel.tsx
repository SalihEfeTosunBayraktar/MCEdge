import { useEffect, useState } from "react";
import type { ProjectSnapshot, TourState } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { stepDone, syncTour, tourScenario, TOUR_STEPS } from "../tour.ts";
import { Icon } from "./Icon.tsx";

/** Outlines the first visible element a step points at (config/tour.json), and follows the UI as it changes. */
function usePointer(selectors: string[]) {
  useEffect(() => {
    let marked: Element | undefined;
    const update = () => {
      const found = selectors.map((s) => document.querySelector(s)).find((el) => el && (el as HTMLElement).offsetParent !== null);
      if (found === marked) return;
      marked?.classList.remove("tour-point");
      marked = found ?? undefined;
      marked?.classList.add("tour-point");
    };
    update();
    const timer = setInterval(update, 400);
    return () => (clearInterval(timer), marked?.classList.remove("tour-point"));
  }, [selectors.join("|")]);
}

/**
 * The first-mod tour (Q245): a small panel, not a dialog, that lists the steps and checks each against the project
 * (the block exists, its texture is set and not the default, its test scenario passed). The test step writes and runs
 * a scenario on a dedicated server, so it needs neither the Scenarios tab nor Java knowledge, and Simple mode keeps it.
 */
export function TourPanel({ snapshot, engineId, tour, onChange }: { snapshot: ProjectSnapshot; engineId: string; tour: TourState; onChange: (tour: TourState) => void }) {
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    const next = syncTour(snapshot, tour);
    if (next !== tour) onChange(next);
  }, [snapshot, tour]);

  const done = TOUR_STEPS.map((step) => stepDone(snapshot, tour, step.check));
  const current = done.indexOf(false);
  const finished = current < 0;
  usePointer(finished ? [] : TOUR_STEPS[current].point);

  const test = async () => {
    if (!tour.subject || !engineId || running) return;
    const { name, text } = tourScenario(snapshot, tour.subject);
    setRunning(true);
    setProblem(undefined);
    try {
      await api.writeScenario(snapshot.dir, name, text);
      const outcome = await api.runScenario(snapshot.dir, engineId, name);
      if (outcome.ok) return onChange({ ...tour, tested: tour.subject });
      const steps = outcome.result?.steps.filter((s) => s.error || s.pass === false).map((s) => s.label ?? s.op).join(", ");
      setProblem(outcome.error === "serverRunning" ? t("scenarios.serverRunning") : outcome.error === "serverForeign" ? t("scenarios.serverForeign")
        : outcome.error ?? (outcome.result?.fatal ? t("scenarios.fatal", { reason: outcome.result.fatal }) : t("tour.failed", { steps: steps ?? "" })));
    } finally {
      setRunning(false);
    }
  };
  const key = (id: string, part: "title" | "text") => t(`tour.${id}.${part}` as StringKey);

  return (
    <aside className="tour" data-testid="tour" aria-label={t("tour.title")}>
      <header>
        <b>{t("tour.title")}</b>
        <span className="dim" data-testid="tour-progress">{t("tour.progress", { done: done.filter(Boolean).length, total: done.length })}</span>
        <button type="button" className="tour-close" data-testid="tour-close" title={t("tour.closeHint")} aria-label={t("tour.close")}
          onClick={() => onChange({ ...tour, status: "paused" })}><Icon name="close" size={12} /></button>
      </header>
      <ol>
        {TOUR_STEPS.map((step, i) => (
          <li key={step.id} data-step={step.id} data-state={done[i] ? "done" : i === current ? "current" : "todo"}>
            <span className="tour-mark">{done[i] ? <Icon name="check" size={12} /> : i + 1}</span>
            <div>
              <b>{key(step.id, "title")}</b>
              {i === current && <p>{key(step.id, "text")}</p>}
              {i === current && step.check === "scenario" && (
                <>
                  <button type="button" className="abtn primary" data-testid="tour-test" disabled={running || !engineId} onClick={() => void test()}>
                    <Icon name="play" /><span>{t(running ? "tour.testing" : "tour.test")}</span>
                  </button>
                  {running && <p className="dim" data-testid="tour-running">{t("tour.testingHint")}</p>}
                  {problem && <p className="error-text" data-testid="tour-problem">{problem}</p>}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {finished && <p className="tour-done" data-testid="tour-finished"><b>{t("tour.doneTitle")}</b> {t("tour.doneText")}</p>}
      <footer>
        {finished
          ? <button type="button" className="abtn primary" data-testid="tour-finish" onClick={() => onChange({ ...tour, status: "done" })}><span>{t("tour.finish")}</span></button>
          : <button type="button" className="linkbtn" data-testid="tour-skip" onClick={() => onChange({ ...tour, status: "skipped" })}>{t("tour.skip")}</button>}
      </footer>
    </aside>
  );
}

/** The offer on the start screen for a user who answered "new" in the setup. */
export function TourOffer({ onStart, onDecline }: { onStart: () => void; onDecline: () => void }) {
  return (
    <div className="tour-offer" data-testid="tour-offer">
      <b>{t("tour.offerTitle")}</b>
      <p className="hint nomargin">{t("tour.offerText")}</p>
      <div className="tour-offer-buttons">
        <button type="button" className="abtn primary" data-testid="tour-start" onClick={onStart}><Icon name="play" /><span>{t("tour.start")}</span></button>
        <button type="button" className="abtn" data-testid="tour-decline" onClick={onDecline}><span>{t("tour.decline")}</span></button>
      </div>
    </div>
  );
}
