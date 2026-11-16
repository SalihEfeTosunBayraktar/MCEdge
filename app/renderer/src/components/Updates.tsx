import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clientRunPlayer, type UpdateState } from "../../../shared/api.ts";
import type { EngineBuild } from "../model.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";
import { markdown, Modal } from "./HelpDialogs.tsx";
import { Icon } from "./Icon.tsx";
import { FormGroup } from "./ui.tsx";

/** A game client or server of this app is starting or running: restarting for an update would stop it. */
export const gameRunning = (builds: Record<string, EngineBuild>) =>
  Object.entries(builds).some(([key, b]) => (b.status === "running" || b.status === "waiting") && (/ server$/.test(key) || clientRunPlayer(key) !== undefined));

/** The app's update state (Q207), kept current by the main process. */
export function useUpdateState(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    void api.updateState().then(setState);
    return api.onUpdateState(setState);
  }, []);
  return state;
}

/**
 * Update dialog: Help > Check for updates (`check`: asks for the latest release first, failures shown) or the status
 * bar's update item. Shows the release notes; a downloaded update offers Restart now, which asks first while a game
 * client or server runs because restarting stops it.
 */
export function UpdateDialog({ check, confirm = false, gameRunning, onClose }: {
  check?: boolean;
  /** Opened by Restart now during a game run: the warning shows at once. */
  confirm?: boolean;
  gameRunning: boolean;
  onClose: () => void;
}) {
  const live = useUpdateState();
  const [checked, setChecked] = useState(!check);
  const [confirming, setConfirming] = useState(confirm);
  useEffect(() => void (check && api.checkUpdates().then(() => setChecked(true))), [check]);
  const state = checked ? live : undefined;
  const latest = state?.latest ?? "";
  const text = !state || state.status === "checking" || state.status === "idle" ? t("updates.checking")
    : state.status === "latest" ? t("updates.latest", { version: state.current })
    : state.status === "failed" ? t("updates.failed", { message: state.message ?? "" })
    : state.status === "downloading" ? t("updates.downloading", { latest, version: state.current, percent: state.percent ?? 0 })
    : state.status === "ready" ? t("updates.ready", { latest })
    : t("updates.manual", { latest, version: state.current });
  const restart = () => (gameRunning && !confirming ? setConfirming(true) : void api.installUpdate());
  const offered = state?.status === "available" || state?.status === "downloading" || state?.status === "ready";
  return (
    <Modal title={offered ? t("updates.notesTitle", { version: latest }) : t("updates.title")} className="updatedlg" onClose={onClose}
      closeLabel={offered ? t("updates.later") : undefined} buttons={<>
        {state?.url && <button type="button" className="abtn primary" onClick={() => void api.openExternal(state.url!)}><Icon name="globe" /><span>{t("updates.open")}</span></button>}
        {state?.status === "ready" && (
          <button type="button" className={`abtn ${confirming ? "danger" : "primary"}`} onClick={restart} data-testid="update-restart">
            <Icon name="redo" /><span>{t(confirming ? "updates.stopAndRestart" : "updates.restart")}</span>
          </button>
        )}
      </>}>
      <p className="notice" data-testid="update-status" data-status={state?.status ?? "checking"}>{text}</p>
      {confirming && <p className="notice" data-testid="update-game-running">{t("updates.gameRunning")}</p>}
      {offered && (
        <FormGroup title={t("updates.notes")}>
          <div className="markdown updnotes" data-testid="update-notes">{state.notes ? markdown(state.notes) : <p>{t("updates.noNotes")}</p>}</div>
        </FormGroup>
      )}
    </Modal>
  );
}

/**
 * Status-bar item of an update (Q207): a release to download by hand, the download's progress, then Restart now /
 * Later. Checks that find nothing or fail stay quiet here. Clicking it opens the update dialog with the notes.
 */
export function UpdateItem({ gameRunning }: { gameRunning: boolean }) {
  const state = useUpdateState();
  const [later, setLater] = useState(false);
  const [dialog, setDialog] = useState<"notes" | "confirm">();
  if (!state || !["available", "downloading", "ready"].includes(state.status)) return null;
  const version = state.latest ?? "";
  const label = state.status === "available" ? t("status.updateAvailable", { version })
    : state.status === "downloading" ? t("status.updateDownloading", { version, percent: state.percent ?? 0 })
    : later ? t("status.restartToUpdate") : t("status.updateReady", { version });
  const restart = () => (gameRunning ? setDialog("confirm") : void api.installUpdate());
  return (
    <span className={`sitem update ${state.status}`} data-testid="update-item" data-status={state.status}>
      <button type="button" className="sitem" title={t("status.updateHint")} onClick={() => setDialog("notes")}>
        <Icon name={state.status === "ready" ? "check" : "down"} />{label}
      </button>
      {state.status === "ready" && !later && (
        <>
          <button type="button" className="mbtn" onClick={restart} data-testid="update-item-restart">{t("updates.restart")}</button>
          <button type="button" className="mbtn" onClick={() => setLater(true)}>{t("updates.later")}</button>
        </>
      )}
      {/* Outside the status bar, which would pass its nowrap small text on to the dialog. */}
      {dialog && createPortal(<UpdateDialog confirm={dialog === "confirm"} gameRunning={gameRunning} onClose={() => setDialog(undefined)} />, document.body)}
    </span>
  );
}
