import { useState } from "react";
import type { BlockbenchOpen } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t } from "../strings.ts";

/**
 * Edit in Blockbench (KUYRUK 171) for a project JSON model: `open` copies the model with its textures (and a block's
 * own texture mapping) to a work folder, starts Blockbench there, and Blockbench's saves come back into the project.
 * `note` says what happened: started, or not found and where to set the program.
 */
export function useBlockbench(dir: string) {
  const [result, setResult] = useState<BlockbenchOpen>();
  const [failed, setFailed] = useState<string>();
  const open = async (model: string, overrides?: Record<string, string>) => {
    setFailed(undefined);
    try {
      setResult(await api.editInBlockbench(dir, model, overrides));
    } catch (error) {
      setResult(undefined);
      setFailed(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));
    }
  };
  const note = failed ? <p className="ferr bbnote">{failed}</p>
    : result?.ok ? <p className="hint nomargin bbnote" title={result.file}>{t("blockbench.opened", { count: result.textures.length })}</p>
    : result ? <p className="ferr bbnote" title={result.searched.join("\n")}>{t("blockbench.missing")}</p>
    : null;
  return { open, note, reset: () => (setResult(undefined), setFailed(undefined)) };
}
