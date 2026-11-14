import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, type GitCommit } from "./git.ts";

/**
 * The changelog of a version jar (KUYRUK 168): the commits made since the last successful export. The export that
 * succeeded is remembered in .mcedge/last-export.json (versioned with the project, so collaborators share it); it is
 * written only when every engine of an export batch built, so a failed export does not move it.
 */
export const LAST_EXPORT = join(".mcedge", "last-export.json");

export interface LastExport {
  /** Full hash of HEAD when the jar was exported; absent when the project had no commit yet. */
  commit?: string;
  /** The mod version of that export. */
  version: string;
  /** ISO date of the export. */
  date: string;
}

export interface Changelog {
  /** The project is a git repository. */
  repo: boolean;
  /** The last successful export, when there was one. */
  since?: LastExport;
  /** The last export's commit is not in this history (rewritten, another clone): the commits after its date are listed. */
  sinceMissing?: boolean;
  /** Commits since the last export that touch the project folder (other than the export record), newest first, merges left out. */
  commits: GitCommit[];
  /** More commits than the list holds (a first export of a long history). */
  truncated: boolean;
  /** Changes not committed yet; they are not in the list. */
  uncommitted: boolean;
  /** Markdown text: a heading with the version, then one line per commit. */
  text: string;
}

const LIMIT = 200;
/**
 * The project folder without the export record and the schemas the app rewrites when it opens a project: neither is
 * a change of the mod.
 */
const PATHS = ["--", ".", `:(exclude)${LAST_EXPORT.replaceAll("\\", "/")}`, ":(exclude)schemas"];

export function readLastExport(dir: string): LastExport | undefined {
  const file = join(dir, LAST_EXPORT);
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return typeof value?.version === "string" && typeof value?.date === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

const ok = (dir: string, args: string[]) => git(dir, args).then(() => true, () => false);

async function commits(dir: string, range: string[]): Promise<GitCommit[]> {
  const out = await git(dir, ["log", `-${LIMIT + 1}`, "--no-merges", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e", ...range, ...PATHS]).catch(() => "");
  return out.split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [hash, short, author, date, subject] = s.split("\x1f");
    return { hash, short, author, date, subject };
  });
}

export function changelogText(version: string, list: GitCommit[]): string {
  return [`## ${version}`, "", ...list.map((c) => `- ${c.subject}`)].join("\n") + "\n";
}

/** The changelog of the next export of `version`. */
export async function changelogSinceExport(dir: string, version: string): Promise<Changelog> {
  const since = readLastExport(dir);
  if (!(await ok(dir, ["rev-parse", "--git-dir"]))) return { repo: false, since, commits: [], truncated: false, uncommitted: false, text: changelogText(version, []) };
  const uncommitted = (await git(dir, ["status", "--porcelain", ...PATHS]).catch(() => "")).trim() !== "";
  let range: string[] = [];
  let sinceMissing = false;
  if (since?.commit) {
    if (await ok(dir, ["merge-base", "--is-ancestor", since.commit, "HEAD"])) range = [`${since.commit}..HEAD`];
    else {
      sinceMissing = true;
      range = [`--since=${since.date}`];
    }
  } else if (since) range = [`--since=${since.date}`];
  const list = (await ok(dir, ["rev-parse", "--verify", "HEAD"])) ? await commits(dir, range) : [];
  const truncated = list.length > LIMIT;
  const shown = list.slice(0, LIMIT);
  return { repo: true, since, ...(sinceMissing ? { sinceMissing } : {}), commits: shown, truncated, uncommitted, text: changelogText(version, shown) };
}

/** Remembers a successful export: HEAD (when there is one), the version and now. */
export async function recordExport(dir: string, version: string): Promise<LastExport> {
  const head = (await git(dir, ["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim();
  const mark: LastExport = { ...(head ? { commit: head } : {}), version, date: new Date().toISOString() };
  const file = join(dir, LAST_EXPORT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(mark, null, 2) + "\n");
  return mark;
}
