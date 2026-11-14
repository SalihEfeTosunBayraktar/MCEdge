import { useEffect, useMemo, useRef, useState } from "react";
import type { GitBranch, GitFile, GitLogCommit, GitStatus } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ActionBar, ActionButton, DataTable, Dialog, FindBar, FormGroup, FormRow, PanelEmpty, Separator, SidePanel } from "../components/ui.tsx";
import { language, t } from "../strings.ts";
import { layoutGraph, parseRefs, type GraphEdge, type GraphRow } from "./graph.ts";

interface Props {
  dir: string;
  /** Called after git changed files in the project (discard, revert, pull), so views reload. */
  onFilesChanged: () => void;
}

/** Status letters of `git status --porcelain=v2` as words. */
const STATE: Record<string, string> = { M: "git.state.modified", A: "git.state.added", D: "git.state.deleted", R: "git.state.renamed", C: "git.state.copied", U: "git.state.conflict", "?": "git.state.untracked" };
const stateOf = (f: GitFile) => (f.worktree !== "." && f.worktree !== "?" ? f.worktree : f.index);
const staged = (f: GitFile) => f.index !== "." && f.index !== "?";
/** Has changes that are not staged yet. */
const unstaged = (f: GitFile) => !staged(f) || f.worktree !== ".";
/** Commits the History graph reads at a time; Load more adds as many again. */
const PAGE = 200;

/**
 * Git panel (KUYRUK 197 layout): every action sits next to what it acts on. The toolbar keeps only view-wide pull,
 * push and refresh; stage / unstage / discard are on the changes table (row buttons and a bar over it), revert on the
 * history bar, commit and commit-and-push under the message, New branch beside the branch field. History draws the
 * branch graph of every branch and tag. Runs the git CLI with the user's own config and credentials.
 */
export function GitView({ dir, onFilesChanged }: Props) {
  const [status, setStatus] = useState<GitStatus>();
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [selected, setSelected] = useState<string>();
  const [diff, setDiff] = useState("");
  const [log, setLog] = useState<GitLogCommit[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [commit, setCommit] = useState<string>();
  const [message, setMessage] = useState("");
  const [all, setAll] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ ok: boolean; text: string }>();
  const [confirm, setConfirm] = useState<{ kind: "discard"; paths: string[] } | { kind: "revert" }>();
  const [branches, setBranches] = useState<GitBranch[]>([]);
  /** Name typed in the New branch dialog; undefined while it is closed. */
  const [newBranch, setNewBranch] = useState<string>();
  /** Commit box: commit on a new branch with this name instead of the current one. */
  const [commitBranch, setCommitBranch] = useState<string>();

  const readLog = () => api.gitLog(dir, limit, true);
  /** Bumped by every action, so a status read that started before it cannot overwrite its result. */
  const seq = useRef(0);
  const refresh = async () => {
    const started = seq.current;
    const next = await api.gitStatus(dir);
    if (seq.current !== started) return;
    setStatus(next);
    if (next.repo) (setLog(await readLog()), setBranches(await api.gitBranches(dir)));
  };
  useEffect(() => void refresh(), [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  // Outside changes (the editor's own saves, an agent over MCP) show up without a manual refresh.
  useEffect(() => api.onFsChange((c) => c.dir === dir && void refresh()), [dir, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void (limit > PAGE && readLog().then(setLog)), [limit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted by path, not in git's order (staged before untracked), so a row stays where it was when it is staged.
  const files = (status?.files ?? []).filter((f) => !query || f.path.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const file = status?.files.find((f) => f.path === selected);
  useEffect(() => {
    if (tab === "changes" && file) void api.gitDiff(dir, file.path, staged(file) && file.worktree === ".").then(setDiff);
    else if (tab === "history" && commit) void api.gitShow(dir, commit).then(setDiff);
    else setDiff("");
  }, [tab, selected, commit, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const graph = useMemo(() => {
    const { rows, width } = layoutGraph(log);
    return { width, rowOf: new Map(log.map((c, i) => [c.hash, rows[i]])) };
  }, [log]);

  /** Runs a git action; its error (or pull/push output) shows under the toolbar. */
  const act = async (fn: () => Promise<GitStatus | { status: GitStatus; output: string }>, changesFiles = false) => {
    setBusy(true);
    setOutput(undefined);
    seq.current++;
    try {
      const result = await fn();
      seq.current++;
      if ("output" in result) (setStatus(result.status), setOutput({ ok: true, text: result.output || t("git.done") }));
      else setStatus(result);
      setLog(await readLog());
      setBranches(await api.gitBranches(dir));
      if (changesFiles) onFilesChanged();
    } catch (error) {
      setOutput({ ok: false, text: String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, "") });
    } finally {
      setBusy(false);
    }
  };
  const doCommit = (push: boolean) => act(async () => {
    const next = await api.gitCommit(dir, message, all, commitBranch?.trim() || undefined);
    setMessage("");
    setCommitBranch(undefined);
    return push ? api.gitPush(dir) : next;
  });

  if (!status) return <section className="view"><p className="empty-note">{t("git.loading")}</p></section>;
  if (!status.repo) {
    return (
      <section className="view">
        <FindBar query="" onQuery={() => undefined} placeholder={t("git.search")} disabled />
        <ActionBar><ActionButton icon="plus" label={t("git.init")} tone="primary" onClick={() => act(() => api.gitInit(dir))} /></ActionBar>
        <div className="scrollarea"><PanelEmpty text={t("git.noRepo")} /></div>
      </section>
    );
  }
  const date = new Intl.DateTimeFormat(language(), { dateStyle: "medium", timeStyle: "short" });
  const stagedCount = status.files.filter(staged).length;
  const cannotCommit = busy || !message.trim() || (!all && !stagedCount) || !status.files.length || (commitBranch !== undefined && !validBranch(commitBranch));
  const toStage = files.filter(unstaged).map((f) => f.path);
  const toUnstage = files.filter(staged).map((f) => f.path);
  const rowButton = (icon: "plus" | "back" | "trash", label: string, run: () => void) => (
    <button className="vbtn gact" title={label} aria-label={label} disabled={busy} onClick={(e) => (e.stopPropagation(), run())}><Icon name={icon} size={10} /></button>
  );
  return (
    <section className="view gitview">
      <FindBar query={query} onQuery={setQuery} placeholder={t("git.search")}
        meta={t("git.meta", { branch: status.branch, upstream: status.upstream ?? t("git.noUpstream"), ahead: status.ahead, behind: status.behind })} />
      <ActionBar>
        <ActionButton icon="down" label={t("git.pull")} disabled={busy || !status.remotes.length} onClick={() => act(() => api.gitPull(dir), true)} />
        <ActionButton icon="up" label={t("git.push")} disabled={busy || !status.remotes.length} onClick={() => act(() => api.gitPush(dir))} />
        <Separator />
        <ActionButton icon="tidy" label={t("git.refresh")} disabled={busy} onClick={() => void refresh()} />
      </ActionBar>
      {/* Sub-tabs under the toolbar, as in Resources (KUYRUK 120). */}
      <div className="langtabs pagetabs" role="tablist">
        <button role="tab" aria-selected={tab === "changes"} className={`ltab ${tab === "changes" ? "on" : ""}`} onClick={() => setTab("changes")}>
          {t("git.changes")}<span className="lpct">{status.files.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "history"} className={`ltab ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}>
          {t("git.history")}<span className="lpct">{log.length}</span>
        </button>
      </div>
      {output && <p className={`notice gitout ${output.ok ? "" : "bad"}`}>{output.text}</p>}
      <div className="split">
        <div className="gitmain">
          {tab === "changes" ? (
            <div className="gittable gitchanges">
              <div className="minibar gitbar">
                <button className="mbtn" disabled={busy || !toStage.length} onClick={() => act(() => api.gitStage(dir, toStage))}><Icon name="plus" />{t("git.stageAll")}</button>
                <button className="mbtn" disabled={busy || !toUnstage.length} onClick={() => act(() => api.gitUnstage(dir, toUnstage))}><Icon name="back" />{t("git.unstageAll")}</button>
                <button className="mbtn danger" disabled={busy || !files.length} onClick={() => setConfirm({ kind: "discard", paths: files.map((f) => f.path) })}><Icon name="trash" />{t("git.discardAll")}</button>
                <span className="fmeta">{t("git.stagedCount", { staged: stagedCount, count: status.files.length })}</span>
              </div>
              <DataTable rows={files} rowKey={(f) => f.path} selected={selected} onSelect={setSelected} empty={t("git.clean")} columns={[
                { label: t("git.col.state"), width: "130px", cell: (f) => <span className={`gstate s-${stateOf(f)}`}>{t((STATE[stateOf(f)] ?? "git.state.modified") as never)}</span> },
                { label: t("git.col.file"), cell: (f) => <code>{f.path}</code> },
                { label: t("git.col.staged"), width: "90px", cell: (f) => (staged(f) ? <b>{t("git.yes")}</b> : <span className="dim">{t("git.no")}</span>) },
                { label: "", width: "86px", cell: (f) => (
                  <span className="gacts">
                    {unstaged(f) && rowButton("plus", t("git.stage"), () => void act(() => api.gitStage(dir, [f.path])))}
                    {staged(f) && rowButton("back", t("git.unstage"), () => void act(() => api.gitUnstage(dir, [f.path])))}
                    {rowButton("trash", t("git.discard"), () => setConfirm({ kind: "discard", paths: [f.path] }))}
                  </span>
                ) },
              ]} />
            </div>
          ) : (
            <div className="gittable githistory">
              <div className="minibar gitbar">
                <button className="mbtn danger" disabled={busy || !commit} onClick={() => setConfirm({ kind: "revert" })}><Icon name="undo" />{t("git.revert")}</button>
                <span className="fmeta">{t("git.graphMeta", { count: log.length })}</span>
                {log.length >= limit && <button className="mbtn" disabled={busy} onClick={() => setLimit(limit + PAGE)}><Icon name="down" />{t("git.loadMore")}</button>}
              </div>
              <DataTable rows={log} rowKey={(c) => c.hash} selected={commit} onSelect={setCommit} empty={t("git.noCommits")} columns={[
                { label: t("git.col.graph"), width: `${Math.max(3, graph.width) * LANE + 12}px`, cell: (c) => <GraphCell row={graph.rowOf.get(c.hash)!} head={c.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> "))} /> },
                { label: t("git.col.commit"), width: "80px", cell: (c) => <code>{c.short}</code> },
                { label: t("git.col.subject"), cell: (c) => (
                  <>
                    {parseRefs(c.refs, status.remotes).map((r) => (
                      <span key={`${r.kind}:${r.name}`} className={`gref ${r.kind}${r.current ? " current" : ""}`} title={r.kind === "head" ? t("git.headHint") : undefined}>
                        {r.kind === "tag" && <Icon name="tag" size={10} />}{r.kind === "branch" && <Icon name="branch" size={10} />}{r.name}
                      </span>
                    ))}
                    {c.subject}
                  </>
                ) },
                { label: t("git.col.author"), width: "150px", cell: (c) => c.author },
                { label: t("git.col.date"), width: "160px", cell: (c) => date.format(new Date(c.date)) },
              ]} />
            </div>
          )}
          <pre className="gitdiff" aria-label={t("git.diff")}>
            {diff ? diff.split("\n").map((line, i) => <span key={i} className={diffClass(line)}>{line}{"\n"}</span>) : <span className="dim">{t(tab === "changes" ? "git.pickFile" : "git.pickCommit")}</span>}
          </pre>
        </div>
        <SidePanel title={t("git.panel")}>
          <div className="form gitform">
            <FormGroup title={t("git.commitGroup")}>
              <FormRow label={t("git.message")} top>
                <textarea rows={4} value={message} spellCheck={false} placeholder={t("git.messageHint")} onChange={(e) => setMessage(e.target.value)} />
              </FormRow>
              <FormRow label={t("git.include")}>
                <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("git.all", { count: status.files.length })}</label>
              </FormRow>
              <p className="hint">{all ? t("git.allHint") : t("git.stagedHint", { count: stagedCount })}</p>
              <FormRow label={t("git.commitTo")}>
                <label className="check">
                  <input type="checkbox" checked={commitBranch !== undefined} onChange={(e) => setCommitBranch(e.target.checked ? "" : undefined)} />
                  {t("git.onNewBranch")}
                </label>
              </FormRow>
              {commitBranch !== undefined && (
                <FormRow label={t("git.branchName")}>
                  <input value={commitBranch} spellCheck={false} placeholder={t("git.branchNameHint")} aria-label={t("git.branchName")} onChange={(e) => setCommitBranch(e.target.value)} />
                </FormRow>
              )}
              <p className="hint">{commitBranch !== undefined ? t("git.newBranchCommitHint", { branch: commitBranch.trim() || "..." }) : t("git.currentBranchHint", { branch: status.branch })}</p>
              <div className="gitformact">
                <ActionButton icon="check" label={t("git.commit")} tone="primary" disabled={cannotCommit} onClick={() => void doCommit(false)} />
                <ActionButton icon="up" label={t("git.commitPush")} disabled={cannotCommit || !status.remotes.length} onClick={() => void doCommit(true)} />
              </div>
            </FormGroup>
            <FormGroup title={t("git.branchGroup")}>
              <FormRow label={t("git.branch")}>
                <div className="gitbranchrow">
                  <select value={status.branch} disabled={busy || branches.length < 2} aria-label={t("git.branch")} data-branches={branches.length}
                    onChange={(e) => { const name = e.target.value; void act(() => api.gitSwitchBranch(dir, name), true); }}>
                    {!branches.some((b) => b.name === status.branch) && <option value={status.branch}>{status.branch}</option>}
                    {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                  <ActionButton icon="branch" label={t("git.newBranch")} disabled={busy} onClick={() => setNewBranch("")} />
                </div>
              </FormRow>
              <p className="hint">{t("git.switchHint")}</p>
              <FormRow label={t("git.upstream")}><div className="fval"><code>{status.upstream ?? "-"}</code></div></FormRow>
              <FormRow label={t("git.sync")}><div className="fval">{t("git.aheadBehind", { ahead: status.ahead, behind: status.behind })}</div></FormRow>
              <FormRow label={t("git.remotes")}><div className="fval"><code>{status.remotes.join(", ") || "-"}</code></div></FormRow>
            </FormGroup>
          </div>
        </SidePanel>
      </div>
      {newBranch !== undefined && (
        <Dialog title={t("git.newBranchTitle")} okLabel={t("git.createBranch")} canOk={validBranch(newBranch) && !branches.some((b) => b.name === newBranch.trim())}
          onCancel={() => setNewBranch(undefined)} onOk={() => {
            const name = newBranch.trim();
            setNewBranch(undefined);
            void act(() => api.gitCreateBranch(dir, name));
          }}>
          <FormGroup title={t("git.branchGroup")}>
            <FormRow label={t("git.branchName")}>
              <input autoFocus value={newBranch} spellCheck={false} placeholder={t("git.branchNameHint")} aria-label={t("git.branchName")} onChange={(e) => setNewBranch(e.target.value)} />
            </FormRow>
            {branches.some((b) => b.name === newBranch.trim()) && <p className="ferr">{t("git.branchTaken")}</p>}
            <p className="hint">{t("git.newBranchHint", { branch: status.branch })}</p>
          </FormGroup>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={t(confirm.kind === "discard" ? "git.discardTitle" : "git.revertTitle")} okLabel={t(confirm.kind === "discard" ? "git.discard" : "git.revert")} canOk
          onCancel={() => setConfirm(undefined)} onOk={() => {
            const target = confirm;
            setConfirm(undefined);
            if (target.kind === "discard") void act(() => api.gitDiscard(dir, target.paths), true);
            if (target.kind === "revert" && commit) void act(() => api.gitRevert(dir, commit), true);
          }}>
          <p className="hint">{confirm.kind === "revert" ? t("git.revertConfirm", { commit: log.find((c) => c.hash === commit)?.subject ?? "" })
            : confirm.paths.length === 1 ? t("git.discardConfirm", { path: confirm.paths[0] }) : t("git.discardAllConfirm", { count: confirm.paths.length })}</p>
        </Dialog>
      )}
    </section>
  );
}

/** Width of one graph lane and height of a table row (.grid td: 27px, its 1px border included), in pixels. */
const LANE = 16;
const ROW = 27;
const laneX = (lane: number) => LANE / 2 + 4 + lane * LANE;

/** One row of the branch graph: the lines through the row, then the commit dot (ringed for HEAD). */
function GraphCell({ row, head }: { row: GraphRow; head: boolean }) {
  const mid = ROW / 2;
  const path = (e: GraphEdge, y0: number, y1: number) => {
    const [x0, x1] = [laneX(e.from), laneX(e.to)];
    const d = x0 === x1 ? `M${x0} ${y0}V${y1}` : `M${x0} ${y0}C${x0} ${y0 + mid * 0.7} ${x1} ${y1 - mid * 0.7} ${x1} ${y1}`;
    return <path key={`${y0}:${e.from}:${e.to}`} d={d} className={`g${e.kind} gc${e.color % 8}`} />;
  };
  const width = laneX(Math.max(row.lane, ...[...row.top, ...row.bottom].map((e) => Math.max(e.from, e.to)))) + LANE / 2;
  return (
    <svg className="ggraph" width={width} height={ROW} viewBox={`0 0 ${width} ${ROW}`} aria-hidden="true" data-lane={row.lane} data-head={head || undefined}>
      {row.top.map((e) => path(e, 0, mid))}
      {row.bottom.map((e) => path(e, mid, ROW))}
      {head && <circle cx={laneX(row.lane)} cy={mid} r={7} className="gheadring" />}
      <circle cx={laneX(row.lane)} cy={mid} r={head ? 4.5 : 4} className={`gdot gf${row.color % 8}`} />
    </svg>
  );
}

/** A quick check of git's branch name rules; git itself has the last word (check-ref-format). */
const validBranch = (name: string) => /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\s~^:?*[\\]+(?<![./]|\.lock)$/.test(name.trim()) && !name.trim().startsWith("/");

function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "dmeta";
  if (line.startsWith("@@")) return "dhunk";
  if (line.startsWith("+")) return "dadd";
  if (line.startsWith("-")) return "ddel";
  return "";
}
