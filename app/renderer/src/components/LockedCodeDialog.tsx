import type { LockedFileChange } from "../../../../src/generator/lockedCode.ts";
import { t } from "../strings.ts";
import { Dialog } from "./ui.tsx";

/**
 * Unlocking an element whose locked files were edited (KUYRUK 131): lists, per file, the lines only the locked file
 * has (lost on unlock) and the lines fresh generation brings, then asks before dropping them.
 */
export function UnlockCodeDialog({ name, changes, onUnlock, onCancel }: { name: string; changes: LockedFileChange[]; onUnlock: () => void; onCancel: () => void }) {
  const edited = changes.filter((c) => c.status === "edited");
  return (
    <Dialog title={t("lock.unlockTitle", { name })} okLabel={t("lock.unlockConfirm")} canOk danger onOk={onUnlock} onCancel={onCancel}>
      <p className="dim" data-testid="unlock-lead">{t("lock.unlockLead", { count: edited.length })}</p>
      <div className="lockdiff" data-testid="unlock-diff">
        {edited.map((c) => (
          <div key={`${c.engine}/${c.path}`} className="lockfile">
            <div className="lockpath"><code>{c.path.split("/").pop()}</code> <span className="dim">{c.engine}</span></div>
            {c.diff?.lost.map((l) => <div key={`l${l.line}`} className="lockline lost"><span className="dim">{l.line}</span> − {l.text}</div>)}
            {c.diff?.added.map((l) => <div key={`a${l.line}`} className="lockline added"><span className="dim">{l.line}</span> + {l.text}</div>)}
            {c.diff && c.diff.lostLines + c.diff.addedLines > c.diff.lost.length + c.diff.added.length
              && <div className="dim">{t("lock.moreLines", { count: c.diff.lostLines + c.diff.addedLines - c.diff.lost.length - c.diff.added.length })}</div>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
