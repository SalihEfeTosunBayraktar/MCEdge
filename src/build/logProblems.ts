/** Errors and warnings of a Minecraft / Gradle run log, grouped so repeats count once. */
export interface LogProblem {
  level: "error" | "warning";
  /** The message with numbers, hashes and coordinates replaced, so repeats group together. */
  key: string;
  /** First occurrence as printed (without the time stamp). */
  message: string;
  /** Logger or thread when the line names one ("Server thread", "minecraft/Foo"). */
  source?: string;
  count: number;
  /** 1-based line of the first occurrence in the kept log. */
  firstLine: number;
  /** First stack lines of the first occurrence ("Caused by:" lines included). */
  stack?: string[];
}

// [12:34:56] [Server thread/ERROR] [minecraft/MinecraftServer]: text      (Forge, NeoForge)
// [12:34:56] [Render thread/WARN] (Minecraft) text                         (Fabric)
const LOG4J = /^\[[^\]]*\d\d:\d\d:\d\d[^\]]*\]\s*\[([^\]/]+)\/(ERROR|WARN|FATAL)\]\s*(?:\[([^\]]+)\]:?|\(([^)]+)\))?:?\s*(.*)$/;
const EXCEPTION = /^(?:Exception in thread "[^"]*" )?([\w$.]+(?:Exception|Error|Throwable))(?::\s*(.*))?$/;
const FRAME = /^\s+(at |\.\.\. \d+ more)|^Caused by: |^\s+Suppressed: /;
const GRADLE_FAILURE = /^(FAILURE: .*|Execution failed for task .*|> .*(?:Exception|failed|Failed).*)$/;
const MAX_STACK = 12;

const normalize = (text: string) => text
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
  .replace(/@[0-9a-f]{4,}\b/gi, "@<hash>")
  .replace(/-?\d+(\.\d+)?/g, "<n>");

/**
 * Groups the errors and warnings of a log: log4j ERROR/WARN/FATAL lines, uncaught exceptions with their stack and
 * Gradle failures. Stack lines after a problem stay with it; repeats (same text once numbers are masked) count up.
 */
export function groupLogProblems(lines: string[], options: { warnings?: boolean; match?: RegExp } = {}): { errors: number; warnings: number; problems: LogProblem[] } {
  const groups = new Map<string, LogProblem>();
  let last: { problem: LogProblem; fresh: boolean } | undefined;
  const add = (level: LogProblem["level"], message: string, line: number, source?: string) => {
    const key = `${level}|${normalize(message)}`;
    const known = groups.get(key);
    if (known) {
      known.count++;
      last = { problem: known, fresh: false };
    } else {
      const problem: LogProblem = { level, key: normalize(message), message, ...(source ? { source } : {}), count: 1, firstLine: line };
      groups.set(key, problem);
      last = { problem, fresh: true };
    }
  };
  // Whether the line before is the last problem's header: an exception line right after it is the exception it logged.
  let attached = false;
  // Inside an exception's message, before its first "at" line: Fabric writes several lines there ("Mod 'x' requires
  // any version of geckolib, which is missing!"); they stay with the stack.
  let inMessage = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    const frame = FRAME.test(line);
    if (last && (frame || (attached && EXCEPTION.test(trimmed) && !LOG4J.test(line)) || (inMessage && trimmed && !LOG4J.test(line)))) {
      // Repeats keep the stack of their first occurrence.
      if (last.fresh && (last.problem.stack ??= []).length < MAX_STACK) last.problem.stack!.push(trimmed);
      inMessage = !frame && (inMessage || EXCEPTION.test(trimmed));
      attached = false;
      return;
    }
    attached = false;
    inMessage = false;
    const m = LOG4J.exec(line);
    if (m) {
      const level = m[2] === "WARN" ? "warning" : "error";
      if (level === "warning" && options.warnings === false) {
        last = undefined;
        return;
      }
      add(level, m[5] || line, i + 1, m[3] ?? m[4] ?? m[1]);
    } else if (EXCEPTION.test(trimmed) && !/^\s/.test(line)) {
      add("error", trimmed, i + 1);
      inMessage = true;
    }
    else if (GRADLE_FAILURE.test(trimmed)) add("error", trimmed, i + 1, "gradle");
    else {
      last = undefined;
      return;
    }
    attached = true;
  });
  let problems = [...groups.values()];
  if (options.match) problems = problems.filter((p) => options.match!.test(p.message) || p.stack?.some((s) => options.match!.test(s)) || (p.source && options.match!.test(p.source)));
  problems.sort((a, b) => (a.level === b.level ? b.count - a.count || a.firstLine - b.firstLine : a.level === "error" ? -1 : 1));
  return {
    errors: problems.filter((p) => p.level === "error").reduce((n, p) => n + p.count, 0),
    warnings: problems.filter((p) => p.level === "warning").reduce((n, p) => n + p.count, 0),
    problems,
  };
}
