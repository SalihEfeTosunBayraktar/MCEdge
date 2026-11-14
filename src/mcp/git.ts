import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gitBranches, gitCommit, gitCreateBranch, gitDiff, gitDiscard, gitInit, gitLog, gitPull, gitPush, gitRevert, gitShow, gitStage, gitStatus, gitSwitchBranch, gitUnstage } from "../vcs/git.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const paths = { paths: z.array(z.string()).min(1).describe("Project-relative paths") };

/** The Git panel for agents (git CLI on PATH, the user's own config and credentials). */
export function registerGitTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool("git_status", { description: "Branch, upstream, ahead/behind, remotes and changed files (index/worktree state per file; ? = untracked)." },
    () => guard(async () => json(await gitStatus(root))));
  server.registerTool("git_init", { description: "Create a git repository in the project folder." }, () => guard(async () => json(await gitInit(root))));
  server.registerTool("git_diff", { description: "Diff of one file: unstaged changes, or staged ones with staged=true; an untracked file shows whole.", inputSchema: { path: z.string(), staged: z.boolean().default(false) } },
    ({ path, staged }) => guard(async () => json((await gitDiff(root, path, staged)) || "no changes")));
  server.registerTool("git_stage", { description: "Stage files (git add).", inputSchema: paths }, ({ paths: p }) => guard(async () => (await gitStage(root, p), json(await gitStatus(root)))));
  server.registerTool("git_unstage", { description: "Unstage files.", inputSchema: paths }, ({ paths: p }) => guard(async () => (await gitUnstage(root, p), json(await gitStatus(root)))));
  server.registerTool("git_discard", { description: "Throw away working-tree changes of files (untracked files are deleted). Cannot be undone.", inputSchema: paths },
    ({ paths: p }) => guard(async () => (await gitDiscard(root, p), json(await gitStatus(root)))));
  server.registerTool("git_commit", {
    description: "Commit the staged changes, or every change with all=true. With branch, first creates that branch from the current commit and switches to it, so the commit lands there. Returns the new short hash and the branch.",
    inputSchema: { message: z.string().min(1), all: z.boolean().default(false), branch: z.string().min(1).optional().describe("New branch to commit on") },
  }, ({ message, all, branch }) => guard(async () => json({ commit: await gitCommit(root, message, all, branch), branch: (await gitStatus(root)).branch })));
  server.registerTool("git_branches", { description: "Local branches: name, current (the checked-out one), upstream." },
    () => guard(async () => json(await gitBranches(root))));
  server.registerTool("git_create_branch", {
    description: "Create a branch from the current commit (or from a branch/commit) and switch to it unless checkout=false. Uncommitted changes go along.",
    inputSchema: { name: z.string().min(1), checkout: z.boolean().default(true), from: z.string().optional().describe("Branch or commit to start from; default the current commit") },
  }, ({ name, checkout, from }) => guard(async () => (await gitCreateBranch(root, name, checkout, from), json(await gitBranches(root)))));
  server.registerTool("git_switch_branch", { description: "Switch to a local branch. Git refuses when uncommitted changes would be overwritten; commit or discard them first.", inputSchema: { name: z.string().min(1) } },
    ({ name }) => guard(async () => (await gitSwitchBranch(root, name), json(await gitStatus(root)))));
  server.registerTool("git_log", {
    description: "Recent commits, newest first (children before parents): hash, short, author, date, subject, parents (full hashes, first parent first; two or more for a merge) and refs (branches, remote branches and tags pointing at it, as git prints them: \"HEAD -> main\", \"tag: v1\"). With all=true, every branch and tag, enough to draw the branch graph.",
    inputSchema: { limit: z.number().int().min(1).max(1000).default(50), all: z.boolean().default(false).describe("Every branch, remote branch and tag instead of the current branch") },
  }, ({ limit, all }) => guard(async () => json(await gitLog(root, limit, all))));
  server.registerTool("git_show", { description: "One commit: message, stat and patch.", inputSchema: { hash: z.string() } }, ({ hash }) => guard(async () => json(await gitShow(root, hash))));
  server.registerTool("git_revert", { description: "Make a new commit that undoes a commit.", inputSchema: { hash: z.string() } },
    ({ hash }) => guard(async () => (await gitRevert(root, hash), json(await gitLog(root, 3)))));
  server.registerTool("git_pull", { description: "Pull (fast-forward only)." }, () => guard(async () => json(await gitPull(root))));
  server.registerTool("git_push", { description: "Push the branch; the first push sets its upstream on origin." }, () => guard(async () => json(await gitPush(root))));
}
