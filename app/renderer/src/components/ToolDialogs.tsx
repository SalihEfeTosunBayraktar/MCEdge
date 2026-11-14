import { useEffect, useRef, useState } from "react";
import type { ClientRunOptions, Opened } from "../../../shared/api.ts";
import { isPlayerName, nextPlayer } from "../../../../src/build/players.ts";
import { api } from "../api.ts";
import vanillaIds from "../../../../config/vanilla-ids.json" with { type: "json" };
import { t, type StringKey } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

/** Kinds of config/vanilla-ids.json, in the order the data lists show them. */
const KINDS = Object.keys(vanillaIds).filter((k) => !k.startsWith("$")) as string[];
const IDS = vanillaIds as unknown as Record<string, string[]>;

/**
 * Tools > Minecraft data lists (KUYRUK 135): the game's ids MCEdge knows (items, blocks, entities, particles, sounds,
 * ...), searchable, with a copy button per id for pasting into fields and procedures.
 */
export function DataListsDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const [kind, setKind] = useState(KINDS.includes("item") ? "item" : KINDS[0]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string>();
  const q = query.trim().toLowerCase();
  const ids = (IDS[kind] ?? []).filter((id) => !q || id.includes(q));
  const copy = async (id: string) => {
    await navigator.clipboard.writeText(id).catch(() => {});
    setCopied(id);
  };
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog datalists" role="dialog" data-testid="data-lists" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("dataLists.title")}</div>
        <div className="fpair">
          <select aria-label={t("dataLists.kind")} value={kind} onChange={(e) => (setKind(e.target.value), setCopied(undefined))}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`dataLists.kind.${k}` as StringKey)} ({IDS[k].length})</option>)}
          </select>
          <input value={query} placeholder={t("dataLists.search")} aria-label={t("dataLists.search")} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="plain datalist-ids" role="list">
          {ids.map((id) => (
            <li key={id}>
              <code>{id}</code>
              <button type="button" className="mbtn" onClick={() => void copy(id)} aria-label={t("dataLists.copyId", { id })}>
                <Icon name={copied === id ? "check" : "copy"} size={12} /><span>{t(copied === id ? "dataLists.copied" : "dataLists.copy")}</span>
              </button>
            </li>
          ))}
          {!ids.length && <li className="dim">{t("list.noMatch")}</li>}
        </ul>
        <p className="hint">{t("dataLists.hint")}</p>
        <div className="dlg-buttons"><button type="button" className="abtn" onClick={onClose}><span>{t("dialog.close")}</span></button></div>
      </div>
    </div>
  );
}

/** Common Gradle tasks offered while typing; any task the project has can be typed. */
const TASKS = ["build", "clean", "runClient", "runServer", "runData", "jar", "dependencies", "tasks", "genSources", "--refresh-dependencies build"];

/** Build & run > Run Gradle task (KUYRUK 135): one task line, run on the selected engine in the Gradle console. */
export function GradleTaskDialog({ engineName, onRun, onClose }: { engineName: string; onRun: (args: string[]) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const [task, setTask] = useState("");
  const args = task.trim().replace(/^(gradlew?|\.\/gradlew)\s*/, "").split(/\s+/).filter(Boolean);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form ref={box} className="dialog" data-testid="gradle-task" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => (e.preventDefault(), args.length && onRun(args))}>
        <div className="ptitle">{t("gradleTask.title")}</div>
        <FormGroup title={t("gradleTask.group", { engine: engineName })}>
          <FormRow label={t("gradleTask.task")}>
            <input name="task" list="gradle-tasks" value={task} spellCheck={false} placeholder="build" onChange={(e) => setTask(e.target.value)} />
          </FormRow>
          <datalist id="gradle-tasks">{TASKS.map((x) => <option key={x} value={x} />)}</datalist>
          <p className="hint">{t("gradleTask.hint")}</p>
        </FormGroup>
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!args.length}><Icon name="play" /><span>{t("gradleTask.run")}</span></button>
          <button type="button" className="abtn" onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}

/**
 * Build & run > Run another client (KUYRUK 190): a client of the selected engine as another player, beside the ones
 * running (`players`), optionally joining the engine's test server, for multiplayer tests.
 */
export function RunClientDialog({ engineName, players, serverRunning, onRun, onClose }: {
  engineName: string;
  players: string[];
  serverRunning: boolean;
  onRun: (options: ClientRunOptions) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const [player, setPlayer] = useState(() => nextPlayer(players));
  const [join, setJoin] = useState(serverRunning);
  const name = player.trim();
  const error = !isPlayerName(name) ? t("runClient.badName") : players.includes(name) ? t("runClient.taken", { player: name }) : undefined;
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form ref={box} className="dialog" data-testid="run-client" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => (e.preventDefault(), !error && onRun({ player: name, join }))}>
        <div className="ptitle">{t("runClient.title")}</div>
        <FormGroup title={t("runClient.group", { engine: engineName })}>
          <FormRow label={t("runClient.player")}>
            <input name="player" value={player} spellCheck={false} maxLength={16} onChange={(e) => setPlayer(e.target.value)} />
          </FormRow>
          <label className="check">
            <input type="checkbox" name="join" checked={join} onChange={(e) => setJoin(e.target.checked)} />
            <span>{t("runClient.join")}</span>
          </label>
          <p className="hint">{t(serverRunning ? "runClient.hint" : "runClient.noServer")}</p>
        </FormGroup>
        {error && name && <p className="error-text" data-testid="run-client-error">{error}</p>}
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!!error}><Icon name="play" /><span>{t("runClient.run")}</span></button>
          <button type="button" className="abtn" onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}

/**
 * File > Import project from ZIP (KUYRUK 135): a workspace export (File > Export workspace) and the folder it goes in;
 * Import extracts it into a new folder named like the project and opens it.
 */
export function ImportZipDialog({ onImported, onClose }: { onImported: (opened: Opened) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box);
  const [zip, setZip] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => void api.newProjectFolder().then(setParent), []);
  const ok = !busy && zip.trim() !== "" && parent.trim() !== "";
  const run = async () => {
    setBusy(true);
    try {
      onImported(await api.importProjectZip(zip.trim(), parent.trim()));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      setBusy(false);
    }
  };
  return (
    <div className="backdrop" onMouseDown={() => !busy && onClose()}>
      <form ref={box} className="dialog" data-testid="import-zip" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
        onSubmit={(e) => (e.preventDefault(), ok && void run())}>
        <div className="ptitle">{t("importZip.title")}</div>
        <FormGroup title={t("importZip.group")}>
          <FormRow label={t("importZip.zip")}>
            <div className="fpair">
              <input name="zip" value={zip} spellCheck={false} onChange={(e) => setZip(e.target.value)} />
              <button type="button" className="abtn" onClick={async () => { const f = await api.pickZip(); if (f) setZip(f); }}><Icon name="folder" /><span>{t("export.browse")}</span></button>
            </div>
          </FormRow>
          <FormRow label={t("newProject.folder")}>
            <div className="fpair">
              <input name="parent" value={parent} spellCheck={false} onChange={(e) => setParent(e.target.value)} />
              <button type="button" className="abtn" onClick={async () => { const f = await api.pickFolder(parent); if (f) setParent(f); }}><Icon name="folder" /><span>{t("export.browse")}</span></button>
            </div>
          </FormRow>
          <p className="hint">{t("importZip.hint")}</p>
        </FormGroup>
        {error && <p className="error-text" data-testid="import-zip-error">{error}</p>}
        <div className="dlg-buttons">
          <button type="submit" className="abtn primary" disabled={!ok}><Icon name="import" /><span>{t("importZip.import")}</span></button>
          <button type="button" className="abtn" disabled={busy} onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </form>
    </div>
  );
}
