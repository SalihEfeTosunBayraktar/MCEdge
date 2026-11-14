import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Version control for a project through the git CLI on PATH, so the user's credentials, hooks and config apply.
 * Shared by the app's Git panel and the MCP server.
 */
export interface GitFile {
  path: string;
  /** Staged state (porcelain X): M, A, D, R, C, U, ? or "." for none. */
  index: string;
  /** Working tree state (porcelain Y). */
  worktree: string;
}

export interface GitStatus {
  repo: boolean;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  remotes: string[];
}

export interface GitBranch {
  name: string;
  /** The checked-out branch. */
  current: boolean;
  upstream?: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  /** ISO date. */
  date: string;
  subject: string;
}

/** A commit of gitLog: with its parents and the refs pointing at it, enough to draw the branch graph. */
export interface GitLogCommit extends GitCommit {
  /** Full parent hashes, first parent first; none for a root commit, two or more for a merge. */
  parents: string[];
  /** Git's decorations as `git log --decorate` prints them: "HEAD -> main", "origin/main", "tag: v1.0". */
  refs: string[];
}

/** Runs git in the project; rejects with git's own message on a non-zero exit. */
export function git(dir: string, args: string[], input?: string, okExit1 = false): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile("git", ["-C", dir, "-c", "core.quotepath=off", "-c", "color.ui=false", ...args],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => (error && !(okExit1 && error.code === 1) ? reject(new Error((stderr || stdout || error.message).trim())) : resolvePromise(stdout)));
    if (input !== undefined) child.stdin?.end(input);
  });
}

const isRepo = (dir: string) => git(dir, ["rev-parse", "--git-dir"]).then(() => true, () => false);
const hasHead = (dir: string) => git(dir, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);

export async function gitStatus(dir: string): Promise<GitStatus> {
  if (!(await isRepo(dir))) return { repo: false, branch: "", ahead: 0, behind: 0, files: [], remotes: [] };
  const out = await git(dir, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  const files: GitFile[] = [];
  let branch = "", upstream: string | undefined, ahead = 0, behind = 0;
  const records = out.split("\0");
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.startsWith("# branch.head ")) branch = r.slice(14);
    else if (r.startsWith("# branch.upstream ")) upstream = r.slice(18);
    else if (r.startsWith("# branch.ab ")) [ahead, behind] = r.slice(12).split(" ").map((n) => Math.abs(Number(n)));
    else if (r.startsWith("1 ") || r.startsWith("2 ")) {
      const parts = r.split(" ");
      files.push({ path: parts.slice(r.startsWith("1 ") ? 8 : 9).join(" "), index: parts[1][0], worktree: parts[1][1] });
      if (r.startsWith("2 ")) i++; // a rename's original path follows
    } else if (r.startsWith("u ")) files.push({ path: r.split(" ").slice(10).join(" "), index: "U", worktree: "U" });
    else if (r.startsWith("? ")) files.push({ path: r.slice(2), index: "?", worktree: "?" });
  }
  const remotes = (await git(dir, ["remote"]).catch(() => "")).split(/\r?\n/).filter(Boolean);
  return { repo: true, branch, upstream, ahead, behind, files, remotes };
}

export const gitInit = (dir: string) => git(dir, ["init"]);

/** Diff of one file: staged, unstaged, or a new untracked file against nothing. */
export async function gitDiff(dir: string, path: string, staged = false): Promise<string> {
  const status = await gitStatus(dir);
  if (status.files.find((f) => f.path === path)?.index === "?") {
    // --no-index exits 1 when the files differ, which they always do here.
    return git(dir, ["diff", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", path], undefined, true);
  }
  return git(dir, ["diff", ...(staged ? ["--cached"] : []), "--", path]);
}

export const gitStage = (dir: string, paths: string[]) => git(dir, ["add", "-A", "--", ...paths]);

export async function gitUnstage(dir: string, paths: string[]): Promise<void> {
  await git(dir, (await hasHead(dir)) ? ["reset", "-q", "HEAD", "--", ...paths] : ["rm", "-q", "--cached", "--", ...paths]);
}

/** Throws away working-tree changes of files; untracked files are deleted. */
export async function gitDiscard(dir: string, paths: string[]): Promise<void> {
  const files = (await gitStatus(dir)).files;
  const untracked = paths.filter((p) => files.find((f) => f.path === p)?.index === "?");
  const tracked = paths.filter((p) => !untracked.includes(p));
  for (const path of untracked) {
    const file = resolve(dir, path);
    if (relative(dir, file).startsWith("..")) throw new Error(`path outside project: ${path}`);
    rmSync(file, { recursive: true, force: true });
  }
  if (tracked.length) await git(dir, ["checkout", "HEAD", "--", ...tracked]);
}

/** Commits what is staged, or everything when `all`; with `branch`, on a new branch created and switched to first. */
export async function gitCommit(dir: string, message: string, all = false, branch?: string): Promise<string> {
  if (!message.trim()) throw new Error("commit message required");
  if (branch) await gitCreateBranch(dir, branch);
  if (all) await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-F", "-"], message);
  return (await git(dir, ["rev-parse", "--short", "HEAD"])).trim();
}

/**
 * Newest commits first, children always before their parents (--date-order). With `all`, every branch, remote
 * branch and tag (not the stash), as a branch graph shows them; otherwise the current branch only.
 */
export async function gitLog(dir: string, limit = 200, all = false): Promise<GitLogCommit[]> {
  const out = await git(dir, ["log", `-${limit}`, "--date-order", ...(all ? ["--exclude=refs/stash", "--all"] : []),
    "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%P%x1f%D%x1e"]).catch(() => "");
  return out.split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [hash, short, author, date, subject, parents, refs] = s.split("\x1f");
    return { hash, short, author, date, subject, parents: parents ? parents.split(" ") : [], refs: refs ? refs.split(", ") : [] };
  });
}

export const gitShow = (dir: string, hash: string) => git(dir, ["show", "--stat", "--patch", "--format=%H%n%an <%ae>%n%ad%n%n%B", hash]);

/** A new commit that undoes `hash`. */
export const gitRevert = (dir: string, hash: string) => git(dir, ["revert", "--no-edit", hash]);

export const gitPull = (dir: string) => git(dir, ["pull", "--ff-only"]);

/** Pushes the branch, setting its upstream on origin the first time. */
export async function gitPush(dir: string): Promise<string> {
  const status = await gitStatus(dir);
  return git(dir, status.upstream ? ["push"] : ["push", "-u", "origin", status.branch]);
}

/**
 * Local branches. A new repository has no commit yet, so `git branch` lists nothing; its unborn current branch
 * is listed anyway so it can be shown and committed to.
 */
export async function gitBranches(dir: string): Promise<GitBranch[]> {
  const out = await git(dir, ["branch", "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)"]);
  const branches = out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [head, name, upstream] = line.split("\0");
    return { name, current: head === "*", ...(upstream ? { upstream } : {}) };
  }).filter((b) => !b.name.startsWith("("));
  const { branch } = await gitStatus(dir);
  if (branch && branch !== "(detached)" && !branches.some((b) => b.name === branch)) branches.unshift({ name: branch, current: true });
  return branches;
}

/** Throws git's own message when `name` is not a valid branch name. */
const checkBranchName = async (dir: string, name: string) => {
  if (!name.trim()) throw new Error("branch name required");
  await git(dir, ["check-ref-format", "--branch", name]);
};

/**
 * Creates a branch from the current commit (or `from`) and, unless `checkout` is false, switches to it.
 * Uncommitted changes go along to the new branch.
 */
export async function gitCreateBranch(dir: string, name: string, checkout = true, from?: string): Promise<void> {
  await checkBranchName(dir, name);
  if (checkout) await git(dir, ["switch", "-c", name, ...(from ? [from] : [])]);
  else await git(dir, ["branch", name, ...(from ? [from] : [])]);
}

/** Switches to a local branch; git refuses (and says why) when uncommitted changes would be overwritten. */
export async function gitSwitchBranch(dir: string, name: string): Promise<void> {
  await checkBranchName(dir, name);
  await git(dir, ["switch", name]);
}
